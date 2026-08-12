import type { OperationToast } from '../components/OperationFeedback';
import type { BoardSnapshot } from '../core/types';
import type { WorkflowApprovalDecisionValue } from '../core/workflowGateContracts';
import { materializeAcceptedWorkflowOutput } from '../core/workflowOutputArtifactClient';
import { reconcileAgentArtifactTarget } from '../core/agentArtifactTargetClient';
import type { useI18n } from '../i18n';
import type { RunProductCommand } from './useBoardSession';

interface WorkflowRuntimeControllerOptions {
  adoptDurableSnapshot: (snapshot: BoardSnapshot) => void;
  getCurrentSnapshot: () => BoardSnapshot;
  runProductCommand?: RunProductCommand;
  setOperationToast: (toast: OperationToast | undefined) => void;
  t: ReturnType<typeof useI18n>['t'];
}

export function useWorkflowRuntimeController(options: WorkflowRuntimeControllerOptions) {
  const {
    adoptDurableSnapshot,
    getCurrentSnapshot,
    runProductCommand,
    setOperationToast,
    t,
  } = options;

  async function createWorkflowRun(groupId: string): Promise<string | undefined> {
    try {
      const created = await requireProductCommands(runProductCommand)(
        (commands) => commands.workflow.createRun({ groupId }),
        { history: true },
      );
      setOperationToast({
        id: created.workflowRunId,
        title: t('workflowRuntime.created'),
        body: t('workflowRuntime.createdBody'),
        tone: 'success',
      });
      return created.workflowRunId;
    } catch (error) {
      setOperationToast({
        id: `workflow-run:${groupId}`,
        title: t('workflowRuntime.createFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
      return undefined;
    }
  }

  async function acceptWorkflowOutput(
    stepRunId: string,
    assetId: string,
    expectedStepRunVersion: number,
  ): Promise<void> {
    try {
      await requireProductCommands(runProductCommand)(
        (commands) => commands.workflow.acceptOutput({
          assetId,
          expectedStepRunVersion,
          stepRunId,
        }),
        {
          afterCommit: ({ snapshot }) => materializeAcceptedWorkflowOutput({
            boardId: snapshot.board.boardId,
            projectId: snapshot.project.projectId,
            stepRunId,
          }),
          history: true,
        },
      );
      setOperationToast({
        id: `workflow-output:${stepRunId}:${assetId}`,
        title: t('workflowRuntime.outputSelected'),
        body: t('workflowRuntime.outputSelectedBody'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: `workflow-output:${stepRunId}:${assetId}`,
        title: t('workflowRuntime.outputSelectionFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  }

  async function decideWorkflowGate(
    approvalRequestId: string,
    expectedApprovalRequestVersion: number,
    decision: WorkflowApprovalDecisionValue,
  ): Promise<void> {
    try {
      await requireProductCommands(runProductCommand)(
        (commands) => commands.workflow.decideGate({
          approvalRequestId,
          decision,
          expectedApprovalRequestVersion,
        }),
        {
          afterCommit: ({ result: decided, snapshot }) => decided.workflowRunId
            ? reconcileAgentArtifactTarget({
                boardId: snapshot.board.boardId,
                projectId: snapshot.project.projectId,
                workflowRunId: decided.workflowRunId,
              })
            : Promise.resolve(snapshot),
          history: true,
        },
      );
      setOperationToast({
        id: `workflow-approval:${approvalRequestId}`,
        title: t(decision === 'approve'
          ? 'workflowRuntime.gateApproved'
          : 'workflowRuntime.gateRejected'),
        body: t('workflowRuntime.gateDecisionBody'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: `workflow-approval:${approvalRequestId}`,
        title: t('workflowRuntime.gateDecisionFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  }

  async function prepareWorkflowReview(input: {
    boardId: string;
    projectId: string;
    stepRunId: string;
  }): Promise<void> {
    try {
      const reconciled = await materializeAcceptedWorkflowOutput({
        boardId: input.boardId,
        projectId: input.projectId,
        stepRunId: input.stepRunId,
      });
      adoptDurableSnapshot(reconciled);
    } catch (error) {
      setOperationToast({
        id: `workflow-review:${input.stepRunId}`,
        title: t('agentWorkspace.workflowAttentionPrepareReviewFailed'),
        body: t('agentWorkspace.workflowAttentionPrepareReviewFailedBody'),
        tone: 'error',
      });
      throw error;
    }
  }

  return {
    acceptWorkflowOutput,
    createWorkflowRun,
    decideWorkflowGate,
    prepareWorkflowReview,
  };
}

function requireProductCommands(
  runProductCommand: WorkflowRuntimeControllerOptions['runProductCommand'],
): NonNullable<WorkflowRuntimeControllerOptions['runProductCommand']> {
  if (!runProductCommand) {
    throw new Error('Whiteboard Workflow command facade is unavailable.');
  }
  return runProductCommand;
}
