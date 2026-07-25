import path from 'node:path';
import {
  packageVersionSatisfies,
  parsePackageVersion,
} from './package-semver';

export const workspacePackageLockSchemaVersion = 1;
export const workspacePackageLockFile = 'retake.packages.lock.json';

export interface LocalPackageSource {
  kind: 'local_archive' | 'local_directory';
  path: string;
}

export interface PackageInstallationRecord {
  archiveDigest: string;
  digest: string;
  installationId: string;
  installedAt: string;
  lastActivatedAt: string;
  packageId: string;
  source: LocalPackageSource;
  version: string;
}

export interface WorkspacePackageRoot {
  installationId: string;
  packageId: string;
  requestedRange: string;
}

export interface ResolvedPackageDependency {
  optional: boolean;
  packageId: string;
  range: string;
  resolvedInstallationId: string;
}

export interface ResolvedWorkspacePackage {
  archiveDigest: string;
  dependencies: ResolvedPackageDependency[];
  digest: string;
  installationId: string;
  packageId: string;
  version: string;
}

export interface WorkspacePackageLockV1 {
  hostVersion: string;
  installations: PackageInstallationRecord[];
  resolvedPackages: ResolvedWorkspacePackage[];
  revision: number;
  roots: WorkspacePackageRoot[];
  schemaVersion: 1;
  updatedAt: string;
}

export function emptyWorkspacePackageLock(hostVersion: string): WorkspacePackageLockV1 {
  return {
    hostVersion,
    installations: [],
    resolvedPackages: [],
    revision: 0,
    roots: [],
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
  };
}

export function parseWorkspacePackageLock(value: unknown): WorkspacePackageLockV1 {
  if (!isRecord(value)) throw new Error('Workspace Package lockfile must be an object.');
  assertExactKeys(value, [
    'hostVersion',
    'installations',
    'resolvedPackages',
    'revision',
    'roots',
    'schemaVersion',
    'updatedAt',
  ], 'Workspace Package lockfile');
  if (value.schemaVersion !== workspacePackageLockSchemaVersion) {
    throw new Error('Unsupported Workspace Package lockfile schemaVersion.');
  }
  if (!Number.isInteger(value.revision) || (value.revision as number) < 0) {
    throw new Error('Workspace Package lockfile revision must be a non-negative integer.');
  }
  if (typeof value.hostVersion !== 'string') throw new Error('Workspace Package hostVersion is invalid.');
  parsePackageVersion(value.hostVersion);
  if (typeof value.updatedAt !== 'string') throw new Error('Workspace Package updatedAt is invalid.');
  if (!Array.isArray(value.installations) || !Array.isArray(value.roots) || !Array.isArray(value.resolvedPackages)) {
    throw new Error('Workspace Package lockfile collections are invalid.');
  }
  const installations = value.installations.map(parseInstallation);
  const roots = value.roots.map(parseRoot);
  const resolvedPackages = value.resolvedPackages.map(parseResolvedPackage);
  assertUnique(installations.map((entry) => entry.installationId), 'Installation ID');
  assertUnique(roots.map((entry) => entry.packageId), 'root Package');
  assertUnique(resolvedPackages.map((entry) => entry.packageId), 'resolved Package');
  const installationById = new Map(
    installations.map((entry) => [entry.installationId, entry]),
  );
  for (const root of roots) {
    const installation = installationById.get(root.installationId);
    if (!installation) {
      throw new Error(`Workspace Package root references a missing Installation: ${root.packageId}`);
    }
    if (
      installation.packageId !== root.packageId
      || !packageVersionSatisfies(installation.version, root.requestedRange)
    ) throw new Error(`Workspace Package root does not match its Installation: ${root.packageId}`);
  }
  const activeInstallationIds = new Set(
    resolvedPackages.map((entry) => entry.installationId),
  );
  for (const resolved of resolvedPackages) {
    const installation = installationById.get(resolved.installationId);
    if (!installation) {
      throw new Error(`Resolved Package references a missing Installation: ${resolved.packageId}`);
    }
    if (
      installation.packageId !== resolved.packageId
      || installation.version !== resolved.version
      || installation.digest !== resolved.digest
      || installation.archiveDigest !== resolved.archiveDigest
    ) throw new Error(`Resolved Package does not match its Installation: ${resolved.packageId}`);
    for (const dependency of resolved.dependencies) {
      const dependencyInstallation = installationById.get(dependency.resolvedInstallationId);
      if (!dependencyInstallation) {
        throw new Error(`Resolved dependency references a missing Installation: ${dependency.packageId}`);
      }
      if (
        dependencyInstallation.packageId !== dependency.packageId
        || !activeInstallationIds.has(dependency.resolvedInstallationId)
        || !packageVersionSatisfies(dependencyInstallation.version, dependency.range)
      ) throw new Error(`Resolved dependency does not match its Installation: ${dependency.packageId}`);
    }
  }
  for (const root of roots) {
    if (!activeInstallationIds.has(root.installationId)) {
      throw new Error(`Workspace Package root is absent from the resolved closure: ${root.packageId}`);
    }
  }
  const immutableVersions = new Map<string, string>();
  for (const installation of installations) {
    const key = `${installation.packageId}@${installation.version}`;
    const existing = immutableVersions.get(key);
    if (existing && existing !== installation.digest) {
      throw new Error(`Immutable Package version conflict in lockfile: ${key}`);
    }
    immutableVersions.set(key, installation.digest);
  }
  return {
    hostVersion: value.hostVersion,
    installations,
    resolvedPackages,
    revision: value.revision as number,
    roots,
    schemaVersion: 1,
    updatedAt: value.updatedAt,
  };
}

function parseInstallation(value: unknown): PackageInstallationRecord {
  if (!isRecord(value)) throw new Error('Package Installation must be an object.');
  assertExactKeys(value, [
    'archiveDigest',
    'digest',
    'installationId',
    'installedAt',
    'lastActivatedAt',
    'packageId',
    'source',
    'version',
  ], 'Package Installation');
  if (!isRecord(value.source)) throw new Error('Package Installation source is invalid.');
  assertExactKeys(value.source, ['kind', 'path'], 'Package Installation source');
  if (value.source.kind !== 'local_archive' && value.source.kind !== 'local_directory') {
    throw new Error('Package Installation source kind is invalid.');
  }
  const strings = [
    'archiveDigest',
    'digest',
    'installationId',
    'installedAt',
    'lastActivatedAt',
    'packageId',
    'version',
  ] as const;
  for (const key of strings) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`Package Installation ${key} is invalid.`);
    }
  }
  if (typeof value.source.path !== 'string' || !path.isAbsolute(value.source.path)) {
    throw new Error('Package Installation source path must be absolute.');
  }
  assertDigest(value.digest, 'Package Installation digest');
  assertDigest(value.archiveDigest, 'Package Installation archiveDigest');
  parsePackageVersion(value.version as string);
  return value as unknown as PackageInstallationRecord;
}

function parseRoot(value: unknown): WorkspacePackageRoot {
  if (!isRecord(value)) throw new Error('Workspace Package root must be an object.');
  assertExactKeys(value, ['installationId', 'packageId', 'requestedRange'], 'Workspace Package root');
  for (const key of ['installationId', 'packageId', 'requestedRange'] as const) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`Workspace Package root ${key} is invalid.`);
    }
  }
  return value as unknown as WorkspacePackageRoot;
}

function parseResolvedPackage(value: unknown): ResolvedWorkspacePackage {
  if (!isRecord(value)) throw new Error('Resolved Workspace Package must be an object.');
  assertExactKeys(value, [
    'archiveDigest',
    'dependencies',
    'digest',
    'installationId',
    'packageId',
    'version',
  ], 'Resolved Workspace Package');
  if (!Array.isArray(value.dependencies)) throw new Error('Resolved Package dependencies are invalid.');
  for (const key of ['archiveDigest', 'digest', 'installationId', 'packageId', 'version'] as const) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`Resolved Package ${key} is invalid.`);
    }
  }
  assertDigest(value.digest, 'Resolved Package digest');
  assertDigest(value.archiveDigest, 'Resolved Package archiveDigest');
  parsePackageVersion(value.version as string);
  return {
    archiveDigest: value.archiveDigest,
    dependencies: value.dependencies.map(parseResolvedDependency),
    digest: value.digest,
    installationId: value.installationId as string,
    packageId: value.packageId as string,
    version: value.version as string,
  };
}

function parseResolvedDependency(value: unknown): ResolvedPackageDependency {
  if (!isRecord(value)) throw new Error('Resolved Package dependency must be an object.');
  assertExactKeys(
    value,
    ['optional', 'packageId', 'range', 'resolvedInstallationId'],
    'Resolved Package dependency',
  );
  if (typeof value.optional !== 'boolean') throw new Error('Resolved Package dependency optional is invalid.');
  for (const key of ['packageId', 'range', 'resolvedInstallationId'] as const) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`Resolved Package dependency ${key} is invalid.`);
    }
  }
  return value as unknown as ResolvedPackageDependency;
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

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate ${label} in lockfile.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
