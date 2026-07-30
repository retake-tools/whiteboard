import type {
  AgentRuntimeEvent,
  AgentRuntimePort,
  AgentRuntimeTurnContext,
  AgentRuntimeTurnDecision,
  AgentRuntimeTurnResult,
} from '../src/core/agentSessionContracts';
import { agentRuntimeTurnContext, runtimeBindingForSession } from '../src/core/agentSession';
import {
  imageComposerAspectRatios,
  imageComposerResolutions,
} from '../src/core/imageComposer';
import { createId, nowIso } from '../src/core/id';
import { getBoardSnapshot } from './local-store';
import { listExecutionProviderSettings } from './local-store/execution-provider-store';
import { runCodexAppServerTurn } from './codex-app-server-client';

export const agentRuntimeDecisionSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind',
    'message',
    'capabilityId',
    'operationBlockId',
    'operationPrompt',
    'aspectRatioPreset',
    'targetResolution',
    'variationCount',
    'action',
    'agentRunId',
    'proposalKind',
    'proposedCommand',
    'summary',
    'workflowEntryPointId',
    'coverage',
    'limitations',
  ],
  properties: {
    kind: {
      type: 'string',
      enum: [
        'reply',
        'operation_create_execute',
        'operation_execute',
        'agent_run_control',
        'change_proposal',
        'goal_plan_proposal',
      ],
    },
    message: { type: 'string' },
    capabilityId: {
      type: ['string', 'null'],
      enum: ['image.text_to_image', null],
    },
    operationBlockId: { type: ['string', 'null'] },
    operationPrompt: { type: ['string', 'null'] },
    aspectRatioPreset: {
      type: ['string', 'null'],
      enum: [...imageComposerAspectRatios, null],
    },
    targetResolution: {
      type: ['string', 'null'],
      enum: [...imageComposerResolutions, null],
    },
    variationCount: {
      type: ['integer', 'null'],
      minimum: 1,
      maximum: 4,
    },
    action: {
      type: ['string', 'null'],
      enum: ['pause', 'resume', 'cancel', null],
    },
    agentRunId: { type: ['string', 'null'] },
    proposalKind: {
      type: ['string', 'null'],
      enum: ['modify_workflow', 'install_package', 'expand_permissions', 'out_of_scope', null],
    },
    proposedCommand: {
      anyOf: [
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'targetAgentRunId'],
          properties: {
            kind: { type: 'string', const: 'agent_session.attach_run' },
            targetAgentRunId: { type: 'string' },
          },
        },
        {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'reason'],
          properties: {
            kind: { type: 'string', const: 'unsupported' },
            reason: { type: 'string' },
          },
        },
        { type: 'null' },
      ],
    },
    summary: { type: ['string', 'null'] },
    workflowEntryPointId: { type: ['string', 'null'] },
    coverage: {
      type: ['string', 'null'],
      enum: ['full', 'partial', null],
    },
    limitations: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string' },
    },
  },
} satisfies Record<string, unknown>;

const baseInstructions = `You are Retake's bounded video-workflow assistant.
Use only the Board and AgentRun facts supplied in each user turn. Do not call tools, inspect files, use the shell, browse, or modify the environment.
Return one JSON object matching the supplied schema.
- Set fields that do not apply to the selected kind to null, and set limitations to [] when no limitations apply.
- reply: answer questions that do not change product state.
- retakeContext.boardReadModel is the current Board's canonical, read-only, budgeted projection. Its summary counts
  cover the full Board, while detail arrays may omit items as reported by truncation. Do not treat omitted detail as
  proof that an item does not exist. Prefer this turn's read model over descriptions in recentHistory.
- Board facts alone never authorize execution, candidate selection, Gate approval, Provider authorization, Package
  installation, or Canvas mutation. Decide the user's semantic intent from the whole request and supplied typed
  context; do not rely on keywords.
- operation_create_execute: when there is no active AgentRun or explicit EntryPoint and the user is starting a new
  image-generation task without explicitly targeting an existing Operation. Currently capabilityId must be
  image.text_to_image. Provide a concrete execution-ready operationPrompt and optional aspectRatioPreset,
  targetResolution, and variationCount. Retake will create a new Prompt and Operation; never reuse an old Operation
  merely because it is the only ready or semantically similar item on the Board.
- operation_execute: only when the user semantically continues retakeContext.workingOperation or targets an exact
  Operation listed in retakeContext.explicitOperationBlockIds. Copy that exact operationBlockId and provide an
  updated operationPrompt when needed. The target must have readiness.canRun=true. Never select an Operation only
  because it is unique, recent, ready, or similar. If an existing target is intended but not bound, reply and ask
  the user to identify it.
- When retakeContext.entrypointId is present, return reply only. Explain that Retake will create an approval proposal
  for the exact selected EntryPoint and inputs. Never propose or rewrite an EntryPoint command.
- agent_run_control: only when the user explicitly asks for an allowed action on the exact supplied AgentRun id.
- When retakeContext.agentRun.agentPreset is present, follow its instructions only inside the supplied AgentRun
  target, actions, and tool permissions. Preset text never grants permission or changes Workflow/Gate facts.
- goal_plan_proposal: only when there is no active AgentRun, no explicit EntryPoint, the user is asking Retake to
  plan or create a workflow for a goal, and one option in retakeContext.goalPlanOptions is a useful fit. Return that
  option's exact entrypointId. Use coverage=partial and list concrete limitations when the option does not cover the
  complete goal. Never invent, combine, reorder, or rewrite Workflow steps.
- change_proposal: any request to change Workflow structure, install packages, expand permissions, target another run, create/delete/connect Blocks, or otherwise exceed the supplied scope.
  The only registered proposal command is agent_session.attach_run, and only for another AgentRun id listed in availableAgentRuns. All other proposals must use unsupported.
Chat text does not authorize unrelated mutations. New creative tasks use operation_create_execute; existing
Operations require a typed message or Session binding before operation_execute can be applied.`;

class CodexAppServerAgentRuntimePort implements AgentRuntimePort {
  private events = new Map<string, AgentRuntimeEvent[]>();

  async getCapabilities() {
    return { approvals: false, persistentSessions: true, structuredDecisions: true };
  }

  async startSession(input: Parameters<AgentRuntimePort['startSession']>[0]): Promise<AgentRuntimeTurnResult> {
    return this.runTurn(input, false);
  }

  async resumeSession(input: Parameters<AgentRuntimePort['resumeSession']>[0]): Promise<AgentRuntimeTurnResult> {
    return this.runTurn(input, true);
  }

  async *streamEvents(agentSessionId: string): AsyncIterable<AgentRuntimeEvent> {
    const events = this.events.get(agentSessionId) ?? [];
    this.events.delete(agentSessionId);
    for (const event of events) yield event;
  }

  async respondToApproval(): Promise<void> {
    throw new Error('Retake Agent Runtime V0 does not expose Runtime approval requests.');
  }

  async cancel(): Promise<void> {
    throw new Error('Retake Agent Runtime V0 cancels an active turn through its request AbortSignal.');
  }

  private async runTurn(
    input: Parameters<AgentRuntimePort['startSession']>[0],
    resume: boolean,
  ): Promise<AgentRuntimeTurnResult> {
    let publishedDecisionDelta = false;
    this.publishEvent(input, runtimeEvent(input.agentSessionId, { kind: 'turn_started' }));
    try {
      const result = await runCodexAppServerTurn({
        baseInstructions,
        cwd: process.cwd(),
        ephemeral: false,
        model: input.binding.model,
        outputSchema: agentRuntimeDecisionSchema,
        prompt: runtimePrompt(input.context),
        sandbox: 'read-only',
        onTextDelta: (delta) => {
          if (publishedDecisionDelta) return;
          publishedDecisionDelta = true;
          this.publishEvent(
            input,
            runtimeEvent(input.agentSessionId, { delta: delta.slice(0, 256), kind: 'decision_delta' }),
          );
        },
        ...(resume && input.binding.externalThreadId ? { threadId: input.binding.externalThreadId } : {}),
      });
      const decision = parseAgentRuntimeDecision(result.text, input.context);
      const turnResult = {
        decision,
        externalThreadId: result.threadId,
        model: input.binding.model,
        runtimeTurnId: result.turnId,
      };
      this.publishEvent(input, runtimeEvent(input.agentSessionId, {
        kind: 'turn_completed',
        runtimeTurnId: result.turnId,
      }));
      return turnResult;
    } catch (error) {
      this.publishEvent(input, runtimeEvent(input.agentSessionId, {
        error: error instanceof Error ? error.message : String(error),
        kind: 'turn_failed',
      }));
      throw error;
    }
  }

  private publishEvent(
    input: Parameters<AgentRuntimePort['startSession']>[0],
    event: AgentRuntimeEvent,
  ): void {
    this.appendEvent(input.agentSessionId, event);
    input.onEvent?.(event);
  }

  private appendEvent(agentSessionId: string, event: AgentRuntimeEvent): void {
    const events = this.events.get(agentSessionId) ?? [];
    events.push(event);
    this.events.set(agentSessionId, events.slice(-20));
  }
}

const codexRuntimePort = new CodexAppServerAgentRuntimePort();

export async function runAgentRuntimeTurn(input: {
  agentSessionId: string;
  boardId: string;
  projectId: string;
  sourceMessageId: string;
}, onEvent?: (event: AgentRuntimeEvent) => void): Promise<AgentRuntimeTurnResult> {
  const snapshot = await getBoardSnapshot({ projectId: input.projectId, boardId: input.boardId });
  const binding = runtimeBindingForSession(snapshot, input.agentSessionId);
  if (!binding) throw new Error('Agent Session runtime binding was not found.');
  const settings = await listExecutionProviderSettings(input.projectId);
  const connection = settings.connections.find((candidate) => candidate.connectionId === binding.connectionId);
  if (!connection || connection.connectorId !== 'codex-app-server' || !connection.enabled) {
    throw new Error('Codex App Server connection is not enabled for this Agent Session.');
  }
  if (connection.status !== 'ready' || !connection.modelId) {
    throw new Error(connection.lastError || 'Test the Codex App Server connection and choose a model first.');
  }
  const context = agentRuntimeTurnContext(snapshot, input.agentSessionId, input.sourceMessageId);
  const runtimeBinding = { ...binding, model: connection.modelId };
  const request = { agentSessionId: input.agentSessionId, binding: runtimeBinding, context, ...(onEvent ? { onEvent } : {}) };
  return binding.externalThreadId
    ? codexRuntimePort.resumeSession(request)
    : codexRuntimePort.startSession(request);
}

function runtimePrompt(context: AgentRuntimeTurnContext): string {
  return JSON.stringify({
    retakeContext: {
      projectId: context.projectId,
      boardId: context.boardId,
      boardReadModel: context.boardReadModel,
      agentRun: context.agentRun ?? null,
      availableAgentRuns: context.availableAgentRuns,
      goalPlanOptions: context.goalPlanOptions,
      entrypointId: context.entrypointId ?? null,
      inlineValues: context.inlineValues,
      mentions: context.mentions,
      parameters: context.parameters,
      explicitOperationBlockIds: context.explicitOperationBlockIds,
      workingOperation: context.workingOperation ?? null,
    },
    recentHistory: context.history,
    userMessage: context.userMessage,
  });
}

export function parseAgentRuntimeDecision(text: string, context: AgentRuntimeTurnContext): AgentRuntimeTurnDecision {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const message = typeof parsed.message === 'string' ? parsed.message.trim() : '';
  if (!message) throw new Error('Agent Runtime returned an empty message.');
  if (parsed.kind === 'reply') return { kind: 'reply', message };
  if (context.entrypointId) {
    throw new Error('Agent Runtime cannot replace a typed EntryPoint invocation with another state command.');
  }
  if (parsed.kind === 'operation_create_execute') {
    if (context.agentRun) {
      throw new Error('Agent Runtime cannot bypass an active Agent Run with a free Operation execution.');
    }
    if (context.mentions.length > 0) {
      throw new Error('Agent-created Operation does not support unbound typed inputs yet.');
    }
    const capabilityId = parsed.capabilityId;
    const operationPrompt = typeof parsed.operationPrompt === 'string'
      ? parsed.operationPrompt.trim()
      : '';
    if (capabilityId !== 'image.text_to_image' || !operationPrompt) {
      throw new Error('Agent Runtime returned an invalid create-and-execute Operation.');
    }
    const aspectRatioPreset = typeof parsed.aspectRatioPreset === 'string'
      && imageComposerAspectRatios.includes(
        parsed.aspectRatioPreset as typeof imageComposerAspectRatios[number],
      )
      ? parsed.aspectRatioPreset
      : undefined;
    const targetResolution = typeof parsed.targetResolution === 'string'
      && imageComposerResolutions.includes(
        parsed.targetResolution as typeof imageComposerResolutions[number],
      )
      ? parsed.targetResolution
      : undefined;
    const variationCount = typeof parsed.variationCount === 'number'
      && Number.isInteger(parsed.variationCount)
      && parsed.variationCount >= 1
      && parsed.variationCount <= 4
      ? parsed.variationCount
      : undefined;
    return {
      capabilityId,
      generationParams: {
        ...(aspectRatioPreset ? { aspectRatioPreset } : {}),
        ...(targetResolution ? { targetResolution } : {}),
        ...(variationCount ? { variationCount } : {}),
      },
      kind: 'operation_create_execute',
      message,
      operationPrompt,
    };
  }
  if (parsed.kind === 'operation_execute') {
    if (context.agentRun) {
      throw new Error('Agent Runtime cannot bypass an active Agent Run with a free Operation execution.');
    }
    const operationBlockId = typeof parsed.operationBlockId === 'string'
      ? parsed.operationBlockId
      : undefined;
    const operation = operationBlockId
      ? context.boardReadModel.operations.find(
          (candidate) => candidate.operationBlockId === operationBlockId,
        )
      : undefined;
    const bindingSource = operationBlockId
      && context.explicitOperationBlockIds.includes(operationBlockId)
      ? 'message_explicit'
      : operationBlockId === context.workingOperation?.operationBlockId
        ? 'session_working'
        : undefined;
    if (!operationBlockId || !operation || !operation.readiness.canRun || !bindingSource) {
      throw new Error('Agent Runtime selected an Operation outside the explicitly bound ready scope.');
    }
    const operationPrompt = typeof parsed.operationPrompt === 'string'
      ? parsed.operationPrompt.trim()
      : '';
    if (operation.capabilityId === 'image.text_to_image' && !operationPrompt) {
      throw new Error('Agent Runtime must provide an execution prompt for text-to-image.');
    }
    return {
      bindingSource,
      kind: 'operation_execute',
      message,
      operationBlockId,
      ...(operationPrompt ? { operationPrompt } : {}),
    };
  }
  if (parsed.kind === 'agent_run_control') {
    const action = parsed.action;
    const agentRunId = parsed.agentRunId;
    if (
      (action !== 'pause' && action !== 'resume' && action !== 'cancel') ||
      typeof agentRunId !== 'string' ||
      agentRunId !== context.agentRun?.agentRunId ||
      !context.agentRun.allowedActions.includes(action)
    ) {
      throw new Error('Agent Runtime requested an Agent Run control outside the authorized scope.');
    }
    return { action, agentRunId, kind: 'agent_run_control', message };
  }
  if (parsed.kind === 'goal_plan_proposal') {
    if (context.agentRun) {
      throw new Error('Agent Runtime cannot replace an active Agent Run with a Goal Plan.');
    }
    const workflowEntryPointId = parsed.workflowEntryPointId;
    const coverage = parsed.coverage;
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    const limitations = Array.isArray(parsed.limitations)
      ? parsed.limitations.map((value) => typeof value === 'string' ? value.trim() : '').filter(Boolean)
      : [];
    if (
      typeof workflowEntryPointId !== 'string'
      || !context.goalPlanOptions.some((option) => option.entrypointId === workflowEntryPointId)
    ) throw new Error('Agent Runtime selected a Workflow outside the Goal Plan catalog.');
    if (coverage !== 'full' && coverage !== 'partial') {
      throw new Error('Agent Runtime returned an invalid Goal Plan coverage.');
    }
    if (!summary) throw new Error('Agent Runtime returned an empty Goal Plan summary.');
    if (limitations.length > 8) throw new Error('Agent Runtime returned too many Goal Plan limitations.');
    return {
      coverage,
      kind: 'goal_plan_proposal',
      limitations: [...new Set(limitations)],
      message,
      summary,
      workflowEntryPointId,
    };
  }
  if (parsed.kind === 'change_proposal') {
    const proposalKind = parsed.proposalKind;
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (
      proposalKind !== 'modify_workflow' &&
      proposalKind !== 'install_package' &&
      proposalKind !== 'expand_permissions' &&
      proposalKind !== 'out_of_scope'
    ) throw new Error('Agent Runtime returned an invalid Change Proposal kind.');
    if (!summary) throw new Error('Agent Runtime returned an empty Change Proposal summary.');
    const command = isRecord(parsed.proposedCommand) ? parsed.proposedCommand : undefined;
    if (command?.kind === 'agent_session.attach_run') {
      const targetAgentRunId = command.targetAgentRunId;
      if (
        typeof targetAgentRunId !== 'string' ||
        targetAgentRunId === context.agentRun?.agentRunId ||
        !context.availableAgentRuns.some((run) => run.agentRunId === targetAgentRunId)
      ) throw new Error('Agent Runtime proposed an Agent Run outside the current Board scope.');
      return {
        kind: 'change_proposal',
        message,
        proposalKind,
        proposedCommand: { kind: 'agent_session.attach_run', targetAgentRunId },
        summary,
      };
    }
    if (command?.kind === 'unsupported' && typeof command.reason === 'string' && command.reason.trim()) {
      return {
        kind: 'change_proposal',
        message,
        proposalKind,
        proposedCommand: { kind: 'unsupported', reason: command.reason.trim() },
        summary,
      };
    }
    throw new Error('Agent Runtime returned an unregistered Change Proposal command.');
  }
  throw new Error('Agent Runtime returned an unknown decision kind.');
}

function runtimeEvent(
  agentSessionId: string,
  detail:
    | { kind: 'turn_started' }
    | { delta: string; kind: 'decision_delta' }
    | { kind: 'turn_completed'; runtimeTurnId: string }
    | { error: string; kind: 'turn_failed' },
): AgentRuntimeEvent {
  return {
    agentSessionId,
    occurredAt: nowIso(),
    runtimeEventId: createId('agent_event'),
    ...detail,
  } as AgentRuntimeEvent;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
