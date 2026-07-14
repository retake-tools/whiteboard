import assert from 'node:assert/strict';
import {
  activeExecutionsForBlockIds,
  cancelExecution,
  executionCancellationRequiresConfirmation,
} from '../src/core/executionLifecycle';
import { assignExecutionVersion } from '../src/core/executionConfiguration';
import { createDraftTextToImageOperation, executeExistingImageOperationBlock } from '../src/core/imageOperations';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { migrateBoardSnapshot } from '../src/core/snapshotMigration';
import type { BoardSnapshot } from '../src/core/types';

const snapshot = migrateBoardSnapshot(structuredClone(defaultSnapshot) as BoardSnapshot);
const draft = createDraftTextToImageOperation(snapshot, {
  generationParams: { variationCount: 2 },
  operationTitle: 'Text to image',
  textBlockBody: 'Generate two cancellation test images.',
  textBlockTitle: 'Prompt',
});
const run = executeExistingImageOperationBlock(snapshot, {
  operationBlockId: draft.operationBlock.blockId,
  operation: 'text_to_image',
  instruction: '',
  generationParams: { variationCount: 2 },
});
const executionId = run.execution.executionId;
const resultBlockIds = run.resultBlocks.map((block) => block.blockId);
const resultGroup = snapshot.blocks.find(
  (block) => block.type === 'group' && block.data.groupExecutionId === executionId,
);
assert.ok(resultGroup);
assert.equal(executionCancellationRequiresConfirmation([run.execution]), false);
assert.deepEqual(
  activeExecutionsForBlockIds(snapshot, [resultBlockIds[0]]).map((execution) => execution.executionId),
  [executionId],
);
assert.deepEqual(
  activeExecutionsForBlockIds(snapshot, [resultGroup.blockId]).map((execution) => execution.executionId),
  [executionId],
);

const cancellation = cancelExecution(snapshot, executionId);
assert.equal(cancellation.execution?.status, 'canceled');
assert.equal(cancellation.execution?.operationVersion, undefined);
assert.equal(cancellation.removedBlockIds.length, 3);
assert.equal(draft.operationBlock.data.status, 'canceled');
assert.equal(snapshot.blocks.some((block) => resultBlockIds.includes(block.blockId)), false);
assert.equal(snapshot.blocks.some((block) => block.blockId === resultGroup.blockId), false);
assert.equal(snapshot.edges.some((edge) => resultBlockIds.includes(edge.targetBlockId)), false);
assert.equal(snapshot.historyEvents?.[0]?.type, 'execution_canceled');
assert.equal(activeExecutionsForBlockIds(snapshot, [draft.operationBlock.blockId]).length, 0);

const runningSnapshot = migrateBoardSnapshot(structuredClone(defaultSnapshot) as BoardSnapshot);
const runningDraft = createDraftTextToImageOperation(runningSnapshot, {
  operationTitle: 'Text to image',
  textBlockBody: 'Generate one running cancellation test image.',
  textBlockTitle: 'Prompt',
});
const runningRun = executeExistingImageOperationBlock(runningSnapshot, {
  operationBlockId: runningDraft.operationBlock.blockId,
  operation: 'text_to_image',
  instruction: '',
});
assignExecutionVersion(runningSnapshot, runningRun.execution);
runningRun.execution.status = 'running';
runningDraft.operationBlock.data.status = 'running';
runningRun.resultBlocks[0].data.status = 'running';
assert.equal(executionCancellationRequiresConfirmation([runningRun.execution]), true);
const runningCancellation = cancelExecution(runningSnapshot, runningRun.execution.executionId);
assert.equal(runningCancellation.execution?.status, 'canceled');
assert.equal(runningCancellation.execution?.operationVersion, 1);

console.log({
  canceledBatchExecutionId: executionId,
  canceledBatchResultCount: resultBlockIds.length,
  canceledRunningExecution: true,
  removedResultGroup: true,
});
