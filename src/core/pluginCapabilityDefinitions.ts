import {
  assertValidCapabilityDefinition,
  type CapabilityDefinition,
} from './capabilityContracts';

let definitions = new Map<string, CapabilityDefinition>();
let revision = 0;
const listeners = new Set<() => void>();

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
  revision += 1;
  for (const listener of listeners) listener();
}

export function pluginCapabilityDefinitionFor(
  capabilityId: string,
): CapabilityDefinition | undefined {
  const definition = definitions.get(capabilityId);
  return definition ? structuredClone(definition) : undefined;
}

export function currentPluginCapabilityDefinitionsRevision(): number {
  return revision;
}

export function subscribePluginCapabilityDefinitions(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
