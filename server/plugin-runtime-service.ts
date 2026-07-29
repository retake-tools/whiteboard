import { randomUUID } from 'node:crypto';
import {
  LinkedPackageDevelopmentManager,
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
import {
  OfficialPackagePreferenceStore,
  officialDefaultPluginModuleIds,
} from './official-package-preference-store';

export type PluginRuntimeManagementActionV1 =
  | 'disable'
  | 'enable'
  | 'grant'
  | 'revoke'
  | 'trust';

export interface OfficialPluginRuntimeDefaultV1 {
  packageDigest: string;
  packageId: string;
  permissions: RetakePluginPermission[];
  pluginModuleId: string;
}

export class PluginRuntimeService {
  readonly hostVersion: string;
  readonly manager: LocalPackageManagerService;
  readonly development: LinkedPackageDevelopmentManager;
  readonly officialPreferences: OfficialPackagePreferenceStore;
  readonly stateStore: PluginRuntimeStateStore;
  readonly workspaceRoot: string;

  constructor(input: { hostVersion: string; workspaceRoot: string }) {
    this.manager = new LocalPackageManagerService(input);
    this.development = new LinkedPackageDevelopmentManager(input);
    this.hostVersion = this.manager.hostVersion;
    this.workspaceRoot = this.manager.workspaceRoot;
    this.stateStore = new PluginRuntimeStateStore(this.manager.packagesRoot);
    this.officialPreferences = new OfficialPackagePreferenceStore(
      this.manager.packagesRoot,
    );
  }

  async reconcile(input: {
    officialDefaults?: OfficialPluginRuntimeDefaultV1[];
    safeMode?: boolean;
  } = {}): Promise<PluginRuntimeSnapshotV1> {
    return this.stateStore.withMutationLock(async () => {
      const host = await this.loadHost(input.safeMode);
      if (input.officialDefaults) {
        await this.applyOfficialDefaults(host, input.officialDefaults);
      }
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
    const snapshot = await this.mutate((host) => {
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
      } else if (action === 'revoke') {
        host.revoke(pluginModuleId);
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
    if (officialDefaultPluginModuleIds.includes(
      pluginModuleId as typeof officialDefaultPluginModuleIds[number],
    )) {
      if (action === 'disable' || action === 'enable') {
        await this.officialPreferences.setPluginDisabled(
          pluginModuleId,
          action === 'disable',
        );
      } else if (action === 'grant' || action === 'revoke') {
        await this.officialPreferences.setPluginGrantRevoked(
          pluginModuleId,
          action === 'revoke',
        );
      }
    }
    return snapshot;
  }

  async setPermissions(
    pluginModuleId: string,
    permissions: RetakePluginPermission[],
  ): Promise<PluginRuntimeSnapshotV1> {
    const snapshot = await this.mutate((host) => {
      const record = host.list().find(
        (entry) => entry.pluginModuleId === pluginModuleId,
      );
      if (!record) {
        throw new Error(`PluginModule is not installed: ${pluginModuleId}`);
      }
      host.grant({
        grantId: randomUUID(),
        permissions: [...new Set(permissions)].sort(compareText),
        pluginModuleId,
      });
      if (
        record.desiredState === 'enabled'
        && record.trust
        && !host.snapshot().safeMode
      ) {
        host.enable(pluginModuleId);
      }
      return host.snapshot();
    });
    if (officialDefaultPluginModuleIds.includes(
      pluginModuleId as typeof officialDefaultPluginModuleIds[number],
    )) {
      const record = snapshot.modules.find(
        (entry) => entry.pluginModuleId === pluginModuleId,
      )!;
      const isFullGrant = samePermissionSet(
        record.grant?.permissions ?? [],
        record.manifest.permissions,
      );
      await this.officialPreferences.setPluginPermissionOverride(
        pluginModuleId,
        isFullGrant ? null : [...(record.grant?.permissions ?? [])],
      );
      await this.officialPreferences.setPluginGrantRevoked(
        pluginModuleId,
        false,
      );
    }
    return snapshot;
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
    const [installedModules, previousSnapshot, development] = await Promise.all([
      this.installedModules(),
      this.stateStore.readTolerant(),
      this.development.list(),
    ]);
    const base = new PluginRuntimeHost({
      installedModules,
      previousSnapshot,
      ...(safeMode === undefined ? {} : { safeMode }),
    }).snapshot();
    for (const link of development.links) {
      const active = link.candidate ?? {
        identity: link.identity,
        lastGood: link.lastGood,
      };
      for (const identity of active.identity.pluginModules) {
        const record = base.modules.find((entry) => (
          entry.pluginModuleId === identity.pluginModuleId
          && entry.packageLock.packageId === active.identity.packageId
          && entry.packageLock.installationId === active.lastGood.installationId
          && JSON.stringify(entry.manifest.permissions)
            === JSON.stringify(identity.permissions)
        ));
        if (!record) continue;
        record.trust = {
          definitionHash: record.definitionHash,
          packageDigest: record.packageLock.digest,
          pluginModuleId: record.pluginModuleId,
          publisherId: record.publisherId,
          schemaVersion: 1,
          trustChannel: 'linked_source',
          trustedAt: link.trustedAt,
          trustedBy: 'user',
          trustId: `linked:${link.linkId}`,
          updatePolicy: 'exact_digest',
        };
        record.failure = null;
        if (record.status === 'failed') record.status = 'installed';
      }
    }
    return new PluginRuntimeHost({
      installedModules,
      previousSnapshot: base,
    });
  }

  private async installedModules(): Promise<InstalledPluginModule[]> {
    const { registry } = await this.manager.loadRegistryTolerant();
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

  private async applyOfficialDefaults(
    host: PluginRuntimeHost,
    defaults: OfficialPluginRuntimeDefaultV1[],
  ): Promise<void> {
    const preferences = await this.officialPreferences.read();
    const safeMode = host.snapshot().safeMode;
    for (const policy of defaults) {
      const record = host.list().find((entry) => (
        entry.pluginModuleId === policy.pluginModuleId
        && entry.packageLock.packageId === policy.packageId
        && entry.packageLock.digest === policy.packageDigest
        && entry.publisherId === 'retake.publisher.official'
      ));
      if (!record) continue;
      const grantRevoked = preferences.revokedGrantPluginModuleIds.includes(
        policy.pluginModuleId,
      );
      const permissionOverride = preferences.permissionOverrides.find(
        (entry) => entry.pluginModuleId === policy.pluginModuleId,
      );
      if (!grantRevoked) {
        host.grant({
          grantId: `official:${policy.packageDigest}`,
          permissions: permissionOverride
            ? policy.permissions.filter((permission) => (
              permissionOverride.permissions.includes(permission)
            ))
            : [...policy.permissions],
          pluginModuleId: policy.pluginModuleId,
        });
      }
      host.trust({
        pluginModuleId: policy.pluginModuleId,
        trustChannel: 'official',
        trustedBy: 'host',
        trustId: `official:${policy.packageDigest}`,
        updatePolicy: 'trusted_publisher',
      });
      if (!preferences.disabledPluginModuleIds.includes(
        policy.pluginModuleId,
      ) && !grantRevoked && !safeMode) {
        host.enable(policy.pluginModuleId);
      }
    }
  }
}

function samePermissionSet(
  left: readonly RetakePluginPermission[],
  right: readonly RetakePluginPermission[],
): boolean {
  return left.length === right.length
    && left.every((permission) => right.includes(permission));
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
