import { capabilityDefinitionFor } from './capabilityRegistry';
import type {
  AgentMessageRecord,
  AgentSkillEntrypointOptionV1,
  PackageEntrypointInstantiateCommand,
} from './agentSessionContracts';
import { buildPackageEntrypointInstantiationCommand } from './packageEntrypointDraftApplication';
import {
  listRecommendedPackageEntryPoints,
  resolvePackageEntryPoint,
} from './packageRegistry';
import type { BoardSnapshot } from './types';

export function listAgentSkillEntrypointOptions(): AgentSkillEntrypointOptionV1[] {
  return listRecommendedPackageEntryPoints().flatMap((registration) => {
    if (registration.entrypoint.kind !== 'skill') return [];
    const resolution = resolvePackageEntryPoint({
      entrypointId: registration.entrypoint.entrypointId,
    });
    if (resolution.status !== 'resolved' || resolution.target.kind !== 'skill') return [];
    const capability = capabilityDefinitionFor(resolution.target.capabilityLock.capabilityId);
    const requiredInputs = capability.inputSlots.filter((slot) => slot.required);
    if (requiredInputs.length !== 1) return [];
    const instructionInput = requiredInputs[0];
    if (!instructionInput?.dataTypes.some((type) => type === 'text' || type === 'document')) {
      return [];
    }
    return [{
      capabilityId: resolution.target.capabilityLock.capabilityId,
      description: registration.entrypoint.description,
      entrypointId: registration.entrypoint.entrypointId,
      instructionInputSlotId: instructionInput.slotId,
      name: registration.entrypoint.name,
      outputDataTypes: [...new Set(
        capability.outputSlots.map((slot) => slot.dataType),
      )],
      packageId: registration.packageLock.packageId,
      packageVersion: registration.packageLock.version,
      skillId: resolution.target.skillLock.skillId,
    }];
  });
}

export function buildRecommendedSkillInstantiationCommand(
  snapshot: BoardSnapshot,
  source: AgentMessageRecord,
  input: { proposalId: string; skillEntryPointId: string },
): PackageEntrypointInstantiateCommand {
  if (!listAgentSkillEntrypointOptions().some(
    (option) => option.entrypointId === input.skillEntryPointId,
  )) {
    throw new Error('Recommended Skill requires one eligible installed Skill EntryPoint.');
  }
  const command = buildPackageEntrypointInstantiationCommand(
    snapshot,
    sourceWithEntrypoint(source, input.skillEntryPointId),
    input.proposalId,
  );
  if (command.invocation.targetLock.entrypointKind !== 'skill') {
    throw new Error('Recommended Skill command must lock one Skill EntryPoint.');
  }
  return command;
}

export function assertCurrentRecommendedSkillCommand(
  snapshot: BoardSnapshot,
  source: AgentMessageRecord,
  proposalId: string,
  command: PackageEntrypointInstantiateCommand,
): void {
  const expected = buildRecommendedSkillInstantiationCommand(snapshot, source, {
    proposalId,
    skillEntryPointId: command.invocation.targetLock.entrypointId,
  });
  if (JSON.stringify(expected) !== JSON.stringify(command)) {
    throw new Error('Recommended Skill command no longer matches its source message and installed Skill.');
  }
}

function sourceWithEntrypoint(
  source: AgentMessageRecord,
  entrypointId: string,
): AgentMessageRecord {
  return {
    ...structuredClone(source),
    contextRefs: [
      { entrypointId, kind: 'entrypoint' },
      ...source.contextRefs.filter((ref) => ref.kind !== 'entrypoint'),
    ],
  };
}
