import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  PluginModuleRuntimeRecordV1,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import { PluginManager } from '../src/components/PluginManager';
import type {
  PackageLifecycleControllerV1,
} from '../src/core/packageLifecycleClient';
import type {
  PackageLifecycleSnapshotV1,
} from '../src/core/packageLifecycleContracts';
import {
  createPluginRuntimeController,
  type PluginRuntimeControllerV1,
} from '../src/core/pluginRuntimeManagementClient';
import { I18nProvider } from '../src/i18n';

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => 'en',
    setItem: () => {},
  },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'en-US' },
});

const installed = runtimeSnapshot({
  desiredState: 'disabled',
  grant: null,
  status: 'installed',
  trust: null,
});
assert.match(renderSettings(installed), /Grant exact permissions/);

const granted = runtimeSnapshot({
  desiredState: 'disabled',
  grant: {
    grantId: 'grant.fixture',
    grantedAt: '2026-07-27T00:00:00.000Z',
    grantedBy: 'user',
    permissions: [...installed.modules[0]!.manifest.permissions],
    pluginModuleId: installed.modules[0]!.pluginModuleId,
    publisherId: installed.modules[0]!.publisherId,
    schemaVersion: 1,
  },
  status: 'installed',
  trust: null,
});
assert.match(renderSettings(granted), /Trust exact code/);

const enabled = runtimeSnapshot({
  desiredState: 'enabled',
  grant: granted.modules[0]!.grant,
  status: 'enabled',
  trust: {
    definitionHash: granted.modules[0]!.definitionHash,
    packageDigest: granted.modules[0]!.packageLock.digest,
    pluginModuleId: granted.modules[0]!.pluginModuleId,
    publisherId: granted.modules[0]!.publisherId,
    schemaVersion: 1,
    trustChannel: 'user_trusted',
    trustedAt: '2026-07-27T00:00:00.000Z',
    trustedBy: 'user',
    trustId: 'trust.fixture',
    updatePolicy: 'exact_digest',
  },
});
assert.match(renderSettings(enabled), />Disable</);
assert.match(renderSettings({ ...enabled, safeMode: true }), /Leave safe mode/);

const originalFetch = globalThis.fetch;
const calls: string[] = [];
const applied: PluginRuntimeSnapshotV1[] = [];
let releaseFirstRequest: (() => void) | undefined;
const firstRequest = new Promise<void>((resolve) => {
  releaseFirstRequest = resolve;
});
let responseIndex = 0;
globalThis.fetch = async (input): Promise<Response> => {
  calls.push(String(input));
  const index = responseIndex++;
  if (index === 0) await firstRequest;
  const snapshot = index === 0
    ? runtimeSnapshot({
      desiredState: 'disabled',
      grant: enabled.modules[0]!.grant,
      status: 'disabled',
      trust: enabled.modules[0]!.trust,
    })
    : {
      ...enabled,
      modules: [{
        ...enabled.modules[0]!,
        status: 'disabled',
      }],
      safeMode: true,
    };
  return new Response(JSON.stringify(snapshot), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
};

try {
  const controller = createPluginRuntimeController({
    applySnapshot: async (snapshot) => {
      applied.push(snapshot);
    },
    initialSnapshot: enabled,
  });
  let notificationCount = 0;
  const unsubscribe = controller.subscribe(() => {
    notificationCount += 1;
  });
  const disable = controller.manageModule(
    enabled.modules[0]!.pluginModuleId,
    'disable',
  );
  const safeMode = controller.setSafeMode(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  releaseFirstRequest?.();
  await Promise.all([disable, safeMode]);
  unsubscribe();
  assert.deepEqual(calls, [
    '/api/local/plugin-runtime/modules/retake.plugin.runtime-management-fixture/disable',
    '/api/local/plugin-runtime/safe-mode',
  ]);
  assert.equal(applied.length, 2);
  assert.equal(notificationCount, 2);
  assert.equal(controller.getSnapshot().safeMode, true);
} finally {
  globalThis.fetch = originalFetch;
}

process.stdout.write(`${JSON.stringify({
  exactNextRuntimeAction: true,
  lazyPanelUsesStableExternalStore: true,
  runtimeMutationsSerialized: true,
  runtimeSnapshotReconciledBeforeNotification: true,
})}\n`);

function renderSettings(snapshot: PluginRuntimeSnapshotV1): string {
  const pluginController: PluginRuntimeControllerV1 = {
    getSnapshot: () => snapshot,
    manageModule: async () => snapshot,
    refresh: async () => snapshot,
    replace: async () => snapshot,
    setSafeMode: async () => snapshot,
    subscribe: () => () => {},
  };
  const packageSnapshot = lifecycleSnapshot(snapshot);
  const packageController: PackageLifecycleControllerV1 = {
    getSnapshot: () => packageSnapshot,
    mutate: async () => packageSnapshot,
    refresh: async () => packageSnapshot,
    subscribe: () => () => {},
  };
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(PluginManager, {
        onClose: () => {},
        packageController,
        pluginController,
      }),
    ),
  );
}

function lifecycleSnapshot(
  pluginRuntime: PluginRuntimeSnapshotV1,
): PackageLifecycleSnapshotV1 {
  return {
    lockRevision: 1,
    packages: [{
      componentCounts: {
        agentPresets: 0,
        pluginModules: 1,
        skills: 0,
        workflows: 0,
      },
      dependencies: [],
      description: 'Runtime Management fixture.',
      digest: pluginRuntime.modules[0]!.packageLock.digest,
      history: [],
      installationId: pluginRuntime.modules[0]!.packageLock.installationId,
      isRoot: true,
      name: 'Runtime Management fixture',
      packageId: pluginRuntime.modules[0]!.packageLock.packageId,
      source: {
        canUpdate: false,
        kind: 'local_directory',
        label: 'runtime-management-fixture',
      },
      version: pluginRuntime.modules[0]!.packageLock.version,
    }],
    pluginRuntime,
    runtimeRegistry: {
      agentPresets: [],
      lockRevision: 1,
      packages: [],
      profileId: 'test.plugin-manager',
      schemaVersion: 1,
      skills: [],
      snapshotDigest: `sha256:${'b'.repeat(64)}`,
      workflows: [],
    },
    schemaVersion: 1,
    updatedAt: pluginRuntime.updatedAt,
  };
}

function runtimeSnapshot(input: Pick<
  PluginModuleRuntimeRecordV1,
  'desiredState' | 'grant' | 'status' | 'trust'
>): PluginRuntimeSnapshotV1 {
  return {
    modules: [{
      definitionHash: 'sha256:runtime-management-fixture',
      desiredState: input.desiredState,
      failure: null,
      grant: input.grant,
      manifest: {
        contributions: [{
          contributionId: 'retake.contribution.runtime-management-fixture',
          exportName: 'activate',
          kind: 'panel',
        }],
        definitionHash: 'sha256:runtime-management-fixture',
        description: 'Runtime Management fixture.',
        name: 'Runtime Management fixture',
        permissions: ['retake.asset.read.bound'],
        pluginModuleId: 'retake.plugin.runtime-management-fixture',
        runtime: {
          entrypoint: 'dist/index.js',
          hostApi: {
            maximumVersion: 2,
            minimumVersion: 2,
          },
          kind: 'web_module',
        },
        schemaVersion: 2,
        version: '0.1.0',
      },
      negotiatedHostApiVersion: 2,
      packageLock: {
        digest: `sha256:${'a'.repeat(64)}`,
        installationId: 'installation.runtime-management-fixture',
        packageId: 'retake.package.runtime-management-fixture',
        version: '0.1.0',
      },
      pluginModuleId: 'retake.plugin.runtime-management-fixture',
      publisherId: 'retake.publisher.fixture',
      status: input.status,
      trust: input.trust,
      updatedAt: '2026-07-27T00:00:00.000Z',
    }],
    safeMode: false,
    schemaVersion: 1,
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}
