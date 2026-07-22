import type { PackageComposerMention } from './packageComposer';

export type AgentSessionStatus = 'active' | 'archived';

export interface AgentSessionRecord {
  activeAgentRunId?: string;
  activeRuntimeBindingId?: string;
  agentSessionId: string;
  boardId: string;
  createdAt: string;
  projectId: string;
  recordVersion: number;
  status: AgentSessionStatus;
  tenantId: 'tenant_local';
  title: string;
  updatedAt: string;
  userId: 'user_local';
}

export type AgentMessageRole = 'assistant' | 'system' | 'tool' | 'user';

export type AgentMessageContextRef =
  | { agentRunId: string; kind: 'agent_run' }
  | { entrypointId: string; kind: 'entrypoint' }
  | PackageComposerMention;

export interface AgentMessageRecord {
  agentMessageId: string;
  agentSessionId: string;
  boardId: string;
  content: string;
  contextRefs: AgentMessageContextRef[];
  createdAt: string;
  projectId: string;
  recordVersion: number;
  role: AgentMessageRole;
  runtimeTurnId?: string;
  sourceMessageId?: string;
}

export type AgentRuntimeBindingStatus = 'active' | 'failed' | 'stale';

export interface AgentRuntimeBindingRecord {
  agentRuntimeBindingId: string;
  agentSessionId: string;
  connectionId: string;
  createdAt: string;
  externalSessionId?: string;
  externalThreadId?: string;
  lastError?: string;
  model: string;
  recordVersion: number;
  runtimeKind: 'codex_app_server';
  status: AgentRuntimeBindingStatus;
  updatedAt: string;
}

export type ChangeProposalStatus =
  | 'awaiting_decision'
  | 'rejected'
  | 'superseded';

export type ChangeProposalKind =
  | 'expand_permissions'
  | 'install_package'
  | 'modify_workflow'
  | 'out_of_scope';

export interface ChangeProposalRecord {
  agentRunId?: string;
  agentSessionId: string;
  boardId: string;
  createdAt: string;
  instruction: string;
  kind: ChangeProposalKind;
  projectId: string;
  proposalId: string;
  recordVersion: number;
  sourceMessageId: string;
  status: ChangeProposalStatus;
  summary: string;
  updatedAt: string;
}

export type AgentRunControlAction = 'cancel' | 'pause' | 'resume';

export type AgentRuntimeTurnDecision =
  | { kind: 'reply'; message: string }
  | {
      action: AgentRunControlAction;
      agentRunId: string;
      kind: 'agent_run_control';
      message: string;
    }
  | {
      kind: 'change_proposal';
      message: string;
      proposalKind: ChangeProposalKind;
      summary: string;
    };

export interface AgentRuntimeTurnContext {
  agentRun?: {
    agentRunId: string;
    allowedActions: AgentRunControlAction[];
    status: string;
    targetKind: string;
  };
  boardId: string;
  entrypointId?: string;
  history: Array<{ content: string; role: AgentMessageRole }>;
  mentions: PackageComposerMention[];
  projectId: string;
  userMessage: string;
}

export interface AgentRuntimeTurnResult {
  decision: AgentRuntimeTurnDecision;
  externalThreadId: string;
  model: string;
  runtimeTurnId: string;
}

export type AgentRuntimeEvent =
  | { agentSessionId: string; kind: 'turn_started' }
  | { agentSessionId: string; kind: 'turn_completed'; runtimeTurnId: string }
  | { agentSessionId: string; error: string; kind: 'turn_failed' };

export interface AgentRuntimePort {
  cancel(agentSessionId: string): Promise<void>;
  getCapabilities(): Promise<{
    approvals: boolean;
    persistentSessions: boolean;
    structuredDecisions: boolean;
  }>;
  resumeSession(input: {
    agentSessionId: string;
    binding: AgentRuntimeBindingRecord;
    context: AgentRuntimeTurnContext;
  }): Promise<AgentRuntimeTurnResult>;
  startSession(input: {
    agentSessionId: string;
    binding: AgentRuntimeBindingRecord;
    context: AgentRuntimeTurnContext;
  }): Promise<AgentRuntimeTurnResult>;
  streamEvents(agentSessionId: string): AsyncIterable<AgentRuntimeEvent>;
  respondToApproval(requestId: string, decision: 'approve' | 'reject'): Promise<void>;
}
