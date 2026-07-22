import type {
  AgentRuntimeEvent,
  AgentRuntimePort,
  AgentRuntimeTurnContext,
  AgentRuntimeTurnDecision,
  AgentRuntimeTurnResult,
} from '../src/core/agentSessionContracts';
import { agentRuntimeTurnContext, runtimeBindingForSession } from '../src/core/agentSession';
import { getBoardSnapshot } from './local-store';
import { listExecutionProviderSettings } from './local-store/execution-provider-store';
import { runCodexAppServerTurn } from './codex-app-server-client';

const decisionSchema = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'message'],
      properties: { kind: { const: 'reply' }, message: { type: 'string' } },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'message', 'action', 'agentRunId'],
      properties: {
        kind: { const: 'agent_run_control' },
        message: { type: 'string' },
        action: { enum: ['pause', 'resume', 'cancel'] },
        agentRunId: { type: 'string' },
      },
    },
    {
      type: 'object',
      additionalProperties: false,
      required: ['kind', 'message', 'proposalKind', 'summary'],
      properties: {
        kind: { const: 'change_proposal' },
        message: { type: 'string' },
        proposalKind: { enum: ['modify_workflow', 'install_package', 'expand_permissions', 'out_of_scope'] },
        summary: { type: 'string' },
      },
    },
  ],
} satisfies Record<string, unknown>;

const baseInstructions = `You are Retake's bounded video-workflow assistant.
Use only the Board and AgentRun facts supplied in each user turn. Do not call tools, inspect files, use the shell, browse, or modify the environment.
Return one JSON object matching the supplied schema.
- reply: answer questions that do not change product state.
- agent_run_control: only when the user explicitly asks for an allowed action on the exact supplied AgentRun id.
- change_proposal: any request to change Workflow structure, install packages, expand permissions, target another run, create/delete/connect Blocks, or otherwise exceed the supplied scope.
Chat text is intent, never execution authorization.`;

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
    this.appendEvent(input.agentSessionId, { agentSessionId: input.agentSessionId, kind: 'turn_started' });
    try {
      const result = await runCodexAppServerTurn({
        baseInstructions,
        cwd: process.cwd(),
        ephemeral: false,
        model: input.binding.model,
        outputSchema: decisionSchema,
        prompt: runtimePrompt(input.context),
        sandbox: 'read-only',
        ...(resume && input.binding.externalThreadId ? { threadId: input.binding.externalThreadId } : {}),
      });
      const decision = parseAgentRuntimeDecision(result.text, input.context);
      const turnResult = {
        decision,
        externalThreadId: result.threadId,
        model: input.binding.model,
        runtimeTurnId: result.turnId,
      };
      this.appendEvent(input.agentSessionId, {
        agentSessionId: input.agentSessionId,
        kind: 'turn_completed',
        runtimeTurnId: result.turnId,
      });
      return turnResult;
    } catch (error) {
      this.appendEvent(input.agentSessionId, {
        agentSessionId: input.agentSessionId,
        error: error instanceof Error ? error.message : String(error),
        kind: 'turn_failed',
      });
      throw error;
    }
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
}): Promise<AgentRuntimeTurnResult> {
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
  const request = { agentSessionId: input.agentSessionId, binding: runtimeBinding, context };
  return binding.externalThreadId
    ? codexRuntimePort.resumeSession(request)
    : codexRuntimePort.startSession(request);
}

function runtimePrompt(context: AgentRuntimeTurnContext): string {
  return JSON.stringify({
    retakeContext: {
      projectId: context.projectId,
      boardId: context.boardId,
      agentRun: context.agentRun ?? null,
      entrypointId: context.entrypointId ?? null,
      mentions: context.mentions,
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
    return { kind: 'change_proposal', message, proposalKind, summary };
  }
  throw new Error('Agent Runtime returned an unknown decision kind.');
}
