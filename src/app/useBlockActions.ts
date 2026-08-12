import type { RefObject } from 'react';
import type { CanvasTool } from '../components/FloatingToolbar';
import type { OperationToast } from '../components/OperationFeedback';
import { localizedBlockData } from '../core/blockLocalization';
import { activeExecutionsForBlockIds, executionCancellationRequiresConfirmation } from '../core/executionLifecycle';
import {
  blockLockedByGroup,
  blockManagedByWorkflowGroup,
  descendantBlockIds,
  groupStructureLocked,
} from '../core/grouping';
import { saveCollapsedGroupIds } from '../core/groupViewState';
import type { BlockType, BoardSnapshot } from '../core/types';
import type { useI18n } from '../i18n';
import type { CanvasHostCommandsV1 } from '../host-kit';
import { defaultBlockSize } from '../core/blockSizing';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';

interface BlockActionsOptions {
  centeredBlockPosition: (size: { width: number; height: number }) => { x: number; y: number };
  collapsedGroupIdsRef: RefObject<string[]>;
  selectedBlockIds: string[];
  selectedBlockIdsRef: RefObject<string[]>;
  runHostCommand?: <Result>(
    operation: (commands: CanvasHostCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: {
      history?: boolean;
      shouldKeepHistory?: (result: Result) => boolean;
      syncFlow?: boolean;
    },
  ) => Promise<Result>;
  setActiveCanvasTool: (value: CanvasTool | ((current: CanvasTool) => CanvasTool)) => void;
  setCollapsedGroupIds: (ids: string[]) => void;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
}

export function useBlockActions(options: BlockActionsOptions) {
  const {
    centeredBlockPosition,
    collapsedGroupIdsRef,
    selectedBlockIds,
    selectedBlockIdsRef,
    runHostCommand,
    runProductCommand,
    setActiveCanvasTool,
    setCollapsedGroupIds,
    setOperationToast,
    setSelectedBlock,
    setSelectedBlocks,
    snapshotRef,
    t,
  } = options;

  function addBlock(type: BlockType): void {
    if (type === 'group' && selectedBlockIdsRef.current.length === 0) {
      setActiveCanvasTool((current) => (current === 'group' ? 'pan' : 'group'));
      return;
    }
    const executeHostCommand = requireHostCommands(runHostCommand);
    if (type === 'group') {
      setActiveCanvasTool('pan');
      void executeHostCommand(
        (commands) => commands.createGroup({
          blockIds: selectedBlockIdsRef.current,
          color: 'neutral',
          layoutMode: 'free',
          title: t('group.defaultTitle'),
        }),
        { history: true },
      ).then((group) => {
        setSelectedBlock(snapshotRef.current, group.blockId);
      }).catch((error: unknown) => {
        console.error('Canvas Group creation failed.', error);
        setOperationToast({
          body: error instanceof Error ? error.message : String(error),
          id: `group-create-failed:${Date.now()}`,
          title: t('feedback.handoffUnavailable'),
          tone: 'error',
        });
      });
      return;
    }
    const size = defaultBlockSize(type);
    const position = centeredBlockPosition(size);
    setActiveCanvasTool('select');
    void executeHostCommand(
      (commands) => commands.createBlock({
        data: localizedBlockData(type, t),
        position,
        size,
        type,
      }),
      { history: true },
    ).then((block) => {
      setSelectedBlock(snapshotRef.current, block.blockId);
    }).catch((error: unknown) => {
      console.error('Canvas Block creation failed.', error);
      setOperationToast({
        body: error instanceof Error ? error.message : String(error),
        id: `block-create-failed:${Date.now()}`,
        title: t('feedback.handoffUnavailable'),
        tone: 'error',
      });
    });
  }

  function deletableRootBlockIds(current: BoardSnapshot, blockIds: readonly string[]): string[] {
    return blockIds.filter((blockId) => {
      const block = current.blocks.find((candidate) => candidate.blockId === blockId);
      if (
        !block
        || blockLockedByGroup(current, blockId)
        || blockManagedByWorkflowGroup(current, blockId)
      ) return false;
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
    const canUseSimpleHostRemoval = Boolean(
      runHostCommand
      && groupIds.length === 0
      && activeExecutions.length === 0
      && mutableRootIds.every((blockId) => {
        const block = initialSnapshot.blocks.find((candidate) => candidate.blockId === blockId);
        return block && !block.parentGroupId;
      }),
    );
    if (canUseSimpleHostRemoval && runHostCommand) {
      void runHostCommand(
        (commands) => commands.removeBlocks({ blockIds: mutableRootIds }),
        { history: true },
      ).then(() => {
        setSelectedBlocks(snapshotRef.current, []);
      }).catch((error: unknown) => {
        console.error('Canvas Block removal failed.', error);
        setOperationToast({
          body: error instanceof Error ? error.message : String(error),
          id: `block-remove-failed:${Date.now()}`,
          title: t('feedback.handoffUnavailable'),
          tone: 'error',
        });
      });
      return;
    }
    void requireProductCommands(runProductCommand)(
      (commands) => commands.block.delete({
        blockIds: mutableRootIds,
        expectedScope: scopeFor(initialSnapshot),
      }),
      { history: true, shouldKeepHistory: (result) => result.committed },
    ).then((result) => {
      for (const execution of result.canceledExecutions) {
        if (execution.adapterId !== 'retake.video.seedance-modelark'
          && execution.adapterId !== 'retake.video.dreamina-cli') continue;
        window.dispatchEvent(new CustomEvent('retake:cancel-provider-execution', {
          detail: execution,
        }));
      }
      if (result.canceledExecutions.length > 0) setOperationToast({ id: `execution-canceled:${Date.now()}`, title: t('feedback.executionCanceled'), body: t(hasRunningExecution ? 'feedback.runningExecutionCanceled' : 'feedback.queuedExecutionCanceled'), tone: 'success' });
      if (result.deletedBlockIds.length === 0) return;
      const deletedIdSet = new Set(result.deletedBlockIds);
      const nextCollapsedGroupIds = collapsedGroupIdsRef.current.filter((groupId) => !deletedIdSet.has(groupId));
      if (nextCollapsedGroupIds.length !== collapsedGroupIdsRef.current.length) {
        collapsedGroupIdsRef.current = nextCollapsedGroupIds;
        setCollapsedGroupIds(nextCollapsedGroupIds);
        saveCollapsedGroupIds(snapshotRef.current.project.projectId, snapshotRef.current.board.boardId, nextCollapsedGroupIds);
      }
      setSelectedBlocks(snapshotRef.current, []);
    }).catch((error: unknown) => reportBlockCommandFailure('delete', error));
  }

  function deleteSelection(): void { deleteBlockIds(selectedBlockIds); }

  function duplicateSelection(): void {
    if (selectedBlockIds.length === 0) return;
    if (selectedBlockIds.some((blockId) => blockManagedByWorkflowGroup(snapshotRef.current, blockId))) return;
    const current = snapshotRef.current;
    void requireProductCommands(runProductCommand)(
      (commands) => commands.block.duplicate({
        blockIds: selectedBlockIds,
        expectedScope: scopeFor(current),
      }),
      { history: true, shouldKeepHistory: (result) => result.committed },
    ).then((result) => {
      if (result.duplicatedBlockIds.length > 0) {
        setSelectedBlocks(snapshotRef.current, result.duplicatedBlockIds);
      }
    }).catch((error: unknown) => reportBlockCommandFailure('duplicate', error));
  }

  function reportBlockCommandFailure(action: string, error: unknown): void {
    console.error(`Canvas Block ${action} failed.`, error);
    setOperationToast({
      body: error instanceof Error ? error.message : String(error),
      id: `block-${action}-failed:${Date.now()}`,
      title: t('feedback.handoffUnavailable'),
      tone: 'error',
    });
  }

  return { addBlock, deleteBlockIds, deleteSelection, duplicateSelection };
}

function requireHostCommands(
  runHostCommand: BlockActionsOptions['runHostCommand'],
): NonNullable<BlockActionsOptions['runHostCommand']> {
  if (!runHostCommand) throw new Error('Canvas Host command facade is unavailable.');
  return runHostCommand;
}

function requireProductCommands(
  runProductCommand: BlockActionsOptions['runProductCommand'],
): NonNullable<BlockActionsOptions['runProductCommand']> {
  if (!runProductCommand) throw new Error('Whiteboard product command facade is unavailable.');
  return runProductCommand;
}

function scopeFor(snapshot: BoardSnapshot) {
  return {
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
  };
}
