import type {
  RetakeCapabilityDefinitionV2,
  RetakePluginModuleManifestV2,
} from '@retake-tools/package-contracts';
import {
  resolvePluginLocalizedTextV2,
  retakeCapabilityDefinitionV2Schema,
} from '@retake-tools/package-contracts';
import type { CapabilityDefinition } from '../src/core/capabilityContracts';

export function readInstalledPackageCapabilityDefinitions(
  pluginModules: Iterable<RetakePluginModuleManifestV2>,
  files: ReadonlyMap<string, Buffer>,
): Map<string, CapabilityDefinition> {
  const definitions = new Map<string, CapabilityDefinition>();
  for (const pluginModule of pluginModules) {
    for (const contribution of pluginModule.contributions) {
      if (contribution.kind !== 'capability') continue;
      const file = files.get(contribution.definitionPath);
      if (!file) {
        throw new Error(
          `Installed Plugin capability file is missing: ${contribution.definitionPath}`,
        );
      }
      let input: unknown;
      try {
        input = JSON.parse(file.toString('utf8'));
      } catch {
        throw new Error(
          `Installed Plugin capability file is not valid JSON: ${contribution.definitionPath}`,
        );
      }
      const parsed = retakeCapabilityDefinitionV2Schema.safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `Installed Plugin capability definition is invalid: ${contribution.definitionPath}`,
        );
      }
      if (parsed.data.definitionHash !== contribution.definitionHash) {
        throw new Error(
          `Installed Plugin capability definitionHash does not match: ${contribution.contributionId}`,
        );
      }
      const definition = coreCapabilityDefinitionFrom(parsed.data);
      if (definitions.has(definition.capabilityId)) {
        throw new Error(
          `Installed Plugin Capability ID conflicts: ${definition.capabilityId}`,
        );
      }
      definitions.set(definition.capabilityId, definition);
    }
  }
  return definitions;
}

function coreCapabilityDefinitionFrom(
  definition: RetakeCapabilityDefinitionV2,
): CapabilityDefinition {
  return {
    ...structuredClone(definition),
    displayName: resolvePluginLocalizedTextV2(definition.displayName, 'en'),
    schemaVersion: 1,
  };
}
