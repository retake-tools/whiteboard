import type { CapabilityDefinitionLock, SkillDefinitionLock } from './capabilityContracts';
import type { PackageLock } from './packageContracts';
import type { WorkflowDefinitionLock } from './workflowRuntimeContracts';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'waiting_selection'
  | 'paused'
  | 'needs_attention'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type AgentRunStopReason =
  | 'capability_completed'
  | 'workflow_terminal'
  | 'target_paused'
  | 'target_canceled'
  | 'target_invalid'
  | 'user_paused'
  | 'user_canceled';

export type AgentRunTarget =
  | {
    capabilityLock: CapabilityDefinitionLock;
    kind: 'capability';
    operationBlockId: string;
    skillLock?: SkillDefinitionLock;
  }
  | {
    kind: 'workflow_run';
    workflowDefinitionLock: WorkflowDefinitionLock;
    workflowRunId: string;
  };

export interface AgentRunScope {
  allowedCapabilityIds: string[];
  allowedOperationBlockIds: string[];
  allowedStepRunIds: string[];
  boardId: string;
  projectId: string;
  workflowRunId?: string;
}

export type AgentRunStopPolicy =
  | { kind: 'capability_completed' }
  | { kind: 'workflow_terminal' };

export interface AgentRunPermissions {
  allowedToolPermissions: Array<'retake.execute_capability' | 'retake.read'>;
  canCreateBlocks: false;
  canDeleteAssets: false;
  canInstallPackages: false;
  canModifyWorkflow: false;
}

export interface AgentRunRecord {
  agentRunId: string;
  boardId: string;
  createdAt: string;
  createdBy: 'user';
  currentOperationBlockId?: string;
  entrypointId?: string;
  error?: string;
  executionIds: string[];
  permissions: AgentRunPermissions;
  projectId: string;
  recordVersion: number;
  runtimeKind: 'retake_orchestrator';
  scope: AgentRunScope;
  sourcePackageLock?: PackageLock;
  status: AgentRunStatus;
  stopPolicy: AgentRunStopPolicy;
  stopReason?: AgentRunStopReason;
  target: AgentRunTarget;
  updatedAt: string;
}

export interface AgentRunExecutionAction {
  actionKey: string;
  agentRunId: string;
  operationBlockId: string;
  stepRunId?: string;
}
