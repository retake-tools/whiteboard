import type { AgentRunStatus } from './agentRuntimeContracts';
import type { AgentSessionRecord } from './agentSessionContracts';
import type { BoardSnapshot } from './types';

const activeStatuses = new Set<AgentRunStatus>([
  'queued',
  'running',
  'waiting_input',
  'waiting_selection',
  'waiting_approval',
  'paused',
  'needs_attention',
]);

export interface AgentTaskOverviewItem {
  completedSteps?: number;
  currentStepTitle?: string;
  isActive: boolean;
  runStatus?: AgentRunStatus;
  session: AgentSessionRecord;
  taskTitle?: string;
  totalSteps?: number;
}

export function agentTaskOverviewForBoard(
  snapshot: BoardSnapshot,
  sessions: readonly AgentSessionRecord[],
): AgentTaskOverviewItem[] {
  const runsById = new Map((snapshot.agentRuns ?? []).map((run) => [run.agentRunId, run]));
  const workflowRunsById = new Map(
    (snapshot.workflowRuns ?? []).map((run) => [run.workflowRunId, run]),
  );
  const stepsById = new Map(
    (snapshot.workflowStepRuns ?? []).map((step) => [step.stepRunId, step]),
  );
  const blocksById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));

  return sessions.map((session) => {
    const run = session.activeAgentRunId ? runsById.get(session.activeAgentRunId) : undefined;
    if (!run) return { isActive: false, session };
    if (run.target.kind === 'capability') {
      const operation = blocksById.get(run.target.operationBlockId);
      return {
        currentStepTitle: stringValue(operation?.data.title),
        isActive: activeStatuses.has(run.status),
        runStatus: run.status,
        session,
        taskTitle: stringValue(operation?.data.title),
      };
    }

    const workflowRun = workflowRunsById.get(run.target.workflowRunId);
    const group = workflowRun ? blocksById.get(workflowRun.workflowProjectionId) : undefined;
    const stepRuns = workflowRun
      ? workflowRun.stepRunIds.map((stepRunId) => stepsById.get(stepRunId)).filter(Boolean)
      : [];
    const currentStep = stepRuns.find((step) =>
      step?.operationBlockId === run.currentOperationBlockId,
    ) ?? stepRuns.find((step) => workflowRun?.currentStepIds.includes(step?.stepId ?? ''));
    const currentOperation = currentStep ? blocksById.get(currentStep.operationBlockId) : undefined;
    return {
      completedSteps: stepRuns.filter((step) => step?.status === 'succeeded').length,
      currentStepTitle: stringValue(currentOperation?.data.title),
      isActive: activeStatuses.has(run.status),
      runStatus: run.status,
      session,
      taskTitle:
        stringValue(group?.data.title)
        ?? stringValue(group?.data.workflowTitle)
        ?? run.target.workflowDefinitionLock.workflowId,
      totalSteps: stepRuns.length,
    };
  });
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
