import type { RefObject } from 'react';
import type { CanvasTool } from '../components/FloatingToolbar';
import type { OperationToast } from '../components/OperationFeedback';
import { localizedBlockData } from '../core/blockLocalization';
import { createBlockRecord, maxZIndex, touchBoard } from '../core/blockFactory';
import { activeExecutionsForBlockIds, cancelExecution, executionCancellationRequiresConfirmation } from '../core/executionLifecycle';
import {
  blockLockedByGroup,
  createGroupAroundBlocks,
  descendantBlockIds,
  expandGroupToContents,
  fitGroupToChildren,
  groupStructureLocked,
} from '../core/grouping';
import { saveCollapsedGroupIds } from '../core/groupViewState';
import { createId, nowIso } from '../core/id';
import type { BlockType, BoardSnapshot, ExecutionRecord } from '../core/types';
import type { useI18n } from '../i18n';

interface BlockActionsOptions {
  centeredBlockPosition: (size: { width: number; height: number }) => { x: number; y: number };
  collapsedGroupIdsRef: RefObject<string[]>;
  selectedBlockIds: string[];
  selectedBlockIdsRef: RefObject<string[]>;
  setActiveCanvasTool: (value: CanvasTool | ((current: CanvasTool) => CanvasTool)) => void;
  setCollapsedGroupIds: (ids: string[]) => void;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useBlockActions(options: BlockActionsOptions) {
  const {
    centeredBlockPosition,
    collapsedGroupIdsRef,
    selectedBlockIds,
    selectedBlockIdsRef,
    setActiveCanvasTool,
    setCollapsedGroupIds,
    setOperationToast,
    setSelectedBlock,
    setSelectedBlocks,
    snapshotRef,
    t,
    updateSnapshot,
  } = options;

  function addBlock(type: BlockType): void {
    if (type === 'group' && selectedBlockIdsRef.current.length === 0) {
      setActiveCanvasTool((current) => (current === 'group' ? 'pan' : 'group'));
      return;
    }
    let newBlockId = '';
    const nextSnapshot = updateSnapshot((current) => {
      if (type === 'group' && selectedBlockIdsRef.current.length > 0) {
        const group = createGroupAroundBlocks(current, selectedBlockIdsRef.current, { color: 'neutral', kind: 'manual', layoutMode: 'free', title: t('group.defaultTitle') });
        if (!group) return current;
        newBlockId = group.blockId;
        return touchBoard(current);
      }
      const block = createBlockRecord(current, type);
      block.position = centeredBlockPosition(block.size);
      block.data = { ...block.data, ...localizedBlockData(type, t) };
      newBlockId = block.blockId;
      current.blocks.push(block);
      return touchBoard(current);
    }, { persist: true, history: true });
    if (!newBlockId) return;
    setActiveCanvasTool(type === 'group' ? 'pan' : 'select');
    setSelectedBlock(nextSnapshot, newBlockId);
  }

  function deletableRootBlockIds(current: BoardSnapshot, blockIds: readonly string[]): string[] {
    return blockIds.filter((blockId) => {
      const block = current.blocks.find((candidate) => candidate.blockId === blockId);
      if (!block || blockLockedByGroup(current, blockId)) return false;
      return block.type !== 'group' || !groupStructureLocked(current, blockId);
    });
  }

  function deleteBlockIds(blockIds: string[]): void {
    if (blockIds.length === 0) return;
    const initialSnapshot = snapshotRef.current;
    const mutableRootIds = deletableRootBlockIds(initialSnapshot, blockIds);
    if (mutableRootIds.length === 0) return;
    const groupIds = mutableRootIds.filter((blockId) => initialSnapshot.blocks.find((block) => block.blockId === blockId)?.type === 'group');
    const activeExecutions = activeExecutionsForBlockIds(initialSnapshot, [...mutableRootIds, ...descendantBlockIds(initialSnapshot, groupIds)]);
    const hasRunningExecution = executionCancellationRequiresConfirmation(activeExecutions);
    if (hasRunningExecution && !window.confirm(t('feedback.runningExecutionCancelConfirm'))) return;
    let deletedBlockIds: string[] = [];
    let canceledExecutionCount = 0;
    updateSnapshot((current) => {
      const canceledRemovedIds = new Set<string>();
      for (const execution of activeExecutions) {
        const cancellation = cancelExecution(current, execution.executionId);
        if (cancellation.execution?.status !== 'canceled') continue;
        canceledExecutionCount += 1;
        for (const blockId of cancellation.removedBlockIds) canceledRemovedIds.add(blockId);
      }
      const mutableBlockIds = deletableRootBlockIds(current, mutableRootIds);
      const remainingGroupIds = mutableBlockIds.filter((blockId) => current.blocks.find((block) => block.blockId === blockId)?.type === 'group');
      const selectedIds = new Set([...mutableBlockIds, ...descendantBlockIds(current, remainingGroupIds)]);
      deletedBlockIds = [...new Set([...canceledRemovedIds, ...selectedIds])];
      if (selectedIds.size === 0) return current;
      const affectedParentIds = new Set(current.blocks.filter((block) => selectedIds.has(block.blockId) && block.parentGroupId && !selectedIds.has(block.parentGroupId)).map((block) => block.parentGroupId as string));
      current.blocks = current.blocks.filter((block) => !selectedIds.has(block.blockId));
      current.edges = current.edges.filter((edge) => !selectedIds.has(edge.sourceBlockId) && !selectedIds.has(edge.targetBlockId));
      for (const parentGroupId of affectedParentIds) fitGroupToChildren(current, parentGroupId);
      return touchBoard(current);
    }, { persist: true, history: true });
    for (const execution of activeExecutions) {
      if (execution.adapterSnapshot?.adapterId !== 'retake.video.seedance-modelark'
        && execution.adapterSnapshot?.adapterId !== 'retake.video.dreamina-cli') continue;
      window.dispatchEvent(new CustomEvent('retake:cancel-provider-execution', {
        detail: {
          projectId: execution.projectId,
          boardId: execution.boardId,
          executionId: execution.executionId,
          adapterId: execution.adapterSnapshot.adapterId,
          providerTaskIds: providerTaskIds(execution),
        },
      }));
    }
    if (canceledExecutionCount > 0) setOperationToast({ id: `execution-canceled:${Date.now()}`, title: t('feedback.executionCanceled'), body: t(hasRunningExecution ? 'feedback.runningExecutionCanceled' : 'feedback.queuedExecutionCanceled'), tone: 'success' });
    if (deletedBlockIds.length === 0) return;
    const deletedIdSet = new Set(deletedBlockIds);
    const nextCollapsedGroupIds = collapsedGroupIdsRef.current.filter((groupId) => !deletedIdSet.has(groupId));
    if (nextCollapsedGroupIds.length !== collapsedGroupIdsRef.current.length) {
      collapsedGroupIdsRef.current = nextCollapsedGroupIds;
      setCollapsedGroupIds(nextCollapsedGroupIds);
      saveCollapsedGroupIds(snapshotRef.current.project.projectId, snapshotRef.current.board.boardId, nextCollapsedGroupIds);
    }
    setSelectedBlocks(snapshotRef.current, []);
  }

  function deleteSelection(): void { deleteBlockIds(selectedBlockIds); }

  function duplicateSelection(): void {
    if (selectedBlockIds.length === 0) return;
    const newBlockIds: string[] = [];
    const nextSnapshot = updateSnapshot((current) => {
      const selectedGroupIds = selectedBlockIds.filter((blockId) => current.blocks.find((block) => block.blockId === blockId)?.type === 'group');
      const copiedIds = new Set([...selectedBlockIds, ...descendantBlockIds(current, selectedGroupIds)]);
      const selectedBlocks = current.blocks.filter((block) => copiedIds.has(block.blockId));
      const nextZ = maxZIndex(current.blocks) + 1;
      const idMap = new Map(selectedBlocks.map((block) => [block.blockId, createId('block')]));
      const externalParentGroupIds = new Set<string>();
      selectedBlocks.forEach((block, index) => {
        const blockId = idMap.get(block.blockId)!;
        if (selectedBlockIds.includes(block.blockId)) newBlockIds.push(blockId);
        const nextParentGroupId = block.parentGroupId ? idMap.get(block.parentGroupId) ?? block.parentGroupId : undefined;
        if (nextParentGroupId && !idMap.has(block.parentGroupId ?? '')) externalParentGroupIds.add(nextParentGroupId);
        const clonedData = { ...structuredClone(block.data) };
        if (block.type === 'group' && clonedData.groupKind === 'execution_results') { clonedData.groupKind = 'manual'; delete clonedData.groupExecutionId; }
        current.blocks.push({ ...structuredClone(block), blockId, parentGroupId: nextParentGroupId, position: { x: block.position.x + 36, y: block.position.y + 36 }, zIndex: nextZ + index, data: clonedData, createdAt: nowIso(), updatedAt: nowIso() });
      });
      for (const parentGroupId of externalParentGroupIds) expandGroupToContents(current, parentGroupId);
      current.edges.push(...current.edges.flatMap((edge) => {
        const sourceBlockId = idMap.get(edge.sourceBlockId); const targetBlockId = idMap.get(edge.targetBlockId);
        return sourceBlockId && targetBlockId ? [{ ...structuredClone(edge), edgeId: createId('edge'), sourceBlockId, targetBlockId }] : [];
      }));
      return touchBoard(current);
    }, { persist: true, history: true });
    setSelectedBlocks(nextSnapshot, newBlockIds);
  }

  return { addBlock, deleteBlockIds, deleteSelection, duplicateSelection };
}

function providerTaskIds(execution: ExecutionRecord): string[] {
  const modelArk = execution.params?.modelArk;
  if (!modelArk || typeof modelArk !== 'object' || Array.isArray(modelArk)) return [];
  const taskIds = (modelArk as Record<string, unknown>).providerTaskIds;
  return Array.isArray(taskIds) ? taskIds.filter((value): value is string => typeof value === 'string') : [];
}
