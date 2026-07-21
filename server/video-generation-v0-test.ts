import assert from 'node:assert/strict';
import { createBlockRecord } from '../src/core/blockFactory';
import { cancelExecution } from '../src/core/executionLifecycle';
import { createVideoGenerationExecution, runMockVideoGeneration } from '../src/core/videoGeneration';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type { AssetRecord, BoardSnapshot } from '../src/core/types';

const snapshot = structuredClone(defaultSnapshot) as BoardSnapshot;
const firstFrame = addImageInput(snapshot, 'first', 'First frame');
const character = addImageInput(snapshot, 'character', 'Character reference');
const target = createBlockRecord(snapshot, 'video');
target.blockId = 'block_video_shortcut';
target.position = { x: 760, y: 180 };
target.data.executionDraft = {
  schemaVersion: 1,
  capabilityId: 'video.generate',
  executionProfileId: 'video-mock',
  prompt: 'A cat turns toward the camera in warm evening light.',
  parameters: { durationSeconds: 8, outputCount: 3 },
};
snapshot.blocks.push(target);
snapshot.edges.push(
  {
    edgeId: 'edge_video_first_frame',
    sourceBlockId: firstFrame.blockId,
    targetBlockId: target.blockId,
    kind: 'execution_input',
    inputRole: 'first_frame',
  },
  {
    edgeId: 'edge_video_character',
    sourceBlockId: character.blockId,
    targetBlockId: target.blockId,
    kind: 'execution_input',
    inputRole: 'character_reference',
  },
);

const firstRun = await runMockVideoGeneration(snapshot, {
  targetBlockId: target.blockId,
  prompt: target.data.executionDraft.prompt,
  durationSeconds: 8,
  outputCount: 3,
});

assert.equal(firstRun.request.trigger.kind, 'video_block_shortcut');
assert.equal(firstRun.request.capabilityLock.capabilityId, 'video.generate');
assert.equal(firstRun.request.inputBindings.find((binding) => binding.slotId === 'prompt')?.values[0]?.kind, 'inline');
assert.equal(firstRun.request.inputBindings.find((binding) => binding.slotId === 'first_frame')?.values[0]?.kind, 'asset');
assert.equal(firstRun.request.inputBindings.find((binding) => binding.slotId === 'character_references')?.values[0]?.kind, 'asset');
assert.equal(firstRun.execution.status, 'succeeded');
assert.equal(firstRun.execution.adapterSnapshot?.adapterId, 'retake.video.mock');
assert.equal(firstRun.execution.outputBlockIds.length, 3);
assert.equal(firstRun.execution.outputAssetIds.length, 3);
assert.deepEqual(firstRun.execution.outputSlotResults, [{ slotId: 'videos', assetIds: firstRun.execution.outputAssetIds }]);
assert.deepEqual(firstRun.execution.resultSummary, { requested: 3, succeeded: 3, failed: 0 });
assert.equal(firstRun.resultBlocks[0].blockId, target.blockId);
assert.equal(firstRun.resultBlocks.every((block) => block.data.status === 'succeeded'), true);

const firstRunAssetIds = [...firstRun.execution.outputAssetIds];
const firstTargetAssetId = target.data.assetId;
const secondRun = await runMockVideoGeneration(snapshot, {
  targetBlockId: target.blockId,
  prompt: 'Draw two more cards without replacing any paid result.',
  durationSeconds: 12,
  outputCount: 2,
});

assert.equal(secondRun.resultBlocks.length, 2);
assert.equal(secondRun.resultBlocks.some((block) => block.blockId === target.blockId), false);
assert.equal(target.data.assetId, firstTargetAssetId);
assert.equal(firstRunAssetIds.every((assetId) => snapshot.assets.some((asset) => asset.assetId === assetId)), true);
assert.equal(snapshot.assets.filter((asset) => asset.kind === 'video').length, 5);
assert.equal(snapshot.executions.filter((execution) => execution.capabilityId === 'video.generate').length, 2);

const beforeInvalidRun = {
  assets: snapshot.assets.length,
  blocks: snapshot.blocks.length,
  executions: snapshot.executions.length,
};
await assert.rejects(
  () => runMockVideoGeneration(snapshot, {
    targetBlockId: target.blockId,
    prompt: '  ',
    durationSeconds: 8,
    outputCount: 1,
  }),
  /prompt/i,
);
assert.deepEqual(
  { assets: snapshot.assets.length, blocks: snapshot.blocks.length, executions: snapshot.executions.length },
  beforeInvalidRun,
);

const cancellationSnapshot = structuredClone(defaultSnapshot) as BoardSnapshot;
const cancellationTarget = createBlockRecord(cancellationSnapshot, 'video');
cancellationTarget.blockId = 'block_video_cancel_target';
cancellationTarget.data.executionDraft = {
  schemaVersion: 1,
  capabilityId: 'video.generate',
  executionProfileId: 'video-mock',
  prompt: 'A preview that will be canceled before the adapter finishes.',
  parameters: { durationSeconds: 8, outputCount: 3 },
};
cancellationSnapshot.blocks.push(cancellationTarget);
const cancellationRun = createVideoGenerationExecution(cancellationSnapshot, {
  targetBlockId: cancellationTarget.blockId,
  prompt: cancellationTarget.data.executionDraft.prompt,
  durationSeconds: 8,
  outputCount: 3,
});
assert.equal(cancellationRun.resultBlocks[0].blockId, cancellationTarget.blockId);
const paidPartialAsset: AssetRecord = {
  assetId: 'asset_paid_partial_video',
  projectId: cancellationSnapshot.project.projectId,
  kind: 'video',
  mimeType: 'video/mp4',
  storageProvider: 'local',
  storageKey: 'assets/asset_paid_partial_video/original.mp4',
  previewUrl: '/api/local/assets/project/asset_paid_partial_video/original.mp4',
  sourceExecutionId: cancellationRun.execution.executionId,
  createdAt: '2026-07-21T00:00:00.000Z',
};
cancellationSnapshot.assets.push(paidPartialAsset);
cancellationRun.execution.outputAssetIds.push(paidPartialAsset.assetId);
cancellationRun.resultBlocks[1].data.assetId = paidPartialAsset.assetId;
cancellationRun.resultBlocks[1].data.previewUrl = paidPartialAsset.previewUrl;
cancellationRun.resultBlocks[1].data.status = 'succeeded';
const cancellation = cancelExecution(cancellationSnapshot, cancellationRun.execution.executionId);
assert.equal(cancellation.execution?.status, 'canceled');
assert.equal(cancellation.removedBlockIds.length, 1);
assert.equal(cancellationSnapshot.blocks.some((block) => block.blockId === cancellationTarget.blockId), true);
assert.equal(cancellationSnapshot.blocks.some((block) => block.data.assetId === paidPartialAsset.assetId), true);
assert.equal(cancellationSnapshot.assets.some((asset) => asset.assetId === paidPartialAsset.assetId), true);
assert.equal(cancellationTarget.data.assetId, undefined);
assert.equal(cancellationTarget.data.sourceExecutionId, undefined);
assert.equal(cancellationTarget.data.executionDraft?.prompt, 'A preview that will be canceled before the adapter finishes.');
const retryAfterCancellation = createVideoGenerationExecution(cancellationSnapshot, {
  targetBlockId: cancellationTarget.blockId,
  prompt: 'Retry after cancellation.',
  durationSeconds: 8,
  outputCount: 1,
});
assert.equal(retryAfterCancellation.resultBlocks[0].blockId, cancellationTarget.blockId);

console.log(JSON.stringify({
  ok: true,
  firstRunOutputs: firstRun.execution.outputAssetIds.length,
  secondRunOutputs: secondRun.execution.outputAssetIds.length,
  preservedVideoAssets: snapshot.assets.filter((asset) => asset.kind === 'video').length,
  targetWasNotOverwrittenOnRerun: target.data.assetId === firstTargetAssetId,
  canceledShortcutWasReusable: retryAfterCancellation.resultBlocks[0].blockId === cancellationTarget.blockId,
}));

function addImageInput(snapshot: BoardSnapshot, suffix: string, title: string) {
  const asset: AssetRecord = {
    assetId: `asset_video_${suffix}`,
    projectId: snapshot.project.projectId,
    kind: 'image',
    mimeType: 'image/png',
    storageProvider: 'local_mock',
    storageKey: `local-mock://${suffix}.png`,
    previewUrl: `data:image/png;base64,${suffix}`,
    width: 720,
    height: 1280,
    createdAt: '2026-07-21T00:00:00.000Z',
  };
  const block = createBlockRecord(snapshot, 'image');
  block.blockId = `block_video_${suffix}`;
  block.data = { title, assetId: asset.assetId, previewUrl: asset.previewUrl };
  snapshot.assets.push(asset);
  snapshot.blocks.push(block);
  return block;
}
