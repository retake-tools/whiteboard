import type { CapabilityDefinition } from './capabilityContracts';

export type AgentCapabilityAuthoringKind =
  | 'image_generate'
  | 'source_image_edit';

export interface AgentCallableCapabilityV1 {
  authoringKind: AgentCapabilityAuthoringKind;
  capabilityId: string;
  displayName: string;
  inputSlots: Array<{
    cardinality: 'one' | 'optional' | 'many';
    dataTypes: string[];
    required: boolean;
    semanticRole: string;
    slotId: string;
  }>;
}

export function projectAgentCallableCapabilities(
  definitions: readonly CapabilityDefinition[],
): AgentCallableCapabilityV1[] {
  const projected = new Map<string, AgentCallableCapabilityV1>();
  for (const definition of definitions) {
    const capability = projectAgentCallableCapability(definition);
    if (capability) projected.set(capability.capabilityId, capability);
  }
  return [...projected.values()].sort((left, right) => (
    left.capabilityId.localeCompare(right.capabilityId)
  ));
}

export function projectAgentCallableCapability(
  definition: CapabilityDefinition,
): AgentCallableCapabilityV1 | undefined {
  if (!definition.supportedAdapterClasses.includes('agent_runtime.media')) {
    return undefined;
  }
  if (
    definition.outputSlots.length !== 1
    || definition.outputSlots[0]?.dataType !== 'image'
    || !definition.outputSlots[0].projectionBlockTypes.includes('image')
  ) {
    return undefined;
  }

  const promptSlot = definition.inputSlots.find(
    (slot) => slot.required
      && slot.semanticRole === 'prompt'
      && slot.dataTypes.includes('text'),
  );
  if (!promptSlot) return undefined;

  const sourceSlot = definition.inputSlots.find(
    (slot) => slot.required
      && slot.semanticRole === 'source'
      && slot.dataTypes.includes('image'),
  );
  const supportedRequiredSlotIds = new Set([
    promptSlot.slotId,
    ...(sourceSlot ? [sourceSlot.slotId] : []),
  ]);
  if (definition.inputSlots.some(
    (slot) => slot.required && !supportedRequiredSlotIds.has(slot.slotId),
  )) {
    return undefined;
  }

  return {
    authoringKind: sourceSlot ? 'source_image_edit' : 'image_generate',
    capabilityId: definition.capabilityId,
    displayName: definition.displayName,
    inputSlots: definition.inputSlots.map((slot) => ({
      cardinality: slot.cardinality,
      dataTypes: [...slot.dataTypes],
      required: slot.required,
      semanticRole: slot.semanticRole,
      slotId: slot.slotId,
    })),
  };
}
