import assert from 'node:assert/strict';
import type {
  ActivatedPluginWebModuleV2,
  PluginModuleRuntimeRecordV1,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import {
  createPluginHostReadStore,
  disposePluginWebModule,
  reconcilePluginWebModules,
} from '../src/core/pluginWebModuleLoader';

const readStore = createPluginHostReadStore({
  boardId: 'board.fixture',
  boundAssetIds: [],
  boundBlockIds: ['block.fixture', 'block.mask'],
  boundGroupIds: [],
  projectId: 'project.fixture',
  revision: 'revision-1',
  selectedBlockIds: ['block.fixture'],
}, {
  authorizeExecution: (pluginModuleId, capabilityId) => (
    pluginModuleId === 'retake.plugin.loader-fixture'
    && (
      capabilityId === 'image.local_adjust'
      || capabilityId === 'image.masked_edit'
    )
  ),
  async importImage(input) {
    assert.equal(input.projectId, 'project.fixture');
    return {
      assetId: 'asset.imported',
      createdAt: '2026-07-27T00:00:00.000Z',
      height: input.height,
      kind: 'image',
      mimeType: 'image/svg+xml',
      previewUrl: '/api/local/assets/project.fixture/asset.imported/fixture.svg',
      projectId: input.projectId,
      storageKey: 'assets/asset.imported/fixture.svg',
      storageProvider: 'local',
      width: input.width,
    };
  },
});
const host = readStore.host(2, 'retake.plugin.loader-fixture');
assert.equal(host.getReadSnapshot(), host.getReadSnapshot());
assert.equal(Object.isFrozen(host.getReadSnapshot()), true);
assert.equal(Object.isFrozen(host.getReadSnapshot().selectedBlockIds), true);
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
readStore.update({
  ...host.getReadSnapshot(),
  boundAssetIds: ['asset.bound'],
}, [{
  assetId: 'asset.bound',
  createdAt: '2026-07-27T00:00:00.000Z',
  height: 480,
  kind: 'image',
  mimeType: 'image/png',
  previewUrl: '/api/local/assets/project.fixture/asset.bound/original.png',
  projectId: 'project.fixture',
  storageKey: 'assets/asset.bound/original.png',
  storageProvider: 'local',
  width: 640,
}]);
assert.equal(host.assets.getBound('asset.missing'), null);
assert.equal(host.assets.getBound('asset.bound')?.width, 640);
assert.equal(Object.isFrozen(host.assets.getBound('asset.bound')), true);
readStore.setExecutionRunner(async ({ input, kind, signal }) => {
  assert.equal(kind, 'local');
  if (kind !== 'local') {
    throw new Error('Expected local fixture execution.');
  }
  const output = await input.execute({
    assets: [host.assets.getBound('asset.bound')!],
    signal,
  });
  assert.equal(output.images.length, 1);
  return {
    capabilityId: input.capabilityId,
    executionId: 'execution.fixture',
    outputAssetIds: ['asset.result'],
    outputBlockIds: ['block.result'],
    status: 'succeeded',
  };
});
const execution = await host.execution.run({
  capabilityId: 'image.local_adjust',
  execute: async ({ assets, signal }) => {
    assert.equal(signal.aborted, false);
    assert.equal(assets[0]?.assetId, 'asset.bound');
    return {
      images: [{
        dataUrl: 'data:image/png;base64,AA==',
        slotId: 'result_image',
      }],
    };
  },
  inputBlockIds: ['block.fixture'],
  parameters: {
    brightness: 10,
    contrast: 0,
    saturation: 0,
  },
});
assert.equal(execution.executionId, 'execution.fixture');
readStore.setExecutionRunner(async ({ input, kind, pluginModuleId, signal }) => {
  assert.equal(kind, 'connected');
  if (kind !== 'connected') {
    throw new Error('Expected connected fixture execution.');
  }
  assert.equal(signal.aborted, false);
  assert.equal(pluginModuleId, 'retake.plugin.loader-fixture');
  assert.deepEqual(input.inputs, [
    { blockId: 'block.fixture', slotId: 'source_image' },
    { blockId: 'block.mask', slotId: 'inpaint_mask' },
  ]);
  return {
    capabilityId: input.capabilityId,
    connectionId: input.connectionId ?? 'codex-managed',
    executionId: 'execution.connected-fixture',
    outputBlockIds: ['block.connected-result'],
    status: 'queued',
  };
});
const connectedExecution = await host.execution.runConnected!({
  capabilityId: 'image.masked_edit',
  inputs: [
    { blockId: 'block.fixture', slotId: 'source_image' },
    { blockId: 'block.mask', slotId: 'inpaint_mask' },
  ],
  parameters: {
    maskEncoding: 'grayscale_white_selected_v1',
  },
  prompt: 'Replace the selected pixels with blue fabric.',
});
assert.equal(
  connectedExecution.executionId,
  'execution.connected-fixture',
);
await assert.rejects(
  host.execution.runConnected!({
    capabilityId: 'image.masked_edit',
    inputs: [
      { blockId: 'block.out-of-scope', slotId: 'source_image' },
    ],
    parameters: {},
    prompt: 'Edit',
  }),
  /bound typed inputs/,
);
await assert.rejects(
  host.execution.runConnected!({
    capabilityId: 'image.masked_edit',
    inputs: [
      { blockId: 'block.fixture', slotId: 'source_image' },
    ],
    parameters: {},
    prompt: '',
  }),
  /bound typed inputs/,
);
await assert.rejects(
  host.execution.run({
    capabilityId: 'image.local_adjust',
    execute: async () => ({ images: [] }),
    inputBlockIds: ['block.out-of-scope'],
    parameters: {},
  }),
  /bound input Blocks/,
);
await assert.rejects(
  readStore.host(
    2,
    'retake.plugin.unauthorized-fixture',
  ).execution.run({
    capabilityId: 'image.local_adjust',
    execute: async () => ({ images: [] }),
    inputBlockIds: ['block.fixture'],
    parameters: {},
  }),
  /does not own/,
);

readStore.setExecutionRunner(async ({ signal }) => (
  new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      reject(new DOMException('aborted', 'AbortError'));
    }, { once: true });
  })
));
const abortedExecution = host.execution.run({
  capabilityId: 'image.local_adjust',
  execute: async () => ({ images: [] }),
  inputBlockIds: ['block.fixture'],
  parameters: {},
});
readStore.update({
  ...host.getReadSnapshot(),
  boardId: 'board.other',
  revision: 'revision-board-switch',
});
await assert.rejects(abortedExecution, /aborted/);
readStore.update({
  ...host.getReadSnapshot(),
  boardId: 'board.fixture',
  boundAssetIds: ['asset.bound'],
  boundBlockIds: ['block.fixture', 'block.mask'],
  revision: 'revision-board-restored',
}, [{
  assetId: 'asset.bound',
  createdAt: '2026-07-27T00:00:00.000Z',
  height: 480,
  kind: 'image',
  mimeType: 'image/png',
  previewUrl: '/api/local/assets/project.fixture/asset.bound/original.png',
  projectId: 'project.fixture',
  storageKey: 'assets/asset.bound/original.png',
  storageProvider: 'local',
  width: 640,
}]);
const importedAsset = await host.assets.importImage({
  dataUrl: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
  fileName: 'fixture.svg',
  height: 1,
  width: 1,
});
assert.equal(importedAsset.assetId, 'asset.imported');
assert.equal(Object.isFrozen(importedAsset), true);
await assert.rejects(
  host.assets.importImage({ dataUrl: 'data:text/plain,not-an-image' }),
  /requires an image Data URL/i,
);
unsubscribe();

const record = {
  definitionHash: 'sha256:loader-fixture',
  desiredState: 'enabled',
  failure: null,
  grant: {
    grantId: 'grant.fixture',
    grantedAt: '2026-07-26T00:00:00.000Z',
    grantedBy: 'user',
    permissions: ['retake.asset.read.bound'],
    pluginModuleId: 'retake.plugin.loader-fixture',
    publisherId: 'retake.publisher.official',
    schemaVersion: 1,
  },
  manifest: {
    contributions: [],
    definitionHash: 'sha256:loader-fixture',
    description: 'Loader fixture',
    name: 'Loader fixture',
    permissions: ['retake.asset.read.bound'],
    pluginModuleId: 'retake.plugin.loader-fixture',
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
const activate = async (): Promise<ActivatedPluginWebModuleV2> => {
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
await disposePluginWebModule(record.pluginModuleId);
assert.equal(disposalCalls, 1);
await reconcilePluginWebModules({
  activate,
  createHost: () => host,
  snapshot,
});
assert.equal(activationCalls, 2);
await reconcilePluginWebModules({
  activate,
  createHost: () => host,
  snapshot: {
    ...snapshot,
    safeMode: true,
  },
});
assert.equal(disposalCalls, 2);

let fatalFailure:
  | { message: string; pluginModuleId: string }
  | undefined;
await reconcilePluginWebModules({
  activate: async () => {
    throw new Error('fixture activation failure');
  },
  createHost: () => host,
  onFatalFailure: (pluginModuleId, message) => {
    fatalFailure = { message, pluginModuleId };
  },
  snapshot: {
    ...snapshot,
    modules: [{
      ...record,
      packageLock: {
        ...record.packageLock,
        digest: `sha256:${'2'.repeat(64)}`,
      },
      trust: {
        ...record.trust,
        packageDigest: `sha256:${'2'.repeat(64)}`,
      },
    }],
  },
});
assert.deepEqual(fatalFailure, {
  message: 'fixture activation failure',
  pluginModuleId: record.pluginModuleId,
});

fatalFailure = undefined;
const atomicDisposals: string[] = [];
const atomicActivate = async (
  candidate: PluginModuleRuntimeRecordV1,
): Promise<ActivatedPluginWebModuleV2> => ({
  contributions: [],
  async dispose() {
    atomicDisposals.push(candidate.packageLock.digest);
  },
  pluginModuleId: candidate.pluginModuleId,
});
await reconcilePluginWebModules({
  activate: atomicActivate,
  createHost: () => host,
  snapshot,
});
const activationRejectedDigest = `sha256:${'3'.repeat(64)}`;
await reconcilePluginWebModules({
  activate: atomicActivate,
  createHost: () => host,
  snapshot: {
    ...snapshot,
    modules: [{
      ...record,
      packageLock: {
        ...record.packageLock,
        digest: activationRejectedDigest,
      },
      status: 'disabled',
      trust: null,
    }],
  },
});
assert.equal(
  atomicDisposals.length,
  0,
  'An untrusted replacement must retain the previous exact-digest session.',
);
const activationFallback = await reconcilePluginWebModules({
  activate: async () => {
    throw new Error('candidate import failed');
  },
  createHost: () => host,
  onFatalFailure: (pluginModuleId, message) => {
    fatalFailure = { message, pluginModuleId };
  },
  snapshot: {
    ...snapshot,
    modules: [{
      ...record,
      packageLock: {
        ...record.packageLock,
        digest: activationRejectedDigest,
      },
      trust: {
        ...record.trust,
        packageDigest: activationRejectedDigest,
      },
    }],
  },
});
assert.equal(fatalFailure, undefined);
assert.deepEqual(activationFallback.fallbacks, [{
  error: 'candidate import failed',
  pluginModuleId: record.pluginModuleId,
  rejectedDigest: activationRejectedDigest,
  retainedDigest: record.packageLock.digest,
}]);
assert.equal(atomicDisposals.length, 0);

const protocolRejectedDigest = `sha256:${'4'.repeat(64)}`;
const protocolFallback = await reconcilePluginWebModules({
  activate: atomicActivate,
  createHost: () => host,
  snapshot: {
    ...snapshot,
    modules: [{
      ...record,
      packageLock: {
        ...record.packageLock,
        digest: protocolRejectedDigest,
      },
      trust: {
        ...record.trust,
        packageDigest: protocolRejectedDigest,
      },
    }],
  },
  validateSessions: (sessions) => sessions.flatMap((session) => (
    session.record.packageLock.digest === protocolRejectedDigest
      ? [{
        error: 'candidate contribution protocol failed',
        pluginModuleId: session.record.pluginModuleId,
      }]
      : []
  )),
});
assert.deepEqual(protocolFallback.fallbacks, [{
  error: 'candidate contribution protocol failed',
  pluginModuleId: record.pluginModuleId,
  rejectedDigest: protocolRejectedDigest,
  retainedDigest: record.packageLock.digest,
}]);
assert.deepEqual(atomicDisposals, [protocolRejectedDigest]);

const acceptedDigest = `sha256:${'5'.repeat(64)}`;
const accepted = await reconcilePluginWebModules({
  activate: atomicActivate,
  createHost: () => host,
  snapshot: {
    ...snapshot,
    modules: [{
      ...record,
      packageLock: {
        ...record.packageLock,
        digest: acceptedDigest,
      },
      trust: {
        ...record.trust,
        packageDigest: acceptedDigest,
      },
    }],
  },
  validateSessions: () => [],
});
assert.equal(accepted.fallbacks.length, 0);
assert.deepEqual(atomicDisposals, [
  protocolRejectedDigest,
  record.packageLock.digest,
]);

process.stdout.write(`${JSON.stringify({
  activationFailureRetainsLastGoodSession: true,
  activationFailureReportsFatalState: true,
  contributionFailureRetainsLastGoodSession: true,
  conditionalRuntimeChunk: true,
  exactDigestModuleCache: true,
  executionAbortFollowsModuleLifecycle: true,
  connectedExecutionUsesTypedBoundInputs: true,
  executionRequiresBoundBlocksAndCapabilityOwnership: true,
  fatalDisposalDetachesActivation: true,
  safeModeDisposesActivation: true,
  scopedReadSnapshotStableAndImmutable: true,
  scopedAssetMetadataStableAndImmutable: true,
  scopedImageImportReturnsBrowserSafeAsset: true,
  scopedSubscriptionDeduplicatesSnapshots: true,
})}\n`);
