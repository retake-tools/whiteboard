import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PluginRuntimeSnapshotV1 } from '@retake-tools/package-sdk';
import type { RetakePackageManifest } from '../src/core/packageContracts';
import {
  configureInstalledRuntimeRegistry,
  type InstalledRuntimeRegistrySnapshotV1,
  withSnapshotDigest,
} from '../src/core/installedRuntimeRegistry';
import { readMaterializedPackageArchive } from './declarative-package-service';
import {
  LocalPackageManagerService,
  type InstalledDeclarativePackageRegistry,
} from './local-package-manager-service';
import { packageVersionSatisfies, parsePackageVersion } from './package-semver';
import { PluginRuntimeService } from './plugin-runtime-service';
import type {
  ResolvedWorkspacePackage,
  WorkspacePackageLock,
} from './workspace-package-lock';

export const defaultBootstrapProfileId = 'retake.default-video-production';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const defaultBootstrapProfilePath = path.join(
  repositoryRoot,
  'packages',
  'bootstrap',
  'retake.bootstrap.json',
);

export interface BootstrapPackageReference {
  archiveDigest: string;
  archivePath: string;
  digest: string;
  packageId: string;
  version: string;
}

export interface DeclarativePackageBootstrapProfileV1 {
  dependencyPackages: BootstrapPackageReference[];
  hostCompatibility: string;
  profileId: string;
  rootPackage: BootstrapPackageReference;
  schemaVersion: 1;
}

export interface DeclarativePackageBootstrapResult {
  installed: boolean;
  pluginRuntime: PluginRuntimeSnapshotV1;
  snapshot: InstalledRuntimeRegistrySnapshotV1;
}

let defaultBootstrapPromise: Promise<DeclarativePackageBootstrapResult> | undefined;

export async function ensureDefaultDeclarativePackageBootstrap(input: {
  hostVersion: string;
  workspaceRoot: string;
}): Promise<DeclarativePackageBootstrapResult> {
  defaultBootstrapPromise ??= bootstrapDeclarativePackages({
    activateRuntime: true,
    hostVersion: input.hostVersion,
    ...(process.env.RETAKE_PLUGIN_SAFE_MODE === '1'
      ? { pluginSafeMode: true }
      : {}),
    profilePath: defaultBootstrapProfilePath,
    workspaceRoot: input.workspaceRoot,
  });
  try {
    return await defaultBootstrapPromise;
  } catch (error) {
    defaultBootstrapPromise = undefined;
    throw error;
  }
}

export function invalidateDefaultDeclarativePackageBootstrap(): void {
  defaultBootstrapPromise = undefined;
}

export async function bootstrapDeclarativePackages(input: {
  activateRuntime?: boolean;
  hostVersion: string;
  pluginSafeMode?: boolean;
  profilePath: string;
  workspaceRoot: string;
}): Promise<DeclarativePackageBootstrapResult> {
  parsePackageVersion(input.hostVersion);
  const manager = new LocalPackageManagerService({
    hostVersion: input.hostVersion,
    workspaceRoot: input.workspaceRoot,
  });
  const hasLockfile = await manager.hasLockfile();
  if (!hasLockfile) {
    const { archivePaths } = await validateBootstrapProfileArchives(
      input.profilePath,
      input.hostVersion,
    );
    await manager.install(archivePaths[0]!, archivePaths.slice(1));
  }
  const [lockfile, installedRegistry] = await Promise.all([
    manager.list(),
    manager.loadRegistry(),
  ]);
  const snapshot = projectInstalledRuntimeRegistry(lockfile, installedRegistry);
  const pluginRuntime = await new PluginRuntimeService({
    hostVersion: input.hostVersion,
    workspaceRoot: input.workspaceRoot,
  }).reconcile(
    input.pluginSafeMode === undefined
      ? {}
      : { safeMode: input.pluginSafeMode },
  );
  if (input.activateRuntime !== false) configureInstalledRuntimeRegistry(snapshot);
  return {
    installed: !hasLockfile,
    pluginRuntime,
    snapshot,
  };
}

export async function readBootstrapProfile(
  profilePath: string,
): Promise<DeclarativePackageBootstrapProfileV1> {
  const resolvedPath = path.resolve(profilePath);
  const stat = await lstat(resolvedPath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Bootstrap profile must be a regular file.');
  }
  let value: unknown;
  try {
    value = JSON.parse(await readFile(await realpath(resolvedPath), 'utf8')) as unknown;
  } catch (error) {
    throw new Error(`Bootstrap profile is invalid JSON: ${errorMessage(error)}`);
  }
  return parseBootstrapProfile(value);
}

export async function validateBootstrapProfileArchives(
  profilePath: string,
  hostVersion: string,
): Promise<{
  archivePaths: string[];
  profile: DeclarativePackageBootstrapProfileV1;
}> {
  const profile = await readBootstrapProfile(profilePath);
  if (!packageVersionSatisfies(hostVersion, profile.hostCompatibility)) {
    throw new Error(`Bootstrap profile is incompatible with Retake ${hostVersion}.`);
  }
  const references = [profile.rootPackage, ...profile.dependencyPackages];
  return {
    archivePaths: await Promise.all(references.map(
      (reference) => validateBootstrapArchive(profilePath, reference),
    )),
    profile,
  };
}

function parseBootstrapProfile(value: unknown): DeclarativePackageBootstrapProfileV1 {
  if (!isRecord(value)) throw new Error('Bootstrap profile must be an object.');
  assertExactKeys(value, [
    'dependencyPackages',
    'hostCompatibility',
    'profileId',
    'rootPackage',
    'schemaVersion',
  ], 'Bootstrap profile');
  if (value.schemaVersion !== 1) throw new Error('Bootstrap profile schemaVersion is unsupported.');
  if (value.profileId !== defaultBootstrapProfileId) throw new Error('Bootstrap profileId is unsupported.');
  if (typeof value.hostCompatibility !== 'string') {
    throw new Error('Bootstrap profile hostCompatibility is invalid.');
  }
  if (!Array.isArray(value.dependencyPackages)) {
    throw new Error('Bootstrap profile dependencyPackages is invalid.');
  }
  const profile = {
    dependencyPackages: value.dependencyPackages.map(parsePackageReference),
    hostCompatibility: value.hostCompatibility,
    profileId: value.profileId,
    rootPackage: parsePackageReference(value.rootPackage),
    schemaVersion: 1,
  } satisfies DeclarativePackageBootstrapProfileV1;
  const packageIds = [
    profile.rootPackage.packageId,
    ...profile.dependencyPackages.map((reference) => reference.packageId),
  ];
  if (new Set(packageIds).size !== packageIds.length) {
    throw new Error('Bootstrap profile contains duplicate Package IDs.');
  }
  return profile;
}

function parsePackageReference(value: unknown): BootstrapPackageReference {
  if (!isRecord(value)) throw new Error('Bootstrap Package reference must be an object.');
  assertExactKeys(value, [
    'archiveDigest',
    'archivePath',
    'digest',
    'packageId',
    'version',
  ], 'Bootstrap Package reference');
  for (const key of ['archiveDigest', 'archivePath', 'digest', 'packageId', 'version'] as const) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`Bootstrap Package reference ${key} is invalid.`);
    }
  }
  if (
    !/^[A-Za-z0-9._-]+\.retakepkg$/.test(value.archivePath as string)
    || path.basename(value.archivePath as string) !== value.archivePath
  ) throw new Error('Bootstrap archivePath must be a portable filename.');
  assertDigest(value.digest, 'Bootstrap Package content digest');
  assertDigest(value.archiveDigest, 'Bootstrap Package archive digest');
  parsePackageVersion(value.version as string);
  return value as unknown as BootstrapPackageReference;
}

async function validateBootstrapArchive(
  profilePath: string,
  reference: BootstrapPackageReference,
): Promise<string> {
  const profileDirectory = await realpath(path.dirname(path.resolve(profilePath)));
  const archivePath = path.join(profileDirectory, reference.archivePath);
  const archiveStat = await lstat(archivePath);
  if (archiveStat.isSymbolicLink() || !archiveStat.isFile()) {
    throw new Error(`Bootstrap archive must be a regular file: ${reference.archivePath}`);
  }
  const archiveRealPath = await realpath(archivePath);
  if (path.dirname(archiveRealPath) !== profileDirectory) {
    throw new Error(`Bootstrap archive escapes the profile directory: ${reference.archivePath}`);
  }
  const materialized = await readMaterializedPackageArchive(archiveRealPath);
  if (
    materialized.manifest.packageId !== reference.packageId
    || materialized.manifest.version !== reference.version
    || materialized.digest !== reference.digest
    || materialized.archiveDigest !== reference.archiveDigest
  ) throw new Error(`Bootstrap archive does not match its profile lock: ${reference.packageId}`);
  return archiveRealPath;
}

function projectInstalledRuntimeRegistry(
  lockfile: WorkspacePackageLock,
  registry: InstalledDeclarativePackageRegistry,
): InstalledRuntimeRegistrySnapshotV1 {
  const resolvedByPackageId = new Map(
    lockfile.resolvedPackages.map((resolved) => [resolved.packageId, resolved]),
  );
  const packages = registry.packages.map((manifest) => {
    const resolved = resolvedByPackageId.get(manifest.packageId);
    if (!resolved) throw new Error(`Installed Package is absent from the resolved closure: ${manifest.packageId}`);
    return runtimePackageManifest(manifest, resolved);
  });
  return withSnapshotDigest({
    agentPresets: [...registry.agentPresets.values()]
      .map((entry) => structuredClone(entry.definition))
      .sort((left, right) => compareText(left.agentPresetId, right.agentPresetId)),
    lockRevision: lockfile.revision,
    packages: packages.sort((left, right) => compareText(left.packageId, right.packageId)),
    profileId: defaultBootstrapProfileId,
    schemaVersion: 1,
    skills: [...registry.skills.values()]
      .map((entry) => structuredClone(entry.definition))
      .sort((left, right) => compareText(left.skillId, right.skillId)),
    workflows: [...registry.workflows.values()]
      .map((entry) => structuredClone(entry.definition))
      .sort((left, right) => compareText(left.workflowId, right.workflowId)),
  });
}

function runtimePackageManifest(
  manifest: InstalledDeclarativePackageRegistry['packages'][number],
  resolved: ResolvedWorkspacePackage,
): RetakePackageManifest {
  return {
    components: {
      adapterPlugins: [],
      agentPresets: manifest.components.agentPresets.map((component) => ({
        agentPresetId: component.agentPresetId,
        definitionHash: component.definitionHash,
        version: component.version,
      })),
      capabilityPlugins: [],
      skills: manifest.components.skills.map((component) => ({
        definitionHash: component.definitionHash,
        skillId: component.skillId,
        version: component.version,
      })),
      uiPlugins: [],
      workflows: manifest.components.workflows.map((component) => ({
        definitionHash: component.definitionHash,
        version: component.version,
        workflowDefinitionId: component.workflowDefinitionId,
      })),
    },
    description: manifest.description,
    digest: resolved.digest,
    entrypoints: structuredClone(manifest.entrypoints),
    name: manifest.name,
    packageId: manifest.packageId,
    schemaVersion: 1,
    source: {
      archiveDigest: resolved.archiveDigest,
      installationId: resolved.installationId,
      kind: 'installed',
    },
    version: manifest.version,
  };
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: string[],
  label: string,
): void {
  const actual = Object.keys(value).sort(compareText);
  const orderedExpected = [...expected].sort(compareText);
  if (
    actual.length !== orderedExpected.length
    || actual.some((key, index) => key !== orderedExpected[index])
  ) throw new Error(`${label} has unsupported or missing fields.`);
}

function assertDigest(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
