import { touchBoard } from './blockFactory';
import { createId, nowIso } from './id';
import type { BoardSnapshot, ExecutionRecord } from './types';
import type {
  WorkflowApprovalDecisionRecord,
  WorkflowApprovalDecisionValue,
  WorkflowApprovalRequestRecord,
  WorkflowGateEvaluationRecord,
} from './workflowGateContracts';
import type {
  WorkflowGateDefinitionLock,
  WorkflowRunRecord,
  WorkflowStepOutputArtifactBinding,
  WorkflowStepRunRecord,
} from './workflowRuntimeContracts';

export interface WorkflowArtifactGateFact {
  artifactId: string;
  artifactRevisionId: string;
  assetIds: string[];
  executionIds: string[];
  gateId: string;
}

export interface ReconcileWorkflowGatesOptions {
  artifactFacts?: WorkflowArtifactGateFact[];
}

export interface WorkflowGateRuntimeView {
  canDecide: boolean;
  evaluation?: WorkflowGateEvaluationRecord;
  gateDefinitionLock: WorkflowGateDefinitionLock;
  request?: WorkflowApprovalRequestRecord;
}

export interface DecideWorkflowApprovalInput {
  approvalRequestId: string;
  decision: WorkflowApprovalDecisionValue;
  expectedApprovalRequestVersion: number;
  reason?: string;
}

export function reconcileWorkflowGates(
  snapshot: BoardSnapshot,
  run: WorkflowRunRecord,
  stepRuns: WorkflowStepRunRecord[],
  options: ReconcileWorkflowGatesOptions = {},
): boolean {
  let changed = false;
  for (const gate of run.gateDefinitionLocks) {
    const current = currentEvaluationForGate(snapshot, run, gate.gateId);
    const subject = gate.subject.kind === 'step_output'
      ? currentStepOutputGateSubject(snapshot, gate, stepRuns)
      : currentArtifactGateSubject(gate, stepRuns, options.artifactFacts);
    if (gate.subject.kind === 'artifact_revision') {
      const binding = artifactBindingForGate(gate, stepRuns);
      if (
        current
        && (
          !binding
          || current.subjectArtifactRevisionId !== binding.artifactRevisionId
        )
      ) changed = markEvaluationOutdated(snapshot, current) || changed;
      if (!options.artifactFacts) continue;
    }
    if (!subject) {
      if (current) changed = markEvaluationOutdated(snapshot, current) || changed;
      continue;
    }
    if (current?.subjectFingerprint === subject.subjectFingerprint) continue;
    if (current) changed = markEvaluationOutdated(snapshot, current) || changed;
    const createdAt = nowIso();
    const gateEvaluationId = createId('workflow_gate_evaluation');
    const approvalRequestId = createId('workflow_approval_request');
    const evaluation: WorkflowGateEvaluationRecord = {
      gateEvaluationId,
      workflowRunId: run.workflowRunId,
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
      gateId: gate.gateId,
      gateDefinitionLock: structuredClone(gate),
      status: 'waiting_approval',
      freshness: 'current',
      ...(subject.subjectArtifactId
        ? { subjectArtifactId: subject.subjectArtifactId }
        : {}),
      ...(subject.subjectArtifactRevisionId
        ? { subjectArtifactRevisionId: subject.subjectArtifactRevisionId }
        : {}),
      subjectAssetIds: subject.subjectAssetIds,
      subjectExecutionIds: subject.subjectExecutionIds,
      subjectFingerprint: subject.subjectFingerprint,
      approvalRequestId,
      recordVersion: 1,
      createdAt,
      updatedAt: createdAt,
    };
    const request: WorkflowApprovalRequestRecord = {
      approvalRequestId,
      gateEvaluationId,
      workflowRunId: run.workflowRunId,
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
      status: 'pending',
      ...(subject.subjectArtifactId
        ? { subjectArtifactId: subject.subjectArtifactId }
        : {}),
      ...(subject.subjectArtifactRevisionId
        ? { subjectArtifactRevisionId: subject.subjectArtifactRevisionId }
        : {}),
      subjectAssetIds: [...subject.subjectAssetIds],
      subjectExecutionIds: [...subject.subjectExecutionIds],
      subjectFingerprint: subject.subjectFingerprint,
      requestedAt: createdAt,
      recordVersion: 1,
      createdAt,
      updatedAt: createdAt,
    };
    snapshot.workflowGateEvaluations = [...(snapshot.workflowGateEvaluations ?? []), evaluation];
    snapshot.workflowApprovalRequests = [...(snapshot.workflowApprovalRequests ?? []), request];
    run.gateEvaluationIds = [...run.gateEvaluationIds, gateEvaluationId];
    run.updatedAt = createdAt;
    run.recordVersion += 1;
    changed = true;
  }
  if (changed) touchBoard(snapshot);
  return changed;
}

export function workflowGateViewsForRun(
  snapshot: BoardSnapshot,
  workflowRunId: string,
): WorkflowGateRuntimeView[] {
  const run = (snapshot.workflowRuns ?? []).find((candidate) => candidate.workflowRunId === workflowRunId);
  if (!run) return [];
  return run.gateDefinitionLocks.map((gateDefinitionLock) => {
    const evaluation = currentEvaluationForGate(snapshot, run, gateDefinitionLock.gateId);
    const request = evaluation
      ? (snapshot.workflowApprovalRequests ?? []).find(
          (candidate) => candidate.approvalRequestId === evaluation.approvalRequestId,
        )
      : undefined;
    return {
      gateDefinitionLock,
      evaluation,
      request,
      canDecide: Boolean(
        evaluation?.freshness === 'current'
        && evaluation.status === 'waiting_approval'
        && request?.status === 'pending',
      ),
    };
  });
}

export function workflowGatesAllowStep(
  snapshot: BoardSnapshot,
  run: WorkflowRunRecord,
  step: WorkflowStepRunRecord,
): boolean {
  return run.gateDefinitionLocks
    .filter((gate) => step.dependsOn.includes(gate.subject.stepId))
    .every((gate) => {
      const evaluation = currentEvaluationForGate(snapshot, run, gate.gateId);
      return evaluation?.freshness === 'current' && evaluation.status === 'passed';
    });
}

export function workflowGateRunState(
  snapshot: BoardSnapshot,
  run: WorkflowRunRecord,
): 'clear' | 'waiting_approval' | 'failed' | 'incomplete' {
  if (run.gateDefinitionLocks.length === 0) return 'clear';
  let incomplete = false;
  for (const gate of run.gateDefinitionLocks) {
    const evaluation = currentEvaluationForGate(snapshot, run, gate.gateId);
    if (!evaluation || evaluation.freshness !== 'current') {
      incomplete = true;
      continue;
    }
    if (evaluation.status === 'failed') return 'failed';
    if (evaluation.status === 'waiting_approval') return 'waiting_approval';
  }
  return incomplete ? 'incomplete' : 'clear';
}

export function decideWorkflowApproval(
  snapshot: BoardSnapshot,
  input: DecideWorkflowApprovalInput,
): WorkflowApprovalDecisionRecord {
  const request = (snapshot.workflowApprovalRequests ?? []).find(
    (candidate) => candidate.approvalRequestId === input.approvalRequestId,
  );
  if (!request) throw new Error(`Workflow ApprovalRequest not found: ${input.approvalRequestId}`);
  if (request.recordVersion !== input.expectedApprovalRequestVersion) {
    throw new Error(`Workflow ApprovalRequest version conflict: ${input.approvalRequestId}`);
  }
  if (request.status !== 'pending') {
    throw new Error(`Workflow ApprovalRequest is already decided: ${request.status}`);
  }
  if (
    request.projectId !== snapshot.project.projectId
    || request.boardId !== snapshot.board.boardId
  ) throw new Error(`Workflow ApprovalRequest scope does not match the Board: ${input.approvalRequestId}`);
  const run = (snapshot.workflowRuns ?? []).find(
    (candidate) => candidate.workflowRunId === request.workflowRunId,
  );
  const evaluation = (snapshot.workflowGateEvaluations ?? []).find(
    (candidate) => candidate.gateEvaluationId === request.gateEvaluationId,
  );
  if (
    !run
    || !evaluation
    || evaluation.workflowRunId !== run.workflowRunId
    || evaluation.freshness !== 'current'
    || evaluation.status !== 'waiting_approval'
    || evaluation.subjectFingerprint !== request.subjectFingerprint
    || evaluation.subjectArtifactId !== request.subjectArtifactId
    || evaluation.subjectArtifactRevisionId !== request.subjectArtifactRevisionId
    || !arraysEqual(evaluation.subjectAssetIds, request.subjectAssetIds)
    || !arraysEqual(evaluation.subjectExecutionIds, request.subjectExecutionIds)
  ) throw new Error('Workflow ApprovalRequest no longer matches the current Gate evaluation.');
  const current = currentEvaluationForGate(snapshot, run, evaluation.gateId);
  if (current?.gateEvaluationId !== evaluation.gateEvaluationId) {
    throw new Error('Workflow ApprovalRequest is outdated.');
  }

  const decidedAt = nowIso();
  const decision: WorkflowApprovalDecisionRecord = {
    approvalDecisionId: createId('workflow_approval_decision'),
    approvalRequestId: request.approvalRequestId,
    gateEvaluationId: evaluation.gateEvaluationId,
    workflowRunId: run.workflowRunId,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    decision: input.decision,
    expectedApprovalRequestVersion: input.expectedApprovalRequestVersion,
    ...(request.subjectArtifactId
      ? { subjectArtifactId: request.subjectArtifactId }
      : {}),
    ...(request.subjectArtifactRevisionId
      ? { subjectArtifactRevisionId: request.subjectArtifactRevisionId }
      : {}),
    subjectAssetIds: [...request.subjectAssetIds],
    subjectExecutionIds: [...request.subjectExecutionIds],
    subjectFingerprint: request.subjectFingerprint,
    ...(input.reason?.trim() ? { reason: input.reason.trim() } : {}),
    decidedBy: { actorType: 'user', actorId: 'user_local' },
    decidedAt,
    recordVersion: 1,
  };
  snapshot.workflowApprovalDecisions = [...(snapshot.workflowApprovalDecisions ?? []), decision];
  request.status = input.decision === 'approve' ? 'approved' : 'rejected';
  request.updatedAt = decidedAt;
  request.recordVersion += 1;
  evaluation.status = input.decision === 'approve' ? 'passed' : 'failed';
  evaluation.updatedAt = decidedAt;
  evaluation.recordVersion += 1;
  touchBoard(snapshot);
  return decision;
}

interface CurrentGateSubject {
  subjectArtifactId?: string;
  subjectArtifactRevisionId?: string;
  subjectAssetIds: string[];
  subjectExecutionIds: string[];
  subjectFingerprint: string;
}

function currentStepOutputGateSubject(
  snapshot: BoardSnapshot,
  gate: WorkflowGateDefinitionLock,
  stepRuns: WorkflowStepRunRecord[],
): CurrentGateSubject | undefined {
  if (gate.subject.kind !== 'step_output') {
    throw new Error('Workflow step-output Gate subject required.');
  }
  const step = stepRuns.find((candidate) => candidate.stepId === gate.subject.stepId);
  if (!step || step.status !== 'succeeded' || step.freshness !== 'current') return undefined;
  const subjectAssetIds = gateSubjectAssetIds(snapshot, gate, step);
  if (subjectAssetIds.length === 0) return undefined;
  const subjectExecutionIds = unique(subjectAssetIds.flatMap((assetId) => {
    const sourceExecutionId = snapshot.assets.find((asset) => asset.assetId === assetId)?.sourceExecutionId;
    return sourceExecutionId ? [sourceExecutionId] : [];
  }));
  if (subjectExecutionIds.length === 0) return undefined;
  return {
    subjectAssetIds,
    subjectExecutionIds,
    subjectFingerprint: subjectFingerprint({
      gateId: gate.gateId,
      assetIds: subjectAssetIds,
      executionIds: subjectExecutionIds,
    }),
  };
}

function gateSubjectAssetIds(
  snapshot: BoardSnapshot,
  gate: WorkflowGateDefinitionLock,
  step: WorkflowStepRunRecord,
): string[] {
  if (gate.subject.kind !== 'step_output') {
    throw new Error('Workflow step-output Gate subject required.');
  }
  const executionById = new Map(
    step.executionIds.flatMap((executionId) => {
      const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
      return execution ? [[executionId, execution] as const] : [];
    }),
  );
  const candidates = step.outputAcceptancePolicy !== 'automatic'
    ? step.acceptedOutputAssetIds
    : outputAssetIdsForSlot(latestSucceededExecution(executionById, step), step, gate.subject.outputSlotId);
  return unique(candidates.filter((assetId) => {
    const asset = snapshot.assets.find((candidate) => candidate.assetId === assetId);
    const execution = asset?.sourceExecutionId ? executionById.get(asset.sourceExecutionId) : undefined;
    return Boolean(
      asset
      && asset.projectId === snapshot.project.projectId
      && execution
      && outputAssetIdsForSlot(execution, step, gate.subject.outputSlotId).includes(assetId),
    );
  }));
}

function currentArtifactGateSubject(
  gate: WorkflowGateDefinitionLock,
  stepRuns: WorkflowStepRunRecord[],
  facts: WorkflowArtifactGateFact[] | undefined,
): CurrentGateSubject | undefined {
  if (gate.subject.kind !== 'artifact_revision' || !facts) return undefined;
  const fact = facts.find((candidate) => candidate.gateId === gate.gateId);
  if (!fact) return undefined;
  const binding = artifactBindingForGate(gate, stepRuns);
  if (
    !binding
    || binding.artifactId !== fact.artifactId
    || binding.artifactRevisionId !== fact.artifactRevisionId
    || !arraysEqual(binding.assetIds, fact.assetIds)
    || !arraysEqual(binding.executionIds, fact.executionIds)
  ) throw new Error('Workflow Artifact Gate fact does not match the current StepRun binding.');
  return {
    subjectArtifactId: fact.artifactId,
    subjectArtifactRevisionId: fact.artifactRevisionId,
    subjectAssetIds: [...fact.assetIds],
    subjectExecutionIds: [...fact.executionIds],
    subjectFingerprint: subjectFingerprint({
      artifactId: fact.artifactId,
      artifactRevisionId: fact.artifactRevisionId,
      assetIds: fact.assetIds,
      executionIds: fact.executionIds,
      gateId: gate.gateId,
    }),
  };
}

function artifactBindingForGate(
  gate: WorkflowGateDefinitionLock,
  stepRuns: WorkflowStepRunRecord[],
): WorkflowStepOutputArtifactBinding | undefined {
  if (gate.subject.kind !== 'artifact_revision') return undefined;
  const subject = gate.subject;
  const step = stepRuns.find(
    (candidate) => candidate.stepId === subject.stepId,
  );
  if (!step || step.status !== 'succeeded' || step.freshness !== 'current') return undefined;
  const binding = step.outputArtifactBindings.find(
    (candidate) => candidate.workflowOutputSlotId === subject.workflowOutputSlotId,
  );
  if (!binding) return undefined;
  if (
    binding.artifactType !== subject.artifactType
    || binding.outputSlotId !== subject.outputSlotId
  ) throw new Error('Workflow Artifact Gate binding does not match its frozen subject.');
  return binding;
}

function outputAssetIdsForSlot(
  execution: ExecutionRecord | undefined,
  step: WorkflowStepRunRecord,
  outputSlotId: string,
): string[] {
  if (!execution || execution.status !== 'succeeded') return [];
  const slotResult = execution.outputSlotResults?.find((candidate) => candidate.slotId === outputSlotId);
  if (slotResult?.assetIds.length) return slotResult.assetIds;
  return step.outputSlotIds.length === 1 && step.outputSlotIds[0] === outputSlotId
    ? execution.outputAssetIds
    : [];
}

function latestSucceededExecution(
  executionById: Map<string, ExecutionRecord>,
  step: WorkflowStepRunRecord,
): ExecutionRecord | undefined {
  for (let index = step.executionIds.length - 1; index >= 0; index -= 1) {
    const execution = executionById.get(step.executionIds[index]);
    if (execution?.status === 'succeeded') return execution;
  }
  return undefined;
}

function currentEvaluationForGate(
  snapshot: BoardSnapshot,
  run: WorkflowRunRecord,
  gateId: string,
): WorkflowGateEvaluationRecord | undefined {
  const byId = new Map(
    (snapshot.workflowGateEvaluations ?? []).map((evaluation) => [evaluation.gateEvaluationId, evaluation]),
  );
  for (let index = run.gateEvaluationIds.length - 1; index >= 0; index -= 1) {
    const evaluation = byId.get(run.gateEvaluationIds[index]);
    if (evaluation?.gateId === gateId && evaluation.freshness === 'current') return evaluation;
  }
  return undefined;
}

function markEvaluationOutdated(
  snapshot: BoardSnapshot,
  evaluation: WorkflowGateEvaluationRecord,
): boolean {
  if (evaluation.freshness === 'outdated') return false;
  const updatedAt = nowIso();
  evaluation.freshness = 'outdated';
  evaluation.updatedAt = updatedAt;
  evaluation.recordVersion += 1;
  const request = (snapshot.workflowApprovalRequests ?? []).find(
    (candidate) => candidate.approvalRequestId === evaluation.approvalRequestId,
  );
  if (request?.status === 'pending') {
    request.status = 'outdated';
    request.updatedAt = updatedAt;
    request.recordVersion += 1;
  }
  return true;
}

function subjectFingerprint(input: {
  artifactId?: string;
  artifactRevisionId?: string;
  assetIds: string[];
  executionIds: string[];
  gateId: string;
}): string {
  const value = JSON.stringify(input.artifactRevisionId
    ? [
        input.gateId,
        input.artifactId,
        input.artifactRevisionId,
        input.assetIds,
        input.executionIds,
      ]
    : [input.gateId, input.assetIds, input.executionIds]);
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `gate_subject_${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function arraysEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
