import {
  assertValidCapabilityDefinition,
  type CapabilityDefinition,
} from './capabilityContracts';

let definitions = new Map<string, CapabilityDefinition>();

export function replacePluginCapabilityDefinitions(
  nextDefinitions: readonly CapabilityDefinition[],
): void {
  const next = new Map<string, CapabilityDefinition>();
  for (const definition of nextDefinitions) {
    assertValidCapabilityDefinition(definition);
    if (next.has(definition.capabilityId)) {
      throw new Error(
        `Plugin capabilityId is registered more than once: ${definition.capabilityId}`,
      );
    }
    next.set(
      definition.capabilityId,
      structuredClone(definition),
    );
  }
  definitions = next;
}

export function pluginCapabilityDefinitionFor(
  capabilityId: string,
): CapabilityDefinition | undefined {
  const definition = definitions.get(capabilityId);
  return definition ? structuredClone(definition) : undefined;
}
