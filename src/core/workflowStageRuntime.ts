import {
  workflowGateViewsForRun,
  type WorkflowGateRuntimeView,
} from './workflowGateRuntime';
import type { BoardSnapshot } from './types';
import type { WorkflowStepRuntimeView } from './workflowRuntime';
import type {
  WorkflowRunRecord,
  WorkflowStageDefinitionLock,
  WorkflowStepRunFreshness,
  WorkflowStepRunRecord,
} from './workflowRuntimeContracts';

export type WorkflowStageRuntimeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'waiting_input'
  | 'waiting_selection'
  | 'waiting_approval'
  | 'needs_attention'
  | 'succeeded';

export type WorkflowStageOutputReadiness = 'not_required' | 'pending' | 'current';

export interface WorkflowStageRuntimeView {
  currentStepRunIds: string[];
  freshness: WorkflowStepRunFreshness;
  optionalStepRunIds: string[];
  outputArtifactBindings: WorkflowStepRunRecord['outputArtifactBindings'];
  outputReadiness: WorkflowStageOutputReadiness;
  requiredGateEvaluationIds: string[];
  requiredStepRunIds: string[];
  stageDefinitionLock: WorkflowStageDefinitionLock;
  status: WorkflowStageRuntimeStatus;
}

export function projectWorkflowStageViews(
  snapshot: BoardSnapshot,
  run: WorkflowRunRecord,
  steps: WorkflowStepRuntimeView[],
): WorkflowStageRuntimeView[] {
  if (!run.stageDefinitionLocks) return [];
  const stepById = new Map(steps.map((step) => [step.record.stepId, step]));
  const gateViews = workflowGateViewsForRun(snapshot, run.workflowRunId);
  return run.stageDefinitionLocks.map((stageDefinitionLock) => {
    const requiredSteps = stageDefinitionLock.requiredStepIds.flatMap((stepId) => {
      const step = stepById.get(stepId);
      return step ? [step] : [];
    });
    const optionalSteps = stageDefinitionLock.optionalStepIds.flatMap((stepId) => {
      const step = stepById.get(stepId);
      return step ? [step] : [];
    });
    const stageStepIds = new Set([
      ...stageDefinitionLock.requiredStepIds,
      ...stageDefinitionLock.optionalStepIds,
    ]);
    const requiredGates = gateViews.filter(
      (gate) => stageStepIds.has(gate.gateDefinitionLock.subject.stepId),
    );
    const outputArtifactBindings = stageDefinitionLock.outputSlotLocks.flatMap((output) => {
      const step = stepById.get(output.stepId);
      if (!step || step.status !== 'succeeded' || step.freshness !== 'current') return [];
      const binding = step.record.outputArtifactBindings.find(
        (candidate) =>
          candidate.workflowOutputSlotId === output.workflowOutputSlotId
          && candidate.outputSlotId === output.outputSlotId
          && candidate.artifactType === output.artifactType,
      );
      return binding ? [binding] : [];
    });
    const outputReadiness = stageDefinitionLock.outputSlotLocks.length === 0
      ? 'not_required'
      : outputArtifactBindings.length === stageDefinitionLock.outputSlotLocks.length
        ? 'current'
        : 'pending';
    const freshness = requiredSteps.some((step) => step.freshness === 'outdated')
      || requiredGates.some((gate) => gate.evaluation?.freshness === 'outdated')
      ? 'outdated'
      : 'current';
    return {
      stageDefinitionLock,
      requiredStepRunIds: requiredSteps.map((step) => step.record.stepRunId),
      optionalStepRunIds: optionalSteps.map((step) => step.record.stepRunId),
      currentStepRunIds: requiredSteps
        .filter((step) =>
          step.status === 'ready'
          || step.status === 'queued'
          || step.status === 'running'
          || step.status === 'waiting_input'
          || step.status === 'waiting_selection')
        .map((step) => step.record.stepRunId),
      requiredGateEvaluationIds: requiredGates.flatMap(
        (gate) => gate.evaluation ? [gate.evaluation.gateEvaluationId] : [],
      ),
      outputArtifactBindings,
      outputReadiness,
      freshness,
      status: projectedStageStatus(stageDefinitionLock, requiredSteps, requiredGates),
    };
  });
}

function projectedStageStatus(
  stage: WorkflowStageDefinitionLock,
  steps: WorkflowStepRuntimeView[],
  gates: WorkflowGateRuntimeView[],
): WorkflowStageRuntimeStatus {
  if (
    steps.length !== stage.requiredStepIds.length
    || steps.some((step) =>
      step.freshness === 'outdated'
      || step.status === 'failed'
      || step.status === 'canceled'
      || step.status === 'blocked')
    || gates.some((gate) =>
      gate.evaluation?.freshness === 'outdated'
      || gate.evaluation?.status === 'failed')
  ) return 'needs_attention';
  if (steps.some((step) => step.status === 'queued' || step.status === 'running')) return 'running';
  if (gates.some((gate) => gate.evaluation?.status === 'waiting_approval')) return 'waiting_approval';
  if (
    steps.every((step) => step.status === 'succeeded' && step.freshness === 'current')
    && gates.every((gate) =>
      gate.evaluation?.freshness === 'current'
      && gate.evaluation.status === 'passed')
  ) return 'succeeded';
  if (steps.some((step) => step.status === 'waiting_selection')) return 'waiting_selection';
  if (steps.some((step) => step.status === 'waiting_input')) return 'waiting_input';
  if (steps.some((step) => step.status === 'ready')) return 'ready';
  return 'pending';
}
