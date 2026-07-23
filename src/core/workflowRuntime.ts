import { operationReadinessFor } from './capabilities';
import { capabilityDefinitionFor } from './capabilityRegistry';
import { capabilityBindingValueForBlock } from './artifactLibrary';
import type { CapabilityBindingValue } from './capabilityContracts';
import { touchBoard } from './blockFactory';
import {
  configurationFingerprint,
  currentOperationConfiguration,
} from './executionConfiguration';
import { createId, nowIso } from './id';
import type { BlockRecord, BoardSnapshot, ExecutionRecord } from './types';
import {
  reconcileWorkflowGates,
  workflowGateRunState,
  workflowGatesAllowStep,
} from './workflowGateRuntime';
import { workflowDefinitionFor } from './workflowRegistry';
import {
  projectWorkflowStageViews,
  type WorkflowStageRuntimeView,
} from './workflowStageRuntime';
import type {
  WorkflowGateDefinitionLock,
  WorkflowRunRecord,
  WorkflowRunStatus,
  WorkflowStageDefinitionLock,
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
  stages: WorkflowStageRuntimeView[];
  status: WorkflowRunStatus;
  steps: WorkflowStepRuntimeView[];
}

export type {
  WorkflowStageOutputReadiness,
  WorkflowStageRuntimeStatus,
  WorkflowStageRuntimeView,
} from './workflowStageRuntime';

export interface AcceptWorkflowStepOutputsInput {
  acceptedOutputAssetIds: string[];
  expectedStepRunVersion: number;
  stepRunId: string;
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
  const packageContext = packageContextFromGroup(group);
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
    const projectedBindings = projectedStepInputBindings(operationBlock);
    const resolvedInputBindings = step.inputBindings.map((binding) => {
      const projected = projectedBindings.find(
        (candidate) => candidate.inputSlotId === binding.inputSlotId,
      );
      const edgeValues = snapshot.edges
        .filter(
          (candidate) => candidate.kind === 'execution_input'
            && candidate.targetBlockId === operationBlock.blockId
            && candidate.inputSlotId === binding.inputSlotId,
        )
        .flatMap((edge) => {
          const block = snapshot.blocks.find((candidate) => candidate.blockId === edge.sourceBlockId);
          return block ? [capabilityBindingValueForBlock(block)] : [];
        });
      const values = projected?.values.length ? projected.values : edgeValues;
      const capability = capabilityDefinitionFor(step.capabilityLock.capabilityId);
      const slot = capability.inputSlots.find((candidate) => candidate.slotId === binding.inputSlotId);
      if (slot?.required && values.length === 0) {
        throw new Error(`Workflow input projection is missing: ${step.stepId}.${binding.inputSlotId}`);
      }
      if (slot?.cardinality !== 'many' && values.length > 1) {
        throw new Error(`Workflow input projection has too many values: ${step.stepId}.${binding.inputSlotId}`);
      }
      return {
        inputSlotId: binding.inputSlotId,
        source: structuredClone(binding.source),
        values: structuredClone(values),
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
      outputSlotIds: [...step.outputSlots],
      outputBlockIds,
      parameters: objectRecord(operationBlock.data.workflowParameters),
      executionIds: [],
      acceptedOutputAssetIds: [],
      outputAcceptancePolicy: step.outputAcceptancePolicy ?? 'automatic',
      outputArtifactBindings: [],
      outputAssetIds: [],
      optional: step.optional,
      status: 'pending',
      stageId: step.stageId,
      freshness: 'current',
      recordVersion: 1,
      createdAt,
      updatedAt: createdAt,
    };
  });
  const projectedWorkflowBindings = projectedRunInputBindings(group);
  const inputBindings = definition.inputSlots.map((slot) => {
    const projected = projectedWorkflowBindings.find(
      (candidate) => candidate.workflowInputSlotId === slot.slotId,
    );
    const blockValues = projectionBlocks
      .filter((candidate) => candidate.data.workflowInputSlotId === slot.slotId)
      .map(capabilityBindingValueForBlock);
    const values = projected?.values.length ? projected.values : blockValues;
    if (slot.required && values.length === 0) {
      throw new Error(`Workflow input projection is missing: ${slot.slotId}`);
    }
    if (slot.cardinality !== 'many' && values.length > 1) {
      throw new Error(`Workflow input projection has too many values: ${slot.slotId}`);
    }
    return { workflowInputSlotId: slot.slotId, values: structuredClone(values) };
  });
  const outputSlotLocks = definition.outputSlots.map((output) => {
    const step = definition.steps.find((candidate) => candidate.stepId === output.source.stepId);
    const capability = step ? capabilityDefinitionFor(step.capabilityLock.capabilityId) : undefined;
    const slot = capability?.outputSlots.find(
      (candidate) => candidate.slotId === output.source.outputSlotId,
    );
    if (!step || !slot?.artifactType) {
      throw new Error(`Workflow output Artifact lock is incomplete: ${output.slotId}`);
    }
    return {
      artifactType: slot.artifactType,
      outputSlotId: output.source.outputSlotId,
      stepId: output.source.stepId,
      workflowOutputSlotId: output.slotId,
    };
  });
  const gateDefinitionLocks = definition.gates.map((gate): WorkflowGateDefinitionLock => {
    const subject = gate.subject;
    if (subject.kind === 'step_output') {
      return {
        ...structuredClone(gate),
        subject: structuredClone(subject),
      };
    }
    const output = outputSlotLocks.find(
      (candidate) => candidate.workflowOutputSlotId === subject.workflowOutputSlotId,
    );
    if (!output) {
      throw new Error(`Workflow Gate Artifact subject lock is incomplete: ${gate.gateId}`);
    }
    return {
      ...structuredClone(gate),
      subject: {
        artifactScope: 'workflow_run',
        artifactType: output.artifactType,
        kind: 'artifact_revision',
        outputSlotId: output.outputSlotId,
        semanticKey: `workflow_output:${output.workflowOutputSlotId}`,
        stepId: output.stepId,
        workflowOutputSlotId: output.workflowOutputSlotId,
      },
    };
  });
  const stageDefinitionLocks = definition.stages?.map((stage): WorkflowStageDefinitionLock => {
    const members = definition.steps.filter((step) => step.stageId === stage.stageId);
    return {
      stageId: stage.stageId,
      stageTypeId: stage.stageTypeId,
      name: stage.name,
      ...(stage.description ? { description: stage.description } : {}),
      completionPolicy: stage.completionPolicy,
      requiredStepIds: members.filter((step) => !step.optional).map((step) => step.stepId),
      optionalStepIds: members.filter((step) => step.optional).map((step) => step.stepId),
      outputSlotLocks: stage.outputWorkflowSlotIds.map((workflowOutputSlotId) => {
        const output = outputSlotLocks.find(
          (candidate) => candidate.workflowOutputSlotId === workflowOutputSlotId,
        );
        if (!output) {
          throw new Error(`Workflow Stage output lock is incomplete: ${stage.stageId}.${workflowOutputSlotId}`);
        }
        return {
          ...structuredClone(output),
          artifactScope: 'workflow_run',
          semanticKey: `workflow_output:${workflowOutputSlotId}`,
        };
      }),
    };
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
    ...(packageContext ? {
      entrypointId: packageContext.entrypointId,
      sourcePackageLock: packageContext.packageLock,
    } : {}),
    inputBindings,
    gateDefinitionLocks,
    gateEvaluationIds: [],
    outputSlotLocks,
    ...(stageDefinitionLocks ? { stageDefinitionLocks } : {}),
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
  view.record.outputArtifactBindings = [];
  if (view.record.outputAcceptancePolicy !== 'automatic') {
    view.record.acceptedOutputAssetIds = [];
    view.record.acceptedAt = undefined;
    view.record.acceptedBy = undefined;
    clearSelectedOutputMarkers(snapshot, view.record);
  }
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

export function acceptWorkflowStepOutputs(
  snapshot: BoardSnapshot,
  input: AcceptWorkflowStepOutputsInput,
): WorkflowStepRuntimeView {
  const record = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => candidate.stepRunId === input.stepRunId,
  );
  if (!record) throw new Error(`Workflow StepRun not found: ${input.stepRunId}`);
  if (record.recordVersion !== input.expectedStepRunVersion) {
    throw new Error(`Workflow StepRun version conflict: ${input.stepRunId}`);
  }
  if (record.outputAcceptancePolicy === 'automatic') {
    throw new Error(`Workflow Step output selection is not enabled: ${record.stepId}`);
  }
  const run = (snapshot.workflowRuns ?? []).find(
    (candidate) => candidate.workflowRunId === record.workflowRunId,
  );
  if (
    !run
    || run.projectId !== snapshot.project.projectId
    || run.boardId !== snapshot.board.boardId
  ) throw new Error(`Workflow StepRun scope does not match the Board: ${input.stepRunId}`);
  const view = workflowRunView(snapshot, run).steps.find(
    (candidate) => candidate.record.stepRunId === record.stepRunId,
  );
  if (!view || (view.status !== 'waiting_selection' && view.status !== 'succeeded')) {
    throw new Error(`Workflow Step output cannot be selected from status: ${view?.status ?? 'missing'}`);
  }

  const acceptedOutputAssetIds = unique(input.acceptedOutputAssetIds);
  if (acceptedOutputAssetIds.length === 0) {
    throw new Error('Workflow Step output selection requires at least one Asset.');
  }
  if (record.outputAcceptancePolicy === 'manual_single' && acceptedOutputAssetIds.length !== 1) {
    throw new Error('Workflow Step output selection requires exactly one Asset.');
  }
  const executionById = new Map(
    record.executionIds.flatMap((executionId) => {
      const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
      return execution ? [[executionId, execution] as const] : [];
    }),
  );
  for (const assetId of acceptedOutputAssetIds) {
    const asset = snapshot.assets.find((candidate) => candidate.assetId === assetId);
    const sourceExecution = asset?.sourceExecutionId
      ? executionById.get(asset.sourceExecutionId)
      : undefined;
    if (
      !asset
      || asset.projectId !== snapshot.project.projectId
      || !record.outputAssetIds.includes(assetId)
      || !sourceExecution
      || sourceExecution.workflowRunId !== record.workflowRunId
      || sourceExecution.stepRunId !== record.stepRunId
      || !sourceExecution.outputAssetIds.includes(assetId)
    ) throw new Error(`Asset is not a selectable output of this Workflow Step: ${assetId}`);
  }

  const acceptedAt = nowIso();
  record.acceptedOutputAssetIds = acceptedOutputAssetIds;
  record.acceptedBy = 'user';
  record.acceptedAt = acceptedAt;
  record.updatedAt = acceptedAt;
  record.recordVersion += 1;
  updateSelectedOutputMarkers(snapshot, record);
  reconcileWorkflowRuntime(snapshot);
  touchBoard(snapshot);
  const acceptedView = workflowRunView(snapshot, run).steps.find(
    (candidate) => candidate.record.stepRunId === record.stepRunId,
  );
  if (!acceptedView) throw new Error(`Workflow StepRun projection not found: ${input.stepRunId}`);
  return acceptedView;
}

export function reconcileWorkflowRuntime(snapshot: BoardSnapshot): BoardSnapshot {
  for (const run of snapshot.workflowRuns ?? []) {
    const stepRuns = stepRunsFor(snapshot, run);
    const updatedAt = nowIso();
    let view = projectWorkflowRunView(snapshot, run, stepRuns);
    applyWorkflowStepProjection(snapshot, view, updatedAt);
    reconcileWorkflowGates(snapshot, run, stepRuns);
    view = projectWorkflowRunView(snapshot, run, stepRuns);
    applyWorkflowStepProjection(snapshot, view, updatedAt);
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

export function workflowRunViewForId(
  snapshot: BoardSnapshot,
  workflowRunId: string,
): WorkflowRunRuntimeView | undefined {
  const run = (snapshot.workflowRuns ?? []).find((candidate) => candidate.workflowRunId === workflowRunId);
  return run ? workflowRunView(snapshot, run) : undefined;
}

export function workflowStageViewsForRun(
  snapshot: BoardSnapshot,
  workflowRunId: string,
): WorkflowStageRuntimeView[] {
  return workflowRunViewForId(snapshot, workflowRunId)?.stages ?? [];
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
      projectedByStepId.set(
        step.stepId,
        projectStepView(snapshot, run, step, dependencies, workflowGatesAllowStep(snapshot, run, step)),
      );
      unresolved.delete(step.stepId);
    }
  }
  const steps = stepRuns.map((step) => projectedByStepId.get(step.stepId) ?? {
    record: step,
    status: 'blocked' as const,
    freshness: 'current' as const,
    canStart: false,
  });
  const status = projectedRunStatus(snapshot, run, steps);
  return {
    record: run,
    status,
    stages: projectWorkflowStageViews(snapshot, run, steps),
    currentStepIds: steps
      .filter((step) =>
        step.status === 'ready'
        || step.status === 'queued'
        || step.status === 'running'
        || step.status === 'waiting_input'
        || step.status === 'waiting_selection')
      .map((step) => step.record.stepId),
    steps,
  };
}

function projectStepView(
  snapshot: BoardSnapshot,
  run: WorkflowRunRecord,
  record: WorkflowStepRunRecord,
  dependencies: WorkflowStepRuntimeView[],
  gatesAllowDependencies: boolean,
): WorkflowStepRuntimeView {
  const latest = latestStepExecution(snapshot, record);
  let status: WorkflowStepRunStatus;
  let freshness: WorkflowStepRunFreshness = 'current';
  if (latest?.status === 'queued' || latest?.status === 'running' || latest?.status === 'failed' || latest?.status === 'canceled') {
    status = latest.status;
  } else if (latest?.status === 'succeeded') {
    status = record.outputAcceptancePolicy !== 'automatic' && !hasValidAcceptedOutputs(snapshot, record)
      ? 'waiting_selection'
      : 'succeeded';
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
  } else if (
    !gatesAllowDependencies
    || !dependencies.every((dependency) => dependency.status === 'succeeded' && dependency.freshness === 'current')
  ) {
    status = 'pending';
  } else {
    const operation = snapshot.blocks.find((block) => block.blockId === record.operationBlockId && block.type === 'operation');
    status = operation && operationReadinessFor(snapshot, operation).canRun ? 'ready' : 'waiting_input';
  }
  const dependencyReady = dependencies.every(
    (dependency) => dependency.status === 'succeeded' && dependency.freshness === 'current',
  ) && gatesAllowDependencies;
  const canRetry =
    status === 'failed'
    || status === 'canceled'
    || status === 'succeeded'
    || status === 'waiting_selection';
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

function projectedRunStatus(
  snapshot: BoardSnapshot,
  run: WorkflowRunRecord,
  steps: WorkflowStepRuntimeView[],
): WorkflowRunStatus {
  if (run.status === 'paused' || run.status === 'canceled') return run.status;
  const gateState = workflowGateRunState(snapshot, run);
  if (steps.some((step) =>
    step.freshness === 'outdated'
    || step.status === 'failed'
    || step.status === 'canceled'
    || step.status === 'blocked')
    || gateState === 'failed') {
    return 'needs_attention';
  }
  if (steps.some((step) => step.status === 'queued' || step.status === 'running')) return 'running';
  if (gateState === 'waiting_approval') return 'waiting_approval';
  if (
    steps.length > 0
    && steps.every((step) => step.status === 'succeeded' && step.freshness === 'current')
  ) return gateState === 'clear' ? 'succeeded' : 'needs_attention';
  if (steps.some((step) => step.status === 'waiting_selection')) return 'waiting_selection';
  if (steps.some((step) => step.status === 'waiting_input')) return 'waiting_input';
  if (steps.some((step) => step.status === 'ready')) {
    return steps.some((step) => step.record.executionIds.length > 0) ? 'running' : 'ready';
  }
  return run.status === 'draft' ? 'draft' : 'running';
}

function applyWorkflowStepProjection(
  snapshot: BoardSnapshot,
  view: WorkflowRunRuntimeView,
  updatedAt: string,
): void {
  for (const projected of view.steps) {
    const record = projected.record;
    if (record.outputAcceptancePolicy !== 'automatic') {
      updateSelectedOutputMarkers(snapshot, record);
    }
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

function hasValidAcceptedOutputs(snapshot: BoardSnapshot, step: WorkflowStepRunRecord): boolean {
  if (step.acceptedOutputAssetIds.length === 0) return false;
  const executionById = new Map(
    step.executionIds.flatMap((executionId) => {
      const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
      return execution ? [[executionId, execution] as const] : [];
    }),
  );
  return step.acceptedOutputAssetIds.every((assetId) => {
    const asset = snapshot.assets.find((candidate) => candidate.assetId === assetId);
    const execution = asset?.sourceExecutionId ? executionById.get(asset.sourceExecutionId) : undefined;
    return Boolean(
      asset
      && asset.projectId === snapshot.project.projectId
      && execution
      && execution.workflowRunId === step.workflowRunId
      && execution.stepRunId === step.stepRunId
      && execution.outputAssetIds.includes(assetId),
    );
  });
}

function clearSelectedOutputMarkers(snapshot: BoardSnapshot, step: WorkflowStepRunRecord): void {
  for (const block of snapshot.blocks) {
    if (
      block.data.reviewStatus === 'selected'
      && typeof block.data.sourceExecutionId === 'string'
      && step.executionIds.includes(block.data.sourceExecutionId)
    ) {
      block.data = { ...block.data, reviewStatus: undefined };
      block.updatedAt = nowIso();
    }
  }
}

function updateSelectedOutputMarkers(snapshot: BoardSnapshot, step: WorkflowStepRunRecord): void {
  const acceptedIds = new Set(step.acceptedOutputAssetIds);
  for (const block of snapshot.blocks) {
    const assetId = typeof block.data.assetId === 'string' ? block.data.assetId : undefined;
    const sourceExecutionId = typeof block.data.sourceExecutionId === 'string'
      ? block.data.sourceExecutionId
      : undefined;
    if (!assetId || !sourceExecutionId || !step.executionIds.includes(sourceExecutionId)) continue;
    const reviewStatus = acceptedIds.has(assetId) ? 'selected' as const : undefined;
    if (block.data.reviewStatus === reviewStatus) continue;
    block.data = { ...block.data, reviewStatus };
    block.updatedAt = nowIso();
  }
}

function operationBlockIdFor(execution: ExecutionRecord): string {
  return typeof execution.params?.operationBlockId === 'string' ? execution.params.operationBlockId : '';
}

function stringMetadata(block: BlockRecord, key: string): string {
  const value = block.data[key];
  if (typeof value !== 'string' || !value) throw new Error(`Workflow Group metadata is missing: ${key}`);
  return value;
}

function packageContextFromGroup(group: BlockRecord): {
  entrypointId: string;
  packageLock: { digest: string; packageId: string; version: string };
} | undefined {
  const values = [
    group.data.packageId,
    group.data.packageVersion,
    group.data.packageDigest,
    group.data.packageEntryPointId,
  ];
  if (values.every((value) => value === undefined)) return undefined;
  if (!values.every((value) => typeof value === 'string' && value.length > 0)) {
    throw new Error('Workflow Group Package lock is incomplete.');
  }
  return {
    entrypointId: String(group.data.packageEntryPointId),
    packageLock: {
      packageId: String(group.data.packageId),
      version: String(group.data.packageVersion),
      digest: String(group.data.packageDigest),
    },
  };
}

function workflowStepInputFingerprint(snapshot: BoardSnapshot, step: WorkflowStepRunRecord): string {
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const value = JSON.stringify({
    parameters: step.parameters ?? {},
    inputs: step.resolvedInputBindings.map((binding) => ({
      inputSlotId: binding.inputSlotId,
      values: binding.values.map((bindingValue) => {
        if (bindingValue.kind === 'inline') return { kind: 'inline', value: bindingValue.value };
        const blockId = bindingValue.blockId;
        const block = blockId ? blockById.get(blockId) : undefined;
        return {
          ...bindingValue,
          type: block?.type,
          body: typeof block?.data.body === 'string' ? block.data.body : undefined,
          assetId: typeof block?.data.assetId === 'string' ? block.data.assetId : undefined,
          sourceExecutionId: typeof block?.data.sourceExecutionId === 'string' ? block.data.sourceExecutionId : undefined,
          documentKind: typeof block?.data.documentKind === 'string' ? block.data.documentKind : undefined,
        };
      }),
    })),
  });
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `input_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function projectedRunInputBindings(group: BlockRecord): WorkflowRunRecord['inputBindings'] {
  const value = group.data.workflowInputBindings;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as { workflowInputSlotId?: unknown; values?: unknown };
    if (typeof candidate.workflowInputSlotId !== 'string') return [];
    return [{
      workflowInputSlotId: candidate.workflowInputSlotId,
      values: capabilityBindingValues(candidate.values),
    }];
  });
}

function projectedStepInputBindings(
  operationBlock: BlockRecord,
): WorkflowStepRunRecord['resolvedInputBindings'] {
  const value = operationBlock.data.workflowInputBindings;
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as {
      inputSlotId?: unknown;
      source?: unknown;
      values?: unknown;
    };
    if (typeof candidate.inputSlotId !== 'string' || !isWorkflowBindingSource(candidate.source)) return [];
    return [{
      inputSlotId: candidate.inputSlotId,
      source: candidate.source,
      values: capabilityBindingValues(candidate.values),
    }];
  });
}

function capabilityBindingValues(value: unknown): CapabilityBindingValue[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): CapabilityBindingValue[] => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Record<string, unknown>;
    if (candidate.kind === 'inline') return [{ kind: 'inline', value: structuredClone(candidate.value) }];
    if (candidate.kind === 'block' && typeof candidate.blockId === 'string') {
      return [{ kind: 'block', blockId: candidate.blockId }];
    }
    if (candidate.kind === 'asset' && typeof candidate.assetId === 'string') {
      return [{
        kind: 'asset',
        assetId: candidate.assetId,
        ...(typeof candidate.blockId === 'string' ? { blockId: candidate.blockId } : {}),
      }];
    }
    if (candidate.kind === 'artifact_revision' && typeof candidate.artifactRevisionId === 'string') {
      return [{
        kind: 'artifact_revision',
        artifactRevisionId: candidate.artifactRevisionId,
        ...(typeof candidate.blockId === 'string' ? { blockId: candidate.blockId } : {}),
      }];
    }
    return [];
  });
}

function isWorkflowBindingSource(value: unknown): value is WorkflowStepRunRecord['resolvedInputBindings'][number]['source'] {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return candidate.kind === 'workflow_input' && typeof candidate.slotId === 'string'
    || candidate.kind === 'step_output'
      && typeof candidate.stepId === 'string'
      && typeof candidate.outputSlotId === 'string';
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? structuredClone(value as Record<string, unknown>)
    : {};
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
