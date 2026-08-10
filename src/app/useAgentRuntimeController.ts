import { useEffect, useRef, type RefObject } from 'react';
import type { OperationToast } from '../components/OperationFeedback';
import { supersedeResolvedAgentRunBlockerProposals } from '../core/agentChangeApplication';
import {
  attachAgentRunExecution,
  cancelAgentRun,
  createAgentRunForWorkflowArtifactSlice,
  createAgentRunForWorkflowGateSlice,
  createAgentRunForWorkflowSlice,
  createAgentRunForWorkflowStageSlice,
  createAgentRunForWorkflowRun,
  markAgentRunNeedsAttention,
  nextAgentRunExecutionActions,
  pauseAgentRun,
  reconcileAgentRuntime,
  retryAgentRunAfterMissingExecution,
  startAgentRun,
} from '../core/agentRuntime';
import { isRetiredDefinitionError } from '../core/retiredDefinitions';
import { reconcileAgentArtifactTarget } from '../core/agentArtifactTargetClient';
import type { AgentWorkflowGateCompletion } from '../core/agentRuntimeContracts';
import type { BoardSnapshot } from '../core/types';
import { reconcileWorkflowArtifactGates } from '../core/workflowArtifactGateClient';
import type { useI18n } from '../i18n';

interface AgentRuntimeControllerOptions {
  runOperation: (blockId: string) => Promise<void>;
  persistSnapshot: (
    snapshot: BoardSnapshot,
    options?: { requireLocalApi?: boolean },
  ) => Promise<void>;
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
    persistSnapshot,
    setOperationToast,
    snapshot,
    snapshotRef,
    t,
    updateSnapshot,
  } = options;
  const runOperationRef = useRef(runOperation);
  const inFlightActionsRef = useRef(new Map<string, { actionKey: string; boardId: string }>());
  runOperationRef.current = runOperation;

  const runtimeRevision = [
    snapshot.board.boardId,
    snapshot.board.updatedAt,
    ...(snapshot.agentRuns ?? []).map((run) => `${run.agentRunId}:${run.recordVersion}:${run.status}`),
    ...snapshot.executions.map((execution) =>
      `${execution.executionId}:${execution.recordVersion ?? 0}:${execution.status}`),
  ].join('|');

  useEffect(() => {
    const scope = snapshotRef.current;
    const runtimeSnapshot = structuredClone(scope);
    const changed = reconcileAgentRuntime(runtimeSnapshot);
    const proposalsChanged = supersedeResolvedAgentRunBlockerProposals(runtimeSnapshot);
    const actions = nextAgentRunExecutionActions(runtimeSnapshot);
    if (changed || proposalsChanged) {
      updateSnapshot(() => runtimeSnapshot, { history: false, persist: true });
    }
    const boardId = runtimeSnapshot.board.boardId;
    for (const action of actions) {
      // The same Run stays single-flight while its new Execution is being
      // persisted and attached, but a different AgentRun may dispatch in
      // parallel on the same Board.
      if (inFlightActionsRef.current.has(action.agentRunId)) continue;
      const knownExecutionIds = new Set(
        runtimeSnapshot.executions.map((execution) => execution.executionId),
      );
      inFlightActionsRef.current.set(action.agentRunId, { actionKey: action.actionKey, boardId });
      const settleAction = (error?: unknown): void => {
        if (inFlightActionsRef.current.get(action.agentRunId)?.actionKey === action.actionKey) {
          inFlightActionsRef.current.delete(action.agentRunId);
        }
        if (snapshotRef.current.board.boardId !== boardId) return;
        updateSnapshot((current) => {
          let attachedExecution = false;
          for (const execution of current.executions) {
            if (
              !knownExecutionIds.has(execution.executionId)
              && execution.params?.operationBlockId === action.operationBlockId
            ) {
              attachAgentRunExecution(current, action.agentRunId, execution.executionId);
              attachedExecution = true;
            }
          }
          if (!attachedExecution) {
            markAgentRunNeedsAttention(
              current,
              action.agentRunId,
              error
                ? error instanceof Error ? error.message : String(error)
                : 'Operation returned without creating an Execution.',
              isRetiredDefinitionError(error)
                ? 'retired_definition'
                : 'operation_execution_missing',
            );
          }
          reconcileAgentRuntime(current);
          supersedeResolvedAgentRunBlockerProposals(current);
          return current;
        }, { history: false, persist: true });
      };
      void runOperationRef.current(action.operationBlockId).then(
        () => settleAction(),
        (error) => settleAction(error),
      );
    }
  }, [runtimeRevision]);

  function createWorkflowAgentRun(workflowRunId: string): string | undefined {
    return mutateAgentRun('create', (current) => {
      const created = createAgentRunForWorkflowRun(current, workflowRunId);
      startAgentRun(current, created.record.agentRunId);
      return created.record.agentRunId;
    });
  }

  function createWorkflowSliceAgentRun(
    workflowRunId: string,
    stepRunId: string,
  ): string | undefined {
    return mutateAgentRun('create', (current) => {
      const created = createAgentRunForWorkflowSlice(current, workflowRunId, stepRunId);
      startAgentRun(current, created.record.agentRunId);
      return created.record.agentRunId;
    });
  }

  async function createWorkflowArtifactSliceAgentRun(
    workflowRunId: string,
    workflowOutputSlotId: string,
  ): Promise<void> {
    let agentRunId = '';
    try {
      const createdSnapshot = updateSnapshot((current) => {
        const created = createAgentRunForWorkflowArtifactSlice(
          current,
          workflowRunId,
          workflowOutputSlotId,
        );
        startAgentRun(current, created.record.agentRunId);
        agentRunId = created.record.agentRunId;
        return current;
      }, { history: true });
      await persistSnapshot(createdSnapshot, { requireLocalApi: true });
      const reconciled = await reconcileAgentArtifactTarget({
        agentRunId,
        boardId: createdSnapshot.board.boardId,
        projectId: createdSnapshot.project.projectId,
      });
      updateSnapshot(() => reconciled, { history: false, persist: false });
      setOperationToast({
        id: agentRunId,
        title: t('agentRuntime.created'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: agentRunId || 'agent-run:create-artifact-slice',
        title: t('agentRuntime.actionFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  }

  async function createWorkflowStageSliceAgentRun(
    workflowRunId: string,
    stageId: string,
  ): Promise<void> {
    let agentRunId = '';
    try {
      const createdSnapshot = updateSnapshot((current) => {
        const created = createAgentRunForWorkflowStageSlice(
          current,
          workflowRunId,
          stageId,
        );
        startAgentRun(current, created.record.agentRunId);
        agentRunId = created.record.agentRunId;
        return current;
      }, { history: true });
      await persistSnapshot(createdSnapshot, { requireLocalApi: true });
      const reconciled = await reconcileAgentArtifactTarget({
        agentRunId,
        boardId: createdSnapshot.board.boardId,
        projectId: createdSnapshot.project.projectId,
      });
      updateSnapshot(() => reconciled, { history: false, persist: false });
      setOperationToast({
        id: agentRunId,
        title: t('agentRuntime.created'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: agentRunId || 'agent-run:create-stage-slice',
        title: t('agentRuntime.actionFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  }

  async function createWorkflowGateSliceAgentRun(
    workflowRunId: string,
    gateId: string,
    completion: AgentWorkflowGateCompletion,
  ): Promise<void> {
    let agentRunId = '';
    try {
      const createdSnapshot = updateSnapshot((current) => {
        const created = createAgentRunForWorkflowGateSlice(
          current,
          workflowRunId,
          gateId,
          completion,
        );
        startAgentRun(current, created.record.agentRunId);
        agentRunId = created.record.agentRunId;
        return current;
      }, { history: true });
      await persistSnapshot(createdSnapshot, { requireLocalApi: true });
      const reconciled = await reconcileWorkflowArtifactGates({
        boardId: createdSnapshot.board.boardId,
        projectId: createdSnapshot.project.projectId,
        workflowRunId,
      });
      updateSnapshot(() => reconciled, { history: false, persist: false });
      setOperationToast({
        id: agentRunId,
        title: t('agentRuntime.created'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: agentRunId || 'agent-run:create-gate-slice',
        title: t('agentRuntime.actionFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  }

  function pause(agentRunId: string): void {
    void persistAgentRunControl(
      'pause',
      (current) => pauseAgentRun(current, agentRunId).record.agentRunId,
    );
  }

  function resume(agentRunId: string): void {
    void persistAgentRunControl(
      'resume',
      (current) => startAgentRun(current, agentRunId).record.agentRunId,
    );
  }

  function cancel(agentRunId: string): void {
    void persistAgentRunControl(
      'cancel',
      (current) => cancelAgentRun(current, agentRunId).record.agentRunId,
    );
  }

  async function retry(agentRunId: string): Promise<void> {
    await persistAgentRunControl(
      'retry',
      (current) => retryAgentRunAfterMissingExecution(current, agentRunId).record.agentRunId,
    );
  }

  async function persistAgentRunControl(
    action: 'cancel' | 'pause' | 'resume' | 'retry',
    mutate: (snapshot: BoardSnapshot) => string,
  ): Promise<void> {
    let agentRunId = '';
    try {
      const nextSnapshot = updateSnapshot((current) => {
        agentRunId = mutate(current);
        supersedeResolvedAgentRunBlockerProposals(current);
        return current;
      }, { history: true });
      await persistSnapshot(nextSnapshot, { requireLocalApi: true });
      setOperationToast({
        id: agentRunId || `agent-run:${action}`,
        title: t(agentActionSuccessKey(action)),
        body: action === 'cancel' ? t('agentRuntime.cancelCurrentExecutionContinues') : undefined,
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: agentRunId || `agent-run:${action}`,
        title: t('agentRuntime.actionFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  }

  function mutateAgentRun(
    action: 'create',
    mutate: (snapshot: BoardSnapshot) => string,
  ): string | undefined {
    try {
      let agentRunId = '';
      updateSnapshot((current) => {
        agentRunId = mutate(current);
        return current;
      }, { history: true, persist: true });
      setOperationToast({
        id: agentRunId || `agent-run:${action}`,
        title: t(agentActionSuccessKey(action)),
        tone: 'success',
      });
      return agentRunId;
    } catch (error) {
      setOperationToast({
        id: `agent-run:${action}`,
        title: t('agentRuntime.actionFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
      return undefined;
    }
  }

  return {
    cancelAgentRun: cancel,
    createWorkflowArtifactSliceAgentRun,
    createWorkflowAgentRun,
    createWorkflowGateSliceAgentRun,
    createWorkflowSliceAgentRun,
    createWorkflowStageSliceAgentRun,
    pauseAgentRun: pause,
    resumeAgentRun: resume,
    retryAgentRun: retry,
  };
}

function agentActionSuccessKey(action: 'cancel' | 'create' | 'pause' | 'resume' | 'retry') {
  if (action === 'cancel') return 'agentRuntime.canceled' as const;
  if (action === 'create') return 'agentRuntime.created' as const;
  if (action === 'pause') return 'agentRuntime.paused' as const;
  return 'agentRuntime.resumed' as const;
}
