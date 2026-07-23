import { capabilityDefinitionFor } from './capabilityRegistry';
import type {
  AgentPresetDefinition,
  AgentPresetDefinitionLock,
  AgentPresetRuntimeFeature,
  AgentPresetRuntimeKind,
  AgentPresetToolPermission,
} from './agentPresetContracts';
import { skillDefinitionFor } from './skillRegistry';

export interface AgentPresetRegistry {
  definitions: AgentPresetDefinition[];
}

const runtimeKinds = new Set<AgentPresetRuntimeKind>(['codex_app_server']);
const runtimeFeatures = new Set<AgentPresetRuntimeFeature>([
  'persistent_session',
  'streaming_events',
  'structured_output',
]);
const toolPermissions = new Set<AgentPresetToolPermission>([
  'retake.execute_capability',
  'retake.read',
]);
const reviewResponsibilities = new Set([
  'input_readiness',
  'output_traceability',
  'scope_drift',
  'stage_handoff',
] as const);

export const storyProductionDirectorPreset: AgentPresetDefinition = {
  agentPresetId: 'retake.agent.story-production-director',
  allowedCapabilityIds: [
    'story.screenplay.generate',
    'design.character.define',
    'design.scene.define',
    'previs.storyboard.plan',
    'previs.storyboard_sheet.generate',
    'generation.video_package.prepare',
  ],
  definitionHash: 'sha256:retake-agent-story-production-director-generation-package-v1',
  description: 'Advance the locked story-production target one ready step at a time and stop at missing facts or gates.',
  instructions: `Act as the bounded Story Production Director for the current Retake AgentRun.

Read the supplied Board, target, scope, WorkflowRun, readiness, and Gate facts before responding. Stay inside the locked target and allowed capabilities. Advance only work that Retake reports as ready, one legal step at a time. Do not invent completion, assets, approvals, or state that is not present in Retake facts.

When inputs are missing, a human Gate is waiting, output provenance is unclear, execution failed, or the requested change exceeds scope, stop and explain the exact blocker. Structural changes must become a ChangeProposal. Never reorder the Workflow, skip a required Gate, install a Package, expand permission, or treat a status summary as the production artifact.`,
  name: 'Story Production Director',
  permissionPolicy: {
    canCreateBlocks: false,
    canDeleteAssets: false,
    canInstallPackages: false,
    canModifyWorkflow: false,
  },
  reviewResponsibilities: [
    'input_readiness',
    'output_traceability',
    'scope_drift',
    'stage_handoff',
  ],
  roleLabel: 'Director',
  runtimePreference: {
    compatibleRuntimeKinds: ['codex_app_server'],
    preferredRuntimeKind: 'codex_app_server',
    requiredFeatures: [
      'persistent_session',
      'streaming_events',
      'structured_output',
    ],
  },
  schemaVersion: 1,
  skillPolicy: {
    allowedSkillIds: [
      'retake.screenplay.from-brief',
      'retake.character-bible.from-screenplay',
      'retake.scene-bible.from-screenplay',
      'retake.storyboard-plan.from-production-design',
      'retake.storyboard-sheet.from-unit-plan',
      'retake.video-generation-package.from-approved-storyboard',
    ],
    mode: 'allow_list',
  },
  source: {
    kind: 'catmeme_migration',
    paths: [
      'skills-v1-node-workflow/direction-project-director/SKILL.md',
      'skills/production-workflow/registry.yaml',
    ],
  },
  toolPolicy: {
    allowedToolPermissions: ['retake.read', 'retake.execute_capability'],
  },
  version: '0.3.0',
};

export const builtInAgentPresetRegistry = createAgentPresetRegistry([
  storyProductionDirectorPreset,
]);

export function createAgentPresetRegistry(
  definitions: AgentPresetDefinition[],
): AgentPresetRegistry {
  const ids = new Set<string>();
  for (const definition of definitions) {
    const issues = validateAgentPresetDefinition(definition);
    if (issues.length > 0) throw new Error(issues.join('\n'));
    if (ids.has(definition.agentPresetId)) {
      throw new Error(`Duplicate AgentPreset ID: ${definition.agentPresetId}`);
    }
    ids.add(definition.agentPresetId);
  }
  return { definitions: structuredClone(definitions) };
}

export function listAgentPresets(
  registry: AgentPresetRegistry = builtInAgentPresetRegistry,
): AgentPresetDefinition[] {
  return structuredClone(registry.definitions);
}

export function agentPresetDefinitionFor(
  agentPresetId: string,
  registry: AgentPresetRegistry = builtInAgentPresetRegistry,
): AgentPresetDefinition {
  const definition = registry.definitions.find(
    (candidate) => candidate.agentPresetId === agentPresetId,
  );
  if (!definition) throw new Error(`AgentPreset definition not found: ${agentPresetId}`);
  return structuredClone(definition);
}

export function agentPresetDefinitionLock(
  definition: AgentPresetDefinition,
): AgentPresetDefinitionLock {
  return {
    agentPresetId: definition.agentPresetId,
    definitionHash: definition.definitionHash,
    version: definition.version,
  };
}

export function validateAgentPresetDefinition(
  definition: AgentPresetDefinition,
): string[] {
  const issues: string[] = [];
  if (
    definition.schemaVersion !== 1
    || !definition.agentPresetId
    || !definition.version
    || !definition.definitionHash
    || !definition.name.trim()
    || !definition.instructions.trim()
  ) issues.push(`AgentPreset identity or instructions are incomplete: ${definition.agentPresetId}`);

  validateUniqueNonEmpty(
    definition.allowedCapabilityIds,
    'AgentPreset allowed Capability',
    issues,
  );
  for (const capabilityId of definition.allowedCapabilityIds) {
    try {
      capabilityDefinitionFor(capabilityId);
    } catch {
      issues.push(`AgentPreset Capability is not registered: ${capabilityId}`);
    }
  }

  if (definition.skillPolicy.mode === 'allow_list') {
    validateUniqueNonEmpty(
      definition.skillPolicy.allowedSkillIds,
      'AgentPreset allowed Skill',
      issues,
    );
    for (const skillId of definition.skillPolicy.allowedSkillIds) {
      try {
        const skill = skillDefinitionFor(skillId);
        if (!skill.capabilityBindings.some(
          (binding) => definition.allowedCapabilityIds.includes(binding.capabilityId),
        )) issues.push(`AgentPreset Skill has no allowed Capability binding: ${skillId}`);
      } catch {
        issues.push(`AgentPreset Skill is not registered: ${skillId}`);
      }
    }
  }

  validateKnownUnique(
    definition.toolPolicy.allowedToolPermissions,
    toolPermissions,
    'AgentPreset tool permission',
    issues,
  );
  validateKnownUnique(
    definition.runtimePreference.compatibleRuntimeKinds,
    runtimeKinds,
    'AgentPreset compatible Runtime',
    issues,
  );
  validateKnownUnique(
    definition.runtimePreference.requiredFeatures,
    runtimeFeatures,
    'AgentPreset required Runtime feature',
    issues,
  );
  validateKnownUnique(
    definition.reviewResponsibilities,
    reviewResponsibilities,
    'AgentPreset review responsibility',
    issues,
  );
  const preferred = definition.runtimePreference.preferredRuntimeKind;
  if (
    preferred
    && !definition.runtimePreference.compatibleRuntimeKinds.includes(preferred)
  ) issues.push(`AgentPreset preferred Runtime is not compatible: ${preferred}`);
  if (
    definition.permissionPolicy.canCreateBlocks
    || definition.permissionPolicy.canDeleteAssets
    || definition.permissionPolicy.canInstallPackages
    || definition.permissionPolicy.canModifyWorkflow
  ) issues.push('AgentPreset permission policy exceeds the V0 boundary.');
  if (definition.source.paths?.some(
    (sourcePath) => sourcePath.startsWith('/') || sourcePath.startsWith('~'),
  )) issues.push('AgentPreset source paths must be repository-relative.');
  return issues;
}

function validateUniqueNonEmpty(
  values: string[],
  label: string,
  issues: string[],
): void {
  if (values.length === 0) issues.push(`${label} list is empty.`);
  if (values.length !== new Set(values).size) issues.push(`${label} list has duplicates.`);
  if (values.some((value) => !value)) issues.push(`${label} list has an empty value.`);
}

function validateKnownUnique<T extends string>(
  values: T[],
  known: Set<T>,
  label: string,
  issues: string[],
): void {
  validateUniqueNonEmpty(values, label, issues);
  for (const value of values) {
    if (!known.has(value)) issues.push(`${label} is unsupported: ${value}`);
  }
}
