import type {
  CapabilityDefinitionLock,
  SkillDefinitionLock,
} from './capabilityContracts';
import type {
  PackageLock,
  PackageWorkflowDefinitionLock,
} from './packageContracts';

export type GoalPlanCoverage = 'full' | 'partial';

export interface GoalPlanWorkflowOptionV1 {
  capabilityIds: string[];
  description: string;
  entrypointId: string;
  includesExternalActionAuthorization: boolean;
  name: string;
  packageId: string;
  packageVersion: string;
  requiredInputSlotIds: string[];
  skillIds: string[];
  stepCount: number;
  workflowDefinitionId: string;
  workflowVersion: string;
}

export interface GoalPlanStepSnapshotV1 {
  capabilityLock: CapabilityDefinitionLock;
  dependsOn: string[];
  optional: boolean;
  skillLock: SkillDefinitionLock;
  stageId: string;
  stepId: string;
}

export interface GoalPlanSnapshotV1 {
  schemaRef: 'retake.agent-goal-plan/v1';
  budget: {
    externalActionPolicy: 'explicit_user_per_action';
    maxExecutionCount: number;
    packageInstallCount: 0;
  };
  coverage: GoalPlanCoverage;
  goal: string;
  goalPlanId: string;
  limitations: string[];
  selectedWorkflow: {
    entrypointId: string;
    packageLock: PackageLock;
    workflowDefinitionLock: PackageWorkflowDefinitionLock;
  };
  sourceMessageFingerprint: string;
  sourceMessageId: string;
  steps: GoalPlanStepSnapshotV1[];
}
