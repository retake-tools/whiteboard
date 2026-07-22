import type { SkillDefinitionLock } from './capabilityContracts';

export interface PackageLock {
  digest: string;
  packageId: string;
  version: string;
}

export interface PackageWorkflowDefinitionLock {
  definitionHash: string;
  version: string;
  workflowDefinitionId: string;
}

export interface PackageOpaqueComponentLock {
  componentId: string;
  definitionHash: string;
  version: string;
}

export interface RetakePackageComponents {
  adapterPlugins: PackageOpaqueComponentLock[];
  agentPresets: PackageOpaqueComponentLock[];
  capabilityPlugins: PackageOpaqueComponentLock[];
  skills: SkillDefinitionLock[];
  uiPlugins: PackageOpaqueComponentLock[];
  workflows: PackageWorkflowDefinitionLock[];
}

interface PackageEntryPointBase {
  compatibleStageIds: string[];
  default?: boolean;
  description: string;
  entrypointId: string;
  name: string;
  recommended?: boolean;
  requiredInputSlotIds: string[];
  schemaVersion: 1;
}

export interface PackageSkillEntryPoint extends PackageEntryPointBase {
  kind: 'skill';
  ref: {
    capabilityId: string;
    skillId: string;
  };
}

export interface PackageWorkflowEntryPoint extends PackageEntryPointBase {
  kind: 'workflow';
  ref: {
    workflowDefinitionId: string;
  };
}

export interface PackageAgentPresetEntryPoint extends PackageEntryPointBase {
  kind: 'agent_preset';
  ref: {
    agentPresetId: string;
  };
}

export type RetakePackageEntryPoint =
  | PackageSkillEntryPoint
  | PackageWorkflowEntryPoint
  | PackageAgentPresetEntryPoint;

export interface RetakePackageManifest extends PackageLock {
  components: RetakePackageComponents;
  description: string;
  entrypoints: RetakePackageEntryPoint[];
  name: string;
  schemaVersion: 1;
  source: {
    kind: 'builtin';
  };
}

export interface PackageInvocationContext {
  entrypointId: string;
  packageLock: PackageLock;
}
