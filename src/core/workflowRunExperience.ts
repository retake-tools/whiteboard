import type { AgentRunRecord } from './agentRuntimeContracts';
import type { BoardSnapshot, ExecutionRecord } from './types';
import type { WorkflowGateEvaluationStatus } from './workflowGateContracts';
import type {
  WorkflowRunRecord,
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

export interface WorkflowRunExperienceExecutionView {
  capabilityId: string;
  executionId: string;
  operationBlockId: string;
  providerLabel?: string;
  status: ExecutionRecord['status'] | 'unavailable';
  stepRunId: string;
}

export interface WorkflowRunExperienceArtifactView {
  artifactId: string;
  artifactRevisionId: string;
  artifactType: string;
  operationBlockId: string;
  outputSlotId: string;
  stepRunId: string;
}

export interface WorkflowRunExperienceGateView {
  freshness?: 'current' | 'outdated';
  gateId: string;
  label: string;
  operationBlockId?: string;
  status: WorkflowGateEvaluationStatus | 'not_ready';
  subjectLabel: string;
}

export interface WorkflowRunTimelineEventView {
  detail?: string;
  eventId: string;
  kind: 'run' | 'step' | 'execution' | 'artifact' | 'gate';
  label: string;
  occurredAt: string;
  operationBlockId?: string;
  status: string;
  tone: 'neutral' | 'active' | 'success' | 'attention';
}

export interface WorkflowRunExperienceItemView {
  artifactRevisionCount: number;
  artifacts: WorkflowRunExperienceArtifactView[];
  blockedStepCount: number;
  completedStepCount: number;
  currentStepCount: number;
  executionCount: number;
  executions: WorkflowRunExperienceExecutionView[];
  gateCount: number;
  gateWaitingCount: number;
  gates: WorkflowRunExperienceGateView[];
  isActiveAgentRunTarget: boolean;
  label: string;
  nextStepCount: number;
  status: WorkflowRunStatus;
  steps: WorkflowRunExperienceStepView[];
  timelineEvents: WorkflowRunTimelineEventView[];
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
  options: { workflowRunIds?: readonly string[] } = {},
): WorkflowRunExperienceView {
  const activeWorkflowRunId = workflowRunIdForAgentRun(activeAgentRun);
  const workflowRunIds = options.workflowRunIds === undefined
    ? undefined
    : new Set(options.workflowRunIds);
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const executionById = new Map(snapshot.executions.map((execution) => [execution.executionId, execution]));
  const gateEvaluationById = new Map(
    (snapshot.workflowGateEvaluations ?? []).map((evaluation) => [evaluation.gateEvaluationId, evaluation]),
  );
  const stepRecordsByRun = new Map<string, NonNullable<BoardSnapshot['workflowStepRuns']>>();
  for (const step of snapshot.workflowStepRuns ?? []) {
    const records = stepRecordsByRun.get(step.workflowRunId) ?? [];
    records.push(step);
    stepRecordsByRun.set(step.workflowRunId, records);
  }
  const workflowLabelByProjection = new Map(
    snapshot.blocks.flatMap((block) => (
      block.type === 'group'
      && typeof block.data.workflowProjectionId === 'string'
      && typeof block.data.title === 'string'
      && block.data.title.trim()
        ? [[block.data.workflowProjectionId, block.data.title.trim()] as const]
        : []
    )),
  );
  const runs = (snapshot.workflowRuns ?? [])
    .filter((run) => run.boardId === snapshot.board.boardId)
    .filter((run) => workflowRunIds === undefined || workflowRunIds.has(run.workflowRunId))
    .map((run): WorkflowRunExperienceItemView => {
      const stepRecords = [...(stepRecordsByRun.get(run.workflowRunId) ?? [])];
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
          label: operationLabel(blockById, step.operationBlockId, step.stepId),
          operationBlockId: step.operationBlockId,
          role: stepRole(step.status),
          status: step.status,
          stepId: step.stepId,
          stepRunId: step.stepRunId,
        }));
      const executionIds = new Set(stepRecords.flatMap((step) => step.executionIds));
      const executions = uniqueExecutionViews(stepRecords.flatMap((step) => step.executionIds.map((executionId) => {
        const execution = executionById.get(executionId);
        const providerLabel = executionProviderLabel(execution);
        return {
          capabilityId: execution?.capabilityId ?? step.capabilityLock.capabilityId,
          executionId,
          operationBlockId: step.operationBlockId,
          ...(providerLabel ? { providerLabel } : {}),
          status: execution?.status ?? 'unavailable',
          stepRunId: step.stepRunId,
        } satisfies WorkflowRunExperienceExecutionView;
      })));
      const artifacts = uniqueArtifactViews(stepRecords.flatMap((step) => (
        step.outputArtifactBindings.map((binding) => ({
          artifactId: binding.artifactId,
          artifactRevisionId: binding.artifactRevisionId,
          artifactType: binding.artifactType,
          operationBlockId: step.operationBlockId,
          outputSlotId: binding.workflowOutputSlotId || binding.outputSlotId,
          stepRunId: step.stepRunId,
        }))
      )));
      const gateEvaluations = selectedGateEvaluations(gateEvaluationById, run);
      const currentGateEvaluationByGateId = new Map(gateEvaluations.map((gate) => [gate.gateId, gate]));
      const gates = run.gateDefinitionLocks.map((gate): WorkflowRunExperienceGateView => {
        const evaluation = currentGateEvaluationByGateId.get(gate.gateId);
        const subjectStep = stepRecords.find((step) => step.stepId === gate.subject.stepId);
        const subjectOperationLabel = subjectStep
          ? operationLabel(blockById, subjectStep.operationBlockId, subjectStep.stepId)
          : gate.subject.stepId;
        const outputLabel = gate.subject.kind === 'artifact_revision'
          ? gate.subject.workflowOutputSlotId
          : gate.subject.outputSlotId;
        return {
          ...(evaluation ? { freshness: evaluation.freshness } : {}),
          gateId: gate.gateId,
          label: gate.name?.trim() || `${subjectOperationLabel} · ${outputLabel}`,
          ...(subjectStep ? { operationBlockId: subjectStep.operationBlockId } : {}),
          status: evaluation?.status ?? 'not_ready',
          subjectLabel: `${subjectOperationLabel} · ${outputLabel}`,
        };
      });
      const timelineEvents = timelineEventsFor({
        artifacts,
        blockById,
        executionById,
        gateEvaluations,
        run,
        stepRecords,
      });
      return {
        artifactRevisionCount: artifacts.length,
        artifacts,
        blockedStepCount: steps.filter((step) => step.role === 'blocked').length,
        completedStepCount: steps.filter((step) => step.role === 'done').length,
        currentStepCount: steps.filter((step) => step.role === 'current').length,
        executionCount: executionIds.size,
        executions,
        gateCount: run.gateDefinitionLocks.length,
        gateWaitingCount: gateEvaluations.filter((gate) => gate.status === 'waiting_approval').length,
        gates,
        isActiveAgentRunTarget: run.workflowRunId === activeWorkflowRunId,
        label: workflowLabelByProjection.get(run.workflowProjectionId)
          ?? run.workflowDefinitionLock.workflowId,
        nextStepCount: steps.filter((step) => step.role === 'next').length,
        status: run.status,
        steps,
        timelineEvents,
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

function timelineEventsFor(input: {
  artifacts: WorkflowRunExperienceArtifactView[];
  blockById: Map<string, BoardSnapshot['blocks'][number]>;
  executionById: Map<string, ExecutionRecord>;
  gateEvaluations: NonNullable<BoardSnapshot['workflowGateEvaluations']>;
  run: WorkflowRunRecord;
  stepRecords: NonNullable<BoardSnapshot['workflowStepRuns']>;
}): WorkflowRunTimelineEventView[] {
  const artifactRevisionIds = new Set(input.artifacts.map((artifact) => artifact.artifactRevisionId));
  const events: WorkflowRunTimelineEventView[] = [{
    eventId: `run-created:${input.run.workflowRunId}`,
    kind: 'run',
    label: input.run.workflowDefinitionLock.workflowId,
    occurredAt: input.run.createdAt,
    status: 'created',
    tone: 'neutral',
  }];
  for (const step of input.stepRecords) {
    if (step.status !== 'pending') {
      events.push({
        eventId: `step:${step.stepRunId}:${step.recordVersion}`,
        kind: 'step',
        label: operationLabel(input.blockById, step.operationBlockId, step.stepId),
        occurredAt: step.updatedAt,
        operationBlockId: step.operationBlockId,
        status: step.status,
        tone: timelineTone(step.status),
      });
    }
    for (const executionId of step.executionIds) {
      const execution = input.executionById.get(executionId);
      if (!execution) continue;
      events.push({
        ...(executionProviderLabel(execution) ? { detail: executionProviderLabel(execution) } : {}),
        eventId: `execution:${execution.executionId}:${execution.status}`,
        kind: 'execution',
        label: operationLabel(input.blockById, step.operationBlockId, execution.capabilityId),
        occurredAt: execution.completedAt ?? execution.startedAt,
        operationBlockId: step.operationBlockId,
        status: execution.status,
        tone: timelineTone(execution.status),
      });
    }
    for (const binding of step.outputArtifactBindings) {
      if (!artifactRevisionIds.has(binding.artifactRevisionId)) continue;
      events.push({
        detail: binding.artifactType,
        eventId: `artifact:${binding.artifactRevisionId}`,
        kind: 'artifact',
        label: binding.workflowOutputSlotId || binding.outputSlotId,
        occurredAt: binding.boundAt,
        operationBlockId: step.operationBlockId,
        status: 'ready',
        tone: 'success',
      });
    }
  }
  for (const gate of input.gateEvaluations) {
    events.push({
      eventId: `gate:${gate.gateEvaluationId}:${gate.recordVersion}`,
      kind: 'gate',
      label: gate.gateDefinitionLock.name?.trim() || gate.gateId,
      occurredAt: gate.updatedAt,
      status: gate.status,
      tone: timelineTone(gate.status),
    });
  }
  events.push({
    eventId: `run-status:${input.run.workflowRunId}:${input.run.recordVersion}`,
    kind: 'run',
    label: input.run.workflowDefinitionLock.workflowId,
    occurredAt: input.run.updatedAt,
    status: input.run.status,
    tone: timelineTone(input.run.status),
  });
  return events.sort((left, right) => (
    left.occurredAt.localeCompare(right.occurredAt)
    || left.eventId.localeCompare(right.eventId)
  ));
}

function timelineTone(status: string): WorkflowRunTimelineEventView['tone'] {
  if (status === 'succeeded' || status === 'passed' || status === 'ready') return 'success';
  if (
    status === 'failed'
    || status === 'blocked'
    || status === 'needs_attention'
    || status === 'waiting_approval'
    || status === 'waiting_input'
    || status === 'waiting_selection'
  ) return 'attention';
  if (status === 'queued' || status === 'running') return 'active';
  return 'neutral';
}

function executionProviderLabel(execution?: ExecutionRecord): string | undefined {
  if (!execution) return undefined;
  const provider = execution.provider ?? execution.adapterSnapshot?.provider;
  const model = execution.model ?? execution.adapterSnapshot?.model;
  if (provider && model) return `${provider} · ${model}`;
  return provider ?? model ?? execution.connectionId;
}

function uniqueArtifactViews(
  artifacts: WorkflowRunExperienceArtifactView[],
): WorkflowRunExperienceArtifactView[] {
  const byRevisionId = new Map<string, WorkflowRunExperienceArtifactView>();
  for (const artifact of artifacts) {
    if (!byRevisionId.has(artifact.artifactRevisionId)) {
      byRevisionId.set(artifact.artifactRevisionId, artifact);
    }
  }
  return [...byRevisionId.values()];
}

function uniqueExecutionViews(
  executions: WorkflowRunExperienceExecutionView[],
): WorkflowRunExperienceExecutionView[] {
  const byExecutionId = new Map<string, WorkflowRunExperienceExecutionView>();
  for (const execution of executions) {
    if (!byExecutionId.has(execution.executionId)) {
      byExecutionId.set(execution.executionId, execution);
    }
  }
  return [...byExecutionId.values()];
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

function operationLabel(
  blockById: Map<string, BoardSnapshot['blocks'][number]>,
  operationBlockId: string,
  stepId: string,
): string {
  const title = blockById.get(operationBlockId)?.data.title;
  return typeof title === 'string' && title.trim() ? title.trim() : stepId;
}

function selectedGateEvaluations(
  evaluationById: Map<string, NonNullable<BoardSnapshot['workflowGateEvaluations']>[number]>,
  run: WorkflowRunRecord,
) {
  const selected = new Map<string, NonNullable<BoardSnapshot['workflowGateEvaluations']>[number]>();
  for (const gateEvaluationId of run.gateEvaluationIds) {
    const evaluation = evaluationById.get(gateEvaluationId);
    if (!evaluation || evaluation.workflowRunId !== run.workflowRunId) continue;
    const current = selected.get(evaluation.gateId);
    if (
      !current
      || Number(evaluation.freshness === 'current') > Number(current.freshness === 'current')
      || evaluation.freshness === current.freshness && evaluation.updatedAt > current.updatedAt
    ) selected.set(evaluation.gateId, evaluation);
  }
  return [...selected.values()];
}
