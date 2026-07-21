import assert from 'node:assert/strict';
import { createBlockRecord } from '../src/core/blockFactory';
import { executionConfiguration, assignExecutionVersion } from '../src/core/executionConfiguration';
import { executionSourceLineage } from '../src/core/executionLineage';
import {
  directBezierIntersectsObstacles,
  executionOutputEdgeRoute,
  resultApproachOffsetForGap,
  shouldUseDirectExecutionOutputBezier,
  targetLeftClearance,
} from '../src/core/executionOutputEdgePath';
import { createFlowEdges, createFlowNodes } from '../src/core/flowProjection';
import {
  imageBranchDraftSelectionBlockIds,
  imageOperationResultRowLayout,
} from '../src/core/imageOperationLayout';
import {
  addImageCodexOperation,
  createDraftImageToImageOperation,
  executeExistingImageOperationBlock,
  type ImageGenerationParams,
} from '../src/core/imageOperations';
import { createGroupAroundBlocks } from '../src/core/grouping';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { migrateBoardSnapshot } from '../src/core/snapshotMigration';
import { createImageResultRetryPrompt } from '../src/core/prompts';
import type { AssetRecord, BlockRecord, BoardSnapshot, ExecutionRecord } from '../src/core/types';

const snapshot = migrateBoardSnapshot(structuredClone(defaultSnapshot) as BoardSnapshot);
snapshot.blocks = [];
snapshot.edges = [];
snapshot.assets = [];
snapshot.executions = [];
snapshot.historyEvents = [];

const placementSnapshot = migrateBoardSnapshot(structuredClone(defaultSnapshot) as BoardSnapshot);
placementSnapshot.blocks = [];
const placementOperation = createBlockRecord(placementSnapshot, 'operation');
placementOperation.position = { x: 100, y: 100 };
placementOperation.size = { width: 320, height: 190 };
placementSnapshot.blocks.push(placementOperation);
const placementResultSize = { width: 214, height: 380 };
const directRightLayout = imageOperationResultRowLayout(
  placementSnapshot,
  placementOperation,
  placementResultSize,
  1,
);
assert.deepEqual(directRightLayout, { x: 500, y: 100 });
const firstRightBlocker = createBlockRecord(placementSnapshot, 'image');
firstRightBlocker.position = directRightLayout;
firstRightBlocker.size = placementResultSize;
placementSnapshot.blocks.push(firstRightBlocker);
const fartherRightLayout = imageOperationResultRowLayout(
  placementSnapshot,
  placementOperation,
  placementResultSize,
  1,
);
assert.deepEqual(fartherRightLayout, { x: 762, y: 100 });
const secondRightBlocker = createBlockRecord(placementSnapshot, 'image');
secondRightBlocker.position = fartherRightLayout;
secondRightBlocker.size = placementResultSize;
placementSnapshot.blocks.push(secondRightBlocker);
const upperLayout = imageOperationResultRowLayout(
  placementSnapshot,
  placementOperation,
  placementResultSize,
  1,
);
assert.deepEqual(upperLayout, { x: 500, y: -328 });
const upperBlocker = createBlockRecord(placementSnapshot, 'image');
upperBlocker.position = upperLayout;
upperBlocker.size = placementResultSize;
placementSnapshot.blocks.push(upperBlocker);
const lowerLayout = imageOperationResultRowLayout(
  placementSnapshot,
  placementOperation,
  placementResultSize,
  1,
);
assert.deepEqual(lowerLayout, { x: 500, y: 528 });

const source = createBlockRecord(snapshot, 'image');
source.position = { x: 180, y: 160 };
source.size = { width: 300, height: 230 };
source.data = {
  ...source.data,
  assetId: 'asset_branch_source',
  sourceExecutionId: 'exec_upstream_v2',
  title: 'Upstream V2 result',
};
snapshot.blocks.push(source);
snapshot.assets.push(createSourceAsset(snapshot));
snapshot.executions.push(createUpstreamExecution(snapshot, source));

const resultGroup = createGroupAroundBlocks(snapshot, [source.blockId], {
  executionId: 'exec_upstream_v2',
  kind: 'execution_results',
  title: 'Execution results',
});
assert.ok(resultGroup);
assert.equal(source.parentGroupId, resultGroup.blockId);

const firstBranch = createDraftImageToImageOperation(snapshot, {
  operation: 'quick_edit',
  sourceBlockId: source.blockId,
  textBlockTitle: 'Prompt A',
  textBlockBody: 'Create branch A with warmer light.',
  operationTitle: 'Branch A',
});
const secondBranch = createDraftImageToImageOperation(snapshot, {
  operation: 'create_similar',
  sourceBlockId: source.blockId,
  textBlockTitle: 'Prompt B',
  textBlockBody: 'Create branch B with a wider composition.',
  operationTitle: 'Branch B',
});

for (const branch of [firstBranch, secondBranch]) {
  assert.equal(branch.textBlock.parentGroupId, resultGroup.parentGroupId);
  assert.equal(branch.operationBlock.parentGroupId, resultGroup.parentGroupId);
  assert.notEqual(branch.operationBlock.parentGroupId, resultGroup.blockId);
  assert.ok(snapshot.edges.some(
    (edge) =>
      edge.sourceBlockId === source.blockId &&
      edge.targetBlockId === branch.operationBlock.blockId &&
      edge.kind === 'execution_input' &&
      edge.inputRole === 'source',
  ));
}
assert.equal(rectanglesOverlap(firstBranch.textBlock, secondBranch.textBlock), false);
assert.equal(rectanglesOverlap(firstBranch.operationBlock, secondBranch.operationBlock), false);
assert.equal(rectanglesOverlap(resultGroup, firstBranch.textBlock), false);
assert.equal(rectanglesOverlap(resultGroup, firstBranch.operationBlock), false);
const migratedDraftSnapshot = migrateBoardSnapshot(structuredClone(snapshot));
for (const branch of [firstBranch, secondBranch]) {
  const migratedText = migratedDraftSnapshot.blocks.find((block) => block.blockId === branch.textBlock.blockId);
  const migratedOperation = migratedDraftSnapshot.blocks.find((block) => block.blockId === branch.operationBlock.blockId);
  assert.deepEqual(migratedText?.position, branch.textBlock.position);
  assert.deepEqual(migratedOperation?.position, branch.operationBlock.position);
}

const firstSelection = imageBranchDraftSelectionBlockIds(
  source,
  firstBranch.textBlock,
  firstBranch.operationBlock,
);
assert.deepEqual(new Set(firstSelection), new Set([
  firstBranch.textBlock.blockId,
  firstBranch.operationBlock.blockId,
]));
const ordinarySource = structuredClone(source);
delete ordinarySource.data.sourceExecutionId;
assert.deepEqual(
  new Set(imageBranchDraftSelectionBlockIds(ordinarySource, firstBranch.textBlock, firstBranch.operationBlock)),
  new Set([source.blockId, firstBranch.textBlock.blockId, firstBranch.operationBlock.blockId]),
);

const deletionSnapshot = structuredClone(snapshot);
const deletedIds = new Set(firstSelection);
deletionSnapshot.blocks = deletionSnapshot.blocks.filter((block) => !deletedIds.has(block.blockId));
deletionSnapshot.edges = deletionSnapshot.edges.filter(
  (edge) => !deletedIds.has(edge.sourceBlockId) && !deletedIds.has(edge.targetBlockId),
);
assert.ok(deletionSnapshot.blocks.some((block) => block.blockId === source.blockId));
assert.ok(deletionSnapshot.blocks.some((block) => block.blockId === resultGroup.blockId));
assert.ok(deletionSnapshot.blocks.some((block) => block.blockId === secondBranch.textBlock.blockId));
assert.ok(deletionSnapshot.blocks.some((block) => block.blockId === secondBranch.operationBlock.blockId));
assert.ok(deletionSnapshot.edges.some(
  (edge) => edge.sourceBlockId === source.blockId && edge.targetBlockId === secondBranch.operationBlock.blockId,
));

firstBranch.operationBlock.data.generationParams = {
  ...(firstBranch.operationBlock.data.generationParams as ImageGenerationParams),
  variationCount: 2,
};
assert.notEqual(
  (secondBranch.operationBlock.data.generationParams as ImageGenerationParams).variationCount,
  2,
);

const firstRun = executeExistingImageOperationBlock(snapshot, {
  generationParams: firstBranch.operationBlock.data.generationParams as ImageGenerationParams,
  operationBlockId: firstBranch.operationBlock.blockId,
  operation: 'image_to_image',
  instruction: '',
});
const secondRun = executeExistingImageOperationBlock(snapshot, {
  generationParams: secondBranch.operationBlock.data.generationParams as ImageGenerationParams,
  operationBlockId: secondBranch.operationBlock.blockId,
  operation: 'image_to_image',
  instruction: '',
});
assignExecutionVersion(snapshot, firstRun.execution);
firstRun.execution.status = 'running';
assignExecutionVersion(snapshot, secondRun.execution);
secondRun.execution.status = 'running';

assert.equal(firstRun.execution.operationVersion, 1);
assert.equal(secondRun.execution.operationVersion, 1);
assert.notEqual(firstRun.execution.executionId, secondRun.execution.executionId);
assert.equal(firstRun.execution.inputBlockIds.includes(firstBranch.textBlock.blockId), true);
assert.equal(firstRun.execution.inputBlockIds.includes(secondBranch.textBlock.blockId), false);
assert.equal(secondRun.execution.inputBlockIds.includes(secondBranch.textBlock.blockId), true);
assert.equal(secondRun.execution.inputBlockIds.includes(firstBranch.textBlock.blockId), false);
assert.equal(executionConfiguration(firstRun.execution).prompt, firstBranch.textBlock.data.body);
assert.equal(executionConfiguration(secondRun.execution).prompt, secondBranch.textBlock.data.body);
assert.equal(firstRun.resultBlocks.length, 2);
assert.equal(secondRun.resultBlocks.length, 1);
assert.match(firstRun.execution.agentPrompt ?? '', /As soon as each variant file is ready/);
assert.match(firstRun.execution.agentPrompt ?? '', /Partial writeback keeps the execution running/);

const retrySnapshot = structuredClone(snapshot);
const retryExecution = retrySnapshot.executions.find(
  (execution) => execution.executionId === firstRun.execution.executionId,
);
const retryFirstResult = retrySnapshot.blocks.find(
  (block) => block.blockId === firstRun.resultBlocks[0].blockId,
);
const retrySecondResult = retrySnapshot.blocks.find(
  (block) => block.blockId === firstRun.resultBlocks[1].blockId,
);
assert.ok(retryExecution && retryFirstResult && retrySecondResult);
retryExecution.status = 'failed';
retryExecution.errorMessage = 'Variant 1 failed.';
retryFirstResult.data.status = 'failed';
retryFirstResult.data.statusVisualDismissed = true;
retrySecondResult.data.status = 'succeeded';
retrySecondResult.data.assetId = 'asset_existing_variant_2';
const migratedRetrySnapshot = migrateBoardSnapshot(retrySnapshot);
const migratedRetryFirstResult = migratedRetrySnapshot.blocks.find(
  (block) => block.blockId === retryFirstResult.blockId,
);
assert.equal(migratedRetryFirstResult?.data.statusVisualDismissed, undefined);
const retryNodes = createFlowNodes(migratedRetrySnapshot);
assert.equal(retryNodes.find((node) => node.id === retryFirstResult.blockId)?.data.resultRetryMode, 'codex_prompt');
assert.equal(retryNodes.find((node) => node.id === retrySecondResult.blockId)?.data.resultRetryMode, undefined);
const retryPrompt = createImageResultRetryPrompt(migratedRetrySnapshot, migratedRetryFirstResult!);
assert.match(retryPrompt, /Retry exactly one failed Retake Whiteboard image result/);
assert.match(retryPrompt, new RegExp(`retry resultBlockId: ${retryFirstResult.blockId}`));
assert.match(retryPrompt, /retake_mark_execution_running is expected to resume/);
assert.match(retryPrompt, /requested variation count: 1/);
assert.match(retryPrompt, new RegExp(`${retryExecution.executionId}-1\\.png`));
assert.doesNotMatch(retryPrompt, new RegExp(`result image blockId: ${retrySecondResult.blockId}`));

const batchFlowEdges = createFlowEdges(snapshot)
  .filter((edge) => firstRun.resultBlocks.some((block) => block.blockId === edge.target));
assert.deepEqual(batchFlowEdges.map((edge) => edge.type), ['executionOutput', 'executionOutput']);
assert.deepEqual(batchFlowEdges.map((edge) => edge.data?.resultIndex), [0, 1]);
const blockingResult = { bottom: 407, left: 800, right: 1000, top: 193 };
assert.equal(shouldUseDirectExecutionOutputBezier({
  obstacles: [],
  sourceX: 500,
  sourceY: 300,
  targetX: 1200,
  targetY: 300,
}), true);
assert.equal(shouldUseDirectExecutionOutputBezier({
  obstacles: [blockingResult],
  sourceX: 500,
  sourceY: 300,
  targetLeftGap: 32,
  targetX: 1200,
  targetY: 300,
}), false);
assert.equal(shouldUseDirectExecutionOutputBezier({
  obstacles: [blockingResult],
  sourceX: 500,
  sourceY: 300,
  targetLeftGap: 8,
  targetX: 1200,
  targetY: 300,
}), true);
assert.equal(shouldUseDirectExecutionOutputBezier({
  obstacles: [blockingResult],
  sourceX: 500,
  sourceY: 300,
  targetX: 700,
  targetY: 300,
}), true);
assert.equal(directBezierIntersectsObstacles({
  obstacles: [blockingResult],
  sourceX: 500,
  sourceY: 300,
  targetX: 1200,
  targetY: 300,
}), true);
assert.equal(targetLeftClearance(
  { bottom: 407, left: 1200, right: 1580, top: 193 },
  [blockingResult],
), 200);
assert.equal(targetLeftClearance(
  { bottom: 407, left: 980, right: 1360, top: 193 },
  [blockingResult],
), 0);
assert.equal(resultApproachOffsetForGap(16), 6);
assert.equal(resultApproachOffsetForGap(32), 12);
assert.equal(resultApproachOffsetForGap(80), 18);
const firstRowSecondResultRoute = executionOutputEdgeRoute({
  resultHeight: 214,
  sourceX: 500,
  sourceY: 300,
  targetX: 1200,
  targetY: 300,
  targetLeftGap: 32,
});
assert.equal(firstRowSecondResultRoute.targetLeftX, 1200);
assert.equal(firstRowSecondResultRoute.targetLeftY, 300);
assert.equal(firstRowSecondResultRoute.targetTopY, 193);
assert.equal(firstRowSecondResultRoute.targetBottomY, 407);
assert.equal(firstRowSecondResultRoute.laneSide, 'top');
assert.equal(firstRowSecondResultRoute.laneY, 161);
assert.equal(firstRowSecondResultRoute.gutterX, 532);
assert.equal(firstRowSecondResultRoute.approachX, 1188);
assert.match(firstRowSecondResultRoute.path, /^M 500 300 L /);
assert.equal((firstRowSecondResultRoute.path.match(/ Q /g) ?? []).length, 4);
assert.match(firstRowSecondResultRoute.path, /L 1200 300$/);

const secondRowSecondResultRoute = executionOutputEdgeRoute({
  resultHeight: 214,
  sourceX: 500,
  sourceY: 300,
  targetX: 1200,
  targetY: 586,
  targetLeftGap: 32,
});
const firstRowBottom = firstRowSecondResultRoute.targetTopY + 214;
assert.equal(secondRowSecondResultRoute.targetTopY - firstRowBottom, 72);
assert.equal(secondRowSecondResultRoute.laneY - firstRowBottom, 40);
assert.equal(secondRowSecondResultRoute.gutterX, firstRowSecondResultRoute.gutterX);

const upperSecondResultRoute = executionOutputEdgeRoute({
  resultHeight: 380,
  sourceX: 420,
  sourceY: 195,
  targetX: 762,
  targetY: -138,
  targetLeftGap: 48,
});
assert.equal(upperSecondResultRoute.laneSide, 'bottom');
assert.equal(upperSecondResultRoute.targetBottomY, 52);
assert.equal(upperSecondResultRoute.laneY, 84);
assert.match(upperSecondResultRoute.path, /L 762 -138$/);

const firstResultGroup = executionResultGroup(snapshot, firstRun.execution.executionId);
const secondResultGroup = executionResultGroup(snapshot, secondRun.execution.executionId);
assert.ok(firstResultGroup);
assert.equal(secondResultGroup, undefined);
assert.equal(firstResultGroup.parentGroupId, resultGroup.parentGroupId);
assert.equal(secondRun.resultBlock.parentGroupId, resultGroup.parentGroupId);
assert.equal(
  rectanglesOverlap(firstResultGroup, secondRun.resultBlock),
  false,
  JSON.stringify({ firstResultGroup, secondResultBlock: secondRun.resultBlock }, null, 2),
);

const lineage = executionSourceLineage(snapshot, firstRun.execution);
assert.equal(lineage.sourceBlock?.blockId, source.blockId);
assert.equal(lineage.sourceExecution?.executionId, 'exec_upstream_v2');
assert.equal(lineage.sourceExecutionVersion, 2);
assert.ok(snapshot.historyEvents?.some(
  (event) =>
    event.type === 'operation_created' &&
    event.executionId === firstRun.execution.executionId &&
    event.detail?.sourceBlockId === source.blockId,
));

const assetOnlyReferenceSnapshot = structuredClone(snapshot);
const assetOnlyReference: AssetRecord = {
  ...createSourceAsset(assetOnlyReferenceSnapshot),
  assetId: 'asset_reference_without_block',
  storageKey: 'assets/asset_reference_without_block/original.png',
};
const assetOnlyReferenceRun = addImageCodexOperation(assetOnlyReferenceSnapshot, {
  operation: 'generate_image',
  sourceBlockId: source.blockId,
  instruction: 'Generate a new shot using the attached image only as visual reference.',
  referenceAssets: [assetOnlyReference],
});
const referenceSlot = assetOnlyReferenceRun.execution.inputBindingsSnapshot?.find(
  (binding) => binding.slotId === 'references',
);
assert.deepEqual(referenceSlot?.values, [{
  kind: 'asset',
  assetId: assetOnlyReference.assetId,
}]);
assert.match(assetOnlyReferenceRun.prompt, /\[general_reference\]/);

console.log({
  branchCount: 2,
  branchDraftDeletionPreservesSharedSource: true,
  branchExecutionsIndependent: true,
  branchLayoutNonOverlapping: true,
  branchResultGroupsIndependent: true,
  batchOutputEdgesAvoidPriorResults: true,
  progressiveWritebackPrompt: true,
  assetOnlyReferenceContract: true,
  resumableFailedResultPrompt: true,
  sourceLineageVersion: lineage.sourceExecutionVersion,
});

function createSourceAsset(snapshot: BoardSnapshot): AssetRecord {
  return {
    assetId: 'asset_branch_source',
    projectId: snapshot.project.projectId,
    kind: 'image',
    mimeType: 'image/png',
    storageProvider: 'local',
    storageKey: 'assets/asset_branch_source/original.png',
    previewUrl: '/api/local/assets/proj_demo_retake/asset_branch_source/original.png',
    width: 1200,
    height: 920,
    createdAt: '2026-07-11T02:00:00.000Z',
  };
}

function createUpstreamExecution(snapshot: BoardSnapshot, outputBlock: BlockRecord): ExecutionRecord {
  return {
    executionId: 'exec_upstream_v2',
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId: 'image.text_to_image',
    adapter: 'mcp_agent',
    status: 'succeeded',
    inputBlockIds: [],
    outputBlockIds: [outputBlock.blockId],
    outputAssetIds: ['asset_branch_source'],
    startedAt: '2026-07-11T02:00:00.000Z',
    completedAt: '2026-07-11T02:01:00.000Z',
    operationVersion: 2,
  };
}

function executionResultGroup(snapshot: BoardSnapshot, executionId: string): BlockRecord | undefined {
  return snapshot.blocks.find(
    (block) => block.type === 'group' && block.data.groupExecutionId === executionId,
  );
}

function rectanglesOverlap(left: BlockRecord, right: BlockRecord): boolean {
  return !(
    left.position.x + left.size.width <= right.position.x ||
    right.position.x + right.size.width <= left.position.x ||
    left.position.y + left.size.height <= right.position.y ||
    right.position.y + right.size.height <= left.position.y
  );
}
