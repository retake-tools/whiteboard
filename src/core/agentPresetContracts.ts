export type AgentPresetToolPermission =
  | 'retake.execute_capability'
  | 'retake.read';

export type AgentPresetRuntimeKind = 'codex_app_server';

export type AgentPresetRuntimeFeature =
  | 'persistent_session'
  | 'streaming_events'
  | 'structured_output';

export type AgentPresetReviewResponsibility =
  | 'input_readiness'
  | 'output_traceability'
  | 'scope_drift'
  | 'stage_handoff';

export interface AgentPresetDefinitionLock {
  agentPresetId: string;
  definitionHash: string;
  version: string;
}

export type AgentPresetSkillPolicy =
  | { mode: 'any_compatible' }
  | {
      allowedSkillIds: string[];
      mode: 'allow_list';
    };

export interface AgentPresetDefinition extends AgentPresetDefinitionLock {
  allowedCapabilityIds: string[];
  description: string;
  instructions: string;
  name: string;
  permissionPolicy: {
    canCreateBlocks: false;
    canDeleteAssets: false;
    canInstallPackages: false;
    canModifyWorkflow: false;
  };
  reviewResponsibilities: AgentPresetReviewResponsibility[];
  roleLabel?: string;
  runtimePreference: {
    compatibleRuntimeKinds: AgentPresetRuntimeKind[];
    preferredRuntimeKind?: AgentPresetRuntimeKind;
    requiredFeatures: AgentPresetRuntimeFeature[];
  };
  schemaVersion: 1;
  skillPolicy: AgentPresetSkillPolicy;
  source: {
    kind: 'builtin' | 'catmeme_migration';
    paths?: string[];
  };
  toolPolicy: {
    allowedToolPermissions: AgentPresetToolPermission[];
  };
}

export type AgentPresetSnapshot = AgentPresetDefinition;

export interface AgentPresetSelectionLock {
  agentPresetLock: AgentPresetDefinitionLock;
  entrypointId: string;
  packageLock: {
    digest: string;
    packageId: string;
    version: string;
  };
}
