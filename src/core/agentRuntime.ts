import { operationReadinessFor } from './capabilities';
import { assertAgentPresetSnapshotForRun } from './agentPresetApplication';
import { touchBoard } from './blockFactory';
import { capabilityDefinitionFor } from './capabilityRegistry';
import { createId, nowIso } from './id';
import type { GoalPlanSnapshotV1 } from './goalPlanContracts';
import { skillDefinitionFor } from './skillRegistry';
import type {
  AgentRunExecutionAction,
  AgentRunRecord,
  AgentRunStatus,
  AgentRunStopReason,
  AgentWorkflowGateCompletion,
} from './agentRuntimeContracts';
import {
  assertWorkflowAgentTarget,
  nextWorkflowAgentExecutionAction,
  projectWorkflowAgentRun,
  workflowArtifactTargetBinding,
  workflowAgentScope,
  workflowOutputArtifactBinding,
} from './agentWorkflowRuntime';
import type { BlockRecord, BoardSnapshot, ExecutionRecord } from './types';
import {
  reconcileWorkflowRuntime,
  workflowRunViewForId,
} from './workflowRuntime';

const activeStatuses = new Set<AgentRunStatus>([
  'queued',
  'running',
  'waiting_input',
  'waiting_selection',
  'waiting_approval',
  'paused',
  'needs_attention',
]);

export interface AgentRunRuntimeView {
  canCancel: boolean;
  canPause: boolean;
  canResume: boolean;
  record: AgentRunRecord;
  status: AgentRunStatus;
}

export function createAgentRunForWorkflowRun(
  snapshot: BoardSnapshot,
  workflowRunId: string,
): AgentRunRuntimeView {
  reconcileWorkflowRuntime(snapshot);
  assertNoActiveAgentRun(snapshot);
  const workflow = workflowRunViewForId(snapshot, workflowRunId);
  if (!workflow) throw new Error(`Workflow Run not found: ${workflowRunId}`);
  const stepRuns = workflow.steps.map((step) => step.record);
  if (stepRuns.length === 0) throw new Error(`Workflow Run has no StepRuns: ${workflowRunId}`);
  const target = {
    kind: 'workflow_run' as const,
    workflowRunId,
    workflowDefinitionLock: structuredClone(workflow.record.workflowDefinitionLock),
  };
  const createdAt = nowIso();
  const record: AgentRunRecord = {
    agentRunId: createId('agent_run'),
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    runtimeKind: 'retake_orchestrator',
    target,
    scope: {
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
      workflowRunId,
      ...workflowAgentScope(workflow, target),
    },
    stopPolicy: { kind: 'workflow_terminal' },
    permissions: defaultPermissions(),
    status: 'queued',
    executionIds: [],
    ...(workflow.record.entrypointId ? { entrypointId: workflow.record.entrypointId } : {}),
    ...(workflow.record.sourcePackageLock ? { sourcePackageLock: structuredClone(workflow.record.sourcePackageLock) } : {}),
    createdBy: 'user',
    createdAt,
    updatedAt: createdAt,
    recordVersion: 1,
  };
  snapshot.agentRuns = [...(snapshot.agentRuns ?? []), record];
  touchBoard(snapshot);
  return agentRunView(record);
}

export function createAgentRunForGoalPlan(
  snapshot: BoardSnapshot,
  input: {
    goalPlanSnapshot: GoalPlanSnapshotV1;
    sourceChangeProposalId: string;
    workflowRunId: string;
  },
): AgentRunRuntimeView {
  reconcileWorkflowRuntime(snapshot);
  assertNoActiveAgentRun(snapshot);
  const workflow = workflowRunViewForId(snapshot, input.workflowRunId);
  if (!workflow) throw new Error(`Workflow Run not found: ${input.workflowRunId}`);
  if (workflow.steps.length === 0) {
    throw new Error(`Goal Plan Workflow Run has no StepRuns: ${input.workflowRunId}`);
  }
  const selected = input.goalPlanSnapshot.selectedWorkflow;
  if (
    selected.workflowDefinitionLock.workflowDefinitionId
      !== workflow.record.workflowDefinitionLock.workflowId
    || selected.workflowDefinitionLock.version
      !== workflow.record.workflowDefinitionLock.version
    || selected.workflowDefinitionLock.definitionHash
      !== workflow.record.workflowDefinitionLock.definitionHash
    || selected.entrypointId !== workflow.record.entrypointId
    || JSON.stringify(selected.packageLock) !== JSON.stringify(workflow.record.sourcePackageLock)
    || workflow.record.sourceChangeProposalId !== input.sourceChangeProposalId
  ) throw new Error('Goal Plan Workflow Run provenance does not match the approved plan.');
  const target = {
    goalPlanSnapshot: structuredClone(input.goalPlanSnapshot),
    kind: 'goal' as const,
    workflowDefinitionLock: structuredClone(workflow.record.workflowDefinitionLock),
    workflowRunId: workflow.record.workflowRunId,
  };
  const createdAt = nowIso();
  const record: AgentRunRecord = {
    agentRunId: createId('agent_run'),
    boardId: snapshot.board.boardId,
    createdAt,
    createdBy: 'user',
    entrypointId: selected.entrypointId,
    executionIds: [],
    permissions: defaultPermissions(),
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    runtimeKind: 'retake_orchestrator',
    scope: {
      boardId: snapshot.board.boardId,
      projectId: snapshot.project.projectId,
      workflowRunId: workflow.record.workflowRunId,
      ...workflowAgentScope(workflow, target),
    },
    sourceChangeProposalId: input.sourceChangeProposalId,
    sourcePackageLock: structuredClone(selected.packageLock),
    status: 'queued',
    stopPolicy: { kind: 'goal_plan_terminal' },
    target,
    updatedAt: createdAt,
  };
  snapshot.agentRuns = [...(snapshot.agentRuns ?? []), record];
  touchBoard(snapshot);
  return agentRunView(record);
}

export function createAgentRunForWorkflowSlice(
  snapshot: BoardSnapshot,
  workflowRunId: string,
  stepRunId: string,
): AgentRunRuntimeView {
  reconcileWorkflowRuntime(snapshot);
  assertNoActiveAgentRun(snapshot);
  const workflow = workflowRunViewForId(snapshot, workflowRunId);
  if (!workflow) throw new Error(`Workflow Run not found: ${workflowRunId}`);
  const step = workflow.steps.find((candidate) => candidate.record.stepRunId === stepRunId);
  if (!step) throw new Error(`Workflow Slice target StepRun not found: ${stepRunId}`);
  const target = {
    kind: 'workflow_slice' as const,
    workflowRunId,
    workflowDefinitionLock: structuredClone(workflow.record.workflowDefinitionLock),
    until: {
      kind: 'step' as const,
      stepId: step.record.stepId,
      stepRunId: step.record.stepRunId,
    },
  };
  const createdAt = nowIso();
  const record: AgentRunRecord = {
    agentRunId: createId('agent_run'),
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    runtimeKind: 'retake_orchestrator',
    target,
    scope: {
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
      workflowRunId,
      ...workflowAgentScope(workflow, target),
    },
    stopPolicy: { kind: 'workflow_slice_target' },
    permissions: defaultPermissions(),
    status: 'queued',
    executionIds: [],
    ...(workflow.record.entrypointId ? { entrypointId: workflow.record.entrypointId } : {}),
    ...(workflow.record.sourcePackageLock ? { sourcePackageLock: structuredClone(workflow.record.sourcePackageLock) } : {}),
    createdBy: 'user',
    createdAt,
    updatedAt: createdAt,
    recordVersion: 1,
  };
  snapshot.agentRuns = [...(snapshot.agentRuns ?? []), record];
  touchBoard(snapshot);
  return agentRunView(record);
}

export function createAgentRunForWorkflowArtifactSlice(
  snapshot: BoardSnapshot,
  workflowRunId: string,
  workflowOutputSlotId: string,
): AgentRunRuntimeView {
  reconcileWorkflowRuntime(snapshot);
  assertNoActiveAgentRun(snapshot);
  const workflow = workflowRunViewForId(snapshot, workflowRunId);
  if (!workflow) throw new Error(`Workflow Run not found: ${workflowRunId}`);
  const output = workflow.record.outputSlotLocks.find(
    (candidate) => candidate.workflowOutputSlotId === workflowOutputSlotId,
  );
  if (!output) throw new Error(`Workflow output Slot lock not found: ${workflowOutputSlotId}`);
  const step = workflow.steps.find((candidate) => candidate.record.stepId === output.stepId);
  if (!step) throw new Error(`Workflow Artifact target StepRun not found: ${output.stepId}`);
  const target = {
    kind: 'workflow_slice' as const,
    workflowRunId,
    workflowDefinitionLock: structuredClone(workflow.record.workflowDefinitionLock),
    until: {
      artifactScope: 'workflow_run' as const,
      artifactType: output.artifactType,
      kind: 'artifact' as const,
      outputSlotId: output.outputSlotId,
      semanticKey: `workflow_output:${output.workflowOutputSlotId}`,
      stepId: output.stepId,
      stepRunId: step.record.stepRunId,
      workflowOutputSlotId: output.workflowOutputSlotId,
    },
  };
  const createdAt = nowIso();
  const record: AgentRunRecord = {
    agentRunId: createId('agent_run'),
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    runtimeKind: 'retake_orchestrator',
    target,
    scope: {
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
      workflowRunId,
      ...workflowAgentScope(workflow, target),
    },
    stopPolicy: { kind: 'workflow_slice_target' },
    permissions: defaultPermissions(),
    status: 'queued',
    executionIds: [],
    ...(workflow.record.entrypointId ? { entrypointId: workflow.record.entrypointId } : {}),
    ...(workflow.record.sourcePackageLock ? { sourcePackageLock: structuredClone(workflow.record.sourcePackageLock) } : {}),
    createdBy: 'user',
    createdAt,
    updatedAt: createdAt,
    recordVersion: 1,
  };
  snapshot.agentRuns = [...(snapshot.agentRuns ?? []), record];
  touchBoard(snapshot);
  return agentRunView(record);
}

export function createAgentRunForWorkflowStageSlice(
  snapshot: BoardSnapshot,
  workflowRunId: string,
  stageId: string,
): AgentRunRuntimeView {
  reconcileWorkflowRuntime(snapshot);
  assertNoActiveAgentRun(snapshot);
  const workflow = workflowRunViewForId(snapshot, workflowRunId);
  if (!workflow) throw new Error(`Workflow Run not found: ${workflowRunId}`);
  const stage = workflow.stages.find(
    (candidate) => candidate.stageDefinitionLock.stageId === stageId,
  );
  if (!stage) throw new Error(`Workflow Stage lock not found: ${stageId}`);
  const stepRunByStepId = new Map(
    workflow.steps.map((step) => [step.record.stepId, step.record.stepRunId]),
  );
  const outputTargets = [...stage.stageDefinitionLock.outputSlotLocks]
    .sort((left, right) => left.workflowOutputSlotId.localeCompare(right.workflowOutputSlotId))
    .map((output) => {
      const stepRunId = stepRunByStepId.get(output.stepId);
      if (!stepRunId) {
        throw new Error(`Workflow Stage output StepRun not found: ${stageId}.${output.stepId}`);
      }
      return {
        artifactScope: output.artifactScope,
        artifactType: output.artifactType,
        outputSlotId: output.outputSlotId,
        semanticKey: output.semanticKey,
        stepId: output.stepId,
        stepRunId,
        workflowOutputSlotId: output.workflowOutputSlotId,
      };
    });
  const target = {
    kind: 'workflow_slice' as const,
    workflowRunId,
    workflowDefinitionLock: structuredClone(workflow.record.workflowDefinitionLock),
    until: {
      kind: 'stage' as const,
      stageId: stage.stageDefinitionLock.stageId,
      stageTypeId: stage.stageDefinitionLock.stageTypeId,
      requiredStepRunIds: [...stage.requiredStepRunIds],
      outputTargets,
    },
  };
  const createdAt = nowIso();
  const record: AgentRunRecord = {
    agentRunId: createId('agent_run'),
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    runtimeKind: 'retake_orchestrator',
    target,
    scope: {
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
      workflowRunId,
      ...workflowAgentScope(workflow, target),
    },
    stopPolicy: { kind: 'workflow_slice_target' },
    permissions: defaultPermissions(),
    status: 'queued',
    executionIds: [],
    satisfiedArtifactRevisionIds: [],
    ...(workflow.record.entrypointId ? { entrypointId: workflow.record.entrypointId } : {}),
    ...(workflow.record.sourcePackageLock ? { sourcePackageLock: structuredClone(workflow.record.sourcePackageLock) } : {}),
    createdBy: 'user',
    createdAt,
    updatedAt: createdAt,
    recordVersion: 1,
  };
  snapshot.agentRuns = [...(snapshot.agentRuns ?? []), record];
  touchBoard(snapshot);
  return agentRunView(record);
}

export function createAgentRunForWorkflowGateSlice(
  snapshot: BoardSnapshot,
  workflowRunId: string,
  gateId: string,
  completion: AgentWorkflowGateCompletion,
): AgentRunRuntimeView {
  reconcileWorkflowRuntime(snapshot);
  assertNoActiveAgentRun(snapshot);
  const workflow = workflowRunViewForId(snapshot, workflowRunId);
  if (!workflow) throw new Error(`Workflow Run not found: ${workflowRunId}`);
  const gateDefinitionLock = workflow.record.gateDefinitionLocks.find(
    (candidate) => candidate.gateId === gateId,
  );
  if (!gateDefinitionLock) throw new Error(`Workflow Gate lock not found: ${gateId}`);
  const subjectStep = workflow.steps.find(
    (step) => step.record.stepId === gateDefinitionLock.subject.stepId,
  );
  if (!subjectStep) {
    throw new Error(`Workflow Gate subject StepRun not found: ${gateDefinitionLock.subject.stepId}`);
  }
  const target = {
    kind: 'workflow_slice' as const,
    workflowRunId,
    workflowDefinitionLock: structuredClone(workflow.record.workflowDefinitionLock),
    until: {
      completion,
      gateDefinitionLock: structuredClone(gateDefinitionLock),
      kind: 'gate' as const,
      subjectStepRunId: subjectStep.record.stepRunId,
    },
  };
  const createdAt = nowIso();
  const record: AgentRunRecord = {
    agentRunId: createId('agent_run'),
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    runtimeKind: 'retake_orchestrator',
    target,
    scope: {
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
      workflowRunId,
      ...workflowAgentScope(workflow, target),
    },
    stopPolicy: { kind: 'workflow_slice_target' },
    permissions: defaultPermissions(),
    status: 'queued',
    executionIds: [],
    ...(workflow.record.entrypointId ? { entrypointId: workflow.record.entrypointId } : {}),
    ...(workflow.record.sourcePackageLock
      ? { sourcePackageLock: structuredClone(workflow.record.sourcePackageLock) }
      : {}),
    createdBy: 'user',
    createdAt,
    updatedAt: createdAt,
    recordVersion: 1,
  };
  snapshot.agentRuns = [...(snapshot.agentRuns ?? []), record];
  touchBoard(snapshot);
  return agentRunView(record);
}

export function createAgentRunForOperation(
  snapshot: BoardSnapshot,
  operationBlockId: string,
): AgentRunRuntimeView {
  assertNoActiveAgentRun(snapshot);
  const operation = operationBlock(snapshot, operationBlockId);
  const capabilityId = stringValue(operation.data.capabilityId);
  if (!capabilityId) throw new Error(`Operation Capability is missing: ${operationBlockId}`);
  const capability = capabilityDefinitionFor(capabilityId);
  const skillId = stringValue(operation.data.skillId);
  const skill = skillId ? skillDefinitionFor(skillId) : undefined;
  const createdAt = nowIso();
  const packageContext = packageContextFromBlock(operation);
  const record: AgentRunRecord = {
    agentRunId: createId('agent_run'),
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    runtimeKind: 'retake_orchestrator',
    target: {
      kind: 'capability',
      operationBlockId,
      capabilityLock: {
        capabilityId: capability.capabilityId,
        version: capability.version,
        definitionHash: capability.definitionHash,
      },
      ...(skill ? {
        skillLock: {
          skillId: skill.skillId,
          version: skill.version,
          definitionHash: skill.definitionHash,
        },
      } : {}),
    },
    scope: {
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
      allowedStepRunIds: [],
      allowedOperationBlockIds: [operationBlockId],
      allowedCapabilityIds: [capabilityId],
    },
    stopPolicy: { kind: 'capability_completed' },
    permissions: defaultPermissions(),
    status: 'queued',
    executionIds: [],
    ...(packageContext ?? {}),
    createdBy: 'user',
    createdAt,
    updatedAt: createdAt,
    recordVersion: 1,
  };
  snapshot.agentRuns = [...(snapshot.agentRuns ?? []), record];
  touchBoard(snapshot);
  return agentRunView(record);
}

export function startAgentRun(snapshot: BoardSnapshot, agentRunId: string): AgentRunRuntimeView {
  const record = agentRunRecord(snapshot, agentRunId);
  if (record.status !== 'queued' && record.status !== 'paused') {
    throw new Error(`Agent Run cannot start from status: ${record.status}`);
  }
  assertAgentRunTarget(snapshot, record);
  updateAgentRun(record, {
    status: 'running',
    stopReason: undefined,
    error: undefined,
  });
  touchBoard(snapshot);
  return agentRunView(record);
}

export function pauseAgentRun(snapshot: BoardSnapshot, agentRunId: string): AgentRunRuntimeView {
  const record = agentRunRecord(snapshot, agentRunId);
  if (
    record.status !== 'running'
    && record.status !== 'waiting_input'
    && record.status !== 'waiting_selection'
    && record.status !== 'waiting_approval'
  ) {
    throw new Error(`Agent Run cannot pause from status: ${record.status}`);
  }
  updateAgentRun(record, { status: 'paused', stopReason: 'user_paused' });
  touchBoard(snapshot);
  return agentRunView(record);
}

export function cancelAgentRun(snapshot: BoardSnapshot, agentRunId: string): AgentRunRuntimeView {
  const record = agentRunRecord(snapshot, agentRunId);
  if (!activeStatuses.has(record.status)) throw new Error(`Agent Run cannot cancel from status: ${record.status}`);
  updateAgentRun(record, {
    status: 'canceled',
    stopReason: 'user_canceled',
    currentOperationBlockId: undefined,
  });
  touchBoard(snapshot);
  return agentRunView(record);
}

export function markAgentRunNeedsAttention(
  snapshot: BoardSnapshot,
  agentRunId: string,
  error: string,
): AgentRunRuntimeView {
  const record = agentRunRecord(snapshot, agentRunId);
  if (!activeStatuses.has(record.status)) return agentRunView(record);
  updateAgentRun(record, {
    error,
    status: 'needs_attention',
  });
  touchBoard(snapshot);
  return agentRunView(record);
}

export function reconcileAgentRuntime(snapshot: BoardSnapshot): boolean {
  reconcileWorkflowRuntime(snapshot);
  let changed = false;
  for (const record of snapshot.agentRuns ?? []) {
    if (record.status === 'queued' || record.status === 'paused' || record.status === 'canceled' || record.status === 'succeeded') {
      continue;
    }
    const projection = projectAgentRun(snapshot, record);
    if (!projection) continue;
    if (
      record.status === projection.status
      && record.stopReason === projection.stopReason
      && record.error === projection.error
      && record.currentOperationBlockId === projection.currentOperationBlockId
      && record.satisfiedArtifactRevisionId === projection.satisfiedArtifactRevisionId
      && optionalArraysEqual(record.satisfiedArtifactRevisionIds, projection.satisfiedArtifactRevisionIds)
      && record.satisfiedGateEvaluationId === projection.satisfiedGateEvaluationId
      && arraysEqual(record.executionIds, projection.executionIds)
    ) continue;
    updateAgentRun(record, projection);
    changed = true;
  }
  if (changed) touchBoard(snapshot);
  return changed;
}

export function nextAgentRunExecutionAction(snapshot: BoardSnapshot): AgentRunExecutionAction | undefined {
  reconcileWorkflowRuntime(snapshot);
  const record = (snapshot.agentRuns ?? []).find((candidate) => candidate.status === 'running');
  if (!record) return undefined;
  try {
    assertAgentRunTarget(snapshot, record);
  } catch {
    return undefined;
  }
  if (record.target.kind === 'capability') {
    const executions = executionsForOperation(snapshot, record.target.operationBlockId);
    if (executions.length > 0) return undefined;
    const operation = operationBlock(snapshot, record.target.operationBlockId);
    if (!operationReadinessFor(snapshot, operation).canRun) return undefined;
    if (capabilityRequiresExplicitProviderAuthorization(executionCapabilityId(operation))) {
      return undefined;
    }
    return {
      actionKey: `${record.agentRunId}:operation:${operation.blockId}:0`,
      agentRunId: record.agentRunId,
      operationBlockId: operation.blockId,
    };
  }
  return nextWorkflowAgentExecutionAction(snapshot, record);
}

export function attachAgentRunExecution(
  snapshot: BoardSnapshot,
  agentRunId: string,
  executionId: string,
): void {
  const record = agentRunRecord(snapshot, agentRunId);
  const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
  if (!execution) throw new Error(`Agent Run Execution not found: ${executionId}`);
  const operationBlockId = typeof execution.params?.operationBlockId === 'string'
    ? execution.params.operationBlockId
    : undefined;
  if (
    !operationBlockId
    || !record.scope.allowedOperationBlockIds.includes(operationBlockId)
    || !record.scope.allowedCapabilityIds.includes(execution.capabilityId)
  ) throw new Error('Execution is outside the Agent Run scope.');
  if (record.target.kind === 'capability' && operationBlockId !== record.target.operationBlockId) {
    throw new Error('Execution does not match the Agent Run Capability target.');
  }
  if (record.target.kind !== 'capability' && execution.workflowRunId !== record.target.workflowRunId) {
    throw new Error('Execution does not match the Agent Run Workflow target.');
  }
  if (execution.agentRunId && execution.agentRunId !== record.agentRunId) {
    throw new Error(`Execution already belongs to another Agent Run: ${execution.agentRunId}`);
  }
  execution.agentRunId = record.agentRunId;
  touchBoard(snapshot);
}

export function latestAgentRunForWorkflowRun(
  snapshot: BoardSnapshot,
  workflowRunId: string,
): AgentRunRuntimeView | undefined {
  const record = [...(snapshot.agentRuns ?? [])].reverse().find(
    (candidate) => candidate.target.kind !== 'capability' && candidate.target.workflowRunId === workflowRunId,
  );
  return record ? agentRunView(record) : undefined;
}

export function agentRunViewForId(snapshot: BoardSnapshot, agentRunId: string): AgentRunRuntimeView | undefined {
  const record = (snapshot.agentRuns ?? []).find((candidate) => candidate.agentRunId === agentRunId);
  return record ? agentRunView(record) : undefined;
}

function projectAgentRun(
  snapshot: BoardSnapshot,
  record: AgentRunRecord,
): Pick<AgentRunRecord,
  'currentOperationBlockId' | 'error' | 'executionIds' | 'satisfiedArtifactRevisionId'
  | 'satisfiedArtifactRevisionIds' | 'satisfiedGateEvaluationId' | 'status' | 'stopReason'
> | undefined {
  try {
    assertAgentRunTarget(snapshot, record);
  } catch (error) {
    return {
      status: 'failed',
      stopReason: 'target_invalid',
      error: error instanceof Error ? error.message : 'Agent Run target is invalid.',
      executionIds: record.executionIds,
      satisfiedArtifactRevisionId: record.satisfiedArtifactRevisionId,
      satisfiedArtifactRevisionIds: record.satisfiedArtifactRevisionIds,
      satisfiedGateEvaluationId: record.satisfiedGateEvaluationId,
      currentOperationBlockId: undefined,
    };
  }
  if (record.target.kind === 'capability') return projectCapabilityAgentRun(snapshot, record);
  return projectWorkflowAgentRun(snapshot, record);
}

function projectCapabilityAgentRun(
  snapshot: BoardSnapshot,
  record: AgentRunRecord,
): Pick<AgentRunRecord,
  'currentOperationBlockId' | 'error' | 'executionIds' | 'satisfiedArtifactRevisionId'
  | 'satisfiedArtifactRevisionIds' | 'satisfiedGateEvaluationId' | 'status' | 'stopReason'
> {
  if (record.target.kind !== 'capability') throw new Error('Capability Agent Run target required.');
  const operation = operationBlock(snapshot, record.target.operationBlockId);
  const executions = executionsForOperation(snapshot, operation.blockId);
  const latest = executions[0];
  if (!latest) {
    const ready = operationReadinessFor(snapshot, operation).canRun;
    const authorizationRequired = ready
      && capabilityRequiresExplicitProviderAuthorization(executionCapabilityId(operation));
    return {
      status: ready && !authorizationRequired ? 'running' : 'waiting_input',
      stopReason: authorizationRequired
        ? 'provider_execution_authorization_required'
        : undefined,
      error: authorizationRequired
        ? 'Explicit user Provider authorization is required before this Capability can execute.'
        : undefined,
      executionIds: [],
      currentOperationBlockId: operation.blockId,
    };
  }
  if (latest.status === 'succeeded') {
    return {
      status: 'succeeded',
      stopReason: 'capability_completed',
      error: undefined,
      executionIds: executions.map((execution) => execution.executionId),
      currentOperationBlockId: undefined,
    };
  }
  if (latest.status === 'failed' || latest.status === 'canceled') {
    return {
      status: 'needs_attention',
      stopReason: undefined,
      error: latest.errorMessage,
      executionIds: executions.map((execution) => execution.executionId),
      currentOperationBlockId: operation.blockId,
    };
  }
  return {
    status: 'running',
    stopReason: undefined,
    error: undefined,
    executionIds: executions.map((execution) => execution.executionId),
    currentOperationBlockId: operation.blockId,
  };
}

function executionCapabilityId(operation: BlockRecord): string {
  const capabilityId = operation.data.capabilityId;
  if (typeof capabilityId !== 'string' || !capabilityId) {
    throw new Error(`Operation Capability is missing: ${operation.blockId}`);
  }
  return capabilityId;
}

function capabilityRequiresExplicitProviderAuthorization(
  capabilityId: string,
): boolean {
  return capabilityDefinitionFor(capabilityId).runtimeRequirements.includes(
    'explicit_external_action_authorization',
  );
}

export function acceptVerifiedAgentArtifactRevision(
  snapshot: BoardSnapshot,
  input: {
    agentRunId: string;
    artifactRevisionId: string;
    expectedAgentRunVersion: number;
  },
): AgentRunRuntimeView {
  const record = agentRunRecord(snapshot, input.agentRunId);
  if (
    record.target.kind !== 'workflow_slice'
    || record.target.until.kind !== 'artifact'
  ) throw new Error('Agent Run Artifact Slice target required.');
  if (record.recordVersion !== input.expectedAgentRunVersion) {
    throw new Error(`Agent Run version conflict: ${record.agentRunId}`);
  }
  const binding = workflowArtifactTargetBinding(snapshot, record);
  if (!binding || binding.artifactRevisionId !== input.artifactRevisionId) {
    throw new Error('Verified Artifact Revision does not match the current Workflow output binding.');
  }
  updateAgentRun(record, {
    satisfiedArtifactRevisionId: input.artifactRevisionId,
  });
  reconcileAgentRuntime(snapshot);
  touchBoard(snapshot);
  return agentRunView(record);
}

export function acceptVerifiedAgentStageArtifactRevisions(
  snapshot: BoardSnapshot,
  input: {
    agentRunId: string;
    artifactRevisionIds: string[];
    expectedAgentRunVersion: number;
  },
): AgentRunRuntimeView {
  const record = agentRunRecord(snapshot, input.agentRunId);
  if (
    record.target.kind !== 'workflow_slice'
    || record.target.until.kind !== 'stage'
  ) throw new Error('Agent Run Stage Slice target required.');
  if (record.recordVersion !== input.expectedAgentRunVersion) {
    throw new Error(`Agent Run version conflict: ${record.agentRunId}`);
  }
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
  if (
    bindings.some((binding) => !binding)
    || !arraysEqual(
      bindings.map((binding) => binding?.artifactRevisionId ?? ''),
      input.artifactRevisionIds,
    )
  ) throw new Error('Verified Stage Artifact Revisions do not match the current Workflow output bindings.');
  updateAgentRun(record, {
    satisfiedArtifactRevisionIds: [...input.artifactRevisionIds],
  });
  reconcileAgentRuntime(snapshot);
  touchBoard(snapshot);
  return agentRunView(record);
}

function assertAgentRunTarget(snapshot: BoardSnapshot, record: AgentRunRecord): void {
  if (record.projectId !== snapshot.project.projectId || record.scope.projectId !== snapshot.project.projectId) {
    throw new Error('Agent Run Project scope does not match the Board.');
  }
  if (record.boardId !== snapshot.board.boardId || record.scope.boardId !== snapshot.board.boardId) {
    throw new Error('Agent Run Board scope does not match the Board.');
  }
  if (
    !record.permissions
    || !arraysEqual(record.permissions.allowedToolPermissions, ['retake.read', 'retake.execute_capability'])
    || record.permissions.canCreateBlocks
    || record.permissions.canDeleteAssets
    || record.permissions.canInstallPackages
    || record.permissions.canModifyWorkflow
  ) throw new Error('Agent Run permissions exceed the V0 execution boundary.');
  assertAgentPresetSnapshotForRun(snapshot, record);
  if (record.target.kind === 'capability') {
    if (record.stopPolicy.kind !== 'capability_completed') {
      throw new Error('Agent Run Capability stop policy changed.');
    }
    const operation = operationBlock(snapshot, record.target.operationBlockId);
    if (operation.data.capabilityId !== record.target.capabilityLock.capabilityId) {
      throw new Error('Agent Run Capability target changed.');
    }
    const capability = capabilityDefinitionFor(record.target.capabilityLock.capabilityId);
    if (
      capability.version !== record.target.capabilityLock.version
      || capability.definitionHash !== record.target.capabilityLock.definitionHash
    ) throw new Error('Agent Run Capability Definition lock changed.');
    const operationSkillId = stringValue(operation.data.skillId);
    if (record.target.skillLock) {
      const skill = operationSkillId ? skillDefinitionFor(operationSkillId) : undefined;
      if (
        !skill
        || skill.skillId !== record.target.skillLock.skillId
        || skill.version !== record.target.skillLock.version
        || skill.definitionHash !== record.target.skillLock.definitionHash
      ) throw new Error('Agent Run Skill Definition lock changed.');
    } else if (operationSkillId) {
      throw new Error('Agent Run Capability target gained a Skill outside its lock.');
    }
    if (
      !record.scope.allowedOperationBlockIds.includes(operation.blockId)
      || !record.scope.allowedCapabilityIds.includes(record.target.capabilityLock.capabilityId)
      || record.scope.allowedOperationBlockIds.length !== 1
    ) throw new Error('Agent Run Capability scope is invalid.');
    return;
  }
  assertWorkflowAgentTarget(snapshot, record);
}

function assertNoActiveAgentRun(snapshot: BoardSnapshot): void {
  const active = (snapshot.agentRuns ?? []).find((record) => activeStatuses.has(record.status));
  if (active) throw new Error(`Board already has an active Agent Run: ${active.agentRunId}`);
}

function agentRunRecord(snapshot: BoardSnapshot, agentRunId: string): AgentRunRecord {
  const record = (snapshot.agentRuns ?? []).find((candidate) => candidate.agentRunId === agentRunId);
  if (!record) throw new Error(`Agent Run not found: ${agentRunId}`);
  return record;
}

function agentRunView(record: AgentRunRecord): AgentRunRuntimeView {
  return {
    record,
    status: record.status,
    canPause:
      record.status === 'running'
      || record.status === 'waiting_input'
      || record.status === 'waiting_selection'
      || record.status === 'waiting_approval',
    canResume: record.status === 'paused',
    canCancel: activeStatuses.has(record.status),
  };
}

function operationBlock(snapshot: BoardSnapshot, operationBlockId: string): BlockRecord {
  const operation = snapshot.blocks.find((block) => block.blockId === operationBlockId && block.type === 'operation');
  if (!operation) throw new Error(`Agent Run Operation not found: ${operationBlockId}`);
  return operation;
}

function executionsForOperation(snapshot: BoardSnapshot, operationBlockId: string): ExecutionRecord[] {
  return snapshot.executions.filter((execution) => execution.params?.operationBlockId === operationBlockId);
}

function packageContextFromBlock(block: BlockRecord): {
  entrypointId: string;
  sourcePackageLock: { digest: string; packageId: string; version: string };
} | undefined {
  const entrypointId = stringValue(block.data.packageEntryPointId);
  const packageId = stringValue(block.data.packageId);
  const version = stringValue(block.data.packageVersion);
  const digest = stringValue(block.data.packageDigest);
  if (!entrypointId && !packageId && !version && !digest) return undefined;
  if (!entrypointId || !packageId || !version || !digest) throw new Error('Agent Run Package provenance is incomplete.');
  return { entrypointId, sourcePackageLock: { packageId, version, digest } };
}

function updateAgentRun(
  record: AgentRunRecord,
  values: Partial<Pick<AgentRunRecord,
    'currentOperationBlockId' | 'error' | 'executionIds' | 'satisfiedArtifactRevisionId'
    | 'satisfiedArtifactRevisionIds' | 'satisfiedGateEvaluationId' | 'status' | 'stopReason'>>,
): void {
  Object.assign(record, values, { updatedAt: nowIso(), recordVersion: record.recordVersion + 1 });
  if ('error' in values && values.error === undefined) delete record.error;
  if ('stopReason' in values && values.stopReason === undefined) delete record.stopReason;
  if ('currentOperationBlockId' in values && values.currentOperationBlockId === undefined) {
    delete record.currentOperationBlockId;
  }
  if ('satisfiedArtifactRevisionId' in values && values.satisfiedArtifactRevisionId === undefined) {
    delete record.satisfiedArtifactRevisionId;
  }
  if ('satisfiedArtifactRevisionIds' in values && values.satisfiedArtifactRevisionIds === undefined) {
    delete record.satisfiedArtifactRevisionIds;
  }
  if ('satisfiedGateEvaluationId' in values && values.satisfiedGateEvaluationId === undefined) {
    delete record.satisfiedGateEvaluationId;
  }
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function optionalArraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  if (!left || !right) return left === right;
  return arraysEqual(left, right);
}

function defaultPermissions(): AgentRunRecord['permissions'] {
  return {
    allowedToolPermissions: ['retake.read', 'retake.execute_capability'],
    canCreateBlocks: false,
    canDeleteAssets: false,
    canInstallPackages: false,
    canModifyWorkflow: false,
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
