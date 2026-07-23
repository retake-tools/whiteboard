import { operationReadinessFor } from './capabilities';
import { touchBoard } from './blockFactory';
import { capabilityDefinitionFor } from './capabilityRegistry';
import { createId, nowIso } from './id';
import { skillDefinitionFor } from './skillRegistry';
import type {
  AgentRunExecutionAction,
  AgentRunRecord,
  AgentRunStatus,
  AgentRunStopReason,
} from './agentRuntimeContracts';
import type { BlockRecord, BoardSnapshot, ExecutionRecord } from './types';
import {
  reconcileWorkflowRuntime,
  workflowRunViewForId,
  type WorkflowRunRuntimeView,
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
  const createdAt = nowIso();
  const record: AgentRunRecord = {
    agentRunId: createId('agent_run'),
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    runtimeKind: 'retake_orchestrator',
    target: {
      kind: 'workflow_run',
      workflowRunId,
      workflowDefinitionLock: structuredClone(workflow.record.workflowDefinitionLock),
    },
    scope: {
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
      workflowRunId,
      allowedStepRunIds: stepRuns.map((step) => step.stepRunId),
      allowedOperationBlockIds: stepRuns.map((step) => step.operationBlockId),
      allowedCapabilityIds: unique(stepRuns.map((step) => step.capabilityLock.capabilityId)),
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
    return {
      actionKey: `${record.agentRunId}:operation:${operation.blockId}:0`,
      agentRunId: record.agentRunId,
      operationBlockId: operation.blockId,
    };
  }
  const workflow = workflowRunViewForId(snapshot, record.target.workflowRunId);
  if (!workflow || workflow.steps.some((step) => step.status === 'queued' || step.status === 'running')) return undefined;
  const step = workflow.steps.find((candidate) => candidate.status === 'ready');
  if (!step || !record.scope.allowedStepRunIds.includes(step.record.stepRunId)) return undefined;
  if (!record.scope.allowedOperationBlockIds.includes(step.record.operationBlockId)) return undefined;
  return {
    actionKey: `${record.agentRunId}:step:${step.record.stepRunId}:${step.record.executionIds.length}`,
    agentRunId: record.agentRunId,
    operationBlockId: step.record.operationBlockId,
    stepRunId: step.record.stepRunId,
  };
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
  if (record.target.kind === 'workflow_run' && execution.workflowRunId !== record.target.workflowRunId) {
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
    (candidate) => candidate.target.kind === 'workflow_run' && candidate.target.workflowRunId === workflowRunId,
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
): Pick<AgentRunRecord, 'currentOperationBlockId' | 'error' | 'executionIds' | 'status' | 'stopReason'> | undefined {
  try {
    assertAgentRunTarget(snapshot, record);
  } catch (error) {
    return {
      status: 'failed',
      stopReason: 'target_invalid',
      error: error instanceof Error ? error.message : 'Agent Run target is invalid.',
      executionIds: record.executionIds,
      currentOperationBlockId: undefined,
    };
  }
  if (record.target.kind === 'capability') return projectCapabilityAgentRun(snapshot, record);
  return projectWorkflowAgentRun(snapshot, record);
}

function projectCapabilityAgentRun(
  snapshot: BoardSnapshot,
  record: AgentRunRecord,
): Pick<AgentRunRecord, 'currentOperationBlockId' | 'error' | 'executionIds' | 'status' | 'stopReason'> {
  if (record.target.kind !== 'capability') throw new Error('Capability Agent Run target required.');
  const operation = operationBlock(snapshot, record.target.operationBlockId);
  const executions = executionsForOperation(snapshot, operation.blockId);
  const latest = executions[0];
  if (!latest) {
    const ready = operationReadinessFor(snapshot, operation).canRun;
    return {
      status: ready ? 'running' : 'waiting_input',
      stopReason: undefined,
      error: undefined,
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

function projectWorkflowAgentRun(
  snapshot: BoardSnapshot,
  record: AgentRunRecord,
): Pick<AgentRunRecord, 'currentOperationBlockId' | 'error' | 'executionIds' | 'status' | 'stopReason'> {
  if (record.target.kind !== 'workflow_run') throw new Error('Workflow Agent Run target required.');
  const workflow = workflowRunViewForId(snapshot, record.target.workflowRunId);
  if (!workflow) throw new Error(`Workflow Run not found: ${record.target.workflowRunId}`);
  const executionIds = workflow.steps.flatMap((step) => step.record.executionIds);
  const current = workflow.steps.find((step) =>
    step.status === 'queued'
    || step.status === 'running'
    || step.status === 'ready'
    || step.status === 'waiting_input'
    || step.status === 'waiting_selection',
  );
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
  if (record.target.kind === 'capability') {
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
  const workflow = workflowRunViewForId(snapshot, record.target.workflowRunId);
  if (!workflow || record.scope.workflowRunId !== workflow.record.workflowRunId) {
    throw new Error('Agent Run Workflow target is missing.');
  }
  if (!locksEqual(record.target.workflowDefinitionLock, workflow.record.workflowDefinitionLock)) {
    throw new Error('Agent Run Workflow Definition lock changed.');
  }
  const stepRunIds = workflow.steps.map((step) => step.record.stepRunId);
  const operationBlockIds = workflow.steps.map((step) => step.record.operationBlockId);
  const capabilityIds = unique(workflow.steps.map((step) => step.record.capabilityLock.capabilityId));
  if (
    !arraysEqual(record.scope.allowedStepRunIds, stepRunIds)
    || !arraysEqual(record.scope.allowedOperationBlockIds, operationBlockIds)
    || !arraysEqual(record.scope.allowedCapabilityIds, capabilityIds)
  ) throw new Error('Agent Run Workflow scope changed.');
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
    'currentOperationBlockId' | 'error' | 'executionIds' | 'status' | 'stopReason'>>,
): void {
  Object.assign(record, values, { updatedAt: nowIso(), recordVersion: record.recordVersion + 1 });
  if (values.error === undefined) delete record.error;
  if (values.stopReason === undefined) delete record.stopReason;
  if (values.currentOperationBlockId === undefined) delete record.currentOperationBlockId;
}

function locksEqual(
  left: { definitionHash: string; version: string; workflowId: string },
  right: { definitionHash: string; version: string; workflowId: string },
): boolean {
  return left.workflowId === right.workflowId && left.version === right.version && left.definitionHash === right.definitionHash;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
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
