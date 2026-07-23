import {
  agentPresetDefinitionFor,
  agentPresetDefinitionLock,
} from './agentPresetRegistry';
import type {
  AgentPresetDefinition,
  AgentPresetRuntimeFeature,
  AgentPresetSelectionLock,
} from './agentPresetContracts';
import type { AgentRunRecord } from './agentRuntimeContracts';
import type { AgentRuntimeBindingRecord } from './agentSessionContracts';
import { resolvePackageEntryPoint } from './packageRegistry';
import type { BoardSnapshot } from './types';

export interface AgentPresetCompatibility {
  compatible: boolean;
  issues: string[];
}

export interface AgentPresetTargetRequirements {
  capabilityIds: string[];
  skillIds: string[];
}

const runtimeFeatures: Record<
  AgentRuntimeBindingRecord['runtimeKind'],
  AgentPresetRuntimeFeature[]
> = {
  codex_app_server: [
    'persistent_session',
    'streaming_events',
    'structured_output',
  ],
};

export function resolveAgentPresetSelection(
  entrypointId: string,
): AgentPresetSelectionLock {
  const resolution = resolvePackageEntryPoint({ entrypointId });
  if (resolution.status !== 'needs_target') {
    throw new Error(`AgentPreset EntryPoint cannot be selected: ${entrypointId} (${resolution.status})`);
  }
  return {
    agentPresetLock: structuredClone(resolution.target.agentPresetLock),
    entrypointId: resolution.target.entrypoint.entrypointId,
    packageLock: structuredClone(resolution.target.packageLock),
  };
}

export function agentPresetCompatibilityForRun(
  snapshot: BoardSnapshot,
  agentRun: AgentRunRecord,
  agentSessionId: string,
  definition: AgentPresetDefinition,
): AgentPresetCompatibility {
  return agentPresetCompatibilityForRequirements(
    snapshot,
    agentSessionId,
    definition,
    {
      capabilityIds: agentRun.scope.allowedCapabilityIds,
      skillIds: scopedSkillIds(snapshot, agentRun),
    },
    agentRun.permissions.allowedToolPermissions,
  );
}

export function agentPresetCompatibilityForRequirements(
  snapshot: BoardSnapshot,
  agentSessionId: string,
  definition: AgentPresetDefinition,
  requirements: AgentPresetTargetRequirements,
  requiredToolPermissions: Array<'retake.execute_capability' | 'retake.read'> = [
    'retake.read',
    'retake.execute_capability',
  ],
): AgentPresetCompatibility {
  const issues: string[] = [];
  for (const capabilityId of requirements.capabilityIds) {
    if (!definition.allowedCapabilityIds.includes(capabilityId)) {
      issues.push(`Preset does not allow Capability: ${capabilityId}`);
    }
  }

  if (definition.skillPolicy.mode === 'allow_list') {
    for (const skillId of requirements.skillIds) {
      if (!definition.skillPolicy.allowedSkillIds.includes(skillId)) {
        issues.push(`Preset does not allow Skill: ${skillId}`);
      }
    }
  }
  for (const permission of requiredToolPermissions) {
    if (!definition.toolPolicy.allowedToolPermissions.includes(permission)) {
      issues.push(`Preset does not allow required tool permission: ${permission}`);
    }
  }

  const session = (snapshot.agentSessions ?? []).find(
    (candidate) => candidate.agentSessionId === agentSessionId,
  );
  const binding = session?.activeRuntimeBindingId
    ? (snapshot.agentRuntimeBindings ?? []).find(
        (candidate) =>
          candidate.agentRuntimeBindingId === session.activeRuntimeBindingId
          && candidate.agentSessionId === session.agentSessionId,
      )
    : undefined;
  if (!binding || binding.status !== 'active') {
    issues.push('Preset requires an active Agent Runtime binding.');
  } else {
    if (!definition.runtimePreference.compatibleRuntimeKinds.includes(binding.runtimeKind)) {
      issues.push(`Preset is incompatible with Runtime: ${binding.runtimeKind}`);
    }
    const available = runtimeFeatures[binding.runtimeKind];
    for (const feature of definition.runtimePreference.requiredFeatures) {
      if (!available.includes(feature)) {
        issues.push(`Runtime does not provide required Preset feature: ${feature}`);
      }
    }
  }
  return { compatible: issues.length === 0, issues };
}

export function applyAgentPresetToRun(
  snapshot: BoardSnapshot,
  input: {
    agentRunId: string;
    agentSessionId: string;
    selection: AgentPresetSelectionLock;
  },
): AgentRunRecord {
  const selection = assertCurrentAgentPresetSelection(input.selection);
  const run = (snapshot.agentRuns ?? []).find(
    (candidate) => candidate.agentRunId === input.agentRunId,
  );
  if (!run) throw new Error(`AgentRun not found for AgentPreset: ${input.agentRunId}`);
  if (run.agentPresetSnapshot || run.agentPresetPackageLock) {
    throw new Error('AgentRun already has an AgentPreset snapshot.');
  }
  const compatibility = agentPresetCompatibilityForRun(
    snapshot,
    run,
    input.agentSessionId,
    selection.definition,
  );
  if (!compatibility.compatible) {
    throw new Error(`AgentPreset is incompatible with the AgentRun: ${compatibility.issues.join('; ')}`);
  }
  run.agentPresetSnapshot = structuredClone(selection.definition);
  run.agentPresetPackageLock = structuredClone(selection.packageLock);
  run.permissions.allowedToolPermissions = run.permissions.allowedToolPermissions.filter(
    (permission) => selection.definition.toolPolicy.allowedToolPermissions.includes(permission),
  );
  return run;
}

export function assertCurrentAgentPresetSelection(
  selection: AgentPresetSelectionLock,
): {
  definition: AgentPresetDefinition;
  packageLock: AgentPresetSelectionLock['packageLock'];
} {
  const current = resolveAgentPresetSelection(selection.entrypointId);
  if (JSON.stringify(current) !== JSON.stringify(selection)) {
    throw new Error('AgentPreset Registry lock has changed.');
  }
  const definition = agentPresetDefinitionFor(selection.agentPresetLock.agentPresetId);
  if (
    JSON.stringify(agentPresetDefinitionLock(definition))
    !== JSON.stringify(selection.agentPresetLock)
  ) throw new Error('AgentPreset Definition lock has changed.');
  return {
    definition,
    packageLock: structuredClone(current.packageLock),
  };
}

export function agentPresetSelectionMatchesRun(
  run: AgentRunRecord,
  selection: AgentPresetSelectionLock | undefined,
): boolean {
  if (!selection) return !run.agentPresetSnapshot && !run.agentPresetPackageLock;
  return Boolean(
    run.agentPresetSnapshot
    && run.agentPresetPackageLock
    && JSON.stringify(agentPresetDefinitionLock(run.agentPresetSnapshot))
      === JSON.stringify(selection.agentPresetLock)
    && JSON.stringify(run.agentPresetPackageLock) === JSON.stringify(selection.packageLock),
  );
}

export function assertAgentPresetSnapshotForRun(
  snapshot: BoardSnapshot,
  run: AgentRunRecord,
): void {
  const definition = run.agentPresetSnapshot;
  const packageLock = run.agentPresetPackageLock;
  if (!definition && !packageLock) return;
  if (
    !definition
    || !packageLock
    || !packageLock.packageId
    || !packageLock.version
    || !packageLock.digest
  ) throw new Error('AgentRun AgentPreset provenance is incomplete.');
  if (
    !definition.agentPresetId
    || !definition.version
    || !definition.definitionHash
    || !definition.instructions.trim()
  ) throw new Error('AgentRun AgentPreset snapshot is incomplete.');
  for (const capabilityId of run.scope.allowedCapabilityIds) {
    if (!definition.allowedCapabilityIds.includes(capabilityId)) {
      throw new Error(`AgentRun AgentPreset scope exceeds allowed Capability: ${capabilityId}`);
    }
  }
  if (definition.skillPolicy.mode === 'allow_list') {
    for (const skillId of scopedSkillIds(snapshot, run)) {
      if (!definition.skillPolicy.allowedSkillIds.includes(skillId)) {
        throw new Error(`AgentRun AgentPreset scope exceeds allowed Skill: ${skillId}`);
      }
    }
  }
  if (
    !sameStringSet(
      run.permissions.allowedToolPermissions,
      definition.toolPolicy.allowedToolPermissions,
    )
  ) throw new Error('AgentRun tool permissions do not match its AgentPreset snapshot.');
  if (
    definition.permissionPolicy.canCreateBlocks
    || definition.permissionPolicy.canDeleteAssets
    || definition.permissionPolicy.canInstallPackages
    || definition.permissionPolicy.canModifyWorkflow
  ) throw new Error('AgentRun AgentPreset permissions exceed the V0 boundary.');
}

function scopedSkillIds(snapshot: BoardSnapshot, run: AgentRunRecord): string[] {
  if (run.target.kind === 'capability') {
    return run.target.skillLock ? [run.target.skillLock.skillId] : [];
  }
  const allowedStepRunIds = new Set(run.scope.allowedStepRunIds);
  return [...new Set(
    (snapshot.workflowStepRuns ?? [])
      .filter((step) => allowedStepRunIds.has(step.stepRunId))
      .map((step) => step.skillLock.skillId),
  )];
}

function sameStringSet(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value) => right.includes(value));
}
