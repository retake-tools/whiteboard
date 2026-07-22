import type { RefObject } from 'react';
import { loadBoardSnapshot } from '../core/boardStore';
import { blockLockedByGroup } from '../core/grouping';
import {
  executionConnection,
  resolveExecutionConnectionPreference,
} from '../core/executionProviderPreferences';
import { startTextGeneration } from '../core/textGenerationClient';
import { appendDocumentStream, beginDocumentStream } from '../core/documentStreamStore';
import { subscribeExecutionEvents } from '../core/executionEventClient';
import {
  createDraftTextGenerationOperation,
  executeExistingTextGenerationOperation,
  type TextGenerationLabels,
} from '../core/textOperations';
import type { BlockRecord, BoardSnapshot } from '../core/types';
import type { OperationToast } from '../components/OperationFeedback';
import type { useI18n } from '../i18n';

interface TextGenerationControllerOptions {
  centerWorkflowBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  focusWorkflowBlocks: (blockIds: string[]) => void;
  persistSnapshot: (snapshot: BoardSnapshot, options?: { requireLocalApi?: boolean }) => Promise<void>;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useTextGenerationController(options: TextGenerationControllerOptions) {
  const {
    centerWorkflowBlocks,
    focusWorkflowBlocks,
    persistSnapshot,
    setOperationToast,
    setSelectedBlocks,
    snapshotRef,
    t,
    updateSnapshot,
  } = options;

  function createTextGenerationDraft(): void {
    let workflowBlockIds: string[] = [];
    const nextSnapshot = updateSnapshot((current) => {
      const draft = createDraftTextGenerationOperation(current, {
        ...labels(),
        connectionId: preferredTextConnection(current),
      });
      workflowBlockIds = [draft.promptBlock.blockId, draft.operationBlock.blockId, draft.resultBlock.blockId];
      centerWorkflowBlocks(current, workflowBlockIds);
      return current;
    }, { history: true, persist: true });
    if (workflowBlockIds.length) {
      setSelectedBlocks(nextSnapshot, workflowBlockIds);
      focusWorkflowBlocks(workflowBlockIds);
    }
  }

  async function startTextGenerationOperation(block: BlockRecord): Promise<void> {
    if (
      block.type !== 'operation' ||
      block.data.capabilityId !== 'text.generate' ||
      blockLockedByGroup(snapshotRef.current, block.blockId)
    ) return;
    let executionId = '';
    let connectionId = '';
    let resultBlockId = '';
    try {
      await persistSnapshot(snapshotRef.current, { requireLocalApi: true });
      const queuedSnapshot = updateSnapshot((current) => {
        const currentBlock = current.blocks.find((candidate) => candidate.blockId === block.blockId);
        if (!currentBlock || currentBlock.type !== 'operation') return current;
        const preference = resolveExecutionConnectionPreference({
          capabilityId: 'text.generate',
          explicitConnectionId: typeof currentBlock.data.connectionId === 'string'
            ? currentBlock.data.connectionId
            : undefined,
          initialConnectionId: 'codex-app-server',
          projectId: current.project.projectId,
          useCase: 'text',
        });
        connectionId = preference.connectionId ?? '';
        const connection = executionConnection(connectionId, current.project.projectId);
        if (!connection || !preference.isUsable) throw new Error(t('feedback.connectionUnavailable'));
        const run = executeExistingTextGenerationOperation(current, {
          connection,
          labels: labels(),
          operationBlockId: currentBlock.blockId,
        });
        executionId = run.execution.executionId;
        resultBlockId = run.resultBlock.blockId;
        return current;
      }, { history: true });
      beginDocumentStream(resultBlockId);
      await persistSnapshot(queuedSnapshot, { requireLocalApi: true });
      let finishStream: ((snapshot: BoardSnapshot) => void) | undefined;
      let failStream: ((error: Error) => void) | undefined;
      const streamCompletion = new Promise<BoardSnapshot>((resolve, reject) => {
        finishStream = resolve;
        failStream = reject;
      });
      const unsubscribe = subscribeExecutionEvents({
        projectId: queuedSnapshot.project.projectId,
        boardId: queuedSnapshot.board.boardId,
        executionId,
        onError: () => failStream?.(new Error('Execution event stream disconnected.')),
        onEvent: (event) => {
          if (event.type === 'text.delta') {
            appendDocumentStream(event.resultBlockId, event.delta);
          } else if (event.type === 'execution.snapshot') {
            finishStream?.(event.snapshot);
          } else if (event.type === 'execution.failed') {
            const failedSnapshot = event.snapshot;
            if (failedSnapshot) updateSnapshot(() => failedSnapshot, { history: false, persist: false });
            failStream?.(new Error(event.errorMessage));
          }
        },
      });
      try {
        const started = await startTextGeneration({
          projectId: queuedSnapshot.project.projectId,
          boardId: queuedSnapshot.board.boardId,
          executionId,
          connectionId,
        });
        const runningSnapshot = updateSnapshot(() => started.snapshot, { history: true, persist: false });
        setSelectedBlocks(runningSnapshot, [resultBlockId]);
        setOperationToast({ id: executionId, title: t('feedback.textGenerationStarted'), tone: 'success' });
        try {
          const completedSnapshot = await streamCompletion;
          updateSnapshot(() => completedSnapshot, { history: false, persist: false });
          showTextExecutionResult(executionId, completedSnapshot);
        } catch {
          await pollTextExecution(executionId, runningSnapshot);
        }
      } finally {
        unsubscribe();
      }
    } catch (error) {
      setOperationToast({
        id: executionId || `text-generation:${block.blockId}`,
        title: t('feedback.textGenerationFailed'),
        body: error instanceof Error ? error.message : t('feedback.localApiUnavailable'),
        tone: 'error',
      });
    }
  }

  async function pollTextExecution(executionId: string, scope: BoardSnapshot): Promise<void> {
    while (true) {
      await delay(1_000);
      const latest = await loadBoardSnapshot({
        projectId: scope.project.projectId,
        boardId: scope.board.boardId,
      });
      const execution = latest.executions.find((candidate) => candidate.executionId === executionId);
      if (
        snapshotRef.current.project.projectId === scope.project.projectId &&
        snapshotRef.current.board.boardId === scope.board.boardId
      ) {
        updateSnapshot(() => latest, { history: false, persist: false });
      }
      if (!execution) throw new Error(`Text execution disappeared while waiting: ${executionId}`);
      if (execution.status === 'queued' || execution.status === 'running') continue;
      showTextExecutionResult(executionId, latest);
      return;
    }
  }

  function showTextExecutionResult(executionId: string, snapshot: BoardSnapshot): void {
    const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
    if (!execution) return;
    setOperationToast({
      id: executionId,
      title: t(execution.status === 'succeeded'
        ? 'feedback.textGenerationCompleted'
        : 'feedback.textGenerationFailed'),
      body: execution.status === 'failed' ? execution.errorMessage : undefined,
      tone: execution.status === 'succeeded' ? 'success' : 'error',
    });
  }

  function labels(): TextGenerationLabels {
    return {
      operationTitle: t('operation.generateText.title'),
      promptPlaceholder: t('operationToolbar.promptPlaceholder'),
      promptTitle: t('operationToolbar.prompt'),
      resultTitle: t('operation.generateText.title'),
      waitingBody: t('resultStatus.queued'),
    };
  }

  return { createTextGenerationDraft, startTextGenerationOperation };
}

function preferredTextConnection(snapshot: BoardSnapshot): string | undefined {
  return resolveExecutionConnectionPreference({
    capabilityId: 'text.generate',
    initialConnectionId: 'codex-app-server',
    projectId: snapshot.project.projectId,
    useCase: 'text',
  }).connectionId;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
