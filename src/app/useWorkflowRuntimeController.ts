import type { OperationToast } from '../components/OperationFeedback';
import { reconcileAgentRuntime } from '../core/agentRuntime';
import type { BoardSnapshot } from '../core/types';
import type { WorkflowApprovalDecisionValue } from '../core/workflowGateContracts';
import { decideWorkflowApproval } from '../core/workflowGateRuntime';
import { materializeAcceptedWorkflowOutput } from '../core/workflowOutputArtifactClient';
import { acceptWorkflowStepOutputs, createWorkflowRunForGroup } from '../core/workflowRuntime';
import type { useI18n } from '../i18n';

interface WorkflowRuntimeControllerOptions {
  setOperationToast: (toast: OperationToast | undefined) => void;
  t: ReturnType<typeof useI18n>['t'];
  persistSnapshot: (
    snapshot: BoardSnapshot,
    options?: { requireLocalApi?: boolean },
  ) => Promise<void>;
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useWorkflowRuntimeController(options: WorkflowRuntimeControllerOptions) {
  const { persistSnapshot, setOperationToast, t, updateSnapshot } = options;

  function createWorkflowRun(groupId: string): void {
    try {
      let workflowRunId = '';
      updateSnapshot((current) => {
        const view = createWorkflowRunForGroup(current, groupId);
        workflowRunId = view.record.workflowRunId;
        return current;
      }, { history: true, persist: true });
      setOperationToast({
        id: workflowRunId || `workflow-run:${groupId}`,
        title: t('workflowRuntime.created'),
        body: t('workflowRuntime.createdBody'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: `workflow-run:${groupId}`,
        title: t('workflowRuntime.createFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  }

  async function acceptWorkflowOutput(
    stepRunId: string,
    assetId: string,
    expectedStepRunVersion: number,
  ): Promise<void> {
    try {
      const acceptedSnapshot = updateSnapshot((current) => {
        acceptWorkflowStepOutputs(current, {
          acceptedOutputAssetIds: [assetId],
          expectedStepRunVersion,
          stepRunId,
        });
        reconcileAgentRuntime(current);
        return current;
      }, { history: true });
      await persistSnapshot(acceptedSnapshot, { requireLocalApi: true });
      const materializedSnapshot = await materializeAcceptedWorkflowOutput({
        boardId: acceptedSnapshot.board.boardId,
        projectId: acceptedSnapshot.project.projectId,
        stepRunId,
      });
      updateSnapshot(() => materializedSnapshot, { history: false, persist: false });
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

  function decideWorkflowGate(
    approvalRequestId: string,
    expectedApprovalRequestVersion: number,
    decision: WorkflowApprovalDecisionValue,
  ): void {
    try {
      updateSnapshot((current) => {
        decideWorkflowApproval(current, {
          approvalRequestId,
          decision,
          expectedApprovalRequestVersion,
        });
        reconcileAgentRuntime(current);
        return current;
      }, { history: true, persist: true });
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

  return { acceptWorkflowOutput, createWorkflowRun, decideWorkflowGate };
}
