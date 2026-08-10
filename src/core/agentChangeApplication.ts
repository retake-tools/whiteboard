import { setAgentSessionRun } from './agentSession';
import type {
  AgentRuntimeEvent,
  AgentRuntimeEventRecord,
  ChangeDecisionRecord,
  ChangeProposalRecord,
  WorkflowLaunchPreferences,
} from './agentSessionContracts';
import { touchBoard } from './blockFactory';
import { createId, nowIso } from './id';
import {
  buildPackageEntrypointInstantiationCommand,
  stagePackageEntrypointDraft,
  type PackageEntrypointDraftPresentation,
} from './packageEntrypointDraftApplication';
import { stageGoalPlanDraft } from './goalPlanDraftApplication';
import { assertCurrentGoalPlanCommand } from './goalPlanRegistry';
import { assertCurrentRecommendedSkillCommand } from './agentSkillRecommendation';
import type { BoardSnapshot } from './types';

const terminalAgentRunStatuses = new Set(['canceled', 'failed', 'succeeded']);

export function applyWorkflowLaunchPreferences(
  proposal: ChangeProposalRecord,
  preferences: WorkflowLaunchPreferences,
): void {
  if (proposal.status !== 'awaiting_decision') {
    throw new Error('Workflow launch preferences require an awaiting Proposal.');
  }
  const invocation = proposal.proposedCommand.kind === 'package_entrypoint.instantiate'
    ? proposal.proposedCommand.invocation
    : proposal.proposedCommand.kind === 'goal_plan.instantiate'
      ? proposal.proposedCommand.draftCommand.invocation
      : undefined;
  if (!invocation || invocation.targetLock.entrypointKind !== 'workflow') {
    throw new Error('Workflow launch preferences require a Workflow EntryPoint Proposal.');
  }
  if (!['automatic', 'manual'].includes(preferences.interactionMode)) {
    throw new Error('Workflow interaction mode is invalid.');
  }
  const parameters = structuredClone(
    proposal.workflowLaunchParameters ?? invocation.parameters,
  );
  for (const [key, value] of [
    ['connectionId', preferences.connectionId],
    ['aspectRatioPreset', preferences.aspectRatioPreset],
    ['targetResolution', preferences.targetResolution],
  ] as const) {
    if (!Object.prototype.hasOwnProperty.call(preferences, key)) continue;
    if (value) parameters[key] = value;
    else delete parameters[key];
  }
  if (preferences.conceptStepId && preferences.conceptVariationCount) {
    // Candidate count belongs to the concept step. Do not keep the legacy flat
    // value, which would otherwise override every image step in the Workflow.
    delete parameters.variationCount;
    const rawOverrides = parameters.stepParameterOverrides;
    const stepParameterOverrides = rawOverrides && typeof rawOverrides === 'object' && !Array.isArray(rawOverrides)
      ? structuredClone(rawOverrides as Record<string, unknown>)
      : {};
    const rawStep = stepParameterOverrides[preferences.conceptStepId];
    const step = rawStep && typeof rawStep === 'object' && !Array.isArray(rawStep)
      ? structuredClone(rawStep as Record<string, unknown>)
      : {};
    step.variationCount = preferences.conceptVariationCount;
    stepParameterOverrides[preferences.conceptStepId] = step;
    parameters.stepParameterOverrides = stepParameterOverrides;
  }
  proposal.workflowLaunchParameters = parameters;
  proposal.workflowInteractionMode = preferences.interactionMode;
}

export function isResolvedAgentRunBlockerProposal(
  snapshot: BoardSnapshot,
  proposal: ChangeProposalRecord,
): boolean {
  if (
    proposal.status !== 'awaiting_decision'
    || proposal.kind !== 'out_of_scope'
    || proposal.proposedCommand.kind !== 'unsupported'
    || !proposal.agentRunId
  ) return false;
  const run = (snapshot.agentRuns ?? []).find(
    (candidate) => candidate.agentRunId === proposal.agentRunId,
  );
  return Boolean(run && terminalAgentRunStatuses.has(run.status));
}

export function supersedeResolvedAgentRunBlockerProposals(
  snapshot: BoardSnapshot,
): boolean {
  const resolved = (snapshot.changeProposals ?? []).filter(
    (proposal) => isResolvedAgentRunBlockerProposal(snapshot, proposal),
  );
  if (resolved.length === 0) return false;
  const updatedAt = nowIso();
  for (const proposal of resolved) {
    proposal.status = 'superseded';
    proposal.updatedAt = updatedAt;
    proposal.recordVersion += 1;
  }
  touchBoard(snapshot);
  return true;
}

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
  presentation: PackageEntrypointDraftPresentation = {},
): { decision: ChangeDecisionRecord; proposal: ChangeProposalRecord } {
  const proposal = requireChangeProposal(snapshot, input.proposalId);
  if (
    input.decision === 'approve' &&
    proposal.status === 'applied' &&
    proposal.appliedEffect?.idempotencyKey === (
      proposal.proposedCommand.kind === 'package_entrypoint.instantiate'
        ? proposal.proposedCommand.idempotencyKey
        : proposal.proposedCommand.kind === 'goal_plan.instantiate'
          ? proposal.proposedCommand.idempotencyKey
        : undefined
    )
  ) {
    const existingDecision = (snapshot.changeDecisions ?? []).find(
      (decision) => decision.changeDecisionId === proposal.changeDecisionId,
    );
    if (!existingDecision) throw new Error('Applied Change Proposal is missing its decision record.');
    return { decision: existingDecision, proposal };
  }
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
    applyApprovedChangeProposal(snapshot, proposal, presentation);
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

function applyApprovedChangeProposal(
  snapshot: BoardSnapshot,
  proposal: ChangeProposalRecord,
  presentation: PackageEntrypointDraftPresentation,
): void {
  if (proposal.proposedCommand.kind === 'unsupported') {
    throw new Error('Unsupported Change Proposal commands cannot be applied.');
  }
  if (proposal.proposedCommand.kind === 'agent_session.attach_run') {
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
    return;
  }

  const session = requireSession(snapshot, proposal.agentSessionId);
  if (session.status !== 'active') throw new Error('Change Proposal Session is archived.');
  const source = (snapshot.agentMessages ?? []).find(
    (message) => message.agentMessageId === proposal.sourceMessageId,
  );
  if (
    !source ||
    source.agentSessionId !== session.agentSessionId ||
    source.projectId !== proposal.projectId ||
    source.boardId !== proposal.boardId
  ) throw new Error('Typed EntryPoint Proposal source message is outside the approved scope.');
  if (proposal.proposedCommand.kind === 'goal_plan.instantiate') {
    assertCurrentGoalPlanCommand(snapshot, source, proposal.proposedCommand);
    const effectiveCommand = structuredClone(proposal.proposedCommand);
    if (proposal.workflowLaunchParameters) {
      effectiveCommand.draftCommand.invocation.parameters = structuredClone(
        proposal.workflowLaunchParameters,
      );
    }
    const staged = stageGoalPlanDraft(snapshot, effectiveCommand, presentation);
    snapshot.blocks = staged.stagedSnapshot.blocks;
    snapshot.edges = staged.stagedSnapshot.edges;
    snapshot.board = staged.stagedSnapshot.board;
    proposal.appliedEffect = staged.effect;
    return;
  }
  if (proposal.proposedCommand.kind !== 'package_entrypoint.instantiate') {
    throw new Error('This Change Proposal has no registered Application Service command.');
  }
  if (proposal.kind === 'plan_skill') {
    assertCurrentRecommendedSkillCommand(
      snapshot,
      source,
      proposal.proposalId,
      proposal.proposedCommand,
    );
  } else {
    const expectedCommand = buildPackageEntrypointInstantiationCommand(snapshot, source, proposal.proposalId);
    if (JSON.stringify(expectedCommand) !== JSON.stringify(proposal.proposedCommand)) {
      throw new Error('Typed EntryPoint Proposal command no longer matches its frozen source message.');
    }
  }
  const effectiveCommand = structuredClone(proposal.proposedCommand);
  if (proposal.workflowLaunchParameters) {
    effectiveCommand.invocation.parameters = structuredClone(proposal.workflowLaunchParameters);
  }
  const staged = stagePackageEntrypointDraft(snapshot, effectiveCommand, presentation);
  snapshot.blocks = staged.stagedSnapshot.blocks;
  snapshot.edges = staged.stagedSnapshot.edges;
  snapshot.board = staged.stagedSnapshot.board;
  proposal.appliedEffect = staged.effect;
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
