import { maxZIndex, touchBoard } from '../../core/blockFactory';
import {
  activeExecutionsForBlockIds,
  cancelExecution,
} from '../../core/executionLifecycle';
import {
  blockLockedByGroup,
  blockManagedByWorkflowGroup,
  descendantBlockIds,
  expandGroupToContents,
  fitGroupToChildren,
  groupStructureLocked,
} from '../../core/grouping';
import { createId, nowIso } from '../../core/id';
import type { BoardSnapshot, ExecutionRecord } from '../../core/types';
import type { CanvasHostScopeV1 } from '../../host-kit';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardBlockCommandsV1 {
  delete(input: {
    blockIds: readonly string[];
    expectedScope: CanvasHostScopeV1;
  }): Promise<WhiteboardBlockDeleteResultV1>;
  duplicate(input: {
    blockIds: readonly string[];
    expectedScope: CanvasHostScopeV1;
  }): Promise<WhiteboardBlockDuplicateResultV1>;
}

export interface WhiteboardBlockDeleteResultV1 {
  canceledExecutions: WhiteboardCanceledProviderExecutionV1[];
  committed: boolean;
  deletedBlockIds: string[];
}

export interface WhiteboardCanceledProviderExecutionV1 {
  adapterId?: string;
  boardId: string;
  executionId: string;
  projectId: string;
  providerTaskIds: string[];
}

export interface WhiteboardBlockDuplicateResultV1 {
  committed: boolean;
  duplicatedBlockIds: string[];
}

export function createWhiteboardBlockCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardBlockCommandsV1 {
  return Object.freeze({
    async delete(input: Parameters<WhiteboardBlockCommandsV1['delete']>[0]) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        const rootBlockIds = deletableRootBlockIds(snapshot, input.blockIds);
        if (rootBlockIds.length === 0) {
          return { changed: false, result: { canceledExecutions: [], deletedBlockIds: [] } };
        }
        const groupIds = rootBlockIds.filter(
          (blockId) => snapshot.blocks.find((block) => block.blockId === blockId)?.type === 'group',
        );
        const activeExecutions = activeExecutionsForBlockIds(
          snapshot,
          [...rootBlockIds, ...descendantBlockIds(snapshot, groupIds)],
        );
        const canceledExecutions: WhiteboardCanceledProviderExecutionV1[] = [];
        const canceledRemovedIds = new Set<string>();
        for (const execution of activeExecutions) {
          const cancellation = cancelExecution(snapshot, execution.executionId);
          if (cancellation.execution?.status !== 'canceled') continue;
          for (const blockId of cancellation.removedBlockIds) canceledRemovedIds.add(blockId);
          canceledExecutions.push({
            adapterId: execution.adapterSnapshot?.adapterId,
            boardId: execution.boardId,
            executionId: execution.executionId,
            projectId: execution.projectId,
            providerTaskIds: providerTaskIds(execution),
          });
        }
        const currentRootIds = deletableRootBlockIds(snapshot, rootBlockIds);
        const currentGroupIds = currentRootIds.filter(
          (blockId) => snapshot.blocks.find((block) => block.blockId === blockId)?.type === 'group',
        );
        const selectedIds = new Set([
          ...currentRootIds,
          ...descendantBlockIds(snapshot, currentGroupIds),
        ]);
        const deletedBlockIds = [...new Set([...canceledRemovedIds, ...selectedIds])];
        if (selectedIds.size > 0) {
          const affectedParentIds = new Set(snapshot.blocks.flatMap((block) => (
            selectedIds.has(block.blockId)
            && block.parentGroupId
            && !selectedIds.has(block.parentGroupId)
              ? [block.parentGroupId]
              : []
          )));
          snapshot.blocks = snapshot.blocks.filter((block) => !selectedIds.has(block.blockId));
          snapshot.edges = snapshot.edges.filter(
            (edge) => !selectedIds.has(edge.sourceBlockId) && !selectedIds.has(edge.targetBlockId),
          );
          for (const parentGroupId of affectedParentIds) fitGroupToChildren(snapshot, parentGroupId);
        }
        if (deletedBlockIds.length === 0 && canceledExecutions.length === 0) {
          return { changed: false, result: { canceledExecutions: [], deletedBlockIds: [] } };
        }
        touchBoard(snapshot);
        return { changed: true, result: { canceledExecutions, deletedBlockIds } };
      });
      return { ...transaction.result, committed: transaction.committed };
    },

    async duplicate(input: Parameters<WhiteboardBlockCommandsV1['duplicate']>[0]) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        const selectedBlockIds = [...new Set(input.blockIds)].filter((blockId) => (
          snapshot.blocks.some((block) => block.blockId === blockId)
        ));
        if (
          selectedBlockIds.length === 0
          || selectedBlockIds.some((blockId) => blockManagedByWorkflowGroup(snapshot, blockId))
        ) {
          return { changed: false, result: { duplicatedBlockIds: [] } };
        }
        const selectedGroupIds = selectedBlockIds.filter(
          (blockId) => snapshot.blocks.find((block) => block.blockId === blockId)?.type === 'group',
        );
        const copiedIds = new Set([
          ...selectedBlockIds,
          ...descendantBlockIds(snapshot, selectedGroupIds),
        ]);
        const selectedBlocks = snapshot.blocks.filter((block) => copiedIds.has(block.blockId));
        const nextZ = maxZIndex(snapshot.blocks) + 1;
        const idMap = new Map(selectedBlocks.map((block) => [block.blockId, createId('block')]));
        const workflowProjectionIdMap = new Map<string, string>();
        const externalParentGroupIds = new Set<string>();
        const duplicatedBlockIds: string[] = [];
        const createdAt = nowIso();
        selectedBlocks.forEach((block, index) => {
          const blockId = idMap.get(block.blockId)!;
          if (selectedBlockIds.includes(block.blockId)) duplicatedBlockIds.push(blockId);
          const nextParentGroupId = block.parentGroupId
            ? idMap.get(block.parentGroupId) ?? block.parentGroupId
            : undefined;
          if (nextParentGroupId && !idMap.has(block.parentGroupId ?? '')) {
            externalParentGroupIds.add(nextParentGroupId);
          }
          const clonedData = structuredClone(block.data);
          if (block.type === 'group' && clonedData.groupKind === 'execution_results') {
            clonedData.groupKind = 'manual';
            delete clonedData.groupExecutionId;
          }
          if (typeof clonedData.workflowProjectionId === 'string') {
            const nextProjectionId = workflowProjectionIdMap.get(clonedData.workflowProjectionId)
              ?? createId('workflow_projection');
            workflowProjectionIdMap.set(clonedData.workflowProjectionId, nextProjectionId);
            clonedData.workflowProjectionId = nextProjectionId;
          }
          delete clonedData.workflowRunId;
          snapshot.blocks.push({
            ...structuredClone(block),
            blockId,
            createdAt,
            data: clonedData,
            parentGroupId: nextParentGroupId,
            position: { x: block.position.x + 36, y: block.position.y + 36 },
            updatedAt: createdAt,
            zIndex: nextZ + index,
          });
        });
        for (const parentGroupId of externalParentGroupIds) {
          expandGroupToContents(snapshot, parentGroupId);
        }
        const copiedEdges = snapshot.edges.flatMap((edge) => {
          const sourceBlockId = idMap.get(edge.sourceBlockId);
          const targetBlockId = idMap.get(edge.targetBlockId);
          return sourceBlockId && targetBlockId
            ? [{
                ...structuredClone(edge),
                edgeId: createId('edge'),
                sourceBlockId,
                targetBlockId,
              }]
            : [];
        });
        snapshot.edges.push(...copiedEdges);
        touchBoard(snapshot);
        return { changed: true, result: { duplicatedBlockIds } };
      });
      return { ...transaction.result, committed: transaction.committed };
    },
  });
}

function deletableRootBlockIds(
  snapshot: BoardSnapshot,
  blockIds: readonly string[],
): string[] {
  return [...new Set(blockIds)].filter((blockId) => {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
    if (
      !block
      || blockLockedByGroup(snapshot, blockId)
      || blockManagedByWorkflowGroup(snapshot, blockId)
    ) return false;
    return block.type !== 'group' || !groupStructureLocked(snapshot, blockId);
  });
}

function providerTaskIds(execution: ExecutionRecord): string[] {
  const modelArk = execution.params?.modelArk;
  if (!modelArk || typeof modelArk !== 'object' || Array.isArray(modelArk)) return [];
  const taskIds = (modelArk as Record<string, unknown>).providerTaskIds;
  return Array.isArray(taskIds)
    ? taskIds.filter((value): value is string => typeof value === 'string')
    : [];
}

function assertScope(snapshot: BoardSnapshot, expected: CanvasHostScopeV1): void {
  if (
    snapshot.project.projectId !== expected.projectId
    || snapshot.board.boardId !== expected.boardId
  ) {
    throw new Error('Block command scope changed before commit.');
  }
}
