import { cancelAgentRun, pauseAgentRun, startAgentRun } from './agentRuntime';
import { buildAgentBoardReadModel } from './agentBoardReadModel';
import type {
  AgentMessageContextRef,
  AgentMessageRecord,
  AgentRunControlAction,
  AgentRuntimeBindingRecord,
  AgentRuntimeKind,
  AgentRuntimeEventRecord,
  AgentRuntimeTurnContext,
  AgentRuntimeTurnDecision,
  AgentSessionRecord,
  AgentSessionWorkingOperationBinding,
  ChangeProposalRecord,
} from './agentSessionContracts';
import type {
  AgentOperationExecutionRequest,
} from './agentOperationExecution';
import { executionsForOperation } from './executionConfiguration';
import { createId, nowIso } from './id';
import {
  listPackageComposerInlineInputOptions,
  listPackageComposerMentionOptions,
  packageComposerMentionId,
} from './packageComposer';
import { buildPackageEntrypointInstantiationCommand } from './packageEntrypointDraftApplication';
import {
  buildGoalPlanInstantiationCommand,
  listGoalPlanWorkflowOptions,
} from './goalPlanRegistry';
import {
  buildRecommendedSkillInstantiationCommand,
  listAgentSkillEntrypointOptions,
} from './agentSkillRecommendation';
import { resolvePackageEntryPoint } from './packageRegistry';
import type { BoardSnapshot } from './types';
import { workflowRunExperienceFor } from './workflowRunExperience';

export function createAgentSession(
  snapshot: BoardSnapshot,
  input: {
    agentRunId?: string;
    connectionId?: string;
    model?: string;
    runtimeKind?: AgentRuntimeKind;
    title?: string;
  } = {},
): { binding: AgentRuntimeBindingRecord; session: AgentSessionRecord } {
  const now = nowIso();
  const agentRun = input.agentRunId
    ? requireScopedAgentRun(snapshot, input.agentRunId)
    : undefined;
  const agentSessionId = createId('agsession');
  const agentRuntimeBindingId = createId('agruntime');
  const binding: AgentRuntimeBindingRecord = {
    agentRuntimeBindingId,
    agentSessionId,
    connectionId: input.connectionId ?? 'codex-app-server',
    createdAt: now,
    model: input.model ?? 'gpt-5.6-sol',
    recordVersion: 1,
    runtimeKind: input.runtimeKind ?? 'codex_app_server',
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
  if (agentRun) claimAgentRunForSession(snapshot, session, agentRun.agentRunId);
  return { binding, session };
}

export function ensureDefaultAgentSession(
  snapshot: BoardSnapshot,
  input: {
    connectionId?: string;
    model?: string;
    runtimeKind?: AgentRuntimeKind;
    title?: string;
  } = {},
): { created: boolean; session: AgentSessionRecord } {
  const existing = activeBoardAgentSessions(snapshot)[0];
  if (existing) return { created: false, session: existing };
  const created = createAgentSession(snapshot, input);
  return { created: true, session: created.session };
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
  assertContextRefs(snapshot, session, contextRefs, input.content);
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
): {
  assistantMessage: AgentMessageRecord;
  operationExecution?: AgentOperationExecutionRequest;
  proposal?: ChangeProposalRecord;
} {
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
  } else if (input.decision.kind === 'goal_plan_proposal') {
    if (activeAgentRunForSession(snapshot, session)) {
      throw new Error('Goal Plan cannot replace the active Agent Run target.');
    }
    proposal = createGoalPlanProposal(snapshot, session, source, input.decision);
  } else if (input.decision.kind === 'skill_entrypoint_proposal') {
    if (activeAgentRunForSession(snapshot, session)) {
      throw new Error('Recommended Skill cannot replace the active Agent Run target.');
    }
    proposal = createRecommendedSkillProposal(snapshot, session, source, input.decision);
  } else if (input.decision.kind === 'change_proposal') {
    proposal = createChangeProposal(snapshot, session, source, input.decision);
  }

  const assistantMessage: AgentMessageRecord = {
    agentMessageId: createId('agmsg'),
    agentSessionId: session.agentSessionId,
    boardId: snapshot.board.boardId,
    content: input.decision.message.trim() || 'Agent completed without a message.',
    contextRefs: activeAgentRunForSession(snapshot, session)
      ? [{ kind: 'agent_run', agentRunId: session.activeAgentRunId! }]
      : [],
    createdAt: nowIso(),
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    role: 'assistant',
    runtimeTurnId: input.runtimeTurnId,
    sourceMessageId: source.agentMessageId,
    ...(input.decision.suggestions?.length
      ? { suggestions: [...input.decision.suggestions] }
      : {}),
  };
  snapshot.agentMessages ??= [];
  snapshot.agentMessages.push(assistantMessage);
  const operationExecution: AgentOperationExecutionRequest | undefined =
    input.decision.kind === 'operation_create_execute'
      ? {
          agentSessionId: session.agentSessionId,
          assistantMessageId: assistantMessage.agentMessageId,
          decision: input.decision,
          kind: 'create_execute',
          sourceMessageId: source.agentMessageId,
        }
      : input.decision.kind === 'operation_execute'
        ? {
            agentSessionId: session.agentSessionId,
            assistantMessageId: assistantMessage.agentMessageId,
            decision: input.decision,
            kind: 'execute_existing',
            sourceMessageId: source.agentMessageId,
          }
        : undefined;
  touchSession(session);
  return {
    assistantMessage,
    ...(operationExecution ? { operationExecution } : {}),
    ...(proposal ? { proposal } : {}),
  };
}

export function applyAuthorizedOperationSuggestion(
  snapshot: BoardSnapshot,
  input: {
    agentSessionId: string;
    operationBlockId: string;
    sourceMessageId: string;
  },
): {
  assistantMessage: AgentMessageRecord;
  operationExecution: AgentOperationExecutionRequest;
} {
  const session = requireActiveSession(snapshot, input.agentSessionId);
  const activeRun = session.activeAgentRunId
    ? requireScopedAgentRun(snapshot, session.activeAgentRunId)
    : undefined;
  if (
    activeRun
    && !['canceled', 'failed', 'succeeded'].includes(activeRun.status)
  ) {
    throw new Error('An Operation suggestion cannot bypass the active Agent Run.');
  }
  const source = requireMessage(snapshot, input.sourceMessageId);
  if (source.agentSessionId !== session.agentSessionId || source.role !== 'user') {
    throw new Error('Agent Operation suggestion source message is invalid.');
  }
  const suggestionRef = source.contextRefs.find(
    (ref) => ref.kind === 'agent_suggestion_action',
  );
  const operationRef = source.contextRefs.find(
    (ref) => ref.kind === 'operation' && ref.operationBlockId === input.operationBlockId,
  );
  const suggestion = suggestionRef
    ? requireMessage(snapshot, suggestionRef.sourceMessageId)
    : undefined;
  if (
    !suggestionRef
    || !operationRef
    || suggestion?.role !== 'assistant'
    || !suggestion.suggestions?.includes(source.content)
    || !source.content.includes(input.operationBlockId)
  ) {
    throw new Error('Agent Operation suggestion is not bound to an exact visible action.');
  }
  const operation = snapshot.blocks.find(
    (block) => block.blockId === input.operationBlockId && block.type === 'operation',
  );
  if (!operation) throw new Error('Suggested Operation is no longer available.');
  const assistantMessage: AgentMessageRecord = {
    agentMessageId: createId('agmsg'),
    agentSessionId: session.agentSessionId,
    boardId: snapshot.board.boardId,
    content: `正在执行“${operation.data.title}”。`,
    contextRefs: [],
    createdAt: nowIso(),
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    role: 'assistant',
    sourceMessageId: source.agentMessageId,
  };
  snapshot.agentMessages ??= [];
  snapshot.agentMessages.push(assistantMessage);
  touchSession(session);
  return {
    assistantMessage,
    operationExecution: {
      agentSessionId: session.agentSessionId,
      assistantMessageId: assistantMessage.agentMessageId,
      decision: {
        bindingSource: 'message_explicit',
        kind: 'operation_execute',
        message: assistantMessage.content,
        operationBlockId: operation.blockId,
      },
      kind: 'execute_existing',
      sourceMessageId: source.agentMessageId,
    },
  };
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

export function renameAgentSession(
  snapshot: BoardSnapshot,
  agentSessionId: string,
  title: string,
): AgentSessionRecord {
  const session = requireActiveSession(snapshot, agentSessionId);
  const normalizedTitle = title.trim().replace(/\s+/g, ' ');
  if (!normalizedTitle) throw new Error('Agent name cannot be empty.');
  if (normalizedTitle.length > 80) throw new Error('Agent name cannot exceed 80 characters.');
  if (session.title === normalizedTitle) return session;
  session.title = normalizedTitle;
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
  if (agentRunId) claimAgentRunForSession(snapshot, session, agentRunId);
  else delete session.activeAgentRunId;
  touchSession(session);
  return session;
}

export function setAgentSessionWorkingOperation(
  snapshot: BoardSnapshot,
  agentSessionId: string,
  input?: {
    operationBlockId: string;
    source: AgentSessionWorkingOperationBinding['source'];
  },
): AgentSessionRecord {
  const session = requireActiveSession(snapshot, agentSessionId);
  if (!input) {
    delete session.workingOperation;
    touchSession(session);
    return session;
  }
  const operation = requireScopedOperation(snapshot, input.operationBlockId);
  const capabilityId = typeof operation.data.capabilityId === 'string'
    ? operation.data.capabilityId
    : '';
  if (!capabilityId) throw new Error('Agent working Operation has no Capability.');
  session.workingOperation = {
    boundAt: nowIso(),
    capabilityId,
    operationBlockId: operation.blockId,
    source: input.source,
  };
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
  const agentPreferences = message.contextRefs.find((ref) => ref.kind === 'agent_preferences');
  const mentions = message.contextRefs.filter((ref) => ref.kind === 'block' || ref.kind === 'asset');
  const imageReferenceSettings = message.contextRefs
    .filter((ref) => ref.kind === 'image_reference_setting')
    .flatMap((setting) => {
      const mention = mentions.find(
        (candidate) => packageComposerMentionId(candidate) === setting.mentionId,
      );
      if (mention?.kind !== 'block') return [];
      const block = snapshot.blocks.find(
        (candidate) =>
          candidate.blockId === mention.blockId
          && candidate.type === 'image'
          && typeof candidate.data.assetId === 'string',
      );
      return block ? [{
        blockId: block.blockId,
        instruction: setting.instruction,
        mode: setting.mode,
      }] : [];
    });
  const attachedImageBlockIds = mentions.flatMap((mention) => {
    if (mention.kind !== 'block' || mention.slotId !== 'agent_attachment') return [];
    const block = snapshot.blocks.find(
      (candidate) => candidate.blockId === mention.blockId && candidate.type === 'image',
    );
    return block && typeof block.data.assetId === 'string' ? [block.blockId] : [];
  });
  const mentionedImageBlockIds = mentions.flatMap((mention) => {
    if (
      mention.kind !== 'block'
      || mention.slotId === 'agent_attachment'
    ) return [];
    const block = snapshot.blocks.find(
      (candidate) => candidate.blockId === mention.blockId && candidate.type === 'image',
    );
    return block && typeof block.data.assetId === 'string' ? [block.blockId] : [];
  });
  const inlineValues = message.contextRefs.filter((ref) => ref.kind === 'inline');
  const parameters = message.contextRefs.find((ref) => ref.kind === 'parameters');
  const explicitOperationBlockIds = message.contextRefs.flatMap((ref) =>
    ref.kind === 'operation' ? [ref.operationBlockId] : []);
  const selectedImageBlockIds = message.contextRefs.flatMap((ref) =>
    ref.kind === 'canvas_image_selection' ? ref.imageBlockIds : []);
  const run = activeAgentRunForSession(snapshot, session);
  const workflowRunId = run?.target.kind === 'capability'
    ? undefined
    : run?.target.workflowRunId;
  const workflowExperience = workflowRunId
    ? workflowRunExperienceFor(snapshot, run, { workflowRunIds: [workflowRunId] }).runs[0]
    : undefined;
  const workflowStepRunById = new Map(
    (snapshot.workflowStepRuns ?? []).map((step) => [step.stepRunId, step]),
  );
  const workingOperation = scopedWorkingOperation(snapshot, session);
  const workingOutputImageBlockIds = workingOperation
    ? agentSessionWorkingOutputImageBlockIds(snapshot, workingOperation.operationBlockId)
    : [];
  return {
    ...(agentPreferences?.kind === 'agent_preferences'
      ? { agentPreferences: structuredClone(agentPreferences) }
      : {}),
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
        ...(workflowExperience ? {
          workflowSteps: workflowExperience.steps.map((step) => ({
            freshness: step.freshness,
            label: step.label,
            operationBlockId: step.operationBlockId,
            outputAssetIds: [
              ...(workflowStepRunById.get(step.stepRunId)?.outputAssetIds ?? []),
            ],
            status: step.status,
            stepId: step.stepId,
            stepRunId: step.stepRunId,
          })),
        } : {}),
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
    boardReadModel: buildAgentBoardReadModel(snapshot, {
      ...(run ? { activeAgentRun: run } : {}),
      mentionedBlockIds: [
        ...mentions.flatMap((mention) =>
          mention.kind === 'block' ? [mention.blockId] : []),
        ...explicitOperationBlockIds,
        ...selectedImageBlockIds,
        ...(workingOperation ? [workingOperation.operationBlockId] : []),
        ...workingOutputImageBlockIds,
      ],
    }),
    imageReferenceSettings,
    attachedImageBlockIds,
    boardId: snapshot.board.boardId,
    ...(entrypoint?.kind === 'entrypoint' ? { entrypointId: entrypoint.entrypointId } : {}),
    explicitOperationBlockIds,
    history: messagesForSession(snapshot, agentSessionId)
      .filter((candidate) => candidate.agentMessageId !== sourceMessageId)
      .slice(-20)
      .map(({ content, role }) => ({ content, role })),
    goalPlanOptions: !run && !entrypoint
      ? listGoalPlanWorkflowOptions()
      : [],
    skillEntrypointOptions: !run && !entrypoint
      ? listAgentSkillEntrypointOptions().filter((option) => (
          agentPreferences?.kind !== 'agent_preferences'
          || agentPreferences.outputType === 'auto'
          || option.outputDataTypes.includes(agentPreferences.outputType)
        ))
      : [],
    mentions,
    mentionedImageBlockIds,
    inlineValues,
    parameters: parameters?.kind === 'parameters' ? structuredClone(parameters.value) : {},
    projectId: snapshot.project.projectId,
    selectedImageBlockIds,
    userMessage: message.content,
    ...(workingOperation ? { workingOperation } : {}),
    workingOutputImageBlockIds,
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

export function workflowRunIdsForAgentSession(
  snapshot: BoardSnapshot,
  agentSessionId: string,
): string[] {
  const session = (snapshot.agentSessions ?? []).find(
    (candidate) => candidate.agentSessionId === agentSessionId
      && candidate.projectId === snapshot.project.projectId
      && candidate.boardId === snapshot.board.boardId,
  );
  if (!session) return [];

  const agentRunIds = new Set<string>();
  if (session.activeAgentRunId) agentRunIds.add(session.activeAgentRunId);
  for (const message of messagesForSession(snapshot, agentSessionId)) {
    for (const ref of message.contextRefs) {
      if (ref.kind === 'agent_run') agentRunIds.add(ref.agentRunId);
    }
  }

  const workflowRunIds = new Set<string>();
  for (const proposal of proposalsForSession(snapshot, agentSessionId)) {
    if (proposal.draftLaunchEffect?.workflowRunId) {
      workflowRunIds.add(proposal.draftLaunchEffect.workflowRunId);
      agentRunIds.add(proposal.draftLaunchEffect.agentRunId);
    }
  }
  for (const run of snapshot.agentRuns ?? []) {
    if (!agentRunIds.has(run.agentRunId) || run.target.kind === 'capability') continue;
    workflowRunIds.add(run.target.workflowRunId);
  }

  const availableRunIds = new Set(
    (snapshot.workflowRuns ?? []).map((run) => run.workflowRunId),
  );
  return [...workflowRunIds].filter((workflowRunId) => availableRunIds.has(workflowRunId));
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

export function agentSessionForRun(
  snapshot: BoardSnapshot,
  agentRunId: string,
): AgentSessionRecord | undefined {
  return activeBoardAgentSessions(snapshot).find(
    (session) => session.activeAgentRunId === agentRunId,
  );
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

export function createTypedEntrypointProposalForMessage(
  snapshot: BoardSnapshot,
  input: {
    agentSessionId: string;
    explanation: string;
    sourceMessageId: string;
  },
): ChangeProposalRecord {
  const session = requireActiveSession(snapshot, input.agentSessionId);
  const source = requireMessage(snapshot, input.sourceMessageId);
  if (source.agentSessionId !== session.agentSessionId || source.role !== 'user') {
    throw new Error('Typed EntryPoint Proposal source message is invalid.');
  }
  if (!source.contextRefs.some((ref) => ref.kind === 'entrypoint')) {
    throw new Error('Typed EntryPoint Proposal requires an explicit EntryPoint.');
  }
  return createTypedEntrypointProposal(
    snapshot,
    session,
    source,
    input.explanation,
  );
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

function createGoalPlanProposal(
  snapshot: BoardSnapshot,
  session: AgentSessionRecord,
  source: AgentMessageRecord,
  decision: Extract<AgentRuntimeTurnDecision, { kind: 'goal_plan_proposal' }>,
): ChangeProposalRecord {
  const now = nowIso();
  const proposalId = createId('proposal');
  const proposedCommand = buildGoalPlanInstantiationCommand(snapshot, source, {
    coverage: decision.coverage,
    limitations: decision.limitations,
    proposalId,
    workflowEntryPointId: decision.workflowEntryPointId,
  });
  const proposal: ChangeProposalRecord = {
    agentSessionId: session.agentSessionId,
    boardId: snapshot.board.boardId,
    createdAt: now,
    instruction: proposedCommand.goalPlan.goal,
    kind: 'plan_goal',
    proposedCommand,
    projectId: snapshot.project.projectId,
    proposalId,
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

function createRecommendedSkillProposal(
  snapshot: BoardSnapshot,
  session: AgentSessionRecord,
  source: AgentMessageRecord,
  decision: Extract<AgentRuntimeTurnDecision, { kind: 'skill_entrypoint_proposal' }>,
): ChangeProposalRecord {
  const now = nowIso();
  const proposalId = createId('proposal');
  const proposedCommand = buildRecommendedSkillInstantiationCommand(snapshot, source, {
    proposalId,
    skillEntryPointId: decision.skillEntryPointId,
  });
  const proposal: ChangeProposalRecord = {
    agentSessionId: session.agentSessionId,
    boardId: snapshot.board.boardId,
    createdAt: now,
    instruction: source.content,
    kind: 'plan_skill',
    proposedCommand,
    projectId: snapshot.project.projectId,
    proposalId,
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

function activeAgentRunForSession(
  snapshot: BoardSnapshot,
  session: AgentSessionRecord,
) {
  if (!session.activeAgentRunId) return undefined;
  const run = requireScopedAgentRun(snapshot, session.activeAgentRunId);
  return run.status === 'succeeded' || run.status === 'failed' || run.status === 'canceled'
    ? undefined
    : run;
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
  content: string,
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
  const preferenceRefs = refs.filter((ref) => ref.kind === 'agent_preferences');
  const workflowExecutionModeRefs = refs.filter(
    (ref) => ref.kind === 'workflow_execution_mode',
  );
  const workflowInteractionModeRefs = refs.filter(
    (ref) => ref.kind === 'workflow_interaction_mode',
  );
  if (parameterRefs.length > 1) throw new Error('Agent message has multiple parameter refs.');
  if (preferenceRefs.length > 1) throw new Error('Agent message has multiple Agent preference refs.');
  if (workflowExecutionModeRefs.length > 1) {
    throw new Error('Agent message has multiple Workflow execution mode refs.');
  }
  if (workflowInteractionModeRefs.length > 1) {
    throw new Error('Agent message has multiple Workflow interaction mode refs.');
  }
  if ((inlineRefs.length > 0 || parameterRefs.length > 0) && !entrypointId) {
    throw new Error('Agent message typed inline inputs require one EntryPoint context.');
  }
  if (workflowExecutionModeRefs.length > 0) {
    const resolution = entrypointId ? resolvePackageEntryPoint({ entrypointId }) : undefined;
    if (
      resolution?.status !== 'resolved'
      || resolution.target.kind !== 'workflow'
      || !['plan_first', 'run_now'].includes(workflowExecutionModeRefs[0]!.mode)
    ) {
      throw new Error('Workflow execution mode requires one resolved Workflow EntryPoint.');
    }
  }
  if (workflowInteractionModeRefs.length > 0) {
    const resolution = entrypointId ? resolvePackageEntryPoint({ entrypointId }) : undefined;
    if (
      resolution?.status !== 'resolved'
      || resolution.target.kind !== 'workflow'
      || !['automatic', 'manual'].includes(workflowInteractionModeRefs[0]!.mode)
    ) {
      throw new Error('Workflow interaction mode requires one resolved Workflow EntryPoint.');
    }
  }
  const compatibleMentionIds = entrypointId
    ? new Set(listPackageComposerMentionOptions(snapshot, entrypointId).map((option) => option.mentionId))
    : new Set<string>();
  const compatibleInlineSlotIds = entrypointId
    ? new Set(listPackageComposerInlineInputOptions(entrypointId).map((option) => option.slotId))
    : new Set<string>();
  for (const ref of refs) {
    if (ref.kind === 'agent_preferences') {
      if (
        !['auto', 'image', 'video'].includes(ref.outputType)
        || (ref.variationCount !== undefined && ![1, 2, 3, 4].includes(ref.variationCount))
      ) {
        throw new Error('Agent message preferences are invalid.');
      }
    } else if (ref.kind === 'workflow_execution_mode') {
      // Validated once above together with the exact Workflow EntryPoint.
    } else if (ref.kind === 'workflow_interaction_mode') {
      // Validated once above together with the exact Workflow EntryPoint.
    } else if (ref.kind === 'agent_suggestion_action') {
      const source = (snapshot.agentMessages ?? []).find(
        (message) =>
          message.agentMessageId === ref.sourceMessageId
          && message.agentSessionId === session.agentSessionId
          && message.boardId === session.boardId
          && message.role === 'assistant',
      );
      if (
        ref.action !== 'run'
        || !source?.suggestions?.includes(content.trim())
      ) {
        throw new Error('Agent suggestion action is not bound to an exact assistant suggestion.');
      }
    } else if (ref.kind === 'agent_run') {
      if (session.activeAgentRunId !== ref.agentRunId) throw new Error('Agent message Agent Run ref is outside Session scope.');
      requireScopedAgentRun(snapshot, ref.agentRunId);
    } else if (ref.kind === 'operation') {
      requireScopedOperation(snapshot, ref.operationBlockId);
    } else if (ref.kind === 'canvas_image_selection') {
      if (
        ref.imageBlockIds.length === 0
        || ref.imageBlockIds.length !== new Set(ref.imageBlockIds).size
      ) {
        throw new Error('Agent message Canvas image selection is invalid.');
      }
      for (const blockId of ref.imageBlockIds) {
        const block = snapshot.blocks.find(
          (candidate) =>
            candidate.blockId === blockId
            && candidate.boardId === session.boardId
            && candidate.type === 'image'
            && typeof candidate.data.assetId === 'string',
        );
        if (!block) {
          throw new Error('Agent message Canvas image selection is outside Session scope.');
        }
      }
    } else if (ref.kind === 'operation_receipt') {
      throw new Error('Agent message Operation receipt is reserved for the Host.');
    } else if (ref.kind === 'block') {
      const block = snapshot.blocks.find((candidate) => candidate.blockId === ref.blockId);
      if (!block || block.boardId !== session.boardId) throw new Error('Agent message Block ref is outside Session scope.');
      if (
        entrypointId
        && ref.slotId !== 'agent_attachment'
        && !compatibleMentionIds.has(packageComposerMentionId(ref))
      ) {
        throw new Error('Agent message Block ref is incompatible with the typed EntryPoint.');
      }
    } else if (ref.kind === 'asset') {
      if (!snapshot.assets.some((asset) => asset.assetId === ref.assetId && asset.projectId === session.projectId)) {
        throw new Error('Agent message Asset ref is outside Session Project scope.');
      }
      if (
        entrypointId
        && ref.slotId !== 'agent_attachment'
        && !compatibleMentionIds.has(packageComposerMentionId(ref))
      ) {
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

function requireScopedOperation(snapshot: BoardSnapshot, operationBlockId: string) {
  const operation = snapshot.blocks.find(
    (candidate) =>
      candidate.blockId === operationBlockId
      && candidate.boardId === snapshot.board.boardId
      && candidate.type === 'operation',
  );
  if (!operation) {
    throw new Error(`Operation is outside the current Board scope: ${operationBlockId}`);
  }
  return operation;
}

function scopedWorkingOperation(
  snapshot: BoardSnapshot,
  session: AgentSessionRecord,
): AgentSessionWorkingOperationBinding | undefined {
  const binding = session.workingOperation;
  if (!binding) return undefined;
  const operation = snapshot.blocks.find(
    (candidate) =>
      candidate.blockId === binding.operationBlockId
      && candidate.boardId === session.boardId
      && candidate.type === 'operation',
  );
  if (!operation || operation.data.capabilityId !== binding.capabilityId) return undefined;
  return structuredClone(binding);
}

export function agentSessionWorkingOutputImageBlockIds(
  snapshot: BoardSnapshot,
  operationBlockId: string,
): string[] {
  const execution = executionsForOperation(snapshot, operationBlockId)
    .find((candidate) => candidate.status === 'succeeded');
  if (!execution) return [];
  return execution.outputBlockIds.filter((blockId) => {
    const block = snapshot.blocks.find(
      (candidate) =>
        candidate.blockId === blockId
        && candidate.boardId === snapshot.board.boardId
        && candidate.type === 'image'
        && typeof candidate.data.assetId === 'string',
    );
    return Boolean(block);
  });
}

function claimAgentRunForSession(
  snapshot: BoardSnapshot,
  session: AgentSessionRecord,
  agentRunId: string,
): void {
  const currentRun = session.activeAgentRunId && session.activeAgentRunId !== agentRunId
    ? (snapshot.agentRuns ?? []).find((run) => run.agentRunId === session.activeAgentRunId)
    : undefined;
  if (
    currentRun
    && !['canceled', 'failed', 'succeeded'].includes(currentRun.status)
  ) {
    throw new Error(`Agent already has an active task: ${currentRun.agentRunId}`);
  }
  const owner = (snapshot.agentSessions ?? []).find(
    (candidate) =>
      candidate.status === 'active'
      && candidate.agentSessionId !== session.agentSessionId
      && candidate.activeAgentRunId === agentRunId,
  );
  if (owner) {
    throw new Error(`Agent Run already belongs to another Agent: ${owner.agentSessionId}`);
  }
  session.activeAgentRunId = agentRunId;
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
