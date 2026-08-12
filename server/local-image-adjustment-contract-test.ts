import assert from 'node:assert/strict';
import {
  configurationChanges,
  currentOperationConfiguration,
  executionConfiguration,
} from '../src/core/executionConfiguration';
import {
  addPluginImageOperation,
  completePluginImageOperation,
  failPluginImageOperation,
} from '../src/core/pluginImageOperations';
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
import { replacePluginCapabilityDefinitions } from '../src/core/pluginCapabilityDefinitions';
import { imageMimeTypeFromDataUrl } from '../src/core/assetStore';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type { CapabilityDefinition } from '../src/core/capabilityContracts';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';

const localAdjustDefinition = {
  capabilityId: 'image.local_adjust',
  category: 'image_editing',
  definitionHash: 'sha256:image-local-adjust-v1',
  displayName: 'Local image adjustment',
  inputSlots: [{
    artifactTypes: [],
    bindingKinds: ['asset', 'block'],
    cardinality: 'one',
    dataTypes: ['image'],
    required: true,
    semanticRole: 'source',
    slotId: 'source_image',
  }],
  outputSlots: [{
    cardinality: 'one',
    dataType: 'image',
    projectionBlockTypes: ['image'],
    semanticRole: 'adjusted_image',
    slotId: 'result_image',
  }],
  parametersSchemaRef: 'definitions/image.local_adjust.parameters.json',
  runtimeRequirements: ['browser.canvas_2d'],
  schemaVersion: 1,
  supportedAdapterClasses: ['local_canvas'],
  version: '0.1.0',
} satisfies CapabilityDefinition;

replacePluginCapabilityDefinitions([localAdjustDefinition]);

assert.equal(
  imageMimeTypeFromDataUrl('data:image/jpeg;base64,AA=='),
  'image/jpeg',
);
assert.equal(
  imageMimeTypeFromDataUrl('data:image/webp;base64,AA=='),
  'image/webp',
);
assert.throws(
  () => imageMimeTypeFromDataUrl('data:text/plain;base64,AA=='),
  /image data URL/,
);

function snapshotWithSourceImage(): { snapshot: BoardSnapshot; sourceBlock: BlockRecord } {
  const snapshot = structuredClone(defaultSnapshot);
  const sourceAsset: AssetRecord = {
    assetId: 'asset_local_adjust_source',
    projectId: snapshot.project.projectId,
    kind: 'image',
    mimeType: 'image/png',
    storageProvider: 'local_mock',
    storageKey: 'local-mock://source.png',
    previewUrl: 'data:image/png;base64,source',
    width: 800,
    height: 600,
    createdAt: '2026-07-14T00:00:00.000Z',
  };
  const sourceBlock: BlockRecord = {
    blockId: 'block_local_adjust_source',
    boardId: snapshot.board.boardId,
    type: 'image',
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { width: 320, height: 240 },
    zIndex: 20,
    data: { title: 'Source image', assetId: sourceAsset.assetId },
    createdAt: sourceAsset.createdAt,
    updatedAt: sourceAsset.createdAt,
  };
  snapshot.assets.unshift(sourceAsset);
  snapshot.blocks.push(sourceBlock);
  return { snapshot, sourceBlock };
}

const { snapshot, sourceBlock } = snapshotWithSourceImage();
const started = addPluginImageOperation(snapshot, {
  body: 'Adjust',
  capabilityId: 'image.local_adjust',
  params: { brightness: 20, contrast: -10, saturation: 30 },
  sourceBlockId: sourceBlock.blockId,
  title: 'Adjust',
});

const secondStarted = addPluginImageOperation(snapshot, {
  body: 'Crop',
  capabilityId: 'image.local_adjust',
  params: { brightness: 0, contrast: 0, saturation: 0 },
  sourceBlockId: sourceBlock.blockId,
  title: 'Second local operation',
});
assert.equal(
  rectanglesOverlap(started.operationBlock, secondStarted.operationBlock),
  false,
);
assert.equal(
  rectanglesOverlap(started.resultBlock, secondStarted.resultBlock),
  false,
);

assert.equal(started.execution.adapter, 'local_canvas');
assert.equal(started.execution.triggerMode, 'local_canvas');
assert.equal(started.execution.status, 'running');
assert.equal(started.operationBlock.data.status, 'running');
assert.equal(started.resultBlock.data.status, 'running');
assert.equal(started.resultBlock.data.assetId, undefined);
assert.deepEqual(
  configurationChanges(
    executionConfiguration(started.execution),
    currentOperationConfiguration(snapshot, started.operationBlock),
  ),
  [],
);

const resultAsset: AssetRecord = {
  assetId: 'asset_local_adjust_result',
  projectId: snapshot.project.projectId,
  kind: 'image',
  mimeType: 'image/png',
  storageProvider: 'local_mock',
  storageKey: 'local-mock://result.png',
  previewUrl: 'data:image/png;base64,result',
  width: 800,
  height: 600,
  createdAt: '2026-07-14T00:01:00.000Z',
};
const completed = completePluginImageOperation(snapshot, {
  asset: resultAsset,
  executionId: started.execution.executionId,
});

assert.equal(completed.execution.status, 'succeeded');
assert.deepEqual(completed.execution.outputAssetIds, [resultAsset.assetId]);
assert.deepEqual(completed.execution.outputSlotResults, [{ slotId: 'result_image', assetIds: [resultAsset.assetId] }]);
assert.deepEqual(completed.execution.resultSummary, { requested: 1, succeeded: 1, failed: 0 });
assert.equal(completed.operationBlock.data.status, 'succeeded');
assert.equal(completed.resultBlock.data.status, 'succeeded');
assert.equal(completed.resultBlock.data.assetId, resultAsset.assetId);
assert.equal(snapshot.assets[0]?.sourceExecutionId, started.execution.executionId);
assert.equal(snapshot.historyEvents?.[0]?.type, 'execution_succeeded');
assert.equal(snapshot.historyEvents?.[1]?.type, 'result_block_updated');

const failedFixture = snapshotWithSourceImage();
const failedStart = addPluginImageOperation(failedFixture.snapshot, {
  body: 'Adjust',
  capabilityId: 'image.local_adjust',
  params: { brightness: 10, contrast: 0, saturation: 0 },
  sourceBlockId: failedFixture.sourceBlock.blockId,
  title: 'Adjust',
});
replacePluginCapabilityDefinitions([]);
failPluginImageOperation(failedFixture.snapshot, {
  errorMessage: 'Canvas unavailable',
  executionId: failedStart.execution.executionId,
});
assert.equal(failedStart.execution.status, 'failed');
assert.equal(failedStart.execution.errorMessage, 'Canvas unavailable');
assert.equal(failedStart.operationBlock.data.status, 'failed');
assert.equal(failedStart.resultBlock.data.status, 'failed');
assert.equal(failedFixture.snapshot.historyEvents?.[0]?.type, 'execution_failed');
assert.deepEqual(
  failedStart.execution.resultSummary,
  { requested: 1, succeeded: 0, failed: 1 },
);

assert.throws(
  () => capabilityDefinitionFor('image.local_adjust'),
  /Unknown legacy capability/,
);
assert.equal(
  currentOperationConfiguration(snapshot, started.operationBlock).prompt,
  '',
);

console.log({
  adapter: completed.execution.adapter,
  coreCapabilityRemoved: true,
  historicalFallbackUsesStoredAdapter: true,
  outputAssetId: completed.execution.outputAssetIds[0],
  status: completed.execution.status,
});

function rectanglesOverlap(left: BlockRecord, right: BlockRecord): boolean {
  return !(
    left.position.x + left.size.width <= right.position.x
    || right.position.x + right.size.width <= left.position.x
    || left.position.y + left.size.height <= right.position.y
    || right.position.y + right.size.height <= left.position.y
  );
}
