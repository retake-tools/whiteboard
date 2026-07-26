import {
  PackageManager,
  type DownloadedTrustedRegistryPackage,
  type PackageManagerMutationResult,
  type WorkspacePackageLock,
} from '@retake-tools/package-sdk';
import type {
  DeclarativeAgentPresetDefinition,
  DeclarativePackageManifest,
  DeclarativeSkillDefinition,
  DeclarativeWorkflowDefinition,
  RetakePluginModuleManifestV1,
  RetakePackageEntryPoint,
} from '@retake-tools/package-contracts';

export {
  workspacePackageLockFile,
  workspacePackageLockSchemaVersion,
  type LocalPackageSource,
  type PackageInstallationRecord,
  type PackageInstallationSource,
  type RemoteRegistryPackageSource,
  type ResolvedPackageDependency,
  type ResolvedWorkspacePackage,
  type WorkspacePackageLock,
  type WorkspacePackageRoot,
} from '@retake-tools/package-sdk';

export type LocalPackageInstallResult = PackageManagerMutationResult;
export type VerifiedRemotePackageArchive = DownloadedTrustedRegistryPackage;

export interface InstalledDefinition<T> {
  definition: T;
  packageLock: {
    digest: string;
    installationId: string;
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
  pluginModules: Map<string, InstalledDefinition<RetakePluginModuleManifestV1>>;
  skills: Map<string, InstalledDefinition<DeclarativeSkillDefinition>>;
  workflows: Map<string, InstalledDefinition<DeclarativeWorkflowDefinition>>;
}

export class LocalPackageManagerService {
  readonly hostVersion: string;
  readonly packagesRoot: string;
  readonly sdkManager: PackageManager;
  readonly workspaceRoot: string;

  constructor(input: { hostVersion: string; workspaceRoot: string }) {
    this.sdkManager = new PackageManager(input);
    this.hostVersion = this.sdkManager.hostVersion;
    this.packagesRoot = this.sdkManager.packagesRoot;
    this.workspaceRoot = this.sdkManager.workspaceRoot;
  }

  async install(
    sourcePath: string,
    dependencySourcePaths: string[] = [],
  ): Promise<LocalPackageInstallResult> {
    return this.sdkManager.install(sourcePath, dependencySourcePaths);
  }

  async updateGit(
    packageId: string,
    dependencySourcePaths: string[] = [],
  ): Promise<LocalPackageInstallResult> {
    return this.sdkManager.updateGit(packageId, dependencySourcePaths);
  }

  async installVerifiedRemote(
    root: VerifiedRemotePackageArchive,
    dependencies: VerifiedRemotePackageArchive[] = [],
    action: 'install' | 'update',
  ): Promise<LocalPackageInstallResult> {
    return this.sdkManager.commitRemote(
      action,
      root.candidate.packageId,
      [root, ...dependencies],
    );
  }

  async activate(input: {
    digest?: string;
    packageId: string;
    version?: string;
  }): Promise<LocalPackageInstallResult> {
    return this.sdkManager.activate(input);
  }

  async rollback(
    packageId: string,
    target?: string,
  ): Promise<LocalPackageInstallResult> {
    return this.sdkManager.rollback(packageId, target);
  }

  async remove(packageId: string): Promise<WorkspacePackageLock> {
    return this.sdkManager.remove(packageId);
  }

  async list(): Promise<WorkspacePackageLock> {
    return this.sdkManager.list();
  }

  async hasLockfile(): Promise<boolean> {
    return this.sdkManager.hasLockfile();
  }

  async loadRegistry(): Promise<InstalledDeclarativePackageRegistry> {
    const [lockfile, installedPackages] = await Promise.all([
      this.sdkManager.list(),
      this.sdkManager.loadInstalledPackages(),
    ]);
    const resolvedByPackageId = new Map(
      lockfile.resolvedPackages.map((entry) => [entry.packageId, entry]),
    );
    const registry: InstalledDeclarativePackageRegistry = {
      agentPresets: new Map(),
      entrypoints: [],
      packages: [],
      pluginModules: new Map(),
      skills: new Map(),
      workflows: new Map(),
    };
    const entrypointIds = new Set<string>();
    for (const installed of installedPackages) {
      const manifest = installed.manifest;
      const resolved = resolvedByPackageId.get(manifest.packageId);
      if (!resolved) {
        throw new Error(
          `Installed Package is absent from the resolved closure: ${manifest.packageId}`,
        );
      }
      const packageLock = {
        digest: resolved.digest,
        installationId: resolved.installationId,
        packageId: resolved.packageId,
        version: resolved.version,
      };
      registry.packages.push(structuredClone(manifest));
      for (const entrypoint of manifest.entrypoints) {
        if (entrypointIds.has(entrypoint.entrypointId)) {
          throw new Error(
            `Installed Package EntryPoint ID conflicts: ${entrypoint.entrypointId}`,
          );
        }
        entrypointIds.add(entrypoint.entrypointId);
        registry.entrypoints.push({
          entrypoint: structuredClone(entrypoint),
          packageLock: structuredClone(packageLock),
        });
      }
      addDefinitions(
        registry.pluginModules,
        installed.definitions.pluginModules,
        packageLock,
        'PluginModule',
      );
      addDefinitions(
        registry.skills,
        installed.definitions.skills,
        packageLock,
        'Skill',
      );
      addDefinitions(
        registry.workflows,
        installed.definitions.workflows,
        packageLock,
        'Workflow',
      );
      addDefinitions(
        registry.agentPresets,
        installed.definitions.agentPresets,
        packageLock,
        'AgentPreset',
      );
    }
    registry.entrypoints.sort((left, right) => (
      compareText(left.entrypoint.entrypointId, right.entrypoint.entrypointId)
    ));
    registry.packages.sort((left, right) => (
      compareText(left.packageId, right.packageId)
    ));
    return registry;
  }
}

function addDefinitions<T>(
  target: Map<string, InstalledDefinition<T>>,
  source: Map<string, T>,
  packageLock: InstalledDefinition<T>['packageLock'],
  label: string,
): void {
  for (const [id, definition] of source) {
    if (target.has(id)) {
      throw new Error(`Installed Package ${label} ID conflicts: ${id}`);
    }
    target.set(id, {
      definition: structuredClone(definition),
      packageLock: structuredClone(packageLock),
    });
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
