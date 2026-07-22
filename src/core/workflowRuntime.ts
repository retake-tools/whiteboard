import { operationReadinessFor } from './capabilities';
import { touchBoard } from './blockFactory';
import {
  configurationFingerprint,
  currentOperationConfiguration,
} from './executionConfiguration';
import { createId, nowIso } from './id';
import type { BlockRecord, BoardSnapshot, ExecutionRecord } from './types';
import { workflowDefinitionFor } from './workflowRegistry';
import type {
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowStepRunFreshness,
  WorkflowStepRunRecord,
  WorkflowStepRunStatus,
} from './workflowRuntimeContracts';

export interface WorkflowStepRuntimeView {
  canStart: boolean;
  freshness: WorkflowStepRunFreshness;
  record: WorkflowStepRunRecord;
  status: WorkflowStepRunStatus;
}

export interface WorkflowRunRuntimeView {
  currentStepIds: string[];
  record: WorkflowRunRecord;
  status: WorkflowRunStatus;
  steps: WorkflowStepRuntimeView[];
}

export function createWorkflowRunForGroup(
  snapshot: BoardSnapshot,
  groupId: string,
): WorkflowRunRuntimeView {
  const group = snapshot.blocks.find((block) => block.blockId === groupId && block.type === 'group');
  if (!group || group.data.groupKind !== 'workflow') {
    throw new Error(`Workflow Group not found: ${groupId}`);
  }
  const existing = workflowRunViewForGroup(snapshot, groupId);
  if (existing) return existing;

  const workflowId = stringMetadata(group, 'workflowDefinitionId');
  const workflowVersion = stringMetadata(group, 'workflowDefinitionVersion');
  const workflowHash = stringMetadata(group, 'workflowDefinitionHash');
  const projectionId = stringMetadata(group, 'workflowProjectionId');
  const definition = workflowDefinitionFor(workflowId);
  if (definition.version !== workflowVersion || definition.definitionHash !== workflowHash) {
    throw new Error(`Workflow Definition lock mismatch: ${workflowId}@${workflowVersion}`);
  }

  const projectionBlocks = snapshot.blocks.filter(
    (block) => block.data.workflowProjectionId === projectionId,
  );
  const operationBlockIds = new Set(
    projectionBlocks.filter((block) => block.type === 'operation').map((block) => block.blockId),
  );
  if (snapshot.executions.some((execution) => operationBlockIds.has(operationBlockIdFor(execution)))) {
    throw new Error('Create the Workflow Run before executing projected Operations.');
  }

  const createdAt = nowIso();
  const workflowRunId = createId('workflow_run');
  const stepRuns = definition.steps.map((step): WorkflowStepRunRecord => {
    const operationBlock = projectionBlocks.find(
      (block) => block.type === 'operation' && block.data.workflowStepId === step.stepId,
    );
    if (!operationBlock) throw new Error(`Workflow Operation projection is missing: ${step.stepId}`);
    if (
      operationBlock.data.capabilityId !== step.capabilityLock.capabilityId
      || operationBlock.data.skillId !== step.skillLock.skillId
    ) {
      throw new Error(`Workflow Operation lock mismatch: ${step.stepId}`);
    }
    const resolvedInputBindings = step.inputBindings.map((binding) => {
      const edge = snapshot.edges.find(
        (candidate) => candidate.kind === 'execution_input'
          && candidate.targetBlockId === operationBlock.blockId
          && candidate.inputSlotId === binding.inputSlotId,
      );
      if (!edge) throw new Error(`Workflow input projection is missing: ${step.stepId}.${binding.inputSlotId}`);
      return {
        blockId: edge.sourceBlockId,
        inputSlotId: binding.inputSlotId,
        source: structuredClone(binding.source),
      };
    });
    const outputBlockIds = snapshot.edges
      .filter((edge) => edge.kind === 'execution_output' && edge.sourceBlockId === operationBlock.blockId)
      .map((edge) => edge.targetBlockId);
    if (outputBlockIds.length !== step.outputSlots.length) {
      throw new Error(`Workflow output projection is incomplete: ${step.stepId}`);
    }
    return {
      stepRunId: createId('workflow_step_run'),
      workflowRunId,
      stepId: step.stepId,
      capabilityLock: structuredClone(step.capabilityLock),
      skillLock: structuredClone(step.skillLock),
      dependsOn: [...step.dependsOn],
      operationBlockId: operationBlock.blockId,
      resolvedInputBindings,
      outputBlockIds,
      executionIds: [],
      outputAssetIds: [],
      status: 'pending',
      freshness: 'current',
      recordVersion: 1,
      createdAt,
      updatedAt: createdAt,
    };
  });
  const inputBindings = definition.inputSlots.map((slot) => {
    const block = projectionBlocks.find((candidate) => candidate.data.workflowInputSlotId === slot.slotId);
    if (!block) throw new Error(`Workflow input Block projection is missing: ${slot.slotId}`);
    return { workflowInputSlotId: slot.slotId, blockId: block.blockId };
  });
  const run: WorkflowRunRecord = {
    workflowRunId,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    workflowDefinitionLock: {
      workflowId: definition.workflowId,
      version: definition.version,
      definitionHash: definition.definitionHash,
    },
    workflowProjectionId: projectionId,
    status: 'draft',
    inputBindings,
    stepRunIds: stepRuns.map((step) => step.stepRunId),
    currentStepIds: [],
    createdBy: 'user',
    createdAt,
    updatedAt: createdAt,
    recordVersion: 1,
  };
  snapshot.workflowRuns = [...(snapshot.workflowRuns ?? []), run];
  snapshot.workflowStepRuns = [...(snapshot.workflowStepRuns ?? []), ...stepRuns];
  group.data = { ...group.data, workflowRunId };
  group.updatedAt = createdAt;
  reconcileWorkflowRuntime(snapshot);
  touchBoard(snapshot);
  return workflowRunView(snapshot, run);
}

export function attachWorkflowExecution(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  execution: ExecutionRecord,
): void {
  const view = workflowStepRuntimeForOperation(snapshot, operationBlock.blockId);
  if (!view) return;
  const run = (snapshot.workflowRuns ?? []).find((candidate) => candidate.workflowRunId === view.record.workflowRunId);
  if (!run || run.status === 'paused' || run.status === 'canceled') {
    throw new Error(`Workflow Run cannot start a Step: ${run?.status ?? 'missing'}`);
  }
  if (!view.canStart) throw new Error(`Workflow Step is not ready: ${view.record.stepId}`);
  if (
    execution.capabilityId !== view.record.capabilityLock.capabilityId
    || execution.skillId !== view.record.skillLock.skillId
  ) {
    throw new Error(`Workflow Step execution lock mismatch: ${view.record.stepId}`);
  }

  const updatedAt = nowIso();
  execution.workflowRunId = run.workflowRunId;
  execution.stepRunId = view.record.stepRunId;
  view.record.executionIds = [...view.record.executionIds, execution.executionId];
  view.record.inputFingerprint = workflowStepInputFingerprint(snapshot, view.record);
  view.record.status = 'queued';
  view.record.freshness = 'current';
  view.record.error = undefined;
  view.record.updatedAt = updatedAt;
  view.record.recordVersion += 1;
  run.status = 'running';
  run.currentStepIds = [view.record.stepId];
  run.updatedAt = updatedAt;
  run.recordVersion += 1;
}

export function reconcileWorkflowRuntime(snapshot: BoardSnapshot): BoardSnapshot {
  for (const run of snapshot.workflowRuns ?? []) {
    const stepRuns = stepRunsFor(snapshot, run);
    const view = projectWorkflowRunView(snapshot, run, stepRuns);
    const updatedAt = nowIso();
    for (const projected of view.steps) {
      const record = projected.record;
      const outputAssetIds = unique(record.executionIds.flatMap((executionId) =>
        snapshot.executions.find((execution) => execution.executionId === executionId)?.outputAssetIds ?? [],
      ));
      const latest = latestStepExecution(snapshot, record);
      const error = projected.status === 'failed' ? latest?.errorMessage : undefined;
      if (
        record.status === projected.status
        && record.freshness === projected.freshness
        && arraysEqual(record.outputAssetIds, outputAssetIds)
        && record.error === error
      ) continue;
      record.status = projected.status;
      record.freshness = projected.freshness;
      record.outputAssetIds = outputAssetIds;
      record.error = error;
      record.updatedAt = updatedAt;
      record.recordVersion += 1;
    }
    if (run.status === view.status && arraysEqual(run.currentStepIds, view.currentStepIds)) continue;
    run.status = view.status;
    run.currentStepIds = view.currentStepIds;
    run.updatedAt = updatedAt;
    run.recordVersion += 1;
  }
  return snapshot;
}

export function workflowRunViewForGroup(
  snapshot: BoardSnapshot,
  groupId: string,
): WorkflowRunRuntimeView | undefined {
  const group = snapshot.blocks.find((block) => block.blockId === groupId && block.type === 'group');
  const workflowRunId = typeof group?.data.workflowRunId === 'string' ? group.data.workflowRunId : undefined;
  const run = (snapshot.workflowRuns ?? []).find((candidate) => candidate.workflowRunId === workflowRunId);
  return run ? workflowRunView(snapshot, run) : undefined;
}

export function workflowStepRuntimeForOperation(
  snapshot: BoardSnapshot,
  operationBlockId: string,
): WorkflowStepRuntimeView | undefined {
  const record = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => candidate.operationBlockId === operationBlockId,
  );
  if (!record) return undefined;
  const run = (snapshot.workflowRuns ?? []).find((candidate) => candidate.workflowRunId === record.workflowRunId);
  return run ? workflowRunView(snapshot, run).steps.find((step) => step.record.stepRunId === record.stepRunId) : undefined;
}

function workflowRunView(snapshot: BoardSnapshot, run: WorkflowRunRecord): WorkflowRunRuntimeView {
  return projectWorkflowRunView(snapshot, run, stepRunsFor(snapshot, run));
}

function projectWorkflowRunView(
  snapshot: BoardSnapshot,
  run: WorkflowRunRecord,
  stepRuns: WorkflowStepRunRecord[],
): WorkflowRunRuntimeView {
  const unresolved = new Map(stepRuns.map((step) => [step.stepId, step]));
  const projectedByStepId = new Map<string, WorkflowStepRuntimeView>();
  while (unresolved.size > 0) {
    const ready = [...unresolved.values()].filter((step) =>
      step.dependsOn.every((stepId) => projectedByStepId.has(stepId)),
    );
    if (ready.length === 0) {
      for (const step of unresolved.values()) {
        projectedByStepId.set(step.stepId, { record: step, status: 'blocked', freshness: 'current', canStart: false });
      }
      break;
    }
    for (const step of ready) {
      const dependencies = step.dependsOn.flatMap((stepId) => {
        const dependency = projectedByStepId.get(stepId);
        return dependency ? [dependency] : [];
      });
      projectedByStepId.set(step.stepId, projectStepView(snapshot, run, step, dependencies));
      unresolved.delete(step.stepId);
    }
  }
  const steps = stepRuns.map((step) => projectedByStepId.get(step.stepId) ?? {
    record: step,
    status: 'blocked' as const,
    freshness: 'current' as const,
    canStart: false,
  });
  const status = projectedRunStatus(run, steps);
  return {
    record: run,
    status,
    currentStepIds: steps
      .filter((step) => step.status === 'ready' || step.status === 'queued' || step.status === 'running' || step.status === 'waiting_input')
      .map((step) => step.record.stepId),
    steps,
  };
}

function projectStepView(
  snapshot: BoardSnapshot,
  run: WorkflowRunRecord,
  record: WorkflowStepRunRecord,
  dependencies: WorkflowStepRuntimeView[],
): WorkflowStepRuntimeView {
  const latest = latestStepExecution(snapshot, record);
  let status: WorkflowStepRunStatus;
  let freshness: WorkflowStepRunFreshness = 'current';
  if (latest?.status === 'queued' || latest?.status === 'running' || latest?.status === 'failed' || latest?.status === 'canceled') {
    status = latest.status;
  } else if (latest?.status === 'succeeded') {
    status = 'succeeded';
    const operation = snapshot.blocks.find((block) => block.blockId === record.operationBlockId && block.type === 'operation');
    const configurationOutdated = Boolean(
      operation
      && latest.configurationFingerprint
      && latest.configurationFingerprint !== configurationFingerprint(currentOperationConfiguration(snapshot, operation)),
    );
    const inputOutdated = Boolean(
      record.inputFingerprint
      && record.inputFingerprint !== workflowStepInputFingerprint(snapshot, record),
    );
    freshness = configurationOutdated || inputOutdated || dependencies.some((dependency) => dependency.freshness === 'outdated')
      ? 'outdated'
      : 'current';
  } else if (dependencies.some((dependency) => dependency.status === 'failed' || dependency.status === 'canceled' || dependency.status === 'blocked')) {
    status = 'blocked';
  } else if (!dependencies.every((dependency) => dependency.status === 'succeeded' && dependency.freshness === 'current')) {
    status = 'pending';
  } else {
    const operation = snapshot.blocks.find((block) => block.blockId === record.operationBlockId && block.type === 'operation');
    status = operation && operationReadinessFor(snapshot, operation).canRun ? 'ready' : 'waiting_input';
  }
  const dependencyReady = dependencies.every(
    (dependency) => dependency.status === 'succeeded' && dependency.freshness === 'current',
  );
  const canRetry = status === 'failed' || status === 'canceled' || status === 'succeeded';
  return {
    record,
    status,
    freshness,
    canStart:
      run.status !== 'paused'
      && run.status !== 'canceled'
      && dependencyReady
      && (status === 'ready' || canRetry),
  };
}

function projectedRunStatus(run: WorkflowRunRecord, steps: WorkflowStepRuntimeView[]): WorkflowRunStatus {
  if (run.status === 'paused' || run.status === 'canceled') return run.status;
  if (steps.length > 0 && steps.every((step) => step.status === 'succeeded' && step.freshness === 'current')) {
    return 'succeeded';
  }
  if (steps.some((step) =>
    step.freshness === 'outdated'
    || step.status === 'failed'
    || step.status === 'canceled'
    || step.status === 'blocked')) {
    return 'needs_attention';
  }
  if (steps.some((step) => step.status === 'queued' || step.status === 'running')) return 'running';
  if (steps.some((step) => step.status === 'waiting_input')) return 'waiting_input';
  if (steps.some((step) => step.status === 'ready')) {
    return steps.some((step) => step.record.executionIds.length > 0) ? 'running' : 'ready';
  }
  return run.status === 'draft' ? 'draft' : 'running';
}

function stepRunsFor(snapshot: BoardSnapshot, run: WorkflowRunRecord): WorkflowStepRunRecord[] {
  const byId = new Map((snapshot.workflowStepRuns ?? []).map((step) => [step.stepRunId, step]));
  return run.stepRunIds.flatMap((stepRunId) => {
    const step = byId.get(stepRunId);
    return step ? [step] : [];
  });
}

function latestStepExecution(
  snapshot: BoardSnapshot,
  step: WorkflowStepRunRecord,
): ExecutionRecord | undefined {
  const executionById = new Map(snapshot.executions.map((execution) => [execution.executionId, execution]));
  for (let index = step.executionIds.length - 1; index >= 0; index -= 1) {
    const execution = executionById.get(step.executionIds[index]);
    if (execution) return execution;
  }
  return undefined;
}

function operationBlockIdFor(execution: ExecutionRecord): string {
  return typeof execution.params?.operationBlockId === 'string' ? execution.params.operationBlockId : '';
}

function stringMetadata(block: BlockRecord, key: string): string {
  const value = block.data[key];
  if (typeof value !== 'string' || !value) throw new Error(`Workflow Group metadata is missing: ${key}`);
  return value;
}

function workflowStepInputFingerprint(snapshot: BoardSnapshot, step: WorkflowStepRunRecord): string {
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const value = JSON.stringify(step.resolvedInputBindings.map((binding) => {
    const block = blockById.get(binding.blockId);
    return {
      inputSlotId: binding.inputSlotId,
      blockId: binding.blockId,
      type: block?.type,
      body: typeof block?.data.body === 'string' ? block.data.body : undefined,
      assetId: typeof block?.data.assetId === 'string' ? block.data.assetId : undefined,
      sourceExecutionId: typeof block?.data.sourceExecutionId === 'string' ? block.data.sourceExecutionId : undefined,
      documentKind: typeof block?.data.documentKind === 'string' ? block.data.documentKind : undefined,
    };
  }));
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `input_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
