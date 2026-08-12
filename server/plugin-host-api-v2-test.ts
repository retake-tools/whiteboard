import assert from 'node:assert/strict';
import {
  PluginHostErrorV2,
  type PluginSettingsV1,
  type PluginConnectedExecutionRunInputV2,
} from '@retake-tools/package-sdk';
import {
  pluginDraftViewsForBlocks,
} from '../src/app/usePluginDraftController';
import { applyWhiteboardPluginDraft } from '../src/whiteboard/application/whiteboardPluginCommands';
import {
  createPluginHostReadStore,
  type PluginExecutionRunnerRequestV2,
} from '../src/core/pluginWebModuleLoader';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type {
  AssetRecord,
  BlockRecord,
  BoardSnapshot,
} from '../src/core/types';

const pluginModuleId = 'design.retake.host-v2-fixture';
const capabilityId = 'image.annotation_edit';
const snapshot = snapshotWithLegacyDraft();
const sourceBlock = snapshot.blocks.find(
  (block) => block.blockId === 'block.host-v2-source',
)!;
const sourceAsset = snapshot.assets.find(
  (asset) => asset.assetId === 'asset.host-v2-source',
)!;
let current = snapshot;
let persistCount = 0;
let settingsState = {
  entries: [],
  revision: 0,
  schemaVersion: 1 as const,
};
const store = createPluginHostReadStore({
  boardId: snapshot.board.boardId,
  boundAssetIds: [sourceAsset.assetId],
  boundBlockIds: [sourceBlock.blockId],
  boundGroupIds: [],
  projectId: snapshot.project.projectId,
  revision: 'host-v2:1',
  selectedBlockIds: [sourceBlock.blockId],
}, {
  authorizeExecution: (candidateModuleId, candidateCapabilityId) => (
    candidateModuleId === pluginModuleId
    && candidateCapabilityId === capabilityId
  ),
  async importImage(input) {
    return {
      assetId: 'asset.host-v2-imported',
      createdAt: '2026-07-27T00:01:00.000Z',
      height: input.height,
      kind: 'image',
      mimeType: 'image/png',
      previewUrl: '/api/local/assets/imported/composite.png',
      projectId: input.projectId,
      storageKey: 'assets/imported/composite.png',
      storageProvider: 'local',
      width: input.width,
    };
  },
  loadSettingsState: async () => settingsState,
  updateSettingsState: async (input) => {
    settingsState = {
      entries: [
        ...settingsState.entries.filter((entry) => !(
          entry.pluginModuleId === input.pluginModuleId
          && entry.settingsId === input.definition.settingsId
          && entry.scope === input.scope
          && entry.scopeId === input.scopeId
        )),
        {
          pluginModuleId: input.pluginModuleId,
          schemaVersion: input.definition.schemaVersion,
          scope: input.scope,
          scopeId: input.scopeId,
          settingsId: input.definition.settingsId,
          values: input.values,
        },
      ],
      revision: settingsState.revision + 1,
      schemaVersion: 1,
    };
    return settingsState;
  },
});
store.retainModules([{
  packageDigest: 'sha256:host-v2-fixture-1',
  pluginModuleId,
}]);
const host = store.host(2, pluginModuleId, [
  'retake.draft.write.bound',
  'retake.settings.write.self',
]);
store.update(
  host.getReadSnapshot(),
  [sourceAsset],
  pluginDraftViewsForBlocks(
    current,
    new Set([sourceBlock.blockId]),
  ),
);

const legacy = host.drafts.getBound({
  blockId: sourceBlock.blockId,
  capabilityId,
});
assert.equal(legacy?.revision.startsWith('legacy:'), true);
assert.equal(
  (legacy?.value as { sourceAssetId?: string }).sourceAssetId,
  sourceAsset.assetId,
);

store.setDraftRunner(async (request) => {
  const staged = structuredClone(current);
  const applied = applyWhiteboardPluginDraft(staged, request);
  if (applied.changed) {
    current = staged;
    persistCount += 1;
  }
  return applied.result;
});
const historyCount = current.historyEvents?.length ?? 0;
const saved = await host.drafts.saveBound({
  blockId: sourceBlock.blockId,
  capabilityId,
  value: {
    globalInstruction: 'Remove the reflection.',
    marks: [],
    schemaVersion: 2,
  },
});
assert.equal(saved?.capabilityId, capabilityId);
assert.equal(persistCount, 1);
assert.equal(current.historyEvents?.length ?? 0, historyCount);
const migratedBlock = current.blocks.find(
  (block) => block.blockId === sourceBlock.blockId,
)!;
assert.equal(migratedBlock.data.annotationDraft, undefined);
assert.equal(migratedBlock.data.retakePluginDrafts?.length, 1);

store.update(
  { ...host.getReadSnapshot(), revision: 'host-v2:2' },
  [sourceAsset],
  pluginDraftViewsForBlocks(
    current,
    new Set([sourceBlock.blockId]),
  ),
);
assert.deepEqual(
  host.drafts.getBound({
    blockId: sourceBlock.blockId,
    capabilityId,
  })?.value,
  {
    globalInstruction: 'Remove the reflection.',
    marks: [],
    schemaVersion: 2,
  },
);

await assert.rejects(
  host.drafts.saveBound({
    blockId: sourceBlock.blockId,
    capabilityId,
    value: { preview: 'data:image/png;base64,AA==' },
  }),
  (error: unknown) => hostError(error, 'invalid_argument'),
);
await assert.rejects(
  host.drafts.saveBound({
    blockId: sourceBlock.blockId,
    capabilityId,
    value: { text: 'x'.repeat(256 * 1024) },
  }),
  (error: unknown) => hostError(error, 'invalid_argument'),
);
const noDraftPermissionHost = store.host(2, pluginModuleId);
await assert.rejects(
  noDraftPermissionHost.drafts.saveBound({
    blockId: sourceBlock.blockId,
    capabilityId,
    value: { schemaVersion: 2 },
  }),
  (error: unknown) => hostError(error, 'not_authorized'),
);

let environmentNotifications = 0;
const unsubscribeEnvironment = host.environment.subscribe(() => {
  environmentNotifications += 1;
});
store.updateEnvironment({
  colorScheme: 'light',
  contrast: 'normal',
  direction: 'ltr',
  locale: 'zh-CN',
  reducedMotion: true,
  revision: 'environment:zh-CN:reduce',
});
assert.equal(host.environment.getSnapshot().locale, 'zh-CN');
assert.equal(host.environment.getSnapshot().reducedMotion, true);
assert.equal(environmentNotifications, 1);
unsubscribeEnvironment();

const pluginSettings = {
  apiVersion: 1,
  fields: {
    compactMode: {
      default: false,
      label: 'Compact mode',
      scope: 'workspace',
      type: 'boolean',
    },
    outputQuality: {
      default: 90,
      label: 'Output quality',
      maximum: 100,
      minimum: 1,
      scope: 'project',
      type: 'number',
    },
  },
  kind: 'settings',
  schemaVersion: 1,
  settingsId: 'design.retake.host-v2-fixture.settings',
} satisfies PluginSettingsV1;
await store.setSettingsDefinitions([{
  definition: pluginSettings,
  pluginModuleId,
}]);
assert.deepEqual(
  host.settings.getSnapshot(pluginSettings.settingsId)?.values,
  { compactMode: false, outputQuality: 90 },
);
let settingsNotifications = 0;
const unsubscribeSettings = host.settings.subscribe(() => {
  settingsNotifications += 1;
});
const updatedSettings = await host.settings.update({
  scope: 'project',
  settingsId: pluginSettings.settingsId,
  values: { outputQuality: 80 },
});
assert.deepEqual(updatedSettings.values, {
  compactMode: false,
  outputQuality: 80,
});
assert.equal(settingsNotifications, 1);
await assert.rejects(
  noDraftPermissionHost.settings.update({
    scope: 'workspace',
    settingsId: pluginSettings.settingsId,
    values: { compactMode: true },
  }),
  (error: unknown) => hostError(error, 'not_authorized'),
);
unsubscribeSettings();

store.setConnectionLister(({ capabilityId: requestedCapabilityId }) => {
  assert.equal(requestedCapabilityId, capabilityId);
  return [{
    connectionId: 'codex-managed',
    displayName: 'Codex',
    providerLabel: 'OpenAI',
    selectedByDefault: true,
  }];
});
assert.deepEqual(host.execution.listConnections({ capabilityId }), [{
  connectionId: 'codex-managed',
  displayName: 'Codex',
  providerLabel: 'OpenAI',
  selectedByDefault: true,
}]);

const imported = await host.assets.importImage({
  dataUrl: 'data:image/png;base64,AA==',
  fileName: 'composite.png',
  height: 1,
  width: 1,
});
let connectedRequest: PluginExecutionRunnerRequestV2 | undefined;
store.setExecutionRunner(async (request) => {
  connectedRequest = request;
  if (request.kind !== 'connected') {
    throw new Error('Expected a connected execution.');
  }
  return {
    capabilityId: request.input.capabilityId,
    connectionId: 'codex-managed',
    executionId: 'execution.host-v2',
    outputBlockIds: ['block.host-v2-result-1', 'block.host-v2-result-2'],
    status: 'queued',
  };
});
const connectedInput: PluginConnectedExecutionRunInputV2 = {
  capabilityId,
  inputs: [
    { blockId: sourceBlock.blockId, slotId: 'source_image' },
    { assetId: imported.assetId, slotId: 'annotated_composite' },
  ],
  outputCount: 2,
  parameters: { manifest: { schemaVersion: 2 } },
  prompt: 'Apply the annotated edit.',
};
await host.execution.runConnected(connectedInput);
assert.equal(connectedRequest?.kind, 'connected');
assert.equal(
  connectedRequest?.kind === 'connected'
    ? connectedRequest.importedAssets[0]?.storageKey
    : undefined,
  'assets/imported/composite.png',
);
assert.equal(
  connectedRequest?.kind === 'connected'
    ? connectedRequest.input.outputCount
    : undefined,
  2,
);
store.retainModules([{
  packageDigest: 'sha256:host-v2-fixture-2',
  pluginModuleId,
}]);
await assert.rejects(
  host.execution.runConnected(connectedInput),
  (error: unknown) => hostError(error, 'invalid_argument'),
);

process.stdout.write(`${JSON.stringify({
  boundDraftMigratesLegacyWithoutHistory: true,
  connectionSummaryHidesTransport: true,
  draftBoundsAndPermissionEnforced: true,
  environmentUpdatesWithoutReactivation: true,
  importedAssetClearedAcrossPackageDigest: true,
  importedAssetRetainedForConnectedExecution: true,
  outputCountForwarded: true,
  stableHostErrorCodes: true,
})}\n`);

function hostError(
  error: unknown,
  code: PluginHostErrorV2['code'],
): boolean {
  return error instanceof PluginHostErrorV2 && error.code === code;
}

function snapshotWithLegacyDraft(): BoardSnapshot {
  const next = structuredClone(defaultSnapshot);
  const createdAt = '2026-07-27T00:00:00.000Z';
  const asset: AssetRecord = {
    assetId: 'asset.host-v2-source',
    createdAt,
    height: 640,
    kind: 'image',
    mimeType: 'image/png',
    previewUrl: '/api/local/assets/source.png',
    projectId: next.project.projectId,
    storageKey: 'assets/source.png',
    storageProvider: 'local',
    width: 640,
  };
  const block: BlockRecord = {
    blockId: 'block.host-v2-source',
    boardId: next.board.boardId,
    createdAt,
    data: {
      annotationDraft: {
        globalInstruction: 'Remove the reflection.',
        marks: [],
        schemaVersion: 1,
        sourceAssetId: asset.assetId,
        updatedAt: createdAt,
      },
      assetId: asset.assetId,
      previewUrl: asset.previewUrl,
      title: 'Host V2 source',
    },
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { height: 320, width: 320 },
    type: 'image',
    updatedAt: createdAt,
    zIndex: 1,
  };
  next.assets.unshift(asset);
  next.blocks.push(block);
  return next;
}
