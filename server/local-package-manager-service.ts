import { randomBytes, randomUUID } from 'node:crypto';
import {
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { RetakePackageEntryPoint } from '../src/core/packageContracts';
import type {
  DeclarativeAgentPresetDefinition,
  DeclarativeSkillDefinition,
  DeclarativeWorkflowDefinition,
} from '../src/core/declarativePackageDefinitionSchemas';
import type { DeclarativePackageManifest } from '../src/core/declarativePackageContracts';
import {
  materializeDeclarativePackage,
} from './declarative-package-service';
import {
  comparePackageCandidateVersion,
  resolvePackageClosure,
  type PackageCandidate,
  type PackageDependencyResolution,
} from './local-package-dependency-resolver';
import {
  comparePackageVersions,
  packageVersionSatisfies,
  parsePackageVersion,
} from './package-semver';
import {
  emptyWorkspacePackageLock,
  parseWorkspacePackageLock,
  workspacePackageLockFile,
  workspacePackageLockSchemaVersion,
  type PackageInstallationRecord,
  type ResolvedPackageDependency,
  type ResolvedWorkspacePackage,
  type WorkspacePackageLockV1,
  type WorkspacePackageRoot,
} from './workspace-package-lock';
export {
  workspacePackageLockFile,
  workspacePackageLockSchemaVersion,
  type LocalPackageSource,
  type PackageInstallationRecord,
  type ResolvedPackageDependency,
  type ResolvedWorkspacePackage,
  type WorkspacePackageLockV1,
  type WorkspacePackageRoot,
} from './workspace-package-lock';

export interface LocalPackageInstallResult {
  changed: boolean;
  lockfile: WorkspacePackageLockV1;
  root: ResolvedWorkspacePackage;
}

export interface InstalledDefinition<T> {
  definition: T;
  packageLock: {
    digest: string;
    packageId: string;
    version: string;
  };
}

export interface InstalledDeclarativePackageRegistry {
  agentPresets: Map<string, InstalledDefinition<DeclarativeAgentPresetDefinition>>;
  entrypoints: Array<{
    entrypoint: RetakePackageEntryPoint;
    packageLock: {
      digest: string;
      packageId: string;
      version: string;
    };
  }>;
  packages: DeclarativePackageManifest[];
  skills: Map<string, InstalledDefinition<DeclarativeSkillDefinition>>;
  workflows: Map<string, InstalledDefinition<DeclarativeWorkflowDefinition>>;
}

export class LocalPackageManagerService {
  readonly hostVersion: string;
  readonly packagesRoot: string;
  readonly workspaceRoot: string;

  constructor(input: { hostVersion: string; workspaceRoot: string }) {
    parsePackageVersion(input.hostVersion);
    this.hostVersion = input.hostVersion;
    this.workspaceRoot = path.resolve(input.workspaceRoot);
    this.packagesRoot = path.join(this.workspaceRoot, 'packages');
  }

  async install(
    sourcePath: string,
    dependencySourcePaths: string[] = [],
  ): Promise<LocalPackageInstallResult> {
    return this.withMutationLock(async () => {
      const current = await this.readLockfile();
      const supplied = await Promise.all(
        [sourcePath, ...dependencySourcePaths].map((source) => this.candidateFromSource(source, current)),
      );
      const root = supplied[0]!;
      assertUniqueSuppliedSources(supplied);
      const candidates = await this.loadCandidatePool(current, supplied);
      const proposedRoots = current.roots.filter(
        (candidate) => candidate.packageId !== root.installation.packageId,
      );
      proposedRoots.push({
        installationId: root.installation.installationId,
        packageId: root.installation.packageId,
        requestedRange: root.installation.version,
      });
      const resolution = resolvePackageClosure(proposedRoots, candidates, this.hostVersion);
      const selectedInstallations = [...resolution.selected.values()].map(
        (candidate) => candidate.installation,
      );
      await Promise.all(
        [...resolution.selected.values()].map((candidate) => this.writeCache(candidate)),
      );
      const next = buildNextLockfile({
        current,
        hostVersion: this.hostVersion,
        roots: proposedRoots,
        selectedInstallations,
        resolution,
      });
      const changed = !sameActiveState(current, next);
      if (changed) await this.writeLockfile(next);
      const effective = changed ? next : current;
      return {
        changed,
        lockfile: structuredClone(effective),
        root: structuredClone(requiredResolvedPackage(effective, root.installation.packageId)),
      };
    });
  }

  async activate(input: {
    digest?: string;
    packageId: string;
    version?: string;
  }): Promise<LocalPackageInstallResult> {
    return this.withMutationLock(async () => {
      if (Boolean(input.digest) === Boolean(input.version)) {
        throw new Error('Package activation requires exactly one of version or digest.');
      }
      const current = await this.readLockfile();
      const target = findInstallation(current, input);
      return this.activateInstallation(current, target);
    });
  }

  async rollback(
    packageId: string,
    target?: string,
  ): Promise<LocalPackageInstallResult> {
    return this.withMutationLock(async () => {
      const current = await this.readLockfile();
      const currentRoot = current.roots.find((root) => root.packageId === packageId);
      if (!currentRoot) throw new Error(`Package is not an active root: ${packageId}`);
      let installation: PackageInstallationRecord;
      if (target) {
        installation = findInstallation(current, {
          ...(target.startsWith('sha256:') ? { digest: target } : { version: target }),
          packageId,
        });
      } else {
        installation = current.installations
          .filter((candidate) => (
            candidate.packageId === packageId
            && candidate.installationId !== currentRoot.installationId
          ))
          .sort(compareInstallationActivation)[0]!;
        if (!installation) throw new Error(`Package has no previous Installation to rollback to: ${packageId}`);
      }
      return this.activateInstallation(current, installation);
    });
  }

  async remove(packageId: string): Promise<WorkspacePackageLockV1> {
    return this.withMutationLock(async () => {
      const current = await this.readLockfile();
      if (!current.roots.some((root) => root.packageId === packageId)) {
        if (current.resolvedPackages.some((entry) => entry.packageId === packageId)) {
          throw new Error(`Package is a transitive dependency and cannot be removed directly: ${packageId}`);
        }
        throw new Error(`Package is not an active root: ${packageId}`);
      }
      const roots = current.roots.filter((root) => root.packageId !== packageId);
      const candidates = await this.loadCandidatePool(current, []);
      const resolution = resolvePackageClosure(roots, candidates, this.hostVersion);
      const next = buildNextLockfile({
        current,
        hostVersion: this.hostVersion,
        roots,
        selectedInstallations: [],
        resolution,
      });
      await this.writeLockfile(next);
      return structuredClone(next);
    });
  }

  async list(): Promise<WorkspacePackageLockV1> {
    return structuredClone(await this.readLockfile());
  }

  async loadRegistry(): Promise<InstalledDeclarativePackageRegistry> {
    const lockfile = await this.readLockfile();
    const registry: InstalledDeclarativePackageRegistry = {
      agentPresets: new Map(),
      entrypoints: [],
      packages: [],
      skills: new Map(),
      workflows: new Map(),
    };
    const entrypointIds = new Set<string>();
    for (const resolved of lockfile.resolvedPackages) {
      const installation = requiredInstallation(lockfile, resolved.installationId);
      const candidate = await this.candidateFromInstallation(installation);
      assertResolvedCandidate(resolved, candidate);
      if (!packageVersionSatisfies(
        this.hostVersion,
        candidate.materialized.manifest.retakeHostCompatibility,
      )) throw new Error(`Installed Package is incompatible with this Retake host: ${resolved.packageId}`);
      const packageLock = {
        digest: resolved.digest,
        packageId: resolved.packageId,
        version: resolved.version,
      };
      registry.packages.push(structuredClone(candidate.materialized.manifest));
      for (const entrypoint of candidate.materialized.manifest.entrypoints) {
        if (entrypointIds.has(entrypoint.entrypointId)) {
          throw new Error(`Installed Package EntryPoint ID conflicts: ${entrypoint.entrypointId}`);
        }
        entrypointIds.add(entrypoint.entrypointId);
        registry.entrypoints.push({ entrypoint: structuredClone(entrypoint), packageLock });
      }
      addDefinitions(
        registry.skills,
        candidate.materialized.definitions.skills,
        packageLock,
        'Skill',
      );
      addDefinitions(
        registry.workflows,
        candidate.materialized.definitions.workflows,
        packageLock,
        'Workflow',
      );
      addDefinitions(
        registry.agentPresets,
        candidate.materialized.definitions.agentPresets,
        packageLock,
        'AgentPreset',
      );
    }
    registry.entrypoints.sort((left, right) => (
      compareText(left.entrypoint.entrypointId, right.entrypoint.entrypointId)
    ));
    registry.packages.sort((left, right) => compareText(left.packageId, right.packageId));
    return registry;
  }

  private async activateInstallation(
    current: WorkspacePackageLockV1,
    target: PackageInstallationRecord,
  ): Promise<LocalPackageInstallResult> {
    if (!current.roots.some((root) => root.packageId === target.packageId)) {
      throw new Error(`Package is not an active root: ${target.packageId}`);
    }
    const roots = current.roots.map((root) => (
      root.packageId === target.packageId
        ? {
            installationId: target.installationId,
            packageId: target.packageId,
            requestedRange: target.version,
          }
        : root
    ));
    const candidates = await this.loadCandidatePool(current, []);
    const resolution = resolvePackageClosure(roots, candidates, this.hostVersion);
    const next = buildNextLockfile({
      current,
      hostVersion: this.hostVersion,
      roots,
      selectedInstallations: [],
      resolution,
    });
    const changed = !sameActiveState(current, next);
    if (changed) await this.writeLockfile(next);
    const effective = changed ? next : current;
    return {
      changed,
      lockfile: structuredClone(effective),
      root: structuredClone(requiredResolvedPackage(effective, target.packageId)),
    };
  }

  private async candidateFromSource(
    sourcePath: string,
    current: WorkspacePackageLockV1,
  ): Promise<PackageCandidate> {
    const materialized = await materializeDeclarativePackage(sourcePath);
    const existing = current.installations.find((installation) => (
      installation.packageId === materialized.manifest.packageId
      && installation.version === materialized.manifest.version
      && installation.digest === materialized.digest
    ));
    const now = new Date().toISOString();
    return {
      installation: existing ?? {
        archiveDigest: materialized.archiveDigest,
        digest: materialized.digest,
        installationId: randomUUID(),
        installedAt: now,
        lastActivatedAt: now,
        packageId: materialized.manifest.packageId,
        source: {
          kind: materialized.inspection.sourceKind === 'archive'
            ? 'local_archive'
            : 'local_directory',
          path: path.resolve(sourcePath),
        },
        version: materialized.manifest.version,
      },
      materialized,
    };
  }

  private async candidateFromInstallation(
    installation: PackageInstallationRecord,
  ): Promise<PackageCandidate> {
    const cachePath = this.cachePath(installation.digest);
    const materialized = await materializeDeclarativePackage(cachePath);
    if (
      materialized.digest !== installation.digest
      || materialized.archiveDigest !== installation.archiveDigest
      || materialized.manifest.packageId !== installation.packageId
      || materialized.manifest.version !== installation.version
    ) {
      throw new Error(`Installed Package cache does not match its lock: ${installation.packageId}`);
    }
    return { installation, materialized };
  }

  private async loadCandidatePool(
    current: WorkspacePackageLockV1,
    supplied: PackageCandidate[],
  ): Promise<Map<string, PackageCandidate[]>> {
    const installed = await Promise.all(
      current.installations.map((installation) => this.candidateFromInstallation(installation)),
    );
    const candidates = new Map<string, PackageCandidate[]>();
    for (const candidate of [...installed, ...supplied]) {
      const list = candidates.get(candidate.installation.packageId) ?? [];
      const sameIdentity = list.find((existing) => (
        existing.installation.version === candidate.installation.version
        && existing.installation.digest === candidate.installation.digest
      ));
      if (!sameIdentity) list.push(candidate);
      candidates.set(candidate.installation.packageId, list);
    }
    for (const [packageId, packageCandidates] of candidates) {
      const versions = new Map<string, string>();
      for (const candidate of packageCandidates) {
        const previousDigest = versions.get(candidate.installation.version);
        if (previousDigest && previousDigest !== candidate.installation.digest) {
          throw new Error(
            `Immutable Package version conflict: ${packageId}@${candidate.installation.version}`,
          );
        }
        versions.set(candidate.installation.version, candidate.installation.digest);
      }
      packageCandidates.sort(comparePackageCandidateVersion);
    }
    return candidates;
  }

  private async writeCache(candidate: PackageCandidate): Promise<void> {
    const outputPath = this.cachePath(candidate.installation.digest);
    await mkdir(path.dirname(outputPath), { recursive: true });
    try {
      await atomicWriteNewFile(outputPath, candidate.materialized.archive);
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
      const cached = await materializeDeclarativePackage(outputPath);
      if (
        cached.digest !== candidate.materialized.digest
        || cached.archiveDigest !== candidate.materialized.archiveDigest
      ) throw new Error(`Content-addressed Package cache conflicts: ${candidate.materialized.digest}`);
    }
  }

  private cachePath(digest: string): string {
    const match = /^sha256:([a-f0-9]{64})$/.exec(digest);
    if (!match) throw new Error(`Invalid Package content digest: ${digest}`);
    return path.join(this.packagesRoot, 'cache', 'sha256', `${match[1]}.retakepkg`);
  }

  private async readLockfile(): Promise<WorkspacePackageLockV1> {
    const lockPath = path.join(this.packagesRoot, workspacePackageLockFile);
    let value: unknown;
    try {
      value = JSON.parse(await readFile(lockPath, 'utf8')) as unknown;
    } catch (error) {
      if (isNotFoundError(error)) return emptyWorkspacePackageLock(this.hostVersion);
      throw new Error(`Workspace Package lockfile is invalid JSON: ${errorMessage(error)}`);
    }
    return parseWorkspacePackageLock(value);
  }

  private async writeLockfile(lockfile: WorkspacePackageLockV1): Promise<void> {
    await mkdir(this.packagesRoot, { recursive: true });
    const outputPath = path.join(this.packagesRoot, workspacePackageLockFile);
    const temporaryPath = `${outputPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(lockfile, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o644,
      });
      await rename(temporaryPath, outputPath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(this.packagesRoot, { recursive: true });
    const lockPath = path.join(this.packagesRoot, 'manager.lock');
    let lockHandle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      lockHandle = await open(lockPath, 'wx', 0o600);
      await lockHandle.writeFile(`${JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: process.pid,
      })}\n`);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        throw new Error('Another Local Package Manager transaction is already active.');
      }
      throw error;
    }
    try {
      return await operation();
    } finally {
      await lockHandle?.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

function buildNextLockfile(input: {
  current: WorkspacePackageLockV1;
  hostVersion: string;
  resolution: PackageDependencyResolution;
  roots: WorkspacePackageRoot[];
  selectedInstallations: PackageInstallationRecord[];
}): WorkspacePackageLockV1 {
  const now = new Date().toISOString();
  const installationMap = new Map(
    input.current.installations.map((installation) => [
      installation.installationId,
      structuredClone(installation),
    ]),
  );
  for (const installation of input.selectedInstallations) {
    if (!installationMap.has(installation.installationId)) {
      installationMap.set(installation.installationId, structuredClone(installation));
    }
  }
  for (const candidate of input.resolution.selected.values()) {
    const installation = installationMap.get(candidate.installation.installationId)
      ?? structuredClone(candidate.installation);
    installation.lastActivatedAt = now;
    installationMap.set(installation.installationId, installation);
  }
  const resolvedPackages = [...input.resolution.selected.values()]
    .map((candidate): ResolvedWorkspacePackage => ({
      archiveDigest: candidate.installation.archiveDigest,
      dependencies: (input.resolution.edges.get(candidate.installation.packageId) ?? [])
        .sort(compareResolvedDependency),
      digest: candidate.installation.digest,
      installationId: candidate.installation.installationId,
      packageId: candidate.installation.packageId,
      version: candidate.installation.version,
    }))
    .sort((left, right) => compareText(left.packageId, right.packageId));
  return {
    hostVersion: input.hostVersion,
    installations: [...installationMap.values()].sort(compareInstallationIdentity),
    resolvedPackages,
    revision: input.current.revision + 1,
    roots: structuredClone(input.roots).sort((left, right) => compareText(left.packageId, right.packageId)),
    schemaVersion: workspacePackageLockSchemaVersion,
    updatedAt: now,
  };
}

function addDefinitions<T>(
  target: Map<string, InstalledDefinition<T>>,
  source: Map<string, T>,
  packageLock: InstalledDefinition<T>['packageLock'],
  label: string,
): void {
  for (const [id, definition] of source) {
    if (target.has(id)) throw new Error(`Installed Package ${label} ID conflicts: ${id}`);
    target.set(id, {
      definition: structuredClone(definition),
      packageLock: structuredClone(packageLock),
    });
  }
}

function assertResolvedCandidate(
  resolved: ResolvedWorkspacePackage,
  candidate: PackageCandidate,
): void {
  if (
    resolved.packageId !== candidate.installation.packageId
    || resolved.version !== candidate.installation.version
    || resolved.digest !== candidate.installation.digest
    || resolved.archiveDigest !== candidate.installation.archiveDigest
  ) throw new Error(`Resolved Package does not match its cached Installation: ${resolved.packageId}`);
}

function findInstallation(
  lockfile: WorkspacePackageLockV1,
  input: { digest?: string; packageId: string; version?: string },
): PackageInstallationRecord {
  const matches = lockfile.installations.filter((installation) => (
    installation.packageId === input.packageId
    && (!input.version || installation.version === input.version)
    && (!input.digest || installation.digest === input.digest)
  ));
  if (matches.length === 0) {
    throw new Error(`Package Installation was not found: ${input.packageId}`);
  }
  if (matches.length > 1) {
    throw new Error(`Package Installation selector is ambiguous: ${input.packageId}`);
  }
  return matches[0]!;
}

function requiredInstallation(
  lockfile: WorkspacePackageLockV1,
  installationId: string,
): PackageInstallationRecord {
  const installation = lockfile.installations.find(
    (candidate) => candidate.installationId === installationId,
  );
  if (!installation) throw new Error(`Package Installation is missing: ${installationId}`);
  return installation;
}

function requiredResolvedPackage(
  lockfile: WorkspacePackageLockV1,
  packageId: string,
): ResolvedWorkspacePackage {
  const resolved = lockfile.resolvedPackages.find((candidate) => candidate.packageId === packageId);
  if (!resolved) throw new Error(`Resolved Package is missing: ${packageId}`);
  return resolved;
}

function assertUniqueSuppliedSources(candidates: PackageCandidate[]): void {
  const identities = new Map<string, string>();
  for (const candidate of candidates) {
    const key = `${candidate.installation.packageId}@${candidate.installation.version}`;
    const digest = identities.get(key);
    if (digest && digest !== candidate.installation.digest) {
      throw new Error(`Immutable Package version conflict: ${key}`);
    }
    identities.set(key, candidate.installation.digest);
  }
}

function sameActiveState(
  left: WorkspacePackageLockV1,
  right: WorkspacePackageLockV1,
): boolean {
  return JSON.stringify({
    hostVersion: left.hostVersion,
    resolvedPackages: left.resolvedPackages,
    roots: left.roots,
  }) === JSON.stringify({
    hostVersion: right.hostVersion,
    resolvedPackages: right.resolvedPackages,
    roots: right.roots,
  });
}

function compareInstallationActivation(
  left: PackageInstallationRecord,
  right: PackageInstallationRecord,
): number {
  return compareText(right.lastActivatedAt, left.lastActivatedAt)
    || compareText(left.installationId, right.installationId);
}

function compareInstallationIdentity(
  left: PackageInstallationRecord,
  right: PackageInstallationRecord,
): number {
  return compareText(left.packageId, right.packageId)
    || comparePackageVersions(left.version, right.version)
    || compareText(left.digest, right.digest);
}

function compareResolvedDependency(
  left: ResolvedPackageDependency,
  right: ResolvedPackageDependency,
): number {
  return compareText(left.packageId, right.packageId)
    || Number(left.optional) - Number(right.optional);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function atomicWriteNewFile(outputPath: string, content: Buffer): Promise<void> {
  const temporaryPath = `${outputPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(temporaryPath, content, { flag: 'wx', mode: 0o644 });
    await link(temporaryPath, outputPath);
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return isNodeError(error) && error.code === 'EEXIST';
}

function isNotFoundError(error: unknown): boolean {
  return isNodeError(error) && error.code === 'ENOENT';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
