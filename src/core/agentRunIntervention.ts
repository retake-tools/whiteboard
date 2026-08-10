import { operationReadinessFor } from './capabilities';
import type { AgentRunRecord } from './agentRuntimeContracts';
import type { BlockRecord, BoardSnapshot, OperationReadinessIssue } from './types';
import { workflowGateViewsForRun } from './workflowGateRuntime';

export type AgentRunInterventionKind =
  | 'approval'
  | 'attention'
  | 'input'
  | 'provider_authorization'
  | 'selection';

export type AgentRunAttentionReason =
  | 'execution_failed'
  | 'execution_missing'
  | 'outdated'
  | 'review_not_ready'
  | 'retired_definition'
  | 'unknown';

export interface AgentRunIntervention {
  attentionReason?: AgentRunAttentionReason;
  approvalCompletesWorkflow?: boolean;
  approvalRequestId?: string;
  detail?: string;
  expectedApprovalRequestVersion?: number;
  kind: AgentRunInterventionKind;
  locateBlockId?: string;
  occurredAt: string;
  readinessIssues: OperationReadinessIssue[];
  prepareReviewStepRunId?: string;
  retryExecutionId?: string;
  retryableResultBlockIds?: string[];
  reviewChecklist?: string[];
  targetLabel?: string;
}

export function agentRunInterventionFor(
  snapshot: BoardSnapshot,
  run: AgentRunRecord,
): AgentRunIntervention | undefined {
  if (
    run.status !== 'waiting_input'
    && run.status !== 'waiting_selection'
    && run.status !== 'waiting_approval'
    && run.status !== 'needs_attention'
    && run.status !== 'failed'
  ) return undefined;

  if (run.stopReason === 'provider_execution_authorization_required') {
    return interventionForOperation(snapshot, run, 'provider_authorization');
  }
  if (run.status === 'waiting_approval') {
    return waitingApprovalIntervention(snapshot, run);
  }
  if (run.status === 'waiting_selection') {
    return interventionForOperation(snapshot, run, 'selection');
  }
  if (run.status === 'waiting_input') {
    return interventionForOperation(snapshot, run, 'input');
  }
  return interventionForOperation(snapshot, run, 'attention', run.error);
}

function interventionForOperation(
  snapshot: BoardSnapshot,
  run: AgentRunRecord,
  kind: Exclude<AgentRunInterventionKind, 'approval'>,
  detail?: string,
): AgentRunIntervention {
  const operation = operationForIntervention(snapshot, run);
  const retryableExecution = kind === 'attention'
    ? retryableImageExecutionForAgentRun(snapshot, run, operation?.blockId)
    : undefined;
  const reviewRecovery = kind === 'attention'
    ? workflowReviewRecoveryFor(snapshot, run)
    : undefined;
  return {
    attentionReason: kind === 'attention'
      ? reviewRecovery
        ? 'review_not_ready'
        : attentionReasonFor(snapshot, run)
      : undefined,
    kind,
    detail,
    locateBlockId: operation?.blockId
      ?? reviewRecovery?.operationBlockId
      ?? workflowGroupBlockId(snapshot, run),
    prepareReviewStepRunId: reviewRecovery?.stepRunId,
    occurredAt: reviewRecovery?.occurredAt
      ?? retryableExecution?.occurredAt
      ?? attentionOccurrenceFor(snapshot, run)
      ?? run.updatedAt,
    readinessIssues: kind === 'input' && operation
      ? operationReadinessFor(snapshot, operation).issues
      : [],
    retryExecutionId: retryableExecution?.executionId,
    retryableResultBlockIds: retryableExecution?.resultBlockIds,
    targetLabel: reviewRecovery?.targetLabel ?? blockLabel(operation),
  };
}

function workflowReviewRecoveryFor(
  snapshot: BoardSnapshot,
  run: AgentRunRecord,
): {
  occurredAt: string;
  operationBlockId: string;
  stepRunId: string;
  targetLabel?: string;
} | undefined {
  if (run.target.kind === 'capability') return undefined;
  const workflowRunId = run.target.workflowRunId;
  const workflowRun = (snapshot.workflowRuns ?? []).find(
    (candidate) => candidate.workflowRunId === workflowRunId,
  );
  if (!workflowRun) return undefined;
  const allowedStepRunIds = new Set(run.scope.allowedStepRunIds);
  const gateViews = workflowGateViewsForRun(snapshot, workflowRunId);
  for (const gate of gateViews) {
    if (
      !gate.gateDefinitionLock.required
      || gate.evaluation?.freshness === 'current'
    ) continue;
    const step = (snapshot.workflowStepRuns ?? []).find(
      (candidate) => (
        candidate.workflowRunId === workflowRunId
        && candidate.stepId === gate.gateDefinitionLock.subject.stepId
        && allowedStepRunIds.has(candidate.stepRunId)
      ),
    );
    if (
      !step
      || step.status !== 'succeeded'
      || step.freshness !== 'current'
      || step.outputAssetIds.length === 0
      || (
        step.outputAcceptancePolicy !== 'automatic'
        && step.acceptedOutputAssetIds.length === 0
      )
    ) continue;
    return {
      occurredAt: gate.evaluation?.updatedAt ?? step.updatedAt,
      operationBlockId: step.operationBlockId,
      stepRunId: step.stepRunId,
      targetLabel: gate.gateDefinitionLock.name,
    };
  }
  return undefined;
}

function retryableImageExecutionForAgentRun(
  snapshot: BoardSnapshot,
  run: AgentRunRecord,
  operationBlockId?: string,
): {
  executionId: string;
  occurredAt: string;
  resultBlockIds: string[];
} | undefined {
  const executionIds = new Set(run.executionIds);
  const executions = snapshot.executions
    .filter((execution) => (
      execution.status === 'failed'
      && (execution.adapter === 'codex_app_server' || execution.adapter === 'direct_api')
      && Boolean(execution.connectionId)
      && (
        execution.agentRunId === run.agentRunId
        || executionIds.has(execution.executionId)
        || (
          run.target.kind !== 'capability'
          && execution.workflowRunId === run.target.workflowRunId
          && Boolean(
            execution.stepRunId
            && run.scope.allowedStepRunIds.includes(execution.stepRunId),
          )
        )
      )
      && (
        !operationBlockId
        || execution.params?.operationBlockId === operationBlockId
      )
    ))
    .sort((left, right) => (
      Date.parse(right.completedAt ?? right.startedAt)
      - Date.parse(left.completedAt ?? left.startedAt)
    ));
  for (const execution of executions) {
    const resultBlockIds = execution.outputBlockIds.filter((blockId) => {
      const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
      return block?.type === 'image' && typeof block.data.assetId !== 'string';
    });
    if (resultBlockIds.length > 0) {
      return {
        executionId: execution.executionId,
        occurredAt: execution.completedAt ?? execution.startedAt,
        resultBlockIds,
      };
    }
  }
  return undefined;
}

function attentionReasonFor(
  snapshot: BoardSnapshot,
  run: AgentRunRecord,
): AgentRunAttentionReason {
  if (run.stopReason === 'operation_execution_missing') return 'execution_missing';
  if (run.stopReason === 'retired_definition') return 'retired_definition';
  const scopedStepRunIds = new Set(run.scope.allowedStepRunIds);
  const scopedSteps = (snapshot.workflowStepRuns ?? []).filter(
    (step) => scopedStepRunIds.has(step.stepRunId),
  );
  if (
    run.status === 'failed'
    || scopedSteps.some((step) => step.status === 'failed')
    || run.executionIds.some((executionId) =>
      snapshot.executions.find((execution) => execution.executionId === executionId)?.status === 'failed')
  ) return 'execution_failed';
  if (scopedSteps.some((step) => step.freshness === 'outdated')) return 'outdated';
  return 'unknown';
}

function waitingApprovalIntervention(
  snapshot: BoardSnapshot,
  run: AgentRunRecord,
): AgentRunIntervention {
  const workflowRunId = workflowRunIdFor(run);
  const workflowRun = (snapshot.workflowRuns ?? []).find(
    (candidate) => candidate.workflowRunId === workflowRunId,
  );
  const scopedStepIds = new Set(
    (snapshot.workflowStepRuns ?? [])
      .filter((candidate) => run.scope.allowedStepRunIds.includes(candidate.stepRunId))
      .map((candidate) => candidate.stepId),
  );
  const evaluation = (snapshot.workflowGateEvaluations ?? []).find(
    (candidate) => {
      const gate = workflowRun?.gateDefinitionLocks.find(
        (definition) => definition.gateId === candidate.gateId,
      );
      return candidate.workflowRunId === workflowRunId
        && candidate.status === 'waiting_approval'
        && candidate.freshness === 'current'
        && Boolean(gate && scopedStepIds.has(gate.subject.stepId));
    },
  );
  const gate = workflowRun?.gateDefinitionLocks.find(
    (candidate) => candidate.gateId === evaluation?.gateId,
  );
  const request = (snapshot.workflowApprovalRequests ?? []).find(
    (candidate) =>
      candidate.approvalRequestId === evaluation?.approvalRequestId
      && candidate.status === 'pending',
  );
  const step = gate
    ? (snapshot.workflowStepRuns ?? []).find(
        (candidate) =>
          candidate.workflowRunId === workflowRunId
          && candidate.stepId === gate.subject.stepId,
      )
    : undefined;
  const operation = step
    ? operationBlock(snapshot, step.operationBlockId)
    : undefined;
  const workflowSteps = (snapshot.workflowStepRuns ?? []).filter(
    (candidate) => candidate.workflowRunId === workflowRunId,
  );
  return {
    approvalCompletesWorkflow: workflowSteps.every(
      (candidate) => candidate.optional || candidate.status === 'succeeded' || candidate.status === 'skipped',
    ),
    approvalRequestId: request?.approvalRequestId,
    expectedApprovalRequestVersion: request?.recordVersion,
    kind: 'approval',
    locateBlockId: operation?.blockId ?? workflowGroupBlockId(snapshot, run),
    occurredAt: request?.requestedAt ?? evaluation?.updatedAt ?? run.updatedAt,
    readinessIssues: [],
    reviewChecklist: gate?.reviewChecklist ? [...gate.reviewChecklist] : [],
    targetLabel: gate?.name ?? blockLabel(operation),
  };
}

function attentionOccurrenceFor(
  snapshot: BoardSnapshot,
  run: AgentRunRecord,
): string | undefined {
  const allowedStepRunIds = new Set(run.scope.allowedStepRunIds);
  const candidates = (snapshot.workflowStepRuns ?? [])
    .filter((step) => (
      allowedStepRunIds.has(step.stepRunId)
      && (step.status === 'failed' || step.freshness === 'outdated')
    ))
    .map((step) => step.updatedAt);
  for (const executionId of run.executionIds) {
    const execution = snapshot.executions.find(
      (candidate) => candidate.executionId === executionId,
    );
    if (execution?.status === 'failed') {
      candidates.push(execution.completedAt ?? execution.startedAt);
    }
  }
  return candidates.sort().at(-1);
}

function operationForIntervention(
  snapshot: BoardSnapshot,
  run: AgentRunRecord,
): BlockRecord | undefined {
  const current = run.currentOperationBlockId
    ? operationBlock(snapshot, run.currentOperationBlockId)
    : undefined;
  if (current) return current;
  if (run.target.kind === 'capability') {
    return operationBlock(snapshot, run.target.operationBlockId);
  }
  const statusPriority = run.status === 'waiting_selection'
    ? ['waiting_selection']
    : run.status === 'waiting_input'
      ? ['waiting_input', 'ready']
      : ['failed', 'blocked', 'canceled'];
  const allowedStepRunIds = new Set(run.scope.allowedStepRunIds);
  const step = (snapshot.workflowStepRuns ?? []).find(
    (candidate) =>
      candidate.workflowRunId === workflowRunIdFor(run)
      && allowedStepRunIds.has(candidate.stepRunId)
      && (
        statusPriority.includes(candidate.status)
        || (run.status === 'needs_attention' && candidate.freshness === 'outdated')
      ),
  );
  return step ? operationBlock(snapshot, step.operationBlockId) : undefined;
}

function workflowGroupBlockId(
  snapshot: BoardSnapshot,
  run: AgentRunRecord,
): string | undefined {
  const workflowRunId = workflowRunIdFor(run);
  const workflowRun = (snapshot.workflowRuns ?? []).find(
    (candidate) => candidate.workflowRunId === workflowRunId,
  );
  return snapshot.blocks.find(
    (block) =>
      block.type === 'group'
      && block.data.workflowProjectionId === workflowRun?.workflowProjectionId,
  )?.blockId;
}

function workflowRunIdFor(run: AgentRunRecord): string | undefined {
  return run.target.kind === 'capability' ? undefined : run.target.workflowRunId;
}

function operationBlock(
  snapshot: BoardSnapshot,
  blockId: string,
): BlockRecord | undefined {
  return snapshot.blocks.find(
    (block) => block.blockId === blockId && block.type === 'operation',
  );
}

function blockLabel(block: BlockRecord | undefined): string | undefined {
  return typeof block?.data.title === 'string' && block.data.title.trim()
    ? block.data.title.trim()
    : undefined;
}
