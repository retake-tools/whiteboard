import {
  resolvePluginLocalizedTextV2,
  retakeCapabilityContributionV2Schema,
  type PluginLocalizedTextV2,
} from '@retake-tools/package-contracts';
import type {
  ActivatedPluginContributionV2,
} from '@retake-tools/package-sdk';
import {
  assertValidCapabilityDefinition,
  type CapabilityDefinition,
} from '../../core/capabilityContracts';

export interface RegisteredPluginCapabilityV1 {
  contributionId: string;
  definition: CapabilityDefinition;
  failure: string | null;
  localizedDisplayName: PluginLocalizedTextV2;
  pluginModuleId: string;
}
export function registeredPluginCapabilityFrom(
  activated: ActivatedPluginContributionV2,
  pluginModuleId: string,
  locale: string,
): RegisteredPluginCapabilityV1 {
  if (activated.contribution.kind !== 'capability') {
    throw new Error(
      'Registered Plugin capability must reference a capability contribution.',
    );
  }
  const parsed = retakeCapabilityContributionV2Schema.safeParse(
    activated.value,
  );
  if (!parsed.success) {
    throw new Error(
      'Plugin capability contribution must use the Retake Capability Contribution V2 contract.',
    );
  }
  const value = parsed.data;
  const definition: CapabilityDefinition = {
    ...structuredClone(value.definition),
    displayName: resolvePluginLocalizedTextV2(
      value.definition.displayName,
      locale,
    ),
    schemaVersion: 1,
  };
  assertValidCapabilityDefinition(definition);
  if (
    activated.contribution.definitionHash
    !== value.definition.definitionHash
  ) {
    throw new Error(
      `Plugin capability contribution definitionHash does not match: ${activated.contribution.contributionId}`,
    );
  }
  return {
    contributionId: activated.contribution.contributionId,
    definition,
    failure: null,
    localizedDisplayName: structuredClone(value.definition.displayName),
    pluginModuleId,
  };
}

export function localizeRegisteredPluginCapability(
  capability: RegisteredPluginCapabilityV1,
  locale: string,
): RegisteredPluginCapabilityV1 {
  const displayName = resolvePluginLocalizedTextV2(
    capability.localizedDisplayName,
    locale,
  );
  if (displayName === capability.definition.displayName) return capability;
  return {
    ...capability,
    definition: {
      ...capability.definition,
      displayName,
    },
  };
}

export function samePluginCapabilities(
  left: readonly RegisteredPluginCapabilityV1[],
  right: readonly RegisteredPluginCapabilityV1[],
): boolean {
  return left.length === right.length
    && left.every((capability, index) => (
      capability.contributionId === right[index]?.contributionId
      && capability.definition.capabilityId
        === right[index]?.definition.capabilityId
      && capability.definition.definitionHash
        === right[index]?.definition.definitionHash
      && capability.definition.displayName
        === right[index]?.definition.displayName
      && capability.failure === right[index]?.failure
      && JSON.stringify(capability.localizedDisplayName)
        === JSON.stringify(right[index]?.localizedDisplayName)
      && capability.pluginModuleId === right[index]?.pluginModuleId
    ));
}

export function pluginCapabilityConflicts(
  capabilities: readonly RegisteredPluginCapabilityV1[],
): Array<{ error: string; pluginModuleId: string }> {
  const providersByCapabilityId = new Map<
    string,
    RegisteredPluginCapabilityV1[]
  >();
  for (const capability of capabilities) {
    const capabilityId = capability.definition.capabilityId;
    const providers = providersByCapabilityId.get(capabilityId) ?? [];
    providers.push(capability);
    providersByCapabilityId.set(capabilityId, providers);
  }
  const failures: Array<{ error: string; pluginModuleId: string }> = [];
  for (const [capabilityId, providers] of providersByCapabilityId) {
    if (providers.length < 2) continue;
    for (const pluginModuleId of new Set(
      providers.map((provider) => provider.pluginModuleId),
    )) {
      failures.push({
        error: `Plugin capabilityId conflicts with another active module: ${capabilityId}`,
        pluginModuleId,
      });
    }
  }
  return failures;
}
