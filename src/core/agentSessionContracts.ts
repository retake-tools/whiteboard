import type {
  PackageComposerInlineValue,
  PackageComposerMention,
  PackageComposerParametersValue,
} from './packageComposer';
import type { AgentPresetSelectionLock } from './agentPresetContracts';
import type {
  GoalPlanCoverage,
  GoalPlanSnapshotV1,
  GoalPlanWorkflowOptionV1,
} from './goalPlanContracts';

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
  | PackageComposerInlineValue
  | PackageComposerMention
  | PackageComposerParametersValue;

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
  | 'approved'
  | 'rejected'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'superseded';

export type ChangeProposalKind =
  | 'instantiate_entrypoint'
  | 'plan_goal'
  | 'expand_permissions'
  | 'install_package'
  | 'modify_workflow'
  | 'out_of_scope';

export type PackageEntryPointMentionLock =
  | {
      blockId: string;
      expectedBlockType: 'document' | 'image' | 'text';
      expectedSourceFingerprint: string;
      kind: 'block';
      slotId: string;
    }
  | {
      assetId: string;
      expectedAssetKind: 'document' | 'image';
      kind: 'asset';
      slotId: string;
    };

export type PackageEntryPointInvocationLock =
  | {
      capabilityLock: {
        capabilityId: string;
        definitionHash: string;
        version: string;
      };
      entrypointId: string;
      entrypointKind: 'skill';
      packageLock: {
        digest: string;
        packageId: string;
        version: string;
      };
      skillLock: {
        definitionHash: string;
        skillId: string;
        version: string;
      };
    }
  | {
      entrypointId: string;
      entrypointKind: 'workflow';
      packageLock: {
        digest: string;
        packageId: string;
        version: string;
      };
      workflowDefinitionLock: {
        definitionHash: string;
        version: string;
        workflowDefinitionId: string;
      };
    };

export interface PackageEntrypointInstantiateCommand {
  idempotencyKey: string;
  invocation: {
    instruction: string;
    instructionSlotId?: string;
    inlineValues: PackageComposerInlineValue[];
    mentionLocks: PackageEntryPointMentionLock[];
    parameters: Record<string, unknown>;
    targetLock: PackageEntryPointInvocationLock;
  };
  kind: 'package_entrypoint.instantiate';
  schemaVersion: 1;
}

export interface GoalPlanInstantiateCommand {
  draftCommand: PackageEntrypointInstantiateCommand;
  goalPlan: GoalPlanSnapshotV1;
  idempotencyKey: string;
  kind: 'goal_plan.instantiate';
  schemaVersion: 1;
}

export type ChangeProposalCommand =
  | {
      kind: 'agent_session.attach_run';
      targetAgentRunId: string;
    }
  | PackageEntrypointInstantiateCommand
  | GoalPlanInstantiateCommand
  | {
      kind: 'unsupported';
      reason: string;
    };

export interface PackageEntryPointDraftAppliedEffect {
  createdBlockIds: string[];
  entrypointKind: 'skill' | 'workflow';
  idempotencyKey: string;
  kind: 'package_entrypoint_draft';
  primaryBlockId: string;
  workflowGroupId?: string;
}

export interface GoalPlanDraftAppliedEffect {
  createdBlockIds: string[];
  goalPlanId: string;
  idempotencyKey: string;
  kind: 'goal_plan_draft';
  primaryBlockId: string;
  workflowGroupId: string;
}

export type AgentDraftAppliedEffect =
  | PackageEntryPointDraftAppliedEffect
  | GoalPlanDraftAppliedEffect;

export type PackageEntrypointAgentLaunchTarget =
  | { kind: 'capability' }
  | { kind: 'workflow_run' }
  | {
      kind: 'workflow_slice';
      until:
        | { kind: 'step'; stepId: string }
        | { kind: 'artifact'; workflowOutputSlotId: string }
        | { kind: 'stage'; stageId: string }
        | {
            completion: 'arrived' | 'passed';
            gateId: string;
            kind: 'gate';
          };
    };

export type AgentDraftLaunchTarget =
  | PackageEntrypointAgentLaunchTarget
  | { kind: 'goal' };

export interface PackageEntrypointDraftLaunchCommand {
  agentPresetSelection?: AgentPresetSelectionLock;
  agentSessionId: string;
  expectedProposalVersion: number;
  idempotencyKey: string;
  kind: 'package_entrypoint_draft.launch_agent';
  proposalId: string;
  schemaVersion: 1;
  target: PackageEntrypointAgentLaunchTarget;
}

export interface PackageEntrypointAgentLaunchEffect {
  agentRunId: string;
  agentSessionId: string;
  createdWorkflowRun?: boolean;
  idempotencyKey: string;
  kind: 'package_entrypoint_agent_launch';
  launchedAt: string;
  targetKind: PackageEntrypointAgentLaunchTarget['kind'];
  workflowRunId?: string;
}

export interface GoalPlanDraftLaunchCommand {
  agentPresetSelection?: AgentPresetSelectionLock;
  agentSessionId: string;
  expectedProposalVersion: number;
  idempotencyKey: string;
  kind: 'goal_plan_draft.launch_agent';
  proposalId: string;
  schemaVersion: 1;
}

export interface GoalPlanAgentLaunchEffect {
  agentRunId: string;
  agentSessionId: string;
  createdWorkflowRun: boolean;
  idempotencyKey: string;
  kind: 'goal_plan_agent_launch';
  launchedAt: string;
  targetKind: 'goal';
  workflowRunId: string;
}

export type AgentDraftLaunchEffect =
  | PackageEntrypointAgentLaunchEffect
  | GoalPlanAgentLaunchEffect;

export interface ChangeProposalRecord {
  agentRunId?: string;
  agentSessionId: string;
  boardId: string;
  createdAt: string;
  instruction: string;
  kind: ChangeProposalKind;
  proposedCommand: ChangeProposalCommand;
  projectId: string;
  proposalId: string;
  recordVersion: number;
  sourceMessageId: string;
  status: ChangeProposalStatus;
  summary: string;
  appliedEffect?: AgentDraftAppliedEffect;
  draftLaunchEffect?: AgentDraftLaunchEffect;
  appliedAt?: string;
  applyError?: string;
  changeDecisionId?: string;
  updatedAt: string;
}

export interface ChangeDecisionRecord {
  agentSessionId: string;
  boardId: string;
  changeDecisionId: string;
  createdAt: string;
  decidedBy: 'user_local';
  decision: 'approve' | 'reject';
  expectedProposalVersion: number;
  projectId: string;
  proposalId: string;
  recordVersion: number;
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
      proposedCommand: ChangeProposalCommand;
      summary: string;
    }
  | {
      coverage: GoalPlanCoverage;
      kind: 'goal_plan_proposal';
      limitations: string[];
      message: string;
      summary: string;
      workflowEntryPointId: string;
    };

export interface AgentRuntimeTurnContext {
  agentRun?: {
    agentRunId: string;
    agentPreset?: {
      agentPresetId: string;
      effectiveToolPermissions: string[];
      instructions: string;
      name: string;
      reviewResponsibilities: string[];
      roleLabel?: string;
      version: string;
    };
    allowedActions: AgentRunControlAction[];
    status: string;
    targetKind: string;
  };
  availableAgentRuns: Array<{
    agentRunId: string;
    status: string;
    targetKind: string;
  }>;
  boardId: string;
  entrypointId?: string;
  history: Array<{ content: string; role: AgentMessageRole }>;
  inlineValues: PackageComposerInlineValue[];
  goalPlanOptions: GoalPlanWorkflowOptionV1[];
  mentions: PackageComposerMention[];
  parameters: Record<string, unknown>;
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
  | { agentSessionId: string; kind: 'turn_started'; occurredAt: string; runtimeEventId: string }
  | { agentSessionId: string; delta: string; kind: 'decision_delta'; occurredAt: string; runtimeEventId: string }
  | { agentSessionId: string; kind: 'turn_completed'; occurredAt: string; runtimeEventId: string; runtimeTurnId: string }
  | { agentSessionId: string; error: string; kind: 'turn_failed'; occurredAt: string; runtimeEventId: string };

export type AgentRuntimeEventRecord = AgentRuntimeEventBase & (
  | { kind: 'turn_started' }
  | { delta: string; kind: 'decision_delta' }
  | { kind: 'turn_completed'; runtimeTurnId: string }
  | { error: string; kind: 'turn_failed' }
);

interface AgentRuntimeEventBase {
  agentSessionId: string;
  boardId: string;
  occurredAt: string;
  projectId: string;
  recordVersion: number;
  runtimeEventId: string;
  sequence: number;
  sourceMessageId: string;
}

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
    onEvent?: (event: AgentRuntimeEvent) => void;
  }): Promise<AgentRuntimeTurnResult>;
  startSession(input: {
    agentSessionId: string;
    binding: AgentRuntimeBindingRecord;
    context: AgentRuntimeTurnContext;
    onEvent?: (event: AgentRuntimeEvent) => void;
  }): Promise<AgentRuntimeTurnResult>;
  streamEvents(agentSessionId: string): AsyncIterable<AgentRuntimeEvent>;
  respondToApproval(requestId: string, decision: 'approve' | 'reject'): Promise<void>;
}
