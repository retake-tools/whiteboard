import assert from 'node:assert/strict';
import { PluginHostErrorV2 } from '@retake-tools/package-sdk';
import {
  listConnectedPluginExecutionConnections,
} from '../src/app/runConnectedPluginExecution';
import {
  runPluginExecution,
} from '../src/app/usePluginExecutionController';
import {
  createPluginContributionRegistry,
} from '../src/core/pluginContributionRegistry';
import {
  cacheExecutionProviderSettings,
} from '../src/core/executionProviderPreferences';
import {
  createPluginHostReadStore,
} from '../src/core/pluginWebModuleLoader';
import type { AnnotationManifest } from '../src/core/imageAnnotations';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type {
  AssetRecord,
  BlockRecord,
  BoardSnapshot,
} from '../src/core/types';

const pluginModuleId = 'design.retake.image-studio.connected-fixture';
const capability = {
  apiVersion: 2,
  definition: {
    capabilityId: 'image.masked_edit',
    category: 'image_editing',
    definitionHash: 'sha256:image-masked-edit-fixture-v1',
    displayName: 'Masked AI image edit',
    inputSlots: [
      {
        artifactTypes: [],
        bindingKinds: ['asset', 'block'],
        cardinality: 'one',
        dataTypes: ['image'],
        required: true,
        semanticRole: 'source',
        slotId: 'source_image',
      },
      {
        artifactTypes: [],
        bindingKinds: ['asset', 'block'],
        cardinality: 'one',
        dataTypes: ['image'],
        required: true,
        semanticRole: 'inpaint_mask',
        slotId: 'inpaint_mask',
      },
      {
        artifactTypes: [],
        bindingKinds: ['inline'],
        cardinality: 'one',
        dataTypes: ['text'],
        required: true,
        semanticRole: 'prompt',
        slotId: 'prompt',
      },
    ],
    outputSlots: [{
      cardinality: 'one',
      dataType: 'image',
      projectionBlockTypes: ['image'],
      semanticRole: 'edited_image',
      slotId: 'edited_image',
    }],
    parametersSchemaRef: 'definitions/image.masked_edit.parameters.json',
    runtimeRequirements: ['durable_asset_output', 'image_generation'],
    schemaVersion: 2,
    supportedAdapterClasses: ['agent_runtime.media'],
    version: '0.1.0',
  },
  kind: 'capability',
} as const;
const annotationCapability = {
  apiVersion: 2,
  definition: {
    capabilityId: 'image.annotation_edit',
    category: 'image_editing',
    definitionHash: 'sha256:image-annotation-edit-fixture-v2',
    displayName: 'Annotation Edit',
    inputSlots: [
      {
        artifactTypes: [],
        bindingKinds: ['asset', 'block'],
        cardinality: 'one',
        dataTypes: ['image'],
        required: true,
        semanticRole: 'source',
        slotId: 'source_image',
      },
      {
        artifactTypes: [],
        bindingKinds: ['asset'],
        cardinality: 'one',
        dataTypes: ['image'],
        required: true,
        semanticRole: 'annotated_composite',
        slotId: 'annotated_composite',
      },
      {
        artifactTypes: [],
        bindingKinds: ['inline'],
        cardinality: 'one',
        dataTypes: ['text'],
        required: true,
        semanticRole: 'prompt',
        slotId: 'prompt',
      },
    ],
    outputSlots: [{
      cardinality: 'many',
      dataType: 'image',
      projectionBlockTypes: ['image'],
      semanticRole: 'edited_images',
      slotId: 'edited_images',
    }],
    parametersSchemaRef: 'definitions/image.annotation_edit.parameters.json',
    runtimeRequirements: ['durable_asset_output', 'image_generation'],
    schemaVersion: 2,
    supportedAdapterClasses: ['agent_runtime.media'],
    version: '0.2.0',
  },
  kind: 'capability',
} as const;

const snapshot = snapshotWithMaskedEditInputs();
const source = snapshot.blocks.find(
  (block) => block.blockId === 'block.connected-source',
)!;
const mask = snapshot.blocks.find(
  (block) => block.blockId === 'block.connected-mask',
)!;
const sourceAsset = assetFor(snapshot, source);
const maskAsset = assetFor(snapshot, mask);
const registry = createPluginContributionRegistry();
const hostStore = createPluginHostReadStore({
  boardId: snapshot.board.boardId,
  boundAssetIds: [sourceAsset.assetId, maskAsset.assetId],
  boundBlockIds: [source.blockId, mask.blockId],
  boundGroupIds: [],
  projectId: snapshot.project.projectId,
  revision: 'connected-fixture-1',
  selectedBlockIds: [source.blockId, mask.blockId],
}, {
  authorizeExecution: (candidateModuleId, capabilityId) => (
    registry.ownsCapability(candidateModuleId, capabilityId)
  ),
});
const host = hostStore.host(2, pluginModuleId);
hostStore.update(host.getReadSnapshot(), [sourceAsset, maskAsset]);
assert.deepEqual(registry.replace([{
  activation: {
    contributions: [
      {
        contribution: {
          contributionId: 'design.retake.image-studio.masked-edit',
          definitionHash: capability.definition.definitionHash,
          definitionPath: 'definitions/image.masked_edit.json',
          exportName: 'maskedEditCapability',
          kind: 'capability',
        },
        value: capability,
      },
      {
        contribution: {
          contributionId: 'design.retake.image-studio.annotation-edit',
          definitionHash: annotationCapability.definition.definitionHash,
          definitionPath: 'definitions/image.annotation_edit.json',
          exportName: 'annotationEditCapability',
          kind: 'capability',
        },
        value: annotationCapability,
      },
    ],
  },
  host,
  record: { pluginModuleId },
}]), []);

cacheExecutionProviderSettings(snapshot.project.projectId, {
  connectionTemplates: [],
  connections: [{
    configurable: false,
    connectionId: 'codex-managed',
    connectionKind: 'agent_host',
    connectorId: 'codex-managed',
    deletable: false,
    description: 'Manual Codex/MCP fixture',
    displayName: 'Codex MCP',
    enabled: true,
    enabledUseCases: ['image'],
    hasCredential: false,
    implementationKind: 'agent_bridge',
    providerLabel: 'Codex',
    status: 'ready',
    supportedCapabilityIds: ['image.annotation_edit', 'image.masked_edit'],
  }],
  connectors: [],
  projectDefaults: [],
  workspaceDefaults: [],
});
hostStore.setConnectionLister(listConnectedPluginExecutionConnections);
const connectionViews = host.execution.listConnections({
  capabilityId: 'image.masked_edit',
});
assert.deepEqual(connectionViews, [{
  connectionId: 'codex-managed',
  displayName: 'Codex MCP',
  providerLabel: 'Codex',
  selectedByDefault: true,
}]);
assert.equal('baseUrl' in connectionViews[0]!, false);
assert.equal('hasCredential' in connectionViews[0]!, false);

const snapshotRef = { current: snapshot };
const persisted: BoardSnapshot[] = [];
const selectedBlockIds: string[] = [];
hostStore.setExecutionRunner((request) => runPluginExecution(request, {
  persistSnapshot: async (next) => {
    persisted.push(structuredClone(next));
  },
  setSelectedBlock: (_next, blockId) => {
    selectedBlockIds.push(blockId);
  },
  snapshotRef,
  updateSnapshot(updater) {
    snapshotRef.current = updater(snapshotRef.current);
    return snapshotRef.current;
  },
}));

const started = await host.execution.runConnected!({
  capabilityId: 'image.masked_edit',
  inputs: [
    { blockId: source.blockId, slotId: 'source_image' },
    { blockId: mask.blockId, slotId: 'inpaint_mask' },
  ],
  parameters: {
    maskEncoding: 'grayscale_white_selected_v1',
  },
  outputCount: 2,
  prompt: 'Change only the selected jacket to dark blue.',
});
assert.equal(started.status, 'queued');
assert.equal(started.connectionId, 'codex-managed');
assert.equal(persisted.length, 1);
assert.equal(selectedBlockIds.length, 1);
assert.equal(started.outputBlockIds.length, 2);

const execution = snapshotRef.current.executions.find(
  (candidate) => candidate.executionId === started.executionId,
)!;
assert.equal(execution.capabilityId, 'image.masked_edit');
assert.equal(execution.adapter, 'mcp_agent');
assert.equal(execution.connectionId, 'codex-managed');
assert.deepEqual(execution.inputBlockIds, [source.blockId, mask.blockId]);
assert.deepEqual(execution.params?.pluginParameters, {
  maskEncoding: 'grayscale_white_selected_v1',
});
assert.deepEqual(execution.params?.inputBindings, [
  {
    assetId: sourceAsset.assetId,
    blockId: source.blockId,
    inputRole: 'source',
  },
  {
    assetId: maskAsset.assetId,
    blockId: mask.blockId,
    inputRole: 'inpaint_mask',
  },
]);
assert.match(execution.agentPrompt ?? '', /inpaint_mask/);
assert.equal(
  snapshotRef.current.edges.some((edge) => (
    edge.sourceBlockId === mask.blockId
    && edge.kind === 'execution_input'
    && edge.inputRole === 'inpaint_mask'
  )),
  true,
);
assert.equal(
  snapshotRef.current.historyEvents?.[0]?.detail?.pluginParameters
    && typeof snapshotRef.current.historyEvents[0].detail === 'object',
  true,
);

const importedMask = await host.assets.importImage({
  dataUrl: 'data:image/png;base64,AA==',
  fileName: 'imported-mask.png',
  height: sourceAsset.height,
  width: sourceAsset.width,
});
const importedStarted = await host.execution.runConnected({
  capabilityId: 'image.masked_edit',
  inputs: [
    { blockId: source.blockId, slotId: 'source_image' },
    { assetId: importedMask.assetId, slotId: 'inpaint_mask' },
  ],
  parameters: {
    maskEncoding: 'grayscale_white_selected_v1',
  },
  prompt: 'Apply the imported mask.',
});
const importedExecution = snapshotRef.current.executions.find(
  (candidate) => candidate.executionId === importedStarted.executionId,
)!;
assert.deepEqual(importedExecution.inputBlockIds, [source.blockId]);
assert.equal(
  (
    importedExecution.params?.inputBindings as Array<{
      assetId: string;
      blockId?: string;
      inputRole: string;
    }>
  ).some((binding) => (
    binding.assetId === importedMask.assetId
    && binding.blockId === undefined
    && binding.inputRole === 'inpaint_mask'
  )),
  true,
);
assert.equal(
  snapshotRef.current.assets.some(
    (asset) => asset.assetId === importedMask.assetId,
  ),
  true,
);
assert.match(
  importedExecution.agentPrompt ?? '',
  new RegExp(`inpaint_mask.*${importedMask.assetId}`, 's'),
);

const annotationManifest: AnnotationManifest = {
  schemaVersion: 1,
  globalInstruction: 'Preserve every unmarked pixel.',
  marks: [
    {
      id: 'R1',
      kind: 'rect',
      color: '#dc2626',
      strokeSize: 'm',
      intent: 'Replace the jacket with a dark blue jacket.',
      start: { x: 0.2, y: 0.2 },
      end: { x: 0.7, y: 0.8 },
    },
  ],
};
const importedComposite = await host.assets.importImage({
  dataUrl: 'data:image/png;base64,AA==',
  fileName: 'annotated-composite.png',
  height: sourceAsset.height,
  width: sourceAsset.width,
});
const annotationStarted = await host.execution.runConnected({
  capabilityId: 'image.annotation_edit',
  inputs: [
    { blockId: source.blockId, slotId: 'source_image' },
    {
      assetId: importedComposite.assetId,
      slotId: 'annotated_composite',
    },
  ],
  outputCount: 3,
  parameters: {
    manifest: annotationManifest,
  },
  prompt: 'Apply the structured visual annotation.',
});
const annotationExecution = snapshotRef.current.executions.find(
  (candidate) => candidate.executionId === annotationStarted.executionId,
)!;
const annotationOperation = snapshotRef.current.blocks.find(
  (block) => block.blockId === annotationExecution.params?.operationBlockId,
)!;
const annotationHistory = snapshotRef.current.historyEvents?.find(
  (event) => event.executionId === annotationExecution.executionId,
)!;
assert.equal(annotationStarted.outputBlockIds.length, 3);
assert.deepEqual(annotationExecution.params?.annotationManifest, annotationManifest);
assert.deepEqual(
  annotationExecution.params?.pluginParameters,
  { manifest: annotationManifest },
);
assert.equal(
  annotationExecution.params?.annotatedCompositeAssetId,
  importedComposite.assetId,
);
assert.deepEqual(annotationExecution.params?.inputBindings, [
  {
    assetId: sourceAsset.assetId,
    blockId: source.blockId,
    inputRole: 'source',
  },
  {
    assetId: importedComposite.assetId,
    inputRole: 'annotated_composite',
  },
]);
assert.deepEqual(annotationExecution.inputBindingsSnapshot, [
  {
    slotId: 'source_image',
    values: [{
      assetId: sourceAsset.assetId,
      blockId: source.blockId,
      kind: 'asset',
    }],
  },
  {
    slotId: 'annotated_composite',
    values: [{ assetId: importedComposite.assetId, kind: 'asset' }],
  },
  {
    slotId: 'prompt',
    values: [{ kind: 'inline', value: 'Apply the structured visual annotation.' }],
  },
]);
assert.deepEqual(annotationOperation.data.annotationManifest, annotationManifest);
assert.deepEqual(
  annotationOperation.data.pluginParameters,
  { manifest: annotationManifest },
);
assert.equal(
  annotationOperation.data.annotatedCompositeAssetId,
  importedComposite.assetId,
);
assert.deepEqual(annotationHistory.detail?.annotationManifest, annotationManifest);
assert.equal(
  annotationHistory.assetIds?.includes(importedComposite.assetId),
  true,
);

const executionCount = snapshotRef.current.executions.length;
await assert.rejects(
  host.execution.runConnected!({
    capabilityId: 'image.masked_edit',
    inputs: [
      { blockId: mask.blockId, slotId: 'source_image' },
      { blockId: source.blockId, slotId: 'inpaint_mask' },
    ],
    parameters: {
      maskEncoding: 'grayscale_white_selected_v1',
    },
    prompt: 'Invalid role order.',
  }),
  (error: unknown) => (
    error instanceof PluginHostErrorV2
    && error.code === 'internal'
    && error.cause instanceof Error
    && /PNG Mask Assets/.test(error.cause.message)
  ),
);
assert.equal(snapshotRef.current.executions.length, executionCount);

registry.removeModule(pluginModuleId);

process.stdout.write(`${JSON.stringify({
  connectedExecutionUsesCurrentRetakeConnection: true,
  credentialsStayOutsidePluginHost: true,
  importedAssetInputCreatesNoIntermediateBlock: true,
  annotationPluginProjectsLegacyReadModel: true,
  annotationPluginFreezesTypedCompositeInput: true,
  maskGeometryValidatedBeforeOperation: true,
  multipleResultsShareOneExecution: true,
  typedInputsPersistedToExecutionAndEdges: true,
})}\n`);

function snapshotWithMaskedEditInputs(): BoardSnapshot {
  const next = structuredClone(defaultSnapshot);
  const createdAt = '2026-07-27T00:00:00.000Z';
  const sourceAsset = imageAsset(
    next,
    'asset.connected-source',
    'image/jpeg',
    createdAt,
  );
  const maskAsset = imageAsset(
    next,
    'asset.connected-mask',
    'image/png',
    createdAt,
  );
  next.assets.unshift(sourceAsset, maskAsset);
  next.blocks.push(
    imageBlock(next, sourceAsset, 'block.connected-source', 0),
    imageBlock(next, maskAsset, 'block.connected-mask', 220),
  );
  return next;
}

function imageAsset(
  snapshot: BoardSnapshot,
  assetId: string,
  mimeType: string,
  createdAt: string,
): AssetRecord {
  return {
    assetId,
    createdAt,
    height: 512,
    kind: 'image',
    mimeType,
    previewUrl: `/api/local/assets/${snapshot.project.projectId}/${assetId}/image`,
    projectId: snapshot.project.projectId,
    storageKey: `local-mock://${assetId}`,
    storageProvider: 'local_mock',
    width: 512,
  };
}

function imageBlock(
  snapshot: BoardSnapshot,
  asset: AssetRecord,
  blockId: string,
  x: number,
): BlockRecord {
  return {
    blockId,
    boardId: snapshot.board.boardId,
    createdAt: asset.createdAt,
    data: {
      assetId: asset.assetId,
      title: blockId,
    },
    layerId: 'layer_default',
    position: { x, y: 0 },
    size: { height: 180, width: 180 },
    type: 'image',
    updatedAt: asset.createdAt,
    zIndex: 60,
  };
}

function assetFor(
  snapshot: BoardSnapshot,
  block: BlockRecord,
): AssetRecord {
  return snapshot.assets.find(
    (asset) => asset.assetId === block.data.assetId,
  )!;
}
