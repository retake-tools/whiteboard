import {
  assertValidCapabilityDefinition,
  type CapabilityDefinition,
} from './capabilityContracts';

let activeDefinitions = new Map<string, CapabilityDefinition>();
let installedDefinitions = new Map<string, CapabilityDefinition>();
let revision = 0;
const listeners = new Set<() => void>();

export function replacePluginCapabilityDefinitions(
  nextDefinitions: readonly CapabilityDefinition[],
): void {
  activeDefinitions = validatedCapabilityDefinitions(
    nextDefinitions,
    'Plugin',
  );
  publishRevision();
}

export function replaceInstalledPluginCapabilityDefinitions(
  nextDefinitions: readonly CapabilityDefinition[],
): void {
  installedDefinitions = validatedCapabilityDefinitions(
    nextDefinitions,
    'Installed Plugin',
  );
  publishRevision();
}

function validatedCapabilityDefinitions(
  nextDefinitions: readonly CapabilityDefinition[],
  label: string,
): Map<string, CapabilityDefinition> {
  const next = new Map<string, CapabilityDefinition>();
  for (const definition of nextDefinitions) {
    assertValidCapabilityDefinition(definition);
    if (next.has(definition.capabilityId)) {
      throw new Error(
        `${label} capabilityId is registered more than once: ${definition.capabilityId}`,
      );
    }
    next.set(
      definition.capabilityId,
      structuredClone(definition),
    );
  }
  return next;
}

function publishRevision(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

export function pluginCapabilityDefinitionFor(
  capabilityId: string,
): CapabilityDefinition | undefined {
  const active = activeDefinitions.get(capabilityId);
  const installed = installedDefinitions.get(capabilityId);
  const definition = active ?? installed;
  return definition ? structuredClone(definition) : undefined;
}

export function listInstalledPluginCapabilityDefinitions(): CapabilityDefinition[] {
  return [...installedDefinitions.values()]
    .map((definition) => structuredClone(definition))
    .sort((left, right) => (
      left.capabilityId < right.capabilityId
        ? -1
        : left.capabilityId > right.capabilityId
          ? 1
          : 0
    ));
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
