import type { CapabilityDefinitionLock, SkillDefinitionLock } from './capabilityContracts';
import type { PackageLock } from './packageContracts';
import type { WorkflowBindingSource, WorkflowOutputAcceptancePolicy } from './workflowRegistry';

export type WorkflowRunStatus =
  | 'draft'
  | 'ready'
  | 'running'
  | 'waiting_input'
  | 'waiting_selection'
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
  blockId: string;
  workflowInputSlotId: string;
}

export interface WorkflowStepResolvedInputBinding {
  blockId: string;
  inputSlotId: string;
  source: WorkflowBindingSource;
}

export interface WorkflowRunRecord {
  boardId: string;
  createdAt: string;
  createdBy: 'user';
  currentStepIds: string[];
  entrypointId?: string;
  inputBindings: WorkflowRunInputBinding[];
  projectId: string;
  recordVersion: number;
  status: WorkflowRunStatus;
  sourcePackageLock?: PackageLock;
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
  outputAcceptancePolicy: WorkflowOutputAcceptancePolicy;
  outputAssetIds: string[];
  outputBlockIds: string[];
  recordVersion: number;
  resolvedInputBindings: WorkflowStepResolvedInputBinding[];
  skillLock: SkillDefinitionLock;
  status: WorkflowStepRunStatus;
  stepId: string;
  stepRunId: string;
  updatedAt: string;
  workflowRunId: string;
}
