import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  PluginRuntimeSnapshotV1,
  RetakePluginPermission,
} from '@retake-tools/package-sdk';
import type { RetakePackageManifest } from '../src/core/packageContracts';
import {
  configureInstalledRuntimeRegistry,
  type InstalledRuntimeRegistrySnapshotV1,
  withSnapshotDigest,
} from '../src/core/installedRuntimeRegistry';
import { readMaterializedPackageArchive } from './declarative-package-service';
import {
  LocalPackageManagerService,
  type InstalledPackageLoadFailure,
  type InstalledDeclarativePackageRegistry,
} from './local-package-manager-service';
import { packageVersionSatisfies, parsePackageVersion } from './package-semver';
import { PluginRuntimeService } from './plugin-runtime-service';
import {
  OfficialPackagePreferenceStore,
} from './official-package-preference-store';
import type {
  ResolvedWorkspacePackage,
  WorkspacePackageLock,
} from './workspace-package-lock';

export const defaultBootstrapProfileId = 'retake.default-studios';
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
  pluginModules: Array<{
    permissions: RetakePluginPermission[];
    pluginModuleId: string;
  }>;
  updateSource: string;
  version: string;
}

export interface DeclarativePackageBootstrapProfileV3 {
  hostCompatibility: string;
  packages: BootstrapPackageReference[];
  profileId: string;
  schemaVersion: 3;
}

export interface DeclarativePackageBootstrapResult {
  installed: boolean;
  packageFailures: InstalledPackageLoadFailure[];
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
  const hadLockfile = await manager.hasLockfile();
  let validated: Awaited<
    ReturnType<typeof validateBootstrapProfileArchives>
  >;
  try {
    validated = await validateBootstrapProfileArchives(
      input.profilePath,
      input.hostVersion,
    );
  } catch (error) {
    if (!hadLockfile || !isNodeError(error, 'ENOENT')) throw error;
    const [lockfile, installed] = await Promise.all([
      manager.list(),
      manager.loadRegistryTolerant(),
    ]);
    const snapshot = projectInstalledRuntimeRegistry(
      lockfile,
      installed.registry,
    );
    const pluginRuntime = await new PluginRuntimeService({
      hostVersion: input.hostVersion,
      workspaceRoot: input.workspaceRoot,
    }).reconcile(
      input.pluginSafeMode === undefined
        ? {}
        : { safeMode: input.pluginSafeMode },
    );
    if (input.activateRuntime !== false) {
      configureInstalledRuntimeRegistry(snapshot);
    }
    return {
      installed: false,
      packageFailures: installed.failures,
      pluginRuntime,
      snapshot,
    };
  }
  const { archivePaths, profile } = validated;
  const preferences = new OfficialPackagePreferenceStore(manager.packagesRoot);
  const preferenceState = await preferences.read();
  let changed = false;
  let lockfile = await manager.list();
  const initialInstalled = await manager.loadRegistryTolerant();
  if (initialInstalled.failures.length > 0) {
    const snapshot = projectInstalledRuntimeRegistry(
      lockfile,
      initialInstalled.registry,
    );
    const pluginRuntime = await new PluginRuntimeService({
      hostVersion: input.hostVersion,
      workspaceRoot: input.workspaceRoot,
    }).reconcile(
      input.pluginSafeMode === undefined
        ? {}
        : { safeMode: input.pluginSafeMode },
    );
    if (input.activateRuntime !== false) {
      configureInstalledRuntimeRegistry(snapshot);
    }
    return {
      installed: false,
      packageFailures: initialInstalled.failures,
      pluginRuntime,
      snapshot,
    };
  }
  const activeRoots = () => new Map(
    lockfile.roots.map((root) => [root.packageId, root]),
  );
  const activePackageIds = () => new Set(
    lockfile.resolvedPackages.map((entry) => entry.packageId),
  );
  const legacyStoryPackageId = 'retake.package.story-production-starter';
  const legacyGuidedImagePackageId =
    'retake.package.image-guided-workflow';
  const videoPolicy = profile.packages.find(
    (entry) => entry.packageId === 'design.retake.video-studio',
  );
  if (
    videoPolicy
    && !activeRoots().has(legacyStoryPackageId)
    && lockfile.installations.some(
      (entry) => entry.packageId === legacyStoryPackageId,
    )
    && !activeRoots().has(videoPolicy.packageId)
    && preferenceState.updatedAt === new Date(0).toISOString()
  ) {
    await preferences.setPackageRemoved(videoPolicy.packageId, true);
    preferenceState.removedPackageIds.push(videoPolicy.packageId);
    preferenceState.removedPackageIds.sort(compareText);
  }
  for (const [index, packagePolicy] of profile.packages.entries()) {
    if (preferenceState.removedPackageIds.includes(packagePolicy.packageId)) {
      continue;
    }
    const activeRoot = activeRoots().get(packagePolicy.packageId);
    if (activeRoot) {
      const active = lockfile.resolvedPackages.find(
        (entry) => entry.packageId === packagePolicy.packageId,
      );
      if (
        active?.version === packagePolicy.version
        && active.digest === packagePolicy.digest
      ) {
        continue;
      }
      if (await isBundledBootstrapInstallation(
        lockfile,
        activeRoot.installationId,
        input.profilePath,
      )) {
        const result = await manager.install(archivePaths[index]!);
        lockfile = result.lockfile;
        changed = changed || result.changed;
        continue;
      }
      // A non-default active source is a user version pin. Do not replace it
      // during startup.
      continue;
    }
    if (
      packagePolicy.packageId === 'design.retake.image-studio'
      && activeRoots().has(legacyGuidedImagePackageId)
    ) {
      lockfile = await manager.remove(legacyGuidedImagePackageId);
      changed = true;
    }
    if (
      packagePolicy.packageId === 'design.retake.video-studio'
      && activeRoots().has(legacyStoryPackageId)
    ) {
      lockfile = await manager.remove(legacyStoryPackageId);
      changed = true;
    }
    const result = await manager.install(archivePaths[index]!);
    lockfile = result.lockfile;
    changed = changed || result.changed;
  }
  const [currentLockfile, installed] = await Promise.all([
    manager.list(),
    manager.loadRegistryTolerant(),
  ]);
  lockfile = currentLockfile;
  const snapshot = projectInstalledRuntimeRegistry(
    currentLockfile,
    installed.registry,
  );
  const officialDefaults = profile.packages.flatMap((packagePolicy) => (
    activePackageIds().has(packagePolicy.packageId)
      ? packagePolicy.pluginModules.map((module) => ({
          packageDigest: packagePolicy.digest,
          packageId: packagePolicy.packageId,
          permissions: [...module.permissions],
          pluginModuleId: module.pluginModuleId,
        }))
      : []
  ));
  const pluginRuntime = await new PluginRuntimeService({
    hostVersion: input.hostVersion,
    workspaceRoot: input.workspaceRoot,
  }).reconcile({
    officialDefaults,
    ...(input.pluginSafeMode === undefined
      ? {}
      : { safeMode: input.pluginSafeMode }),
  });
  if (input.activateRuntime !== false) configureInstalledRuntimeRegistry(snapshot);
  return {
    installed: !hadLockfile || changed,
    packageFailures: installed.failures,
    pluginRuntime,
    snapshot,
  };
}

async function isBundledBootstrapInstallation(
  lockfile: WorkspacePackageLock,
  installationId: string,
  profilePath: string,
): Promise<boolean> {
  const installation = lockfile.installations.find(
    (entry) => entry.installationId === installationId,
  );
  if (installation?.source.kind !== 'local_archive') return false;
  try {
    const [sourceDirectory, profileDirectory] = await Promise.all([
      realpath(path.dirname(installation.source.path)),
      realpath(path.dirname(profilePath)),
    ]);
    return sourceDirectory === profileDirectory;
  } catch {
    return false;
  }
}

export async function readBootstrapProfile(
  profilePath: string,
): Promise<DeclarativePackageBootstrapProfileV3> {
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
  profile: DeclarativePackageBootstrapProfileV3;
}> {
  const profile = await readBootstrapProfile(profilePath);
  if (!packageVersionSatisfies(hostVersion, profile.hostCompatibility)) {
    throw new Error(`Bootstrap profile is incompatible with Retake ${hostVersion}.`);
  }
  const references = profile.packages;
  return {
    archivePaths: await Promise.all(references.map(
      (reference) => validateBootstrapArchive(profilePath, reference),
    )),
    profile,
  };
}

function parseBootstrapProfile(value: unknown): DeclarativePackageBootstrapProfileV3 {
  if (!isRecord(value)) throw new Error('Bootstrap profile must be an object.');
  assertExactKeys(value, [
    'hostCompatibility',
    'packages',
    'profileId',
    'schemaVersion',
  ], 'Bootstrap profile');
  if (value.schemaVersion !== 3) throw new Error('Bootstrap profile schemaVersion is unsupported.');
  if (value.profileId !== defaultBootstrapProfileId) throw new Error('Bootstrap profileId is unsupported.');
  if (typeof value.hostCompatibility !== 'string') {
    throw new Error('Bootstrap profile hostCompatibility is invalid.');
  }
  if (!Array.isArray(value.packages) || value.packages.length === 0) {
    throw new Error('Bootstrap profile packages is invalid.');
  }
  const profile = {
    hostCompatibility: value.hostCompatibility,
    packages: value.packages.map(parsePackageReference),
    profileId: value.profileId,
    schemaVersion: 3,
  } satisfies DeclarativePackageBootstrapProfileV3;
  const packageIds = profile.packages.map((reference) => reference.packageId);
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
    'pluginModules',
    'updateSource',
    'version',
  ], 'Bootstrap Package reference');
  for (const key of [
    'archiveDigest',
    'archivePath',
    'digest',
    'packageId',
    'updateSource',
    'version',
  ] as const) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`Bootstrap Package reference ${key} is invalid.`);
    }
  }
  if (
    !/^[A-Za-z0-9._-]+\.retakepkg$/.test(value.archivePath as string)
    || path.basename(value.archivePath as string) !== value.archivePath
  ) throw new Error('Bootstrap archivePath must be a portable filename.');
  if (
    !/^github:retake-tools\/[a-z0-9._-]+@main#subdirectory=[a-z0-9._/-]+$/
      .test(value.updateSource as string)
  ) {
    throw new Error(
      'Bootstrap updateSource must pin an official GitHub main source.',
    );
  }
  assertDigest(value.digest, 'Bootstrap Package content digest');
  assertDigest(value.archiveDigest, 'Bootstrap Package archive digest');
  parsePackageVersion(value.version as string);
  if (!Array.isArray(value.pluginModules)) {
    throw new Error('Bootstrap Package pluginModules is invalid.');
  }
  const pluginModules = value.pluginModules.map((entry) => {
    if (!isRecord(entry)) {
      throw new Error('Bootstrap PluginModule policy must be an object.');
    }
    assertExactKeys(
      entry,
      ['permissions', 'pluginModuleId'],
      'Bootstrap PluginModule policy',
    );
    if (
      typeof entry.pluginModuleId !== 'string'
      || !Array.isArray(entry.permissions)
      || entry.permissions.some((permission) => typeof permission !== 'string')
    ) {
      throw new Error('Bootstrap PluginModule policy is invalid.');
    }
    const permissions = [...entry.permissions].sort(compareText);
    if (
      new Set(permissions).size !== permissions.length
      || JSON.stringify(permissions) !== JSON.stringify(entry.permissions)
    ) {
      throw new Error(
        'Bootstrap PluginModule permissions must be sorted and unique.',
      );
    }
    return {
      permissions: permissions as RetakePluginPermission[],
      pluginModuleId: entry.pluginModuleId,
    };
  });
  if (
    new Set(pluginModules.map((entry) => entry.pluginModuleId)).size
    !== pluginModules.length
  ) {
    throw new Error('Bootstrap Package contains duplicate PluginModule IDs.');
  }
  return {
    archiveDigest: value.archiveDigest as string,
    archivePath: value.archivePath as string,
    digest: value.digest as string,
    packageId: value.packageId as string,
    pluginModules,
    updateSource: value.updateSource as string,
    version: value.version as string,
  };
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
  const installedModules = materialized.definitions.pluginModules;
  if (installedModules.size !== reference.pluginModules.length) {
    throw new Error(
      `Bootstrap PluginModule allowlist does not match archive: ${reference.packageId}`,
    );
  }
  for (const policy of reference.pluginModules) {
    const pluginModule = installedModules.get(policy.pluginModuleId);
    if (
      !pluginModule
      || JSON.stringify(pluginModule.permissions)
        !== JSON.stringify(policy.permissions)
      || materialized.manifest.publisher.publisherId
        !== 'retake.publisher.official'
    ) {
      throw new Error(
        `Bootstrap PluginModule allowlist does not match archive: ${policy.pluginModuleId}`,
      );
    }
  }
  return archiveRealPath;
}

export function projectInstalledRuntimeRegistry(
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

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
