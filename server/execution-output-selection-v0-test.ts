import assert from 'node:assert/strict';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import {
  selectExecutionOutput,
  selectedExecutionOutput,
} from '../src/core/executionOutputSelection';
import { migrateBoardSnapshot } from '../src/core/snapshotMigration';
import type { AssetRecord, BlockRecord, BoardSnapshot, ExecutionRecord } from '../src/core/types';

const now = '2026-08-15T08:00:00.000Z';
const snapshot = createBlankBoardSnapshot({
  boardName: '[TEST] execution output selection',
  projectName: '[TEST] output selection',
});
const outputs = Array.from({ length: 4 }, (_, index) => outputPair(snapshot, index));
snapshot.assets.push(...outputs.map((output) => output.asset));
snapshot.blocks.push(...outputs.map((output) => output.block));
const execution: ExecutionRecord = {
  adapter: 'direct_api',
  boardId: snapshot.board.boardId,
  capabilityId: 'image.generate',
  completedAt: now,
  executionId: 'execution_four_outputs',
  inputBlockIds: [],
  outputAssetIds: outputs.map((output) => output.asset.assetId),
  outputBlockIds: outputs.map((output) => output.block.blockId),
  projectId: snapshot.project.projectId,
  resultSummary: { failed: 0, requested: 4, succeeded: 4 },
  startedAt: now,
  status: 'succeeded',
};
snapshot.executions.push(execution);

const firstSelection = selectExecutionOutput(snapshot, {
  assetId: outputs[0].asset.assetId,
  blockId: outputs[0].block.blockId,
  executionId: execution.executionId,
  expectedSelectionVersion: 0,
});
assert.equal(firstSelection.changed, true);
assert.equal(firstSelection.selection.recordVersion, 1);
assert.equal(selectedExecutionOutput(snapshot, execution.executionId)?.asset.assetId, outputs[0].asset.assetId);
assert.deepEqual(execution.outputAssetIds, outputs.map((output) => output.asset.assetId));
assert.deepEqual(execution.outputBlockIds, outputs.map((output) => output.block.blockId));

const beforeReselection = structuredClone(snapshot) as BoardSnapshot;
const secondSelection = selectExecutionOutput(snapshot, {
  assetId: outputs[2].asset.assetId,
  blockId: outputs[2].block.blockId,
  executionId: execution.executionId,
  expectedSelectionVersion: 1,
});
assert.equal(secondSelection.changed, true);
assert.equal(secondSelection.selection.recordVersion, 2);
assert.equal(selectedExecutionOutput(snapshot, execution.executionId)?.block.blockId, outputs[2].block.blockId);
assert.equal(snapshot.assets.length, 4);
assert.equal(snapshot.blocks.length, 4);

assert.throws(() => selectExecutionOutput(snapshot, {
  assetId: outputs[1].asset.assetId,
  blockId: outputs[1].block.blockId,
  executionId: execution.executionId,
  expectedSelectionVersion: 1,
}), /version conflict/);

const foreignAsset: AssetRecord = {
  ...outputs[1].asset,
  assetId: 'asset_foreign',
  storageKey: 'assets/asset_foreign.png',
};
snapshot.assets.push(foreignAsset);
assert.throws(() => selectExecutionOutput(snapshot, {
  assetId: foreignAsset.assetId,
  blockId: outputs[1].block.blockId,
  executionId: execution.executionId,
  expectedSelectionVersion: 2,
}), /not an exact output/);
snapshot.assets.pop();

const reopened = migrateBoardSnapshot(structuredClone(snapshot) as BoardSnapshot);
const reopenedSelection = selectedExecutionOutput(reopened, execution.executionId);
assert.equal(reopenedSelection?.asset.assetId, outputs[2].asset.assetId);
assert.equal(reopenedSelection?.block.blockId, outputs[2].block.blockId);

const undoRestored = migrateBoardSnapshot(beforeReselection);
const undoSelection = selectedExecutionOutput(undoRestored, execution.executionId);
assert.equal(undoSelection?.asset.assetId, outputs[0].asset.assetId);
assert.equal(undoRestored.assets.length, 4);
assert.equal(undoRestored.blocks.length, 4);
assert.deepEqual(
  undoRestored.executions[0].outputAssetIds,
  outputs.map((output) => output.asset.assetId),
);

const stale = structuredClone(reopened) as BoardSnapshot;
stale.blocks = stale.blocks.filter((block) => block.blockId !== outputs[2].block.blockId);
const repaired = migrateBoardSnapshot(stale);
assert.equal(repaired.executionOutputSelections?.length, 0);

console.log(JSON.stringify({
  allOutputsPreserved: true,
  exactDownstreamRead: true,
  reopenRestoredSelection: true,
  reselectionVersioned: true,
  undoPreservedOutputs: true,
}));

function outputPair(
  snapshot: BoardSnapshot,
  index: number,
): { asset: AssetRecord; block: BlockRecord } {
  const assetId = `asset_output_${index + 1}`;
  const blockId = `block_output_${index + 1}`;
  const asset: AssetRecord = {
    assetId,
    createdAt: now,
    height: 1440,
    kind: 'image',
    mimeType: 'image/png',
    previewUrl: `data:image/png;base64,OUTPUT${index + 1}`,
    projectId: snapshot.project.projectId,
    sourceExecutionId: 'execution_four_outputs',
    storageKey: `assets/${assetId}.png`,
    storageProvider: 'local',
    width: 1080,
  };
  const block: BlockRecord = {
    blockId,
    boardId: snapshot.board.boardId,
    createdAt: now,
    data: {
      assetId,
      sourceExecutionId: 'execution_four_outputs',
      status: 'succeeded',
      title: `方案 ${index + 1}`,
    },
    layerId: snapshot.layers[0].id,
    position: { x: index * 320, y: 240 },
    size: { height: 360, width: 270 },
    type: 'image',
    updatedAt: now,
    zIndex: index + 1,
  };
  return { asset, block };
}
