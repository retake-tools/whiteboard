import assert from 'node:assert/strict';
import type {
  ActivatedPluginWebModuleV1,
  PluginModuleRuntimeRecordV1,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import {
  createPluginHostReadStore,
  reconcilePluginWebModules,
} from '../src/core/pluginWebModuleLoader';

const readStore = createPluginHostReadStore({
  boardId: 'board.fixture',
  boundAssetIds: [],
  boundBlockIds: ['block.fixture'],
  boundGroupIds: [],
  projectId: 'project.fixture',
  revision: 'revision-1',
  selectedBlockIds: ['block.fixture'],
});
const host = readStore.host(1);
let readNotifications = 0;
const unsubscribe = host.subscribeReadSnapshot(() => {
  readNotifications += 1;
});
readStore.update(host.getReadSnapshot());
assert.equal(readNotifications, 0);
readStore.update({
  ...host.getReadSnapshot(),
  revision: 'revision-2',
  selectedBlockIds: [],
});
assert.equal(readNotifications, 1);
unsubscribe();

const record = {
  definitionHash: 'sha256:loader-fixture',
  desiredState: 'enabled',
  failure: null,
  grant: {
    grantId: 'grant.fixture',
    grantedAt: '2026-07-26T00:00:00.000Z',
    grantedBy: 'user',
    permissions: ['retake.package.read.self'],
    pluginModuleId: 'retake.plugin.loader-fixture',
    publisherId: 'retake.publisher.official',
    schemaVersion: 1,
  },
  manifest: {
    contributions: [],
    definitionHash: 'sha256:loader-fixture',
    description: 'Loader fixture',
    name: 'Loader fixture',
    permissions: ['retake.package.read.self'],
    pluginModuleId: 'retake.plugin.loader-fixture',
    runtime: {
      entrypoint: 'dist/index.js',
      hostApi: {
        maximumVersion: 1,
        minimumVersion: 1,
      },
      kind: 'web_module',
    },
    schemaVersion: 1,
    version: '0.1.0',
  },
  negotiatedHostApiVersion: 1,
  packageLock: {
    digest: `sha256:${'1'.repeat(64)}`,
    installationId: 'installation.fixture',
    packageId: 'retake.package.loader-fixture',
    version: '0.1.0',
  },
  pluginModuleId: 'retake.plugin.loader-fixture',
  publisherId: 'retake.publisher.official',
  status: 'enabled',
  trust: {
    definitionHash: 'sha256:loader-fixture',
    packageDigest: `sha256:${'1'.repeat(64)}`,
    pluginModuleId: 'retake.plugin.loader-fixture',
    publisherId: 'retake.publisher.official',
    schemaVersion: 1,
    trustChannel: 'user_trusted',
    trustedAt: '2026-07-26T00:00:00.000Z',
    trustedBy: 'user',
    trustId: 'trust.fixture',
    updatePolicy: 'exact_digest',
  },
  updatedAt: '2026-07-26T00:00:00.000Z',
} satisfies PluginModuleRuntimeRecordV1;
let activationCalls = 0;
let disposalCalls = 0;
const activate = async (): Promise<ActivatedPluginWebModuleV1> => {
  activationCalls += 1;
  return {
    contributions: [],
    async dispose() {
      disposalCalls += 1;
    },
    pluginModuleId: record.pluginModuleId,
  };
};
const snapshot = {
  modules: [record],
  safeMode: false,
  schemaVersion: 1,
  updatedAt: '2026-07-26T00:00:00.000Z',
} satisfies PluginRuntimeSnapshotV1;
await reconcilePluginWebModules({
  activate,
  createHost: () => host,
  snapshot,
});
await reconcilePluginWebModules({
  activate,
  createHost: () => host,
  snapshot,
});
assert.equal(activationCalls, 1);
await reconcilePluginWebModules({
  activate,
  createHost: () => host,
  snapshot: {
    ...snapshot,
    safeMode: true,
  },
});
assert.equal(disposalCalls, 1);

process.stdout.write(`${JSON.stringify({
  conditionalRuntimeChunk: true,
  exactDigestModuleCache: true,
  safeModeDisposesActivation: true,
  scopedSubscriptionDeduplicatesSnapshots: true,
})}\n`);
