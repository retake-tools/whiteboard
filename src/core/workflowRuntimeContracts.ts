import type {
  CapabilityBindingValue,
  CapabilityDefinitionLock,
  SkillDefinitionLock,
} from './capabilityContracts';
import type { PackageLock } from './packageContracts';
import type {
  WorkflowBindingSource,
  WorkflowGateDefinition,
  WorkflowOutputAcceptancePolicy,
  WorkflowStageCompletionPolicy,
} from './workflowRegistry';

export type WorkflowRunStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'waiting_input'
  | 'waiting_selection'
  | 'waiting_approval'
  | 'paused'
  | 'needs_attention'
  | 'succeeded'
  | 'failed'
  | 'canceled';

export type WorkflowStepRunStatus =
  | 'pending'
  | 'ready'
  | 'queued'
  | 'running'
  | 'waiting_input'
  | 'waiting_selection'
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'canceled'
  | 'blocked';

export type WorkflowStepRunFreshness = 'current' | 'outdated';

export interface WorkflowDefinitionLock {
  definitionHash: string;
  version: string;
  workflowId: string;
}

export interface WorkflowRunInputBinding {
  workflowInputSlotId: string;
  values: CapabilityBindingValue[];
}

export interface WorkflowStepResolvedInputBinding {
  inputSlotId: string;
  source: WorkflowBindingSource;
  values: CapabilityBindingValue[];
}

export interface WorkflowStepOutputArtifactBinding {
  artifactId: string;
  artifactRevisionId: string;
  artifactType: string;
  assetIds: string[];
  boundAt: string;
  executionIds: string[];
  outputSlotId: string;
  primaryAssetId: string;
  workflowOutputSlotId: string;
}

export interface WorkflowOutputSlotLock {
  artifactType: string;
  outputSlotId: string;
  stepId: string;
  workflowOutputSlotId: string;
}

export interface WorkflowStageDefinitionLock {
  completionPolicy: WorkflowStageCompletionPolicy;
  description?: string;
  name: string;
  optionalStepIds: string[];
  outputSlotLocks: Array<WorkflowOutputSlotLock & {
    artifactScope: 'workflow_run';
    semanticKey: string;
  }>;
  requiredStepIds: string[];
  stageId: string;
  stageTypeId: string;
}

export type WorkflowGateDefinitionLock = Omit<WorkflowGateDefinition, 'subject'> & {
  subject:
    | Extract<WorkflowGateDefinition['subject'], { kind: 'step_output' }>
    | {
      artifactScope: 'workflow_run';
      artifactType: string;
      kind: 'artifact_revision';
      outputSlotId: string;
      semanticKey: string;
      stepId: string;
      workflowOutputSlotId: string;
    };
};

export interface WorkflowRunRecord {
  boardId: string;
  createdAt: string;
  createdBy: 'user';
  currentStepIds: string[];
  entrypointId?: string;
  inputBindings: WorkflowRunInputBinding[];
  gateDefinitionLocks: WorkflowGateDefinitionLock[];
  gateEvaluationIds: string[];
  outputSlotLocks: WorkflowOutputSlotLock[];
  projectId: string;
  recordVersion: number;
  status: WorkflowRunStatus;
  sourcePackageLock?: PackageLock;
  sourceChangeProposalId?: string;
  sourceDraftLaunchIdempotencyKey?: string;
  stageDefinitionLocks?: WorkflowStageDefinitionLock[];
  stepRunIds: string[];
  updatedAt: string;
  workflowDefinitionLock: WorkflowDefinitionLock;
  workflowProjectionId: string;
  workflowRunId: string;
}

export interface WorkflowStepRunRecord {
  acceptedAt?: string;
  acceptedBy?: 'user';
  acceptedOutputAssetIds: string[];
  capabilityLock: CapabilityDefinitionLock;
  createdAt: string;
  dependsOn: string[];
  error?: string;
  executionIds: string[];
  freshness: WorkflowStepRunFreshness;
  inputFingerprint?: string;
  operationBlockId: string;
  outputSlotIds: string[];
  outputAcceptancePolicy: WorkflowOutputAcceptancePolicy;
  outputArtifactBindings: WorkflowStepOutputArtifactBinding[];
  outputAssetIds: string[];
  outputBlockIds: string[];
  parameters?: Record<string, unknown>;
  optional?: boolean;
  recordVersion: number;
  resolvedInputBindings: WorkflowStepResolvedInputBinding[];
  skillLock: SkillDefinitionLock;
  status: WorkflowStepRunStatus;
  stageId?: string;
  stepId: string;
  stepRunId: string;
  updatedAt: string;
  workflowRunId: string;
}
