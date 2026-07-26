import { randomUUID } from 'node:crypto';
import {
  PluginRuntimeHost,
  type InstalledPluginModule,
  type PluginModuleRuntimeRecordV1,
  type PluginRuntimeSnapshotV1,
  type RetakePluginPermission,
} from '@retake-tools/package-sdk';
import { LocalPackageManagerService } from './local-package-manager-service';
import { PluginRuntimeStateStore } from './plugin-runtime-state-store';

export class PluginRuntimeService {
  readonly hostVersion: string;
  readonly manager: LocalPackageManagerService;
  readonly stateStore: PluginRuntimeStateStore;
  readonly workspaceRoot: string;

  constructor(input: { hostVersion: string; workspaceRoot: string }) {
    this.manager = new LocalPackageManagerService(input);
    this.hostVersion = this.manager.hostVersion;
    this.workspaceRoot = this.manager.workspaceRoot;
    this.stateStore = new PluginRuntimeStateStore(this.manager.packagesRoot);
  }

  async reconcile(input: {
    safeMode?: boolean;
  } = {}): Promise<PluginRuntimeSnapshotV1> {
    return this.stateStore.withMutationLock(async () => {
      const host = await this.loadHost(input.safeMode);
      const snapshot = host.snapshot();
      await this.stateStore.write(snapshot);
      return snapshot;
    });
  }

  async grant(input: {
    permissions: RetakePluginPermission[];
    pluginModuleId: string;
  }): Promise<PluginModuleRuntimeRecordV1> {
    return this.mutate((host) => host.grant({
      grantId: randomUUID(),
      permissions: input.permissions,
      pluginModuleId: input.pluginModuleId,
    }));
  }

  async revoke(
    pluginModuleId: string,
  ): Promise<PluginModuleRuntimeRecordV1> {
    return this.mutate((host) => host.revoke(pluginModuleId));
  }

  async enable(
    pluginModuleId: string,
  ): Promise<PluginModuleRuntimeRecordV1> {
    return this.mutate((host) => host.enable(pluginModuleId));
  }

  async disable(
    pluginModuleId: string,
  ): Promise<PluginModuleRuntimeRecordV1> {
    return this.mutate((host) => host.disable(pluginModuleId));
  }

  async fail(
    pluginModuleId: string,
    message: string,
  ): Promise<PluginModuleRuntimeRecordV1> {
    return this.mutate((host) => host.fail(pluginModuleId, message));
  }

  async setSafeMode(enabled: boolean): Promise<PluginRuntimeSnapshotV1> {
    return this.mutate((host) => host.setSafeMode(enabled));
  }

  async assertPermission(
    pluginModuleId: string,
    permission: RetakePluginPermission,
  ): Promise<void> {
    await this.stateStore.withMutationLock(async () => {
      const host = await this.loadHost();
      await this.stateStore.write(host.snapshot());
      host.assertPermission(pluginModuleId, permission);
    });
  }

  private async mutate<T>(
    operation: (host: PluginRuntimeHost) => T,
  ): Promise<T> {
    return this.stateStore.withMutationLock(async () => {
      const host = await this.loadHost();
      const result = operation(host);
      await this.stateStore.write(host.snapshot());
      return result;
    });
  }

  private async loadHost(
    safeMode?: boolean,
  ): Promise<PluginRuntimeHost> {
    const [installedModules, previousSnapshot] = await Promise.all([
      this.installedModules(),
      this.stateStore.read(),
    ]);
    return new PluginRuntimeHost({
      installedModules,
      previousSnapshot,
      ...(safeMode === undefined ? {} : { safeMode }),
    });
  }

  private async installedModules(): Promise<InstalledPluginModule[]> {
    const registry = await this.manager.loadRegistry();
    return [...registry.pluginModules.values()]
      .map((entry) => ({
        definitionHash: entry.definition.definitionHash,
        manifest: structuredClone(entry.definition),
        packageLock: structuredClone(entry.packageLock),
      }))
      .sort((left, right) => compareText(
        left.manifest.pluginModuleId,
        right.manifest.pluginModuleId,
      ));
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
