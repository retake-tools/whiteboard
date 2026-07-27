import {
  retakeCapabilityContributionV1Schema,
} from '@retake-tools/package-contracts';
import type {
  ActivatedPluginContributionV1,
} from '@retake-tools/package-sdk';
import {
  assertValidCapabilityDefinition,
  type CapabilityDefinition,
} from './capabilityContracts';

export interface RegisteredPluginCapabilityV1 {
  contributionId: string;
  definition: CapabilityDefinition;
  failure: string | null;
  pluginModuleId: string;
}

export function registeredPluginCapabilityFrom(
  activated: ActivatedPluginContributionV1,
  pluginModuleId: string,
): RegisteredPluginCapabilityV1 {
  const parsed = retakeCapabilityContributionV1Schema.safeParse(
    activated.value,
  );
  if (!parsed.success) {
    throw new Error(
      'Plugin capability contribution must use the Retake Capability Contribution V1 contract.',
    );
  }
  const value = parsed.data;
  assertValidCapabilityDefinition(value.definition);
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
    definition: structuredClone(
      value.definition,
    ) as CapabilityDefinition,
    failure: null,
    pluginModuleId,
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
      && capability.failure === right[index]?.failure
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
