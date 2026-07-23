import { cancelAgentRun, pauseAgentRun, startAgentRun } from './agentRuntime';
import type {
  AgentMessageContextRef,
  AgentMessageRecord,
  AgentRunControlAction,
  AgentRuntimeBindingRecord,
  AgentRuntimeEventRecord,
  AgentRuntimeTurnContext,
  AgentRuntimeTurnDecision,
  AgentSessionRecord,
  ChangeProposalRecord,
} from './agentSessionContracts';
import { createId, nowIso } from './id';
import {
  listPackageComposerInlineInputOptions,
  listPackageComposerMentionOptions,
  packageComposerMentionId,
} from './packageComposer';
import { buildPackageEntrypointInstantiationCommand } from './packageEntrypointDraftApplication';
import { resolvePackageEntryPoint } from './packageRegistry';
import type { BoardSnapshot } from './types';

export function createAgentSession(
  snapshot: BoardSnapshot,
  input: {
    agentRunId?: string;
    connectionId?: string;
    model?: string;
    title?: string;
  } = {},
): { binding: AgentRuntimeBindingRecord; session: AgentSessionRecord } {
  const now = nowIso();
  const agentRun = input.agentRunId
    ? requireScopedAgentRun(snapshot, input.agentRunId)
    : latestBoardAgentRun(snapshot);
  const agentSessionId = createId('agsession');
  const agentRuntimeBindingId = createId('agruntime');
  const binding: AgentRuntimeBindingRecord = {
    agentRuntimeBindingId,
    agentSessionId,
    connectionId: input.connectionId ?? 'codex-app-server',
    createdAt: now,
    model: input.model ?? 'gpt-5.6-sol',
    recordVersion: 1,
    runtimeKind: 'codex_app_server',
    status: 'active',
    updatedAt: now,
  };
  const session: AgentSessionRecord = {
    ...(agentRun ? { activeAgentRunId: agentRun.agentRunId } : {}),
    activeRuntimeBindingId: agentRuntimeBindingId,
    agentSessionId,
    boardId: snapshot.board.boardId,
    createdAt: now,
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    status: 'active',
    tenantId: 'tenant_local',
    title: input.title?.trim() || `Agent ${((snapshot.agentSessions?.length ?? 0) + 1)}`,
    updatedAt: now,
    userId: 'user_local',
  };
  snapshot.agentSessions ??= [];
  snapshot.agentRuntimeBindings ??= [];
  snapshot.agentSessions.push(session);
  snapshot.agentRuntimeBindings.push(binding);
  return { binding, session };
}

export function appendAgentUserMessage(
  snapshot: BoardSnapshot,
  agentSessionId: string,
  input: { content: string; contextRefs?: AgentMessageContextRef[] },
): AgentMessageRecord {
  const session = requireActiveSession(snapshot, agentSessionId);
  const content = input.content.trim();
  const contextRefs = structuredClone(input.contextRefs ?? []);
  const hasTypedInput = contextRefs.some((ref) => ref.kind === 'entrypoint')
    && contextRefs.some((ref) => ref.kind === 'block' || ref.kind === 'asset' || ref.kind === 'inline');
  if (!content && !hasTypedInput) throw new Error('Agent message cannot be empty.');
  assertContextRefs(snapshot, session, contextRefs);
  const message: AgentMessageRecord = {
    agentMessageId: createId('agmsg'),
    agentSessionId,
    boardId: snapshot.board.boardId,
    content,
    contextRefs,
    createdAt: nowIso(),
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    role: 'user',
  };
  snapshot.agentMessages ??= [];
  snapshot.agentMessages.push(message);
  touchSession(session);
  return message;
}

export function applyAgentRuntimeTurn(
  snapshot: BoardSnapshot,
  input: {
    agentSessionId: string;
    decision: AgentRuntimeTurnDecision;
    externalThreadId: string;
    runtimeModel: string;
    runtimeTurnId: string;
    sourceMessageId: string;
  },
): { assistantMessage: AgentMessageRecord; proposal?: ChangeProposalRecord } {
  const session = requireActiveSession(snapshot, input.agentSessionId);
  const source = requireMessage(snapshot, input.sourceMessageId);
  if (source.agentSessionId !== session.agentSessionId || source.role !== 'user') {
    throw new Error('Agent runtime response source message is invalid.');
  }
  const binding = requireSessionBinding(snapshot, session);
  binding.externalThreadId = input.externalThreadId;
  binding.externalSessionId = input.externalThreadId;
  binding.model = input.runtimeModel;
  binding.status = 'active';
  delete binding.lastError;
  touchVersioned(binding);

  let proposal: ChangeProposalRecord | undefined;
  const explicitEntrypoint = source.contextRefs.find((ref) => ref.kind === 'entrypoint');
  if (explicitEntrypoint) {
    if (input.decision.kind !== 'reply') {
      throw new Error('Agent Runtime cannot replace a typed EntryPoint invocation with another state command.');
    }
    proposal = createTypedEntrypointProposal(snapshot, session, source, input.decision.message);
  } else if (input.decision.kind === 'agent_run_control') {
    applyAgentRunControl(snapshot, session, input.decision.action, input.decision.agentRunId);
  } else if (input.decision.kind === 'change_proposal') {
    proposal = createChangeProposal(snapshot, session, source, input.decision);
  }

  const assistantMessage: AgentMessageRecord = {
    agentMessageId: createId('agmsg'),
    agentSessionId: session.agentSessionId,
    boardId: snapshot.board.boardId,
    content: input.decision.message.trim() || 'Agent completed without a message.',
    contextRefs: session.activeAgentRunId
      ? [{ kind: 'agent_run', agentRunId: session.activeAgentRunId }]
      : [],
    createdAt: nowIso(),
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    role: 'assistant',
    runtimeTurnId: input.runtimeTurnId,
    sourceMessageId: source.agentMessageId,
  };
  snapshot.agentMessages ??= [];
  snapshot.agentMessages.push(assistantMessage);
  touchSession(session);
  return { assistantMessage, ...(proposal ? { proposal } : {}) };
}

export function markAgentRuntimeFailure(
  snapshot: BoardSnapshot,
  agentSessionId: string,
  error: string,
): void {
  const session = requireActiveSession(snapshot, agentSessionId);
  const binding = requireSessionBinding(snapshot, session);
  binding.status = 'failed';
  binding.lastError = error;
  touchVersioned(binding);
  touchSession(session);
}

export function archiveAgentSession(snapshot: BoardSnapshot, agentSessionId: string): AgentSessionRecord {
  const session = requireSession(snapshot, agentSessionId);
  session.status = 'archived';
  touchSession(session);
  return session;
}

export function setAgentSessionRun(
  snapshot: BoardSnapshot,
  agentSessionId: string,
  agentRunId?: string,
): AgentSessionRecord {
  const session = requireActiveSession(snapshot, agentSessionId);
  if (agentRunId) requireScopedAgentRun(snapshot, agentRunId);
  session.activeAgentRunId = agentRunId;
  touchSession(session);
  return session;
}

export function agentRuntimeTurnContext(
  snapshot: BoardSnapshot,
  agentSessionId: string,
  sourceMessageId: string,
): AgentRuntimeTurnContext {
  const session = requireActiveSession(snapshot, agentSessionId);
  const message = requireMessage(snapshot, sourceMessageId);
  if (message.agentSessionId !== agentSessionId || message.role !== 'user') {
    throw new Error('Agent runtime context source message is invalid.');
  }
  const entrypoint = message.contextRefs.find((ref) => ref.kind === 'entrypoint');
  const mentions = message.contextRefs.filter((ref) => ref.kind === 'block' || ref.kind === 'asset');
  const inlineValues = message.contextRefs.filter((ref) => ref.kind === 'inline');
  const parameters = message.contextRefs.find((ref) => ref.kind === 'parameters');
  const run = session.activeAgentRunId ? requireScopedAgentRun(snapshot, session.activeAgentRunId) : undefined;
  return {
    ...(run ? {
      agentRun: {
        agentRunId: run.agentRunId,
        ...(run.agentPresetSnapshot ? {
          agentPreset: {
            agentPresetId: run.agentPresetSnapshot.agentPresetId,
            effectiveToolPermissions: [...run.permissions.allowedToolPermissions],
            instructions: run.agentPresetSnapshot.instructions,
            name: run.agentPresetSnapshot.name,
            reviewResponsibilities: [...run.agentPresetSnapshot.reviewResponsibilities],
            ...(run.agentPresetSnapshot.roleLabel
              ? { roleLabel: run.agentPresetSnapshot.roleLabel }
              : {}),
            version: run.agentPresetSnapshot.version,
          },
        } : {}),
        allowedActions: allowedAgentRunActions(run.status),
        status: run.status,
        targetKind: run.target.kind,
      },
    } : {}),
    availableAgentRuns: (snapshot.agentRuns ?? [])
      .filter((candidate) => candidate.projectId === snapshot.project.projectId
        && candidate.boardId === snapshot.board.boardId)
      .map((candidate) => ({
        agentRunId: candidate.agentRunId,
        status: candidate.status,
        targetKind: candidate.target.kind,
      })),
    boardId: snapshot.board.boardId,
    ...(entrypoint?.kind === 'entrypoint' ? { entrypointId: entrypoint.entrypointId } : {}),
    history: messagesForSession(snapshot, agentSessionId)
      .filter((candidate) => candidate.agentMessageId !== sourceMessageId)
      .slice(-20)
      .map(({ content, role }) => ({ content, role })),
    mentions,
    inlineValues,
    parameters: parameters?.kind === 'parameters' ? structuredClone(parameters.value) : {},
    projectId: snapshot.project.projectId,
    userMessage: message.content,
  };
}

export function messagesForSession(snapshot: BoardSnapshot, agentSessionId: string): AgentMessageRecord[] {
  return [...(snapshot.agentMessages ?? [])]
    .filter((message) => message.agentSessionId === agentSessionId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function proposalsForSession(snapshot: BoardSnapshot, agentSessionId: string): ChangeProposalRecord[] {
  return [...(snapshot.changeProposals ?? [])]
    .filter((proposal) => proposal.agentSessionId === agentSessionId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function runtimeEventsForSession(snapshot: BoardSnapshot, agentSessionId: string): AgentRuntimeEventRecord[] {
  return [...(snapshot.agentRuntimeEvents ?? [])]
    .filter((event) => event.agentSessionId === agentSessionId)
    .sort((left, right) => left.sequence - right.sequence);
}

export function activeBoardAgentSessions(snapshot: BoardSnapshot): AgentSessionRecord[] {
  return [...(snapshot.agentSessions ?? [])]
    .filter((session) => session.projectId === snapshot.project.projectId
      && session.boardId === snapshot.board.boardId
      && session.status === 'active')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export function runtimeBindingForSession(
  snapshot: BoardSnapshot,
  agentSessionId: string,
): AgentRuntimeBindingRecord | undefined {
  const session = (snapshot.agentSessions ?? []).find((candidate) => candidate.agentSessionId === agentSessionId);
  if (
    !session?.activeRuntimeBindingId ||
    session.projectId !== snapshot.project.projectId ||
    session.boardId !== snapshot.board.boardId
  ) return undefined;
  const binding = (snapshot.agentRuntimeBindings ?? []).find(
    (binding) => binding.agentRuntimeBindingId === session.activeRuntimeBindingId,
  );
  return binding?.agentSessionId === session.agentSessionId ? binding : undefined;
}

function createTypedEntrypointProposal(
  snapshot: BoardSnapshot,
  session: AgentSessionRecord,
  source: AgentMessageRecord,
  explanation: string,
): ChangeProposalRecord {
  const now = nowIso();
  const proposalId = createId('proposal');
  const proposedCommand = buildPackageEntrypointInstantiationCommand(snapshot, source, proposalId);
  const proposal: ChangeProposalRecord = {
    agentSessionId: session.agentSessionId,
    boardId: snapshot.board.boardId,
    createdAt: now,
    instruction: proposedCommand.invocation.instruction,
    kind: 'instantiate_entrypoint',
    proposedCommand,
    projectId: snapshot.project.projectId,
    proposalId,
    recordVersion: 1,
    sourceMessageId: source.agentMessageId,
    status: 'awaiting_decision',
    summary: explanation.trim() || 'Create the selected EntryPoint as a draft.',
    updatedAt: now,
  };
  snapshot.changeProposals ??= [];
  snapshot.changeProposals.push(proposal);
  return proposal;
}

function createChangeProposal(
  snapshot: BoardSnapshot,
  session: AgentSessionRecord,
  source: AgentMessageRecord,
  decision: Extract<AgentRuntimeTurnDecision, { kind: 'change_proposal' }>,
): ChangeProposalRecord {
  const now = nowIso();
  const proposal: ChangeProposalRecord = {
    ...(session.activeAgentRunId ? { agentRunId: session.activeAgentRunId } : {}),
    agentSessionId: session.agentSessionId,
    boardId: snapshot.board.boardId,
    createdAt: now,
    instruction: source.content,
    kind: decision.proposalKind,
    proposedCommand: structuredClone(decision.proposedCommand),
    projectId: snapshot.project.projectId,
    proposalId: createId('proposal'),
    recordVersion: 1,
    sourceMessageId: source.agentMessageId,
    status: 'awaiting_decision',
    summary: decision.summary.trim() || decision.message.trim(),
    updatedAt: now,
  };
  snapshot.changeProposals ??= [];
  snapshot.changeProposals.push(proposal);
  return proposal;
}

function applyAgentRunControl(
  snapshot: BoardSnapshot,
  session: AgentSessionRecord,
  action: AgentRunControlAction,
  agentRunId: string,
): void {
  if (!session.activeAgentRunId || session.activeAgentRunId !== agentRunId) {
    throw new Error('Agent runtime requested an Agent Run outside the Session target.');
  }
  const run = requireScopedAgentRun(snapshot, agentRunId);
  if (!allowedAgentRunActions(run.status).includes(action)) {
    throw new Error(`Agent Run action is not allowed in status ${run.status}: ${action}`);
  }
  if (action === 'pause') pauseAgentRun(snapshot, agentRunId);
  else if (action === 'resume') startAgentRun(snapshot, agentRunId);
  else cancelAgentRun(snapshot, agentRunId);
}

function allowedAgentRunActions(status: string): AgentRunControlAction[] {
  if (status === 'paused') return ['resume', 'cancel'];
  if (['queued', 'running', 'waiting_input', 'waiting_selection', 'waiting_approval', 'needs_attention'].includes(status)) {
    return ['pause', 'cancel'];
  }
  return [];
}

function assertContextRefs(
  snapshot: BoardSnapshot,
  session: AgentSessionRecord,
  refs: AgentMessageContextRef[],
): void {
  const entrypointRefs = refs.filter((ref) => ref.kind === 'entrypoint');
  if (entrypointRefs.length > 1) throw new Error('Agent message has multiple EntryPoint refs.');
  const entrypointId = entrypointRefs[0]?.kind === 'entrypoint' ? entrypointRefs[0].entrypointId : undefined;
  if (entrypointId && resolvePackageEntryPoint({ entrypointId }).status !== 'resolved') {
    throw new Error(`Agent message EntryPoint ref is not installed: ${entrypointId}`);
  }
  const mentionRefs = refs.filter((ref) => ref.kind === 'block' || ref.kind === 'asset');
  const inlineRefs = refs.filter((ref) => ref.kind === 'inline');
  const parameterRefs = refs.filter((ref) => ref.kind === 'parameters');
  if (parameterRefs.length > 1) throw new Error('Agent message has multiple parameter refs.');
  if ((mentionRefs.length > 0 || inlineRefs.length > 0 || parameterRefs.length > 0) && !entrypointId) {
    throw new Error('Agent message typed inputs require one EntryPoint context.');
  }
  const compatibleMentionIds = entrypointId
    ? new Set(listPackageComposerMentionOptions(snapshot, entrypointId).map((option) => option.mentionId))
    : new Set<string>();
  const compatibleInlineSlotIds = entrypointId
    ? new Set(listPackageComposerInlineInputOptions(entrypointId).map((option) => option.slotId))
    : new Set<string>();
  for (const ref of refs) {
    if (ref.kind === 'agent_run') {
      if (session.activeAgentRunId !== ref.agentRunId) throw new Error('Agent message Agent Run ref is outside Session scope.');
      requireScopedAgentRun(snapshot, ref.agentRunId);
    } else if (ref.kind === 'block') {
      const block = snapshot.blocks.find((candidate) => candidate.blockId === ref.blockId);
      if (!block || block.boardId !== session.boardId) throw new Error('Agent message Block ref is outside Session scope.');
      if (!compatibleMentionIds.has(packageComposerMentionId(ref))) {
        throw new Error('Agent message Block ref is incompatible with the typed EntryPoint.');
      }
    } else if (ref.kind === 'asset') {
      if (!snapshot.assets.some((asset) => asset.assetId === ref.assetId && asset.projectId === session.projectId)) {
        throw new Error('Agent message Asset ref is outside Session Project scope.');
      }
      if (!compatibleMentionIds.has(packageComposerMentionId(ref))) {
        throw new Error('Agent message Asset ref is incompatible with the typed EntryPoint.');
      }
    } else if (ref.kind === 'inline') {
      if (
        !compatibleInlineSlotIds.has(ref.slotId)
        || (
          typeof ref.value === 'string'
            ? !ref.value.trim()
            : !ref.value || typeof ref.value !== 'object' || Array.isArray(ref.value)
        )
      ) {
        throw new Error('Agent message inline input is incompatible with the typed EntryPoint.');
      }
    } else if (ref.kind === 'parameters') {
      if (!entrypointId) throw new Error('Agent message parameters require one EntryPoint context.');
      if (!ref.value || typeof ref.value !== 'object' || Array.isArray(ref.value)) {
        throw new Error('Agent message EntryPoint parameters are invalid.');
      }
    }
  }
}

function requireScopedAgentRun(snapshot: BoardSnapshot, agentRunId: string) {
  const run = (snapshot.agentRuns ?? []).find((candidate) => candidate.agentRunId === agentRunId);
  if (!run || run.projectId !== snapshot.project.projectId || run.boardId !== snapshot.board.boardId) {
    throw new Error(`Agent Run is outside the current Board scope: ${agentRunId}`);
  }
  return run;
}

function latestBoardAgentRun(snapshot: BoardSnapshot) {
  return [...(snapshot.agentRuns ?? [])]
    .filter((run) => run.projectId === snapshot.project.projectId && run.boardId === snapshot.board.boardId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

function requireSession(snapshot: BoardSnapshot, agentSessionId: string): AgentSessionRecord {
  const session = (snapshot.agentSessions ?? []).find((candidate) => candidate.agentSessionId === agentSessionId);
  if (!session || session.projectId !== snapshot.project.projectId || session.boardId !== snapshot.board.boardId) {
    throw new Error(`Agent Session not found in current Board: ${agentSessionId}`);
  }
  return session;
}

function requireActiveSession(snapshot: BoardSnapshot, agentSessionId: string): AgentSessionRecord {
  const session = requireSession(snapshot, agentSessionId);
  if (session.status !== 'active') throw new Error('Agent Session is archived.');
  return session;
}

function requireSessionBinding(snapshot: BoardSnapshot, session: AgentSessionRecord): AgentRuntimeBindingRecord {
  const binding = runtimeBindingForSession(snapshot, session.agentSessionId);
  if (!binding || binding.agentSessionId !== session.agentSessionId) {
    throw new Error('Agent Session runtime binding is missing.');
  }
  return binding;
}

function requireMessage(snapshot: BoardSnapshot, messageId: string): AgentMessageRecord {
  const message = (snapshot.agentMessages ?? []).find((candidate) => candidate.agentMessageId === messageId);
  if (!message || message.projectId !== snapshot.project.projectId || message.boardId !== snapshot.board.boardId) {
    throw new Error(`Agent message not found in current Board: ${messageId}`);
  }
  return message;
}

function touchSession(session: AgentSessionRecord): void {
  session.updatedAt = nowIso();
  session.recordVersion += 1;
}

function touchVersioned(record: AgentRuntimeBindingRecord): void {
  record.updatedAt = nowIso();
  record.recordVersion += 1;
}
