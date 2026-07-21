import assert from 'node:assert/strict';
import {
  configurationChanges,
  currentOperationConfiguration,
  executionConfiguration,
} from '../src/core/executionConfiguration';
import { addLocalImageOperation, completeLocalImageOperation, failLocalImageOperation } from '../src/core/imageOperations';
import { hasImageAdjustments, imageAdjustmentFilter } from '../src/core/localImageTransforms';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';

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
const started = addLocalImageOperation(snapshot, {
  body: 'Adjust',
  capabilityId: 'image.local_adjust',
  params: { brightness: 20, contrast: -10, saturation: 30 },
  sourceBlockId: sourceBlock.blockId,
  title: 'Adjust',
});

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
const completed = completeLocalImageOperation(snapshot, {
  asset: resultAsset,
  executionId: started.execution.executionId,
});

assert.equal(completed.execution.status, 'succeeded');
assert.deepEqual(completed.execution.outputAssetIds, [resultAsset.assetId]);
assert.deepEqual(completed.execution.outputSlotResults, [{ slotId: 'images', assetIds: [resultAsset.assetId] }]);
assert.deepEqual(completed.execution.resultSummary, { requested: 1, succeeded: 1, failed: 0 });
assert.equal(completed.operationBlock.data.status, 'succeeded');
assert.equal(completed.resultBlock.data.status, 'succeeded');
assert.equal(completed.resultBlock.data.assetId, resultAsset.assetId);
assert.equal(snapshot.assets[0]?.sourceExecutionId, started.execution.executionId);
assert.equal(snapshot.historyEvents?.[0]?.type, 'execution_succeeded');
assert.equal(snapshot.historyEvents?.[1]?.type, 'result_block_updated');

const failedFixture = snapshotWithSourceImage();
const failedStart = addLocalImageOperation(failedFixture.snapshot, {
  body: 'Adjust',
  capabilityId: 'image.local_adjust',
  params: { brightness: 10, contrast: 0, saturation: 0 },
  sourceBlockId: failedFixture.sourceBlock.blockId,
  title: 'Adjust',
});
failLocalImageOperation(failedFixture.snapshot, {
  errorMessage: 'Canvas unavailable',
  executionId: failedStart.execution.executionId,
});
assert.equal(failedStart.execution.status, 'failed');
assert.equal(failedStart.execution.errorMessage, 'Canvas unavailable');
assert.equal(failedStart.operationBlock.data.status, 'failed');
assert.equal(failedStart.resultBlock.data.status, 'failed');
assert.equal(failedFixture.snapshot.historyEvents?.[0]?.type, 'execution_failed');

assert.equal(
  imageAdjustmentFilter({ brightness: 20, contrast: -10, saturation: 100 }),
  'brightness(120%) contrast(90%) saturate(200%)',
);
assert.equal(hasImageAdjustments({ brightness: 0, contrast: 0, saturation: 0 }), false);
assert.equal(hasImageAdjustments({ brightness: 0, contrast: 1, saturation: 0 }), true);

console.log({
  adapter: completed.execution.adapter,
  outputAssetId: completed.execution.outputAssetIds[0],
  status: completed.execution.status,
});
