import { touchBoard } from './blockFactory';
import { createId, nowIso } from './id';
import type { BoardSnapshot, ExecutionRecord } from './types';
import type {
  WorkflowApprovalDecisionRecord,
  WorkflowApprovalDecisionValue,
  WorkflowApprovalRequestRecord,
  WorkflowGateEvaluationRecord,
} from './workflowGateContracts';
import type { WorkflowGateDefinition } from './workflowRegistry';
import type { WorkflowRunRecord, WorkflowStepRunRecord } from './workflowRuntimeContracts';

export interface WorkflowGateRuntimeView {
  canDecide: boolean;
  evaluation?: WorkflowGateEvaluationRecord;
  gateDefinitionLock: WorkflowGateDefinition;
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
): boolean {
  let changed = false;
  for (const gate of run.gateDefinitionLocks) {
    const subject = currentGateSubject(snapshot, gate, stepRuns);
    const current = currentEvaluationForGate(snapshot, run, gate.gateId);
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

function currentGateSubject(
  snapshot: BoardSnapshot,
  gate: WorkflowGateDefinition,
  stepRuns: WorkflowStepRunRecord[],
): {
  subjectAssetIds: string[];
  subjectExecutionIds: string[];
  subjectFingerprint: string;
} | undefined {
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
    subjectFingerprint: subjectFingerprint(gate.gateId, subjectAssetIds, subjectExecutionIds),
  };
}

function gateSubjectAssetIds(
  snapshot: BoardSnapshot,
  gate: WorkflowGateDefinition,
  step: WorkflowStepRunRecord,
): string[] {
  const executionById = new Map(
    step.executionIds.flatMap((executionId) => {
      const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
      return execution ? [[executionId, execution] as const] : [];
    }),
  );
  const candidates = step.outputAcceptancePolicy === 'manual_selection'
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

function subjectFingerprint(gateId: string, assetIds: string[], executionIds: string[]): string {
  const value = JSON.stringify([gateId, assetIds, executionIds]);
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
