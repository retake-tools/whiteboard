import type { AgentRunRecord } from './agentRuntimeContracts';
import type { BoardSnapshot } from './types';
import type {
  WorkflowRunStatus,
  WorkflowStepRunFreshness,
  WorkflowStepRunStatus,
} from './workflowRuntimeContracts';

export interface WorkflowRunExperienceStepView {
  executionCount: number;
  freshness: WorkflowStepRunFreshness;
  label: string;
  operationBlockId: string;
  role: 'current' | 'next' | 'blocked' | 'done' | 'pending';
  status: WorkflowStepRunStatus;
  stepId: string;
  stepRunId: string;
}

export interface WorkflowRunExperienceItemView {
  artifactRevisionCount: number;
  blockedStepCount: number;
  completedStepCount: number;
  currentStepCount: number;
  executionCount: number;
  gateCount: number;
  gateWaitingCount: number;
  isActiveAgentRunTarget: boolean;
  label: string;
  nextStepCount: number;
  status: WorkflowRunStatus;
  steps: WorkflowRunExperienceStepView[];
  totalStepCount: number;
  updatedAt: string;
  workflowRunId: string;
  workflowVersion: string;
}

export interface WorkflowRunExperienceView {
  activeCount: number;
  attentionCount: number;
  defaultWorkflowRunId?: string;
  runs: WorkflowRunExperienceItemView[];
}

const attentionStatuses = new Set<WorkflowRunStatus>([
  'failed',
  'needs_attention',
  'waiting_approval',
  'waiting_input',
  'waiting_selection',
]);

const activeStatuses = new Set<WorkflowRunStatus>([
  'draft',
  'paused',
  'ready',
  'running',
  'waiting_approval',
  'waiting_input',
  'waiting_selection',
]);

export function workflowRunExperienceFor(
  snapshot: BoardSnapshot,
  activeAgentRun?: AgentRunRecord,
): WorkflowRunExperienceView {
  const activeWorkflowRunId = workflowRunIdForAgentRun(activeAgentRun);
  const runs = (snapshot.workflowRuns ?? [])
    .filter((run) => run.boardId === snapshot.board.boardId)
    .map((run): WorkflowRunExperienceItemView => {
      const stepRecords = (snapshot.workflowStepRuns ?? [])
        .filter((step) => step.workflowRunId === run.workflowRunId);
      const stepOrder = new Map(run.stepRunIds.map((stepRunId, index) => [stepRunId, index]));
      const steps = stepRecords
        .sort((left, right) => (
          (stepOrder.get(left.stepRunId) ?? Number.MAX_SAFE_INTEGER)
          - (stepOrder.get(right.stepRunId) ?? Number.MAX_SAFE_INTEGER)
          || left.stepRunId.localeCompare(right.stepRunId)
        ))
        .map((step): WorkflowRunExperienceStepView => ({
          executionCount: step.executionIds.length,
          freshness: step.freshness,
          label: operationLabel(snapshot, step.operationBlockId, step.stepId),
          operationBlockId: step.operationBlockId,
          role: stepRole(step.status),
          status: step.status,
          stepId: step.stepId,
          stepRunId: step.stepRunId,
        }));
      const executionIds = new Set(stepRecords.flatMap((step) => step.executionIds));
      const artifactRevisionIds = new Set(
        stepRecords.flatMap((step) => (
          step.outputArtifactBindings.map((binding) => binding.artifactRevisionId)
        )),
      );
      const gateEvaluations = selectedGateEvaluations(snapshot, run.workflowRunId);
      return {
        artifactRevisionCount: artifactRevisionIds.size,
        blockedStepCount: steps.filter((step) => step.role === 'blocked').length,
        completedStepCount: steps.filter((step) => step.role === 'done').length,
        currentStepCount: steps.filter((step) => step.role === 'current').length,
        executionCount: executionIds.size,
        gateCount: run.gateDefinitionLocks.length,
        gateWaitingCount: gateEvaluations.filter((gate) => gate.status === 'waiting_approval').length,
        isActiveAgentRunTarget: run.workflowRunId === activeWorkflowRunId,
        label: workflowRunLabel(snapshot, run.workflowProjectionId, run.workflowDefinitionLock.workflowId),
        nextStepCount: steps.filter((step) => step.role === 'next').length,
        status: run.status,
        steps,
        totalStepCount: steps.length,
        updatedAt: run.updatedAt,
        workflowRunId: run.workflowRunId,
        workflowVersion: run.workflowDefinitionLock.version,
      };
    })
    .sort(compareRunExperienceItems);

  return {
    activeCount: runs.filter((run) => activeStatuses.has(run.status)).length,
    attentionCount: runs.filter((run) => attentionStatuses.has(run.status)).length,
    ...(runs[0] ? { defaultWorkflowRunId: runs[0].workflowRunId } : {}),
    runs,
  };
}

function workflowRunIdForAgentRun(run?: AgentRunRecord): string | undefined {
  if (!run || run.target.kind === 'capability') return undefined;
  return run.target.workflowRunId;
}

function compareRunExperienceItems(
  left: WorkflowRunExperienceItemView,
  right: WorkflowRunExperienceItemView,
): number {
  return Number(right.isActiveAgentRunTarget) - Number(left.isActiveAgentRunTarget)
    || runStatusPriority(left.status) - runStatusPriority(right.status)
    || right.updatedAt.localeCompare(left.updatedAt)
    || left.workflowRunId.localeCompare(right.workflowRunId);
}

function runStatusPriority(status: WorkflowRunStatus): number {
  if (attentionStatuses.has(status)) return 0;
  if (activeStatuses.has(status)) return 1;
  return 2;
}

function stepRole(status: WorkflowStepRunStatus): WorkflowRunExperienceStepView['role'] {
  if (status === 'queued' || status === 'running' || status === 'waiting_input' || status === 'waiting_selection') {
    return 'current';
  }
  if (status === 'ready') return 'next';
  if (status === 'blocked' || status === 'failed') return 'blocked';
  if (status === 'succeeded' || status === 'skipped' || status === 'canceled') return 'done';
  return 'pending';
}

function workflowRunLabel(
  snapshot: BoardSnapshot,
  workflowProjectionId: string,
  workflowDefinitionId: string,
): string {
  const group = snapshot.blocks.find((block) => (
    block.type === 'group'
    && block.data.workflowProjectionId === workflowProjectionId
  ));
  const title = group?.data.title;
  return typeof title === 'string' && title.trim() ? title.trim() : workflowDefinitionId;
}

function operationLabel(
  snapshot: BoardSnapshot,
  operationBlockId: string,
  stepId: string,
): string {
  const title = snapshot.blocks.find((block) => block.blockId === operationBlockId)?.data.title;
  return typeof title === 'string' && title.trim() ? title.trim() : stepId;
}

function selectedGateEvaluations(snapshot: BoardSnapshot, workflowRunId: string) {
  const selected = new Map<string, NonNullable<BoardSnapshot['workflowGateEvaluations']>[number]>();
  for (const evaluation of snapshot.workflowGateEvaluations ?? []) {
    if (evaluation.workflowRunId !== workflowRunId) continue;
    const current = selected.get(evaluation.gateId);
    if (
      !current
      || Number(evaluation.freshness === 'current') > Number(current.freshness === 'current')
      || evaluation.freshness === current.freshness && evaluation.updatedAt > current.updatedAt
    ) selected.set(evaluation.gateId, evaluation);
  }
  return [...selected.values()];
}
