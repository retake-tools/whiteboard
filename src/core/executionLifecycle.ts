import { createId, nowIso } from './id';
import { fitGroupToChildren } from './grouping';
import type { BoardHistoryEvent, BoardSnapshot, ExecutionRecord } from './types';

export interface ExecutionCancellationResult {
  execution?: ExecutionRecord;
  removedBlockIds: string[];
}

export function executionIsActive(execution: ExecutionRecord): boolean {
  return execution.status === 'queued' || execution.status === 'running';
}

export function executionCancellationRequiresConfirmation(
  executions: readonly ExecutionRecord[],
): boolean {
  return executions.some((execution) => execution.status === 'running');
}

export function activeExecutionsForBlockIds(
  snapshot: BoardSnapshot,
  blockIds: readonly string[],
): ExecutionRecord[] {
  const blockIdSet = new Set(blockIds);
  const explicitExecutionIds = new Set(
    snapshot.blocks
      .filter((block) => blockIdSet.has(block.blockId) && block.type === 'group')
      .flatMap((block) => typeof block.data.groupExecutionId === 'string' ? [block.data.groupExecutionId] : []),
  );
  return snapshot.executions.filter((execution) => {
    if (!executionIsActive(execution)) return false;
    if (explicitExecutionIds.has(execution.executionId)) return true;
    if (execution.outputBlockIds.some((blockId) => blockIdSet.has(blockId))) return true;
    const operationBlockId = executionOperationBlockId(execution);
    return Boolean(operationBlockId && blockIdSet.has(operationBlockId));
  });
}

export function cancelExecution(
  snapshot: BoardSnapshot,
  executionId: string,
): ExecutionCancellationResult {
  const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
  if (!execution || !executionIsActive(execution)) return { execution, removedBlockIds: [] };

  const updatedAt = nowIso();
  const shortcutBlockId = typeof execution.params?.shortcutBlockId === 'string'
    ? execution.params.shortcutBlockId
    : undefined;
  const outputBlockIds = new Set(
    execution.outputBlockIds.filter((blockId) => {
      if (blockId === shortcutBlockId) return false;
      const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
      return !block?.data.assetId;
    }),
  );
  const resultGroupIds = new Set(
    snapshot.blocks
      .filter(
        (block) =>
          block.type === 'group' &&
          block.data.groupKind === 'execution_results' &&
          block.data.groupExecutionId === executionId,
      )
      .map((block) => block.blockId),
  );
  const removedBlockIds = new Set([...outputBlockIds, ...resultGroupIds]);
  const affectedParentGroupIds = new Set(
    snapshot.blocks
      .filter(
        (block) =>
          removedBlockIds.has(block.blockId) &&
          block.parentGroupId &&
          !removedBlockIds.has(block.parentGroupId),
      )
      .map((block) => block.parentGroupId as string),
  );

  for (const block of snapshot.blocks) {
    if (block.parentGroupId && resultGroupIds.has(block.parentGroupId) && !removedBlockIds.has(block.blockId)) {
      const resultGroup = snapshot.blocks.find((candidate) => candidate.blockId === block.parentGroupId);
      block.parentGroupId = resultGroup?.parentGroupId;
      block.updatedAt = updatedAt;
    }
  }
  snapshot.blocks = snapshot.blocks.filter((block) => !removedBlockIds.has(block.blockId));
  snapshot.edges = snapshot.edges.filter(
    (edge) => !removedBlockIds.has(edge.sourceBlockId) && !removedBlockIds.has(edge.targetBlockId),
  );

  const preservedShortcutBlock = shortcutBlockId
    ? snapshot.blocks.find((block) => block.blockId === shortcutBlockId && block.type === 'video')
    : undefined;
  if (preservedShortcutBlock && !preservedShortcutBlock.data.assetId) {
    preservedShortcutBlock.data = {
      ...preservedShortcutBlock.data,
      title: 'Video block',
      status: undefined,
      sourceExecutionId: undefined,
      resultIndex: undefined,
      resultCount: undefined,
    };
    preservedShortcutBlock.updatedAt = updatedAt;
  }

  const operationBlockId = executionOperationBlockId(execution);
  const operationBlock = snapshot.blocks.find(
    (block) => block.blockId === operationBlockId && block.type === 'operation',
  );
  if (operationBlock) {
    operationBlock.data.status = 'canceled';
    operationBlock.data.sourceExecutionId = execution.executionId;
    operationBlock.updatedAt = updatedAt;
  }

  execution.status = 'canceled';
  execution.completedAt = updatedAt;
  delete execution.errorMessage;
  const historyEvent: BoardHistoryEvent = {
      eventId: createId('history'),
      type: 'execution_canceled',
      createdAt: updatedAt,
      actor: 'user',
      executionId,
      blockIds: [
        ...execution.inputBlockIds,
        operationBlockId,
        ...execution.outputBlockIds,
      ].filter((blockId): blockId is string => typeof blockId === 'string'),
      assetIds: execution.outputAssetIds,
      summary: `Execution canceled: ${execution.capabilityId}`,
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  snapshot.board.updatedAt = updatedAt;
  snapshot.project.updatedAt = updatedAt;
  for (const parentGroupId of affectedParentGroupIds) fitGroupToChildren(snapshot, parentGroupId);
  return { execution, removedBlockIds: [...removedBlockIds] };
}

function executionOperationBlockId(execution: ExecutionRecord): string | undefined {
  return typeof execution.params?.operationBlockId === 'string'
    ? execution.params.operationBlockId
    : undefined;
}
