import { setAgentSessionRun } from './agentSession';
import type {
  AgentRuntimeEvent,
  AgentRuntimeEventRecord,
  ChangeDecisionRecord,
  ChangeProposalCommand,
  ChangeProposalRecord,
} from './agentSessionContracts';
import { createId, nowIso } from './id';
import type { BoardSnapshot } from './types';

export function appendAgentRuntimeEvent(
  snapshot: BoardSnapshot,
  input: { event: AgentRuntimeEvent; sourceMessageId: string },
): AgentRuntimeEventRecord {
  const session = requireSession(snapshot, input.event.agentSessionId);
  const source = (snapshot.agentMessages ?? []).find(
    (message) => message.agentMessageId === input.sourceMessageId,
  );
  if (
    !source ||
    source.projectId !== snapshot.project.projectId ||
    source.boardId !== snapshot.board.boardId ||
    source.agentSessionId !== session.agentSessionId ||
    source.role !== 'user'
  ) throw new Error('Agent Runtime Event source message is invalid.');
  snapshot.agentRuntimeEvents ??= [];
  const existing = snapshot.agentRuntimeEvents.find(
    (candidate) => candidate.runtimeEventId === input.event.runtimeEventId,
  );
  if (existing) return existing;
  const sequence = snapshot.agentRuntimeEvents.reduce(
    (current, candidate) => candidate.agentSessionId === session.agentSessionId
      ? Math.max(current, candidate.sequence)
      : current,
    0,
  ) + 1;
  const base = {
    agentSessionId: session.agentSessionId,
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    runtimeEventId: input.event.runtimeEventId,
    sequence,
    sourceMessageId: source.agentMessageId,
    occurredAt: input.event.occurredAt,
  };
  const record: AgentRuntimeEventRecord = input.event.kind === 'decision_delta'
    ? { ...base, delta: input.event.delta, kind: input.event.kind }
    : input.event.kind === 'turn_completed'
      ? { ...base, kind: input.event.kind, runtimeTurnId: input.event.runtimeTurnId }
      : input.event.kind === 'turn_failed'
        ? { ...base, error: input.event.error, kind: input.event.kind }
        : { ...base, kind: input.event.kind };
  snapshot.agentRuntimeEvents.push(record);
  return record;
}

export function decideChangeProposal(
  snapshot: BoardSnapshot,
  input: {
    decision: 'approve' | 'reject';
    expectedProposalVersion: number;
    proposalId: string;
  },
): { decision: ChangeDecisionRecord; proposal: ChangeProposalRecord } {
  const proposal = requireChangeProposal(snapshot, input.proposalId);
  if (proposal.status !== 'awaiting_decision') throw new Error('Change Proposal is not awaiting a decision.');
  if (proposal.recordVersion !== input.expectedProposalVersion) {
    throw new Error(
      `Change Proposal version conflict: expected ${input.expectedProposalVersion}, current ${proposal.recordVersion}.`,
    );
  }
  if (input.decision === 'approve' && proposal.proposedCommand.kind === 'unsupported') {
    throw new Error('This Change Proposal has no registered Application Service command.');
  }
  const decision: ChangeDecisionRecord = {
    agentSessionId: proposal.agentSessionId,
    boardId: proposal.boardId,
    changeDecisionId: createId('change_decision'),
    createdAt: nowIso(),
    decidedBy: 'user_local',
    decision: input.decision,
    expectedProposalVersion: input.expectedProposalVersion,
    projectId: proposal.projectId,
    proposalId: proposal.proposalId,
    recordVersion: 1,
  };
  snapshot.changeDecisions ??= [];
  snapshot.changeDecisions.push(decision);
  proposal.changeDecisionId = decision.changeDecisionId;

  if (input.decision === 'reject') {
    proposal.status = 'rejected';
    touchProposal(proposal);
    return { decision, proposal };
  }

  proposal.status = 'approved';
  touchProposal(proposal);
  proposal.status = 'applying';
  touchProposal(proposal);
  try {
    applyApprovedChangeProposal(snapshot, proposal);
    proposal.status = 'applied';
    proposal.appliedAt = nowIso();
    delete proposal.applyError;
  } catch (error) {
    proposal.status = 'failed';
    proposal.applyError = error instanceof Error ? error.message : String(error);
  }
  touchProposal(proposal);
  return { decision, proposal };
}

const approvedChangeCommandHandlers: Record<
  Exclude<ChangeProposalCommand['kind'], 'unsupported'>,
  (snapshot: BoardSnapshot, proposal: ChangeProposalRecord) => void
> = {
  'agent_session.attach_run': (snapshot, proposal) => {
    if (proposal.proposedCommand.kind !== 'agent_session.attach_run') {
      throw new Error('Change Proposal command payload does not match its registered command.');
    }
    const command = proposal.proposedCommand;
    const session = requireSession(snapshot, proposal.agentSessionId);
    if (session.status !== 'active') throw new Error('Change Proposal Session is archived.');
    const targetRun = (snapshot.agentRuns ?? []).find(
      (run) => run.agentRunId === command.targetAgentRunId,
    );
    if (
      !targetRun ||
      targetRun.projectId !== snapshot.project.projectId ||
      targetRun.boardId !== snapshot.board.boardId
    ) throw new Error('Change Proposal target Agent Run is outside the approved Board scope.');
    if (targetRun.agentRunId === session.activeAgentRunId) {
      throw new Error('Change Proposal target Agent Run is already attached.');
    }
    setAgentSessionRun(snapshot, session.agentSessionId, targetRun.agentRunId);
  },
};

function applyApprovedChangeProposal(snapshot: BoardSnapshot, proposal: ChangeProposalRecord): void {
  if (proposal.proposedCommand.kind === 'unsupported') {
    throw new Error('Unsupported Change Proposal commands cannot be applied.');
  }
  approvedChangeCommandHandlers[proposal.proposedCommand.kind](snapshot, proposal);
}

function requireSession(snapshot: BoardSnapshot, agentSessionId: string) {
  const session = (snapshot.agentSessions ?? []).find((candidate) => candidate.agentSessionId === agentSessionId);
  if (!session || session.projectId !== snapshot.project.projectId || session.boardId !== snapshot.board.boardId) {
    throw new Error(`Agent Session not found in current Board: ${agentSessionId}`);
  }
  return session;
}

function requireChangeProposal(snapshot: BoardSnapshot, proposalId: string): ChangeProposalRecord {
  const proposal = (snapshot.changeProposals ?? []).find((candidate) => candidate.proposalId === proposalId);
  if (!proposal || proposal.boardId !== snapshot.board.boardId || proposal.projectId !== snapshot.project.projectId) {
    throw new Error(`Change Proposal not found: ${proposalId}`);
  }
  return proposal;
}

function touchProposal(proposal: ChangeProposalRecord): void {
  proposal.updatedAt = nowIso();
  proposal.recordVersion += 1;
}
