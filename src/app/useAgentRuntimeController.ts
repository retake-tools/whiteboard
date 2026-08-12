import { useEffect, useRef, type RefObject } from 'react';
import type { OperationToast } from '../components/OperationFeedback';
import { isRetiredDefinitionError } from '../core/retiredDefinitions';
import { reconcileAgentArtifactTarget } from '../core/agentArtifactTargetClient';
import type { AgentWorkflowGateCompletion } from '../core/agentRuntimeContracts';
import type { BoardSnapshot } from '../core/types';
import { reconcileWorkflowArtifactGates } from '../core/workflowArtifactGateClient';
import type { useI18n } from '../i18n';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';
import type { RunProductCommand } from './useBoardSession';

interface AgentRuntimeControllerOptions {
  runOperation: (blockId: string) => Promise<void>;
  runProductCommand?: RunProductCommand;
  setOperationToast: (toast: OperationToast | undefined) => void;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
}

export function useAgentRuntimeController(options: AgentRuntimeControllerOptions) {
  const {
    runOperation,
    runProductCommand,
    setOperationToast,
    snapshot,
    snapshotRef,
    t,
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
    if (!runProductCommand) return;
    void runProductCommand(
      (commands) => commands.agent.reconcileRuntime(),
      { history: false },
    ).then(({ actions, boardId }) => {
      if (snapshotRef.current.board.boardId !== boardId) return;
      for (const action of actions) {
        // The same Run stays single-flight while its new Execution is being
        // persisted and attached, but a different AgentRun may dispatch in
        // parallel on the same Board.
        if (inFlightActionsRef.current.has(action.agentRunId)) continue;
        inFlightActionsRef.current.set(action.agentRunId, { actionKey: action.actionKey, boardId });
        const settleAction = async (error?: unknown): Promise<void> => {
          if (inFlightActionsRef.current.get(action.agentRunId)?.actionKey === action.actionKey) {
            inFlightActionsRef.current.delete(action.agentRunId);
          }
          if (snapshotRef.current.board.boardId !== boardId) return;
          try {
            await runProductCommand(
              (commands) => commands.agent.settleExecution({
                agentRunId: action.agentRunId,
                errorMessage: error
                  ? error instanceof Error ? error.message : String(error)
                  : undefined,
                knownExecutionIds: action.knownExecutionIds,
                operationBlockId: action.operationBlockId,
                stopReason: isRetiredDefinitionError(error)
                  ? 'retired_definition'
                  : 'operation_execution_missing',
              }),
              { history: false },
            );
          } catch (settleError) {
            setOperationToast({
              id: `agent-run:settle:${action.agentRunId}`,
              title: t('agentRuntime.actionFailed'),
              body: settleError instanceof Error ? settleError.message : undefined,
              tone: 'error',
            });
          }
        };
        void runOperationRef.current(action.operationBlockId).then(
          () => settleAction(),
          (error) => settleAction(error),
        );
      }
    }).catch((error) => {
      setOperationToast({
        id: `agent-runtime:reconcile:${snapshot.board.boardId}`,
        title: t('agentRuntime.actionFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    });
  }, [runtimeRevision]);

  async function createWorkflowAgentRun(workflowRunId: string): Promise<string | undefined> {
    return createAgentRun((commands) => commands.agent.createWorkflowRun({ workflowRunId }));
  }

  async function createWorkflowSliceAgentRun(
    workflowRunId: string,
    stepRunId: string,
  ): Promise<string | undefined> {
    return createAgentRun((commands) => commands.agent.createWorkflowSlice({
      stepRunId,
      workflowRunId,
    }));
  }

  async function createWorkflowArtifactSliceAgentRun(
    workflowRunId: string,
    workflowOutputSlotId: string,
  ): Promise<void> {
    try {
      const created = await requireProductCommands(runProductCommand)(
        (commands) => commands.agent.createWorkflowArtifactSlice({
          workflowOutputSlotId,
          workflowRunId,
        }),
        {
          afterCommit: ({ result }) => reconcileAgentArtifactTarget({
            agentRunId: result.agentRunId,
            boardId: result.boardId,
            projectId: result.projectId,
          }),
          history: true,
        },
      );
      setOperationToast({
        id: created.agentRunId,
        title: t('agentRuntime.created'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: 'agent-run:create-artifact-slice',
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
    try {
      const created = await requireProductCommands(runProductCommand)(
        (commands) => commands.agent.createWorkflowStageSlice({ stageId, workflowRunId }),
        {
          afterCommit: ({ result }) => reconcileAgentArtifactTarget({
            agentRunId: result.agentRunId,
            boardId: result.boardId,
            projectId: result.projectId,
          }),
          history: true,
        },
      );
      setOperationToast({
        id: created.agentRunId,
        title: t('agentRuntime.created'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: 'agent-run:create-stage-slice',
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
    try {
      const created = await requireProductCommands(runProductCommand)(
        (commands) => commands.agent.createWorkflowGateSlice({
          completion,
          gateId,
          workflowRunId,
        }),
        {
          afterCommit: ({ result }) => reconcileWorkflowArtifactGates({
            boardId: result.boardId,
            projectId: result.projectId,
            workflowRunId,
          }),
          history: true,
        },
      );
      setOperationToast({
        id: created.agentRunId,
        title: t('agentRuntime.created'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: 'agent-run:create-gate-slice',
        title: t('agentRuntime.actionFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  }

  function pause(agentRunId: string): void {
    void persistAgentRunControl('pause', agentRunId);
  }

  function resume(agentRunId: string): void {
    void persistAgentRunControl('resume', agentRunId);
  }

  function cancel(agentRunId: string): void {
    void persistAgentRunControl('cancel', agentRunId);
  }

  async function retry(agentRunId: string): Promise<void> {
    await persistAgentRunControl('retry', agentRunId);
  }

  async function persistAgentRunControl(
    action: 'cancel' | 'pause' | 'resume' | 'retry',
    requestedAgentRunId: string,
  ): Promise<void> {
    try {
      const { agentRunId } = await requireProductCommands(runProductCommand)(
        (commands) => commands.agent.control({ action, agentRunId: requestedAgentRunId }),
        { history: true },
      );
      setOperationToast({
        id: agentRunId,
        title: t(agentActionSuccessKey(action)),
        body: action === 'cancel' ? t('agentRuntime.cancelCurrentExecutionContinues') : undefined,
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: requestedAgentRunId || `agent-run:${action}`,
        title: t('agentRuntime.actionFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  }

  async function createAgentRun(
    create: (commands: WhiteboardProductCommandsV1) => Promise<{ agentRunId: string }>,
  ): Promise<string | undefined> {
    try {
      const { agentRunId } = await requireProductCommands(runProductCommand)(create, { history: true });
      setOperationToast({
        id: agentRunId,
        title: t(agentActionSuccessKey('create')),
        tone: 'success',
      });
      return agentRunId;
    } catch (error) {
      setOperationToast({
        id: 'agent-run:create',
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

function requireProductCommands(
  runProductCommand: AgentRuntimeControllerOptions['runProductCommand'],
): NonNullable<AgentRuntimeControllerOptions['runProductCommand']> {
  if (!runProductCommand) {
    throw new Error('Whiteboard Agent command facade is unavailable.');
  }
  return runProductCommand;
}

function agentActionSuccessKey(action: 'cancel' | 'create' | 'pause' | 'resume' | 'retry') {
  if (action === 'cancel') return 'agentRuntime.canceled' as const;
  if (action === 'create') return 'agentRuntime.created' as const;
  if (action === 'pause') return 'agentRuntime.paused' as const;
  return 'agentRuntime.resumed' as const;
}
