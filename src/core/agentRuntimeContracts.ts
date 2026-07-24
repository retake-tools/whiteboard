import type { CapabilityDefinitionLock, SkillDefinitionLock } from './capabilityContracts';
import type { PackageLock } from './packageContracts';
import type { AgentPresetSnapshot } from './agentPresetContracts';
import type {
  WorkflowDefinitionLock,
  WorkflowGateDefinitionLock,
} from './workflowRuntimeContracts';

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'waiting_selection'
  | 'waiting_approval'
  | 'paused'
  | 'needs_attention'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type AgentRunStopReason =
  | 'capability_completed'
  | 'slice_target_satisfied'
  | 'workflow_terminal'
  | 'target_paused'
  | 'target_canceled'
  | 'target_invalid'
  | 'provider_execution_authorization_required'
  | 'user_paused'
  | 'user_canceled';

export interface AgentWorkflowArtifactTarget {
  artifactScope: 'workflow_run';
  artifactType: string;
  outputSlotId: string;
  semanticKey: string;
  stepId: string;
  stepRunId: string;
  workflowOutputSlotId: string;
}

export type AgentWorkflowGateCompletion = 'arrived' | 'passed';

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
  }
  | {
    kind: 'workflow_slice';
    until:
      | {
        kind: 'step';
        stepId: string;
        stepRunId: string;
      }
      | {
        kind: 'artifact';
      } & AgentWorkflowArtifactTarget
      | {
        kind: 'stage';
        outputTargets: AgentWorkflowArtifactTarget[];
        requiredStepRunIds: string[];
        stageId: string;
        stageTypeId: string;
      }
      | {
        completion: AgentWorkflowGateCompletion;
        gateDefinitionLock: WorkflowGateDefinitionLock;
        kind: 'gate';
        subjectStepRunId: string;
      };
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
  | { kind: 'workflow_slice_target' }
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
  agentPresetPackageLock?: PackageLock;
  agentPresetSnapshot?: AgentPresetSnapshot;
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
  satisfiedArtifactRevisionId?: string;
  satisfiedArtifactRevisionIds?: string[];
  satisfiedGateEvaluationId?: string;
  scope: AgentRunScope;
  sourceChangeProposalId?: string;
  sourceDraftLaunchIdempotencyKey?: string;
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
