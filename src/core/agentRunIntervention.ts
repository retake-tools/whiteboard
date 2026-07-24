import { operationReadinessFor } from './capabilities';
import type { AgentRunRecord } from './agentRuntimeContracts';
import type { BlockRecord, BoardSnapshot, OperationReadinessIssue } from './types';

export type AgentRunInterventionKind =
  | 'approval'
  | 'attention'
  | 'input'
  | 'provider_authorization'
  | 'selection';

export interface AgentRunIntervention {
  detail?: string;
  kind: AgentRunInterventionKind;
  locateBlockId?: string;
  readinessIssues: OperationReadinessIssue[];
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
  return {
    kind,
    detail,
    locateBlockId: operation?.blockId ?? workflowGroupBlockId(snapshot, run),
    readinessIssues: kind === 'input' && operation
      ? operationReadinessFor(snapshot, operation).issues
      : [],
    targetLabel: blockLabel(operation),
  };
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
  return {
    kind: 'approval',
    locateBlockId: operation?.blockId ?? workflowGroupBlockId(snapshot, run),
    readinessIssues: [],
    targetLabel: gate?.name ?? blockLabel(operation),
  };
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
