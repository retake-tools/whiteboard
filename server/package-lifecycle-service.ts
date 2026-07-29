import path from 'node:path';
import type {
  PackageInstallationRecord,
  WorkspacePackageLock,
} from '@retake-tools/package-sdk';
import type {
  PackageLifecycleMutationV1,
  PackageLifecycleRecordV1,
  PackageLifecycleSnapshotV1,
  PackageUpdateSnapshotV1,
} from '../src/core/packageLifecycleContracts';
import {
  ensureDefaultDeclarativePackageBootstrap,
  invalidateDefaultDeclarativePackageBootstrap,
} from './declarative-package-bootstrap-service';
import {
  LocalPackageManagerService,
  type InstalledDeclarativePackageRegistry,
} from './local-package-manager-service';
import { PluginRuntimeService } from './plugin-runtime-service';
import {
  OfficialPackagePreferenceStore,
  officialDefaultPackageIds,
} from './official-package-preference-store';
import { PackageUpdateService } from './package-update-service';

export class PackageLifecycleService {
  private readonly hostVersion: string;
  private readonly manager: LocalPackageManagerService;
  private readonly officialPreferences: OfficialPackagePreferenceStore;
  private readonly updates: PackageUpdateService;
  private readonly workspaceRoot: string;

  constructor(input: {
    hostVersion: string;
    workspaceRoot: string;
  }) {
    this.hostVersion = input.hostVersion;
    this.workspaceRoot = input.workspaceRoot;
    this.manager = new LocalPackageManagerService(input);
    this.officialPreferences = new OfficialPackagePreferenceStore(
      this.manager.packagesRoot,
    );
    this.updates = new PackageUpdateService(input);
  }

  async checkUpdates(): Promise<PackageUpdateSnapshotV1> {
    await ensureDefaultDeclarativePackageBootstrap({
      hostVersion: this.hostVersion,
      workspaceRoot: this.workspaceRoot,
    });
    return this.updates.check();
  }

  async read(): Promise<PackageLifecycleSnapshotV1> {
    const bootstrap = await ensureDefaultDeclarativePackageBootstrap({
      hostVersion: this.hostVersion,
      workspaceRoot: this.workspaceRoot,
    });
    const [lockfile, pluginRuntime, installed] = await Promise.all([
      this.manager.list(),
      new PluginRuntimeService({
        hostVersion: this.hostVersion,
        workspaceRoot: this.workspaceRoot,
      }).reconcile(),
      this.manager.loadRegistryTolerant(),
    ]);
    return projectPackageLifecycleSnapshot({
      failures: installed.failures,
      lockfile,
      pluginRuntime,
      registry: installed.registry,
      runtimeRegistry: bootstrap.snapshot,
    });
  }

  async mutate(
    mutation: PackageLifecycleMutationV1,
  ): Promise<PackageLifecycleSnapshotV1> {
    if (mutation.action === 'install') {
      const result = await this.manager.install(
        requiredSource(mutation.source),
      );
      if (isOfficialPackageId(result.root.packageId)) {
        await this.officialPreferences.setPackageRemoved(
          result.root.packageId,
          false,
        );
        await this.officialPreferences.setPackageUpstreamManaged(
          result.root.packageId,
          false,
        );
      }
    } else {
      const packageId = requiredPackageId(mutation.packageId);
      if (mutation.action === 'update') {
        await this.updates.update(packageId);
      } else if (mutation.action === 'repair') {
        await this.repair(packageId);
      } else if (mutation.action === 'rollback') {
        await this.manager.rollback(
          packageId,
          mutation.target ? requiredTarget(mutation.target) : undefined,
        );
      } else {
        await this.manager.remove(packageId);
        if (isOfficialPackageId(packageId)) {
          await this.officialPreferences.setPackageRemoved(packageId, true);
        }
      }
    }
    invalidateDefaultDeclarativePackageBootstrap();
    return this.read();
  }

  private async repair(packageId: string): Promise<void> {
    const [lockfile, installed] = await Promise.all([
      this.manager.list(),
      this.manager.loadRegistryTolerant(),
    ]);
    if (!installed.failures.some((failure) => failure.packageId === packageId)) {
      throw new PackageLifecycleInputError(
        `Package is not isolated: ${packageId}`,
      );
    }
    const resolved = lockfile.resolvedPackages.find(
      (entry) => entry.packageId === packageId,
    );
    const installation = lockfile.installations.find(
      (entry) => entry.installationId === resolved?.installationId,
    );
    if (!installation) {
      throw new PackageLifecycleInputError(
        `Isolated Package Installation is missing: ${packageId}`,
      );
    }
    if (installation.source.kind === 'git') {
      await this.updates.update(packageId);
      return;
    }
    if (
      installation.source.kind !== 'local_directory'
      && installation.source.kind !== 'local_archive'
    ) {
      throw new PackageLifecycleInputError(
        `Isolated Package source cannot be repaired in place: ${packageId}`,
      );
    }
    await this.manager.repair(packageId, installation.source.path);
    if (isOfficialPackageId(packageId)) {
      await this.officialPreferences.setPackageRemoved(packageId, false);
      await this.officialPreferences.setPackageUpstreamManaged(
        packageId,
        false,
      );
    }
  }
}

function isOfficialPackageId(
  packageId: string,
): packageId is typeof officialDefaultPackageIds[number] {
  return officialDefaultPackageIds.includes(
    packageId as typeof officialDefaultPackageIds[number],
  );
}

export function projectPackageLifecycleSnapshot(input: {
  failures?: Awaited<
    ReturnType<LocalPackageManagerService['loadRegistryTolerant']>
  >['failures'];
  lockfile: WorkspacePackageLock;
  pluginRuntime: PackageLifecycleSnapshotV1['pluginRuntime'];
  registry: InstalledDeclarativePackageRegistry;
  runtimeRegistry: PackageLifecycleSnapshotV1['runtimeRegistry'];
}): PackageLifecycleSnapshotV1 {
  const manifests = new Map(
    input.registry.packages.map((manifest) => [manifest.packageId, manifest]),
  );
  const failures = new Map(
    (input.failures ?? []).map((failure) => [failure.packageId, failure]),
  );
  const roots = new Set(
    input.lockfile.roots.map((root) => root.packageId),
  );
  const activeInstallationIds = new Set(
    input.lockfile.resolvedPackages.map((entry) => entry.installationId),
  );
  const packages = input.lockfile.resolvedPackages.map((resolved) => {
    const manifest = manifests.get(resolved.packageId);
    const installation = input.lockfile.installations.find(
      (entry) => entry.installationId === resolved.installationId,
    );
    const failure = failures.get(resolved.packageId);
    if ((!manifest && !failure) || !installation) {
      throw new Error(
        `Package lifecycle projection is incomplete: ${resolved.packageId}`,
      );
    }
    const history = input.lockfile.installations
      .filter((entry) => (
        entry.packageId === resolved.packageId
        && !activeInstallationIds.has(entry.installationId)
      ))
      .sort((left, right) => (
        right.lastActivatedAt.localeCompare(left.lastActivatedAt)
      ))
      .map((entry) => ({
        digest: entry.digest,
        installationId: entry.installationId,
        installedAt: entry.installedAt,
        sourceKind: entry.source.kind,
        version: entry.version,
      }));
    return {
      componentCounts: {
        agentPresets: manifest?.components.agentPresets.length ?? 0,
        pluginModules: manifest?.components.pluginModules?.length ?? 0,
        skills: manifest?.components.skills.length ?? 0,
        workflows: manifest?.components.workflows.length ?? 0,
      },
      dependencies: resolved.dependencies.map((dependency) => ({
        optional: dependency.optional,
        packageId: dependency.packageId,
        range: dependency.range,
      })),
      description: manifest?.description
        ?? 'This Package is isolated because its installed contents are incompatible or invalid.',
      digest: resolved.digest,
      history,
      installationId: resolved.installationId,
      isRoot: roots.has(resolved.packageId),
      loadFailure: failure
        ? {
            code: 'incompatible_or_invalid_package',
            message: summarizeLoadFailure(failure.error),
          }
        : null,
      name: manifest?.name ?? officialPackageName(resolved.packageId),
      packageId: resolved.packageId,
      source: projectSource(installation),
      version: resolved.version,
    } satisfies PackageLifecycleRecordV1;
  }).sort((left, right) => compareText(left.packageId, right.packageId));
  return {
    lockRevision: input.lockfile.revision,
    packages,
    pluginRuntime: structuredClone(input.pluginRuntime),
    runtimeRegistry: structuredClone(input.runtimeRegistry),
    schemaVersion: 1,
    updatedAt: input.lockfile.updatedAt,
  };
}

function projectSource(
  installation: PackageInstallationRecord,
): PackageLifecycleRecordV1['source'] {
  if (installation.source.kind === 'git') {
    const ref = installation.source.requestedRef
      ? ` @ ${installation.source.requestedRef}`
      : '';
    return {
      canUpdate: true,
      kind: 'git',
      label: `${installation.source.repository}${ref}`,
    };
  }
  if (installation.source.kind === 'remote_registry') {
    return {
      canUpdate: false,
      kind: 'remote_registry',
      label: installation.source.registryId,
    };
  }
  return {
    canUpdate: false,
    kind: installation.source.kind,
    label: path.basename(installation.source.path),
  };
}

function requiredSource(value: unknown): string {
  if (typeof value !== 'string') {
    throw new PackageLifecycleInputError('Package source must be a string.');
  }
  const source = value.trim();
  if (source.length === 0 || source.length > 2048) {
    throw new PackageLifecycleInputError('Package source is invalid.');
  }
  return source;
}

function summarizeLoadFailure(message: string): string {
  const issues = message.split('\n').filter(Boolean);
  if (issues.length <= 1) return message;
  return `${issues[0]} (+${issues.length - 1} more validation issues)`;
}

function officialPackageName(packageId: string): string {
  if (packageId === 'design.retake.image-studio') {
    return 'Retake Image Studio';
  }
  if (packageId === 'design.retake.video-studio') {
    return 'Retake Video Studio';
  }
  return packageId;
}

function requiredPackageId(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^[a-z0-9][a-z0-9._-]{2,127}$/.test(value)
  ) {
    throw new PackageLifecycleInputError('Package ID is invalid.');
  }
  return value;
}

function requiredTarget(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new PackageLifecycleInputError('Package rollback target is invalid.');
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export class PackageLifecycleInputError extends Error {}
