import type {
  AgentPresetDefinition,
  AgentPresetDefinitionLock,
  AgentPresetRuntimeFeature,
  AgentPresetRuntimeKind,
  AgentPresetToolPermission,
} from './agentPresetContracts';
import { tryCapabilityDefinitionFor } from './capabilityRegistry';
import { skillDefinitionFor } from './skillRegistry';
import storyProductionDirectorSource from '../../packages/builtin/story-production-agent/agents/agent-story-production-director/retake.agent.json';

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

export const storyProductionDirectorPreset = storyProductionDirectorSource as unknown as AgentPresetDefinition;

export const builtInAgentPresetRegistry = createAgentPresetRegistry([
  storyProductionDirectorPreset,
]);
let activeAgentPresetRegistry = builtInAgentPresetRegistry;

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
  registry: AgentPresetRegistry = activeAgentPresetRegistry,
): AgentPresetDefinition[] {
  return structuredClone(registry.definitions);
}

export function configureAgentPresetRegistry(
  definitions: AgentPresetDefinition[],
): void {
  activeAgentPresetRegistry = createAgentPresetRegistry(definitions);
}

export function agentPresetDefinitionFor(
  agentPresetId: string,
  registry: AgentPresetRegistry = activeAgentPresetRegistry,
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
  const capabilitiesDeclaredByAllowedSkills = new Set<string>();
  if (definition.skillPolicy.mode === 'allow_list') {
    validateUniqueNonEmpty(
      definition.skillPolicy.allowedSkillIds,
      'AgentPreset allowed Skill',
      issues,
    );
    for (const skillId of definition.skillPolicy.allowedSkillIds) {
      try {
        const skill = skillDefinitionFor(skillId);
        for (const binding of skill.capabilityBindings) {
          capabilitiesDeclaredByAllowedSkills.add(binding.capabilityId);
        }
        if (!skill.capabilityBindings.some(
          (binding) => definition.allowedCapabilityIds.includes(binding.capabilityId),
        )) issues.push(`AgentPreset Skill has no allowed Capability binding: ${skillId}`);
      } catch {
        issues.push(`AgentPreset Skill is not registered: ${skillId}`);
      }
    }
  }
  for (const capabilityId of definition.allowedCapabilityIds) {
    if (
      !tryCapabilityDefinitionFor(capabilityId)
      && !capabilitiesDeclaredByAllowedSkills.has(capabilityId)
    ) issues.push(`AgentPreset Capability is not registered: ${capabilityId}`);
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
