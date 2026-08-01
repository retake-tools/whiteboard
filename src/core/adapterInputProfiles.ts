import type { AdapterDefinition, AdapterInputProfile } from './capabilityContracts';
import type { ExecutionRecord } from './types';

export function resolveAdapterInputProfile(
  adapter: AdapterDefinition,
  capabilityId: string,
  boundSlotIds: readonly string[],
): AdapterInputProfile {
  if (!adapter.supportedCapabilityIds.includes(capabilityId)) {
    throw new Error(`Adapter ${adapter.adapterId} does not support Capability ${capabilityId}.`);
  }
  const slots = new Set(boundSlotIds);
  const matches = adapter.inputProfiles.filter((profile) => {
    if (profile.capabilityIds && !profile.capabilityIds.includes(capabilityId)) return false;
    if (!profile.requiredSlots.every((slotId) => slots.has(slotId))) return false;
    const allowedSlots = new Set([...profile.requiredSlots, ...profile.optionalSlots]);
    return [...slots].every((slotId) => allowedSlots.has(slotId));
  });
  if (matches.length !== 1) {
    throw new Error(
      `Adapter ${adapter.adapterId} requires exactly one input Profile for ${capabilityId}; found ${matches.length}.`,
    );
  }
  const selected = matches[0]!;
  return {
    ...selected,
    ...(selected.capabilityIds ? { capabilityIds: [...selected.capabilityIds] } : {}),
    requiredSlots: [...selected.requiredSlots],
    optionalSlots: [...selected.optionalSlots],
  };
}

export function resolveExecutionAdapterInputProfile(
  adapter: AdapterDefinition,
  execution: ExecutionRecord,
): AdapterInputProfile {
  const snapshotSlotIds = execution.inputBindingsSnapshot?.map((binding) => binding.slotId) ?? [];
  const parameterSlotIds = Array.isArray(execution.params?.inputBindings)
    ? execution.params.inputBindings.flatMap((binding) => (
        binding
        && typeof binding === 'object'
        && typeof (binding as { inputSlotId?: unknown }).inputSlotId === 'string'
          ? [(binding as { inputSlotId: string }).inputSlotId]
          : []
      ))
    : [];
  const boundSlotIds = snapshotSlotIds.length > 0
    ? snapshotSlotIds
    : [
        ...(execution.prompt?.trim() ? ['prompt'] : []),
        ...parameterSlotIds,
      ];
  const profile = resolveAdapterInputProfile(adapter, execution.capabilityId, boundSlotIds);
  if (
    execution.adapterSnapshot?.inputProfileId
    && execution.adapterSnapshot.inputProfileId !== profile.profileId
  ) {
    throw new Error(
      `Execution ${execution.executionId} input Profile does not match its frozen Adapter snapshot.`,
    );
  }
  return profile;
}
