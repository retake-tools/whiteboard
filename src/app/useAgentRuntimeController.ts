import { useEffect, useRef, type RefObject } from 'react';
import type { OperationToast } from '../components/OperationFeedback';
import {
  attachAgentRunExecution,
  cancelAgentRun,
  createAgentRunForWorkflowRun,
  nextAgentRunExecutionAction,
  pauseAgentRun,
  reconcileAgentRuntime,
  startAgentRun,
} from '../core/agentRuntime';
import type { BoardSnapshot } from '../core/types';
import type { useI18n } from '../i18n';

interface AgentRuntimeControllerOptions {
  runOperation: (blockId: string) => Promise<void>;
  setOperationToast: (toast: OperationToast | undefined) => void;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useAgentRuntimeController(options: AgentRuntimeControllerOptions) {
  const {
    runOperation,
    setOperationToast,
    snapshot,
    snapshotRef,
    t,
    updateSnapshot,
  } = options;
  const runOperationRef = useRef(runOperation);
  const inFlightActionRef = useRef<{ actionKey: string; boardId: string } | undefined>(undefined);
  runOperationRef.current = runOperation;

  const runtimeRevision = [
    snapshot.board.boardId,
    snapshot.board.updatedAt,
    ...(snapshot.agentRuns ?? []).map((run) => `${run.agentRunId}:${run.recordVersion}:${run.status}`),
    ...snapshot.executions.slice(0, 8).map((execution) => `${execution.executionId}:${execution.status}`),
  ].join('|');

  useEffect(() => {
    const scope = snapshotRef.current;
    const runtimeSnapshot = structuredClone(scope);
    const changed = reconcileAgentRuntime(runtimeSnapshot);
    const action = nextAgentRunExecutionAction(runtimeSnapshot);
    if (changed) {
      updateSnapshot(() => runtimeSnapshot, { history: false, persist: true });
    }
    if (!action || inFlightActionRef.current?.actionKey === action.actionKey) return;
    const boardId = runtimeSnapshot.board.boardId;
    const knownExecutionIds = new Set(runtimeSnapshot.executions.map((execution) => execution.executionId));
    inFlightActionRef.current = { actionKey: action.actionKey, boardId };
    void runOperationRef.current(action.operationBlockId).finally(() => {
      if (inFlightActionRef.current?.actionKey === action.actionKey) inFlightActionRef.current = undefined;
      if (snapshotRef.current.board.boardId !== boardId) return;
      updateSnapshot((current) => {
        for (const execution of current.executions) {
          if (
            !knownExecutionIds.has(execution.executionId)
            && execution.params?.operationBlockId === action.operationBlockId
          ) attachAgentRunExecution(current, action.agentRunId, execution.executionId);
        }
        reconcileAgentRuntime(current);
        return current;
      }, { history: false, persist: true });
    });
  }, [runtimeRevision]);

  function createWorkflowAgentRun(workflowRunId: string): void {
    mutateAgentRun('create', (current) => {
      const created = createAgentRunForWorkflowRun(current, workflowRunId);
      startAgentRun(current, created.record.agentRunId);
      return created.record.agentRunId;
    });
  }

  function pause(agentRunId: string): void {
    mutateAgentRun('pause', (current) => pauseAgentRun(current, agentRunId).record.agentRunId);
  }

  function resume(agentRunId: string): void {
    mutateAgentRun('resume', (current) => startAgentRun(current, agentRunId).record.agentRunId);
  }

  function cancel(agentRunId: string): void {
    mutateAgentRun('cancel', (current) => cancelAgentRun(current, agentRunId).record.agentRunId);
  }

  function mutateAgentRun(
    action: 'cancel' | 'create' | 'pause' | 'resume',
    mutate: (snapshot: BoardSnapshot) => string,
  ): void {
    try {
      let agentRunId = '';
      updateSnapshot((current) => {
        agentRunId = mutate(current);
        return current;
      }, { history: true, persist: true });
      setOperationToast({
        id: agentRunId || `agent-run:${action}`,
        title: t(agentActionSuccessKey(action)),
        body: action === 'cancel' ? t('agentRuntime.cancelCurrentExecutionContinues') : undefined,
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: `agent-run:${action}`,
        title: t('agentRuntime.actionFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  }

  return {
    cancelAgentRun: cancel,
    createWorkflowAgentRun,
    pauseAgentRun: pause,
    resumeAgentRun: resume,
  };
}

function agentActionSuccessKey(action: 'cancel' | 'create' | 'pause' | 'resume') {
  if (action === 'cancel') return 'agentRuntime.canceled' as const;
  if (action === 'create') return 'agentRuntime.created' as const;
  if (action === 'pause') return 'agentRuntime.paused' as const;
  return 'agentRuntime.resumed' as const;
}
