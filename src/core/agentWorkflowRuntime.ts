import type {
  AgentRunExecutionAction,
  AgentRunRecord,
  AgentRunScope,
} from './agentRuntimeContracts';
import type { BoardSnapshot } from './types';
import type { WorkflowStepOutputArtifactBinding } from './workflowRuntimeContracts';
import { workflowGateViewsForRun } from './workflowGateRuntime';
import {
  workflowRunViewForId,
  type WorkflowRunRuntimeView,
  type WorkflowStepRuntimeView,
} from './workflowRuntime';

type WorkflowAgentTarget = Extract<AgentRunRecord['target'], { kind: 'workflow_run' | 'workflow_slice' }>;
type AgentRunProjection = Pick<
  AgentRunRecord,
  'currentOperationBlockId' | 'error' | 'executionIds' | 'satisfiedArtifactRevisionId'
  | 'satisfiedArtifactRevisionIds' | 'status' | 'stopReason'
>;

export interface WorkflowOutputArtifactTarget {
  artifactType: string;
  outputSlotId: string;
  stepRunId: string;
  workflowOutputSlotId: string;
  workflowRunId: string;
}

export function workflowAgentScope(
  workflow: WorkflowRunRuntimeView,
  target: WorkflowAgentTarget,
): Pick<AgentRunScope, 'allowedCapabilityIds' | 'allowedOperationBlockIds' | 'allowedStepRunIds'> {
  const steps = scopedWorkflowSteps(workflow, target);
  return {
    allowedStepRunIds: steps.map((step) => step.record.stepRunId),
    allowedOperationBlockIds: steps.map((step) => step.record.operationBlockId),
    allowedCapabilityIds: unique(steps.map((step) => step.record.capabilityLock.capabilityId)),
  };
}

export function assertWorkflowAgentTarget(
  snapshot: BoardSnapshot,
  record: AgentRunRecord,
): void {
  if (record.target.kind === 'capability') throw new Error('Workflow Agent Run target required.');
  const workflow = workflowRunViewForId(snapshot, record.target.workflowRunId);
  if (!workflow || record.scope.workflowRunId !== workflow.record.workflowRunId) {
    throw new Error('Agent Run Workflow target is missing.');
  }
  if (!locksEqual(record.target.workflowDefinitionLock, workflow.record.workflowDefinitionLock)) {
    throw new Error('Agent Run Workflow Definition lock changed.');
  }
  if (
    record.target.kind === 'workflow_run'
    && record.stopPolicy.kind !== 'workflow_terminal'
  ) throw new Error('Agent Run Workflow stop policy changed.');
  if (
    record.target.kind === 'workflow_slice'
    && record.stopPolicy.kind !== 'workflow_slice_target'
  ) throw new Error('Agent Run Workflow Slice stop policy changed.');
  if (record.target.kind === 'workflow_slice' && record.target.until.kind === 'artifact') {
    const until = record.target.until;
    const output = workflow.record.outputSlotLocks.find(
      (candidate) => candidate.workflowOutputSlotId === until.workflowOutputSlotId,
    );
    if (
      !output
      || output.stepId !== until.stepId
      || output.outputSlotId !== until.outputSlotId
      || output.artifactType !== until.artifactType
      || until.artifactScope !== 'workflow_run'
      || until.semanticKey !== `workflow_output:${output.workflowOutputSlotId}`
    ) throw new Error('Agent Run Workflow Artifact target lock changed.');
  }
  if (record.target.kind === 'workflow_slice' && record.target.until.kind === 'stage') {
    const until = record.target.until;
    const stage = workflow.stages.find(
      (candidate) => candidate.stageDefinitionLock.stageId === until.stageId,
    );
    const expectedOutputs = [...(stage?.stageDefinitionLock.outputSlotLocks ?? [])]
      .sort((left, right) => left.workflowOutputSlotId.localeCompare(right.workflowOutputSlotId));
    if (
      !stage
      || stage.stageDefinitionLock.stageTypeId !== until.stageTypeId
      || !arraysEqual(stage.requiredStepRunIds, until.requiredStepRunIds)
      || expectedOutputs.length !== until.outputTargets.length
      || expectedOutputs.some((output, index) => {
        const target = until.outputTargets[index];
        const stepRunId = workflow.steps.find(
          (step) => step.record.stepId === output.stepId,
        )?.record.stepRunId;
        return !target
          || target.artifactScope !== output.artifactScope
          || target.artifactType !== output.artifactType
          || target.outputSlotId !== output.outputSlotId
          || target.semanticKey !== output.semanticKey
          || target.stepId !== output.stepId
          || target.stepRunId !== stepRunId
          || target.workflowOutputSlotId !== output.workflowOutputSlotId;
      })
    ) throw new Error('Agent Run Workflow Stage target lock changed.');
  }

  const expectedScope = workflowAgentScope(workflow, record.target);
  if (
    !arraysEqual(record.scope.allowedStepRunIds, expectedScope.allowedStepRunIds)
    || !arraysEqual(record.scope.allowedOperationBlockIds, expectedScope.allowedOperationBlockIds)
    || !arraysEqual(record.scope.allowedCapabilityIds, expectedScope.allowedCapabilityIds)
  ) throw new Error('Agent Run Workflow scope changed.');
}

export function nextWorkflowAgentExecutionAction(
  snapshot: BoardSnapshot,
  record: AgentRunRecord,
): AgentRunExecutionAction | undefined {
  if (record.target.kind === 'capability') return undefined;
  const workflow = workflowRunViewForId(snapshot, record.target.workflowRunId);
  if (!workflow) return undefined;
  const allowedStepRunIds = new Set(record.scope.allowedStepRunIds);
  const scopedSteps = workflow.steps.filter((step) => allowedStepRunIds.has(step.record.stepRunId));
  if (scopedSteps.some((step) => step.status === 'queued' || step.status === 'running')) return undefined;
  const step = scopedSteps.find((candidate) => candidate.status === 'ready');
  if (!step || !record.scope.allowedOperationBlockIds.includes(step.record.operationBlockId)) return undefined;
  return {
    actionKey: `${record.agentRunId}:step:${step.record.stepRunId}:${step.record.executionIds.length}`,
    agentRunId: record.agentRunId,
    operationBlockId: step.record.operationBlockId,
    stepRunId: step.record.stepRunId,
  };
}

export function projectWorkflowAgentRun(
  snapshot: BoardSnapshot,
  record: AgentRunRecord,
): AgentRunProjection {
  if (record.target.kind === 'capability') throw new Error('Workflow Agent Run target required.');
  const workflow = workflowRunViewForId(snapshot, record.target.workflowRunId);
  if (!workflow) throw new Error(`Workflow Run not found: ${record.target.workflowRunId}`);
  if (record.target.kind === 'workflow_run') return projectWholeWorkflowAgentRun(workflow);
  return projectWorkflowSliceAgentRun(snapshot, workflow, record);
}

function projectWholeWorkflowAgentRun(workflow: WorkflowRunRuntimeView): AgentRunProjection {
  const executionIds = workflow.steps.flatMap((step) => step.record.executionIds);
  const current = currentWorkflowStep(workflow.steps);
  const base = {
    executionIds,
    currentOperationBlockId: current?.record.operationBlockId,
    error: workflow.steps.find((step) => step.status === 'failed')?.record.error,
  };
  if (workflow.status === 'succeeded') return { ...base, status: 'succeeded', stopReason: 'workflow_terminal' };
  if (workflow.status === 'canceled') return { ...base, status: 'canceled', stopReason: 'target_canceled' };
  if (workflow.status === 'paused') return { ...base, status: 'paused', stopReason: 'target_paused' };
  if (workflow.status === 'waiting_input') return { ...base, status: 'waiting_input', stopReason: undefined };
  if (workflow.status === 'waiting_selection') return { ...base, status: 'waiting_selection', stopReason: undefined };
  if (workflow.status === 'waiting_approval') {
    return { ...base, status: 'waiting_approval', stopReason: undefined };
  }
  if (workflow.status === 'needs_attention' || workflow.status === 'failed') {
    return { ...base, status: 'needs_attention', stopReason: undefined };
  }
  return { ...base, status: 'running', stopReason: undefined };
}

function projectWorkflowSliceAgentRun(
  snapshot: BoardSnapshot,
  workflow: WorkflowRunRuntimeView,
  record: AgentRunRecord,
): AgentRunProjection {
  if (record.target.kind !== 'workflow_slice') throw new Error('Workflow Slice target required.');
  const targetStepRunIds = record.target.until.kind === 'stage'
    ? record.target.until.requiredStepRunIds
    : [record.target.until.stepRunId];
  const allowedStepRunIds = new Set(record.scope.allowedStepRunIds);
  const steps = workflow.steps.filter((step) => allowedStepRunIds.has(step.record.stepRunId));
  const targets = targetStepRunIds.flatMap((stepRunId) => {
    const step = steps.find((candidate) => candidate.record.stepRunId === stepRunId);
    return step ? [step] : [];
  });
  if (targets.length !== targetStepRunIds.length) {
    throw new Error('Workflow Slice target StepRun is outside its frozen scope.');
  }
  const current = currentWorkflowStep(steps);
  const executionIds = steps.flatMap((step) => step.record.executionIds);
  const failedStep = steps.find((step) =>
    step.freshness === 'outdated'
    || step.status === 'failed'
    || step.status === 'canceled'
    || step.status === 'blocked',
  );
  const base = {
    executionIds,
    currentOperationBlockId: current?.record.operationBlockId,
    error: failedStep?.record.error,
    satisfiedArtifactRevisionId: record.satisfiedArtifactRevisionId,
    satisfiedArtifactRevisionIds: record.satisfiedArtifactRevisionIds,
  };

  if (workflow.status === 'canceled') return { ...base, status: 'canceled', stopReason: 'target_canceled' };
  if (workflow.status === 'paused') return { ...base, status: 'paused', stopReason: 'target_paused' };
  if (failedStep) return { ...base, status: 'needs_attention', stopReason: undefined };
  if (steps.some((step) => step.status === 'queued' || step.status === 'running')) {
    return { ...base, status: 'running', stopReason: undefined };
  }
  if (steps.some((step) => step.status === 'waiting_selection')) {
    return { ...base, status: 'waiting_selection', stopReason: undefined };
  }

  const gateState = scopedGateState(snapshot, workflow, steps);
  if (gateState === 'failed') return { ...base, status: 'needs_attention', stopReason: undefined };
  if (gateState === 'waiting_approval') {
    return { ...base, status: 'waiting_approval', stopReason: undefined };
  }
  if (steps.some((step) => step.status === 'waiting_input')) {
    return { ...base, status: 'waiting_input', stopReason: undefined };
  }
  if (targets.every((target) => target.status === 'succeeded' && target.freshness === 'current')) {
    if (record.target.until.kind === 'artifact') {
      const binding = workflowArtifactTargetBinding(snapshot, record);
      if (!binding) {
        return {
          ...base,
          currentOperationBlockId: undefined,
          status: 'running',
          stopReason: undefined,
        };
      }
      if (
        record.satisfiedArtifactRevisionId
        && record.satisfiedArtifactRevisionId !== binding.artifactRevisionId
      ) {
        return {
          ...base,
          status: 'needs_attention',
          stopReason: undefined,
          error: 'The verified Artifact Revision no longer matches the current Workflow output binding.',
        };
      }
      if (!record.satisfiedArtifactRevisionId) {
        return {
          ...base,
          currentOperationBlockId: undefined,
          status: 'running',
          stopReason: undefined,
        };
      }
    }
    if (record.target.until.kind === 'stage') {
      const bindings = workflowStageTargetBindings(snapshot, record);
      if (!bindings) {
        return {
          ...base,
          currentOperationBlockId: undefined,
          status: 'running',
          stopReason: undefined,
        };
      }
      const currentRevisionIds = bindings.map((binding) => binding.artifactRevisionId);
      const verifiedRevisionIds = record.satisfiedArtifactRevisionIds ?? [];
      if (
        verifiedRevisionIds.length > 0
        && !arraysEqual(verifiedRevisionIds, currentRevisionIds)
      ) {
        return {
          ...base,
          status: 'needs_attention',
          stopReason: undefined,
          error: 'The verified Stage Artifact Revisions no longer match the current Workflow output bindings.',
        };
      }
      if (
        record.target.until.outputTargets.length > 0
        && verifiedRevisionIds.length === 0
      ) {
        return {
          ...base,
          currentOperationBlockId: undefined,
          status: 'running',
          stopReason: undefined,
        };
      }
    }
    return gateState === 'passed'
      ? { ...base, currentOperationBlockId: undefined, status: 'succeeded', stopReason: 'slice_target_satisfied' }
      : {
          ...base,
          status: 'needs_attention',
          stopReason: undefined,
          error: 'A required Workflow Gate has no current approval evaluation.',
        };
  }
  return { ...base, status: 'running', stopReason: undefined };
}

function scopedWorkflowSteps(
  workflow: WorkflowRunRuntimeView,
  target: WorkflowAgentTarget,
): WorkflowStepRuntimeView[] {
  if (target.kind === 'workflow_run') return workflow.steps;
  const until = target.until;
  const targetSteps = until.kind === 'stage'
    ? until.requiredStepRunIds.map((stepRunId) =>
        workflow.steps.find((step) => step.record.stepRunId === stepRunId))
    : [workflow.steps.find((step) => step.record.stepRunId === until.stepRunId)];
  if (
    targetSteps.some((step) => !step)
    || targetSteps.some((step) => step?.record.workflowRunId !== target.workflowRunId)
    || (
      until.kind !== 'stage'
      && targetSteps[0]?.record.stepId !== until.stepId
    )
  ) throw new Error('Workflow Slice target StepRun changed.');

  const stepById = new Map(workflow.steps.map((step) => [step.record.stepId, step]));
  const includedStepIds = new Set<string>();
  const visiting = new Set<string>();
  function include(stepId: string): void {
    if (includedStepIds.has(stepId)) return;
    if (visiting.has(stepId)) throw new Error(`Workflow Slice dependency cycle: ${stepId}`);
    const step = stepById.get(stepId);
    if (!step) throw new Error(`Workflow Slice dependency is missing: ${stepId}`);
    visiting.add(stepId);
    for (const dependencyStepId of step.record.dependsOn) include(dependencyStepId);
    visiting.delete(stepId);
    includedStepIds.add(stepId);
  }
  for (const targetStep of targetSteps) {
    if (targetStep) include(targetStep.record.stepId);
  }
  return workflow.steps.filter((step) => includedStepIds.has(step.record.stepId));
}

export function workflowArtifactTargetBinding(
  snapshot: BoardSnapshot,
  record: AgentRunRecord,
): WorkflowStepOutputArtifactBinding | undefined {
  if (
    record.target.kind !== 'workflow_slice'
    || record.target.until.kind !== 'artifact'
  ) throw new Error('Workflow Artifact Slice target required.');
  const until = record.target.until;
  return workflowOutputArtifactBinding(snapshot, {
    artifactType: until.artifactType,
    outputSlotId: until.outputSlotId,
    stepRunId: until.stepRunId,
    workflowOutputSlotId: until.workflowOutputSlotId,
    workflowRunId: record.target.workflowRunId,
  });
}

export function workflowStageTargetBindings(
  snapshot: BoardSnapshot,
  record: AgentRunRecord,
): WorkflowStepOutputArtifactBinding[] | undefined {
  if (
    record.target.kind !== 'workflow_slice'
    || record.target.until.kind !== 'stage'
  ) throw new Error('Workflow Stage Slice target required.');
  const workflowRunId = record.target.workflowRunId;
  const bindings = record.target.until.outputTargets.map((target) =>
    workflowOutputArtifactBinding(snapshot, {
      artifactType: target.artifactType,
      outputSlotId: target.outputSlotId,
      stepRunId: target.stepRunId,
      workflowOutputSlotId: target.workflowOutputSlotId,
      workflowRunId,
    }),
  );
  return bindings.some((binding) => !binding)
    ? undefined
    : bindings as WorkflowStepOutputArtifactBinding[];
}

export function workflowOutputArtifactBinding(
  snapshot: BoardSnapshot,
  target: WorkflowOutputArtifactTarget,
): WorkflowStepOutputArtifactBinding | undefined {
  const workflow = workflowRunViewForId(snapshot, target.workflowRunId);
  const step = workflow?.steps.find(
    (candidate) => candidate.record.stepRunId === target.stepRunId,
  );
  if (!step || step.status !== 'succeeded' || step.freshness !== 'current') return undefined;
  const binding = step.record.outputArtifactBindings.find(
    (candidate) => candidate.workflowOutputSlotId === target.workflowOutputSlotId,
  );
  if (!binding) return undefined;
  if (
    binding.artifactType !== target.artifactType
    || binding.outputSlotId !== target.outputSlotId
  ) throw new Error('Workflow Artifact output binding does not match the frozen target.');
  const expected = outputAssetsForTarget(snapshot, step, target.outputSlotId);
  if (
    !arraysEqual(binding.assetIds, expected.assetIds)
    || !arraysEqual(binding.executionIds, expected.executionIds)
    || binding.primaryAssetId !== expected.assetIds[0]
  ) throw new Error('Workflow Artifact output binding does not match the current Step output.');
  return binding;
}

function outputAssetsForTarget(
  snapshot: BoardSnapshot,
  step: WorkflowStepRuntimeView,
  outputSlotId: string,
): { assetIds: string[]; executionIds: string[] } {
  const executionById = new Map(snapshot.executions.map((execution) => [execution.executionId, execution]));
  if (step.record.outputAcceptancePolicy === 'automatic') {
    const execution = executionById.get(step.record.executionIds.at(-1) ?? '');
    const slot = execution?.outputSlotResults?.find((candidate) => candidate.slotId === outputSlotId);
    const assetIds = unique(slot?.assetIds ?? []).filter(
      (assetId) => execution?.status === 'succeeded' && execution.outputAssetIds.includes(assetId),
    );
    return {
      assetIds,
      executionIds: execution && assetIds.length > 0 ? [execution.executionId] : [],
    };
  }
  const accepted = new Set(step.record.acceptedOutputAssetIds);
  const assetIds: string[] = [];
  const executionIds: string[] = [];
  for (const executionId of step.record.executionIds) {
    const execution = executionById.get(executionId);
    if (!execution || execution.status !== 'succeeded') continue;
    const slot = execution.outputSlotResults?.find((candidate) => candidate.slotId === outputSlotId);
    const selected = (slot?.assetIds ?? []).filter(
      (assetId) => accepted.has(assetId) && execution.outputAssetIds.includes(assetId),
    );
    if (selected.length === 0) continue;
    executionIds.push(execution.executionId);
    assetIds.push(...selected);
  }
  return { assetIds: unique(assetIds), executionIds: unique(executionIds) };
}

function currentWorkflowStep(steps: WorkflowStepRuntimeView[]): WorkflowStepRuntimeView | undefined {
  return steps.find((step) =>
    step.status === 'queued'
    || step.status === 'running'
    || step.status === 'ready'
    || step.status === 'waiting_input'
    || step.status === 'waiting_selection',
  );
}

function scopedGateState(
  snapshot: BoardSnapshot,
  workflow: WorkflowRunRuntimeView,
  steps: WorkflowStepRuntimeView[],
): 'failed' | 'incomplete' | 'passed' | 'waiting_approval' {
  const stepIds = new Set(steps.map((step) => step.record.stepId));
  const gates = workflowGateViewsForRun(snapshot, workflow.record.workflowRunId)
    .filter((gate) => stepIds.has(gate.gateDefinitionLock.subject.stepId));
  if (gates.length === 0) return 'passed';
  if (gates.some((gate) => gate.evaluation?.status === 'failed')) return 'failed';
  if (gates.some((gate) => gate.evaluation?.status === 'waiting_approval')) return 'waiting_approval';
  return gates.every((gate) => gate.evaluation?.freshness === 'current' && gate.evaluation.status === 'passed')
    ? 'passed'
    : 'incomplete';
}

function locksEqual(
  left: { definitionHash: string; version: string; workflowId: string },
  right: { definitionHash: string; version: string; workflowId: string },
): boolean {
  return left.workflowId === right.workflowId
    && left.version === right.version
    && left.definitionHash === right.definitionHash;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
