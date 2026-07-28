import { randomUUID } from 'node:crypto';
import {
  PluginRuntimeHost,
  type InstalledPluginModule,
  type PluginModuleRuntimeRecordV1,
  type PluginRuntimeSnapshotV1,
  type RetakePluginPermission,
} from '@retake-tools/package-sdk';
import {
  grantMatchesInstalledPluginModule,
  trustMatchesInstalledPluginModule,
} from '@retake-tools/plugin-runtime';
import { LocalPackageManagerService } from './local-package-manager-service';
import { PluginRuntimeStateStore } from './plugin-runtime-state-store';

export type PluginRuntimeManagementActionV1 =
  | 'disable'
  | 'enable'
  | 'grant'
  | 'trust';

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

  async trustUserCode(
    pluginModuleId: string,
  ): Promise<PluginModuleRuntimeRecordV1> {
    return this.mutate((host) => host.trust({
      pluginModuleId,
      trustChannel: 'user_trusted',
      trustedBy: 'user',
      trustId: randomUUID(),
      updatePolicy: 'exact_digest',
    }));
  }

  async revokeTrust(
    pluginModuleId: string,
  ): Promise<PluginModuleRuntimeRecordV1> {
    return this.mutate((host) => host.revokeTrust(pluginModuleId));
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

  async manageModule(
    pluginModuleId: string,
    action: PluginRuntimeManagementActionV1,
  ): Promise<PluginRuntimeSnapshotV1> {
    return this.mutate((host) => {
      const record = host.list().find(
        (entry) => entry.pluginModuleId === pluginModuleId,
      );
      if (!record) {
        throw new Error(`PluginModule is not installed: ${pluginModuleId}`);
      }
      if (action === 'grant') {
        host.grant({
          grantId: randomUUID(),
          permissions: [...record.manifest.permissions],
          pluginModuleId,
        });
      } else if (action === 'trust') {
        host.trust({
          pluginModuleId,
          trustChannel: 'user_trusted',
          trustedBy: 'user',
          trustId: randomUUID(),
          updatePolicy: 'exact_digest',
        });
      } else {
        host[action](pluginModuleId);
      }
      return host.snapshot();
    });
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

  async readEnabledModuleFile(input: {
    packageDigest: string;
    path: string;
    pluginModuleId: string;
  }): Promise<{ bytes: Buffer; mediaType: string }> {
    if (
      !input.path.startsWith('dist/')
      || input.path.includes('\\')
      || input.path.split('/').some((segment) => (
        segment.length === 0 || segment === '.' || segment === '..'
      ))
    ) {
      throw new Error('Plugin Web Module path is outside dist/.');
    }
    const host = await this.loadHost();
    const runtime = host.snapshot();
    const record = runtime.modules.find(
      (entry) => entry.pluginModuleId === input.pluginModuleId,
    );
    if (
      !record
      || runtime.safeMode
      || record.negotiatedHostApiVersion === null
      || !grantMatchesInstalledPluginModule(record, record.grant)
      || !trustMatchesInstalledPluginModule(record, record.trust)
    ) {
      throw new Error('Plugin Web Module is not eligible and trusted.');
    }
    if (record.packageLock.digest !== input.packageDigest) {
      throw new Error('Plugin Web Module Package digest is stale.');
    }
    const installedPackages = await this.manager.sdkManager.loadInstalledPackages();
    const installed = installedPackages.find((entry) => (
      entry.manifest.packageId === record.packageLock.packageId
      && entry.digest === input.packageDigest
    ));
    const bytes = installed?.files.get(input.path);
    if (!bytes) throw new Error('Plugin Web Module file is not installed.');
    return {
      bytes: Buffer.from(bytes),
      mediaType: pluginModuleMediaType(input.path),
    };
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
    const publishers = new Map(
      registry.packages.map((manifest) => [
        manifest.packageId,
        manifest.publisher.publisherId,
      ]),
    );
    return [...registry.pluginModules.values()]
      .map((entry) => {
        const publisherId = publishers.get(entry.packageLock.packageId);
        if (!publisherId) {
          throw new Error(
            `PluginModule Package publisher is missing: ${
              entry.packageLock.packageId
            }`,
          );
        }
        return {
          definitionHash: entry.definition.definitionHash,
          manifest: structuredClone(entry.definition),
          packageLock: structuredClone(entry.packageLock),
          publisherId,
        };
      })
      .sort((left, right) => compareText(
        left.manifest.pluginModuleId,
        right.manifest.pluginModuleId,
      ));
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function pluginModuleMediaType(filePath: string): string {
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.svg')) return 'image/svg+xml';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.woff2')) return 'font/woff2';
  if (filePath.endsWith('.woff')) return 'font/woff';
  return 'application/octet-stream';
}
