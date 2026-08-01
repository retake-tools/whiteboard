import packageMetadata from '../package.json';
import {
  projectAgentCallableCapabilities,
  type AgentCallableCapabilityV1,
} from '../src/core/agentCallableCapabilities';
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
import { imageGenerateCapabilityId } from '../src/core/imageGenerateContracts';
import {
  ensureDefaultDeclarativePackageBootstrap,
  type DeclarativePackageBootstrapResult,
} from './declarative-package-bootstrap-service';
import { retakeRoot } from './local-store/context';

const coreImageDefinitions = [
  capabilityDefinitionFor(imageGenerateCapabilityId),
];

export function coreAgentCallableCapabilities(): AgentCallableCapabilityV1[] {
  return projectAgentCallableCapabilities(coreImageDefinitions);
}

export async function loadAgentCallableCapabilities(): Promise<AgentCallableCapabilityV1[]> {
  try {
    const bootstrap = await ensureDefaultDeclarativePackageBootstrap({
      hostVersion: packageMetadata.version,
      workspaceRoot: retakeRoot,
    });
    return agentCallableCapabilitiesForBootstrap(bootstrap);
  } catch (error) {
    console.warn(
      'Agent capability catalog could not load installed Package capabilities; using Core capabilities only.',
      error,
    );
    return coreAgentCallableCapabilities();
  }
}

export function agentCallableCapabilitiesForBootstrap(
  bootstrap: DeclarativePackageBootstrapResult,
): AgentCallableCapabilityV1[] {
  const enabledRuntimeContributionHashes = new Set(
    bootstrap.pluginRuntime.modules
      .filter((module) => module.desiredState === 'enabled' && module.status === 'enabled')
      .flatMap((module) => module.manifest.contributions)
      .filter((contribution) => contribution.kind === 'capability')
      .flatMap((contribution) => (
        'definitionHash' in contribution && contribution.definitionHash
          ? [contribution.definitionHash]
          : []
      )),
  );
  const allRuntimeContributionHashes = new Set(
    bootstrap.pluginRuntime.modules
      .flatMap((module) => module.manifest.contributions)
      .filter((contribution) => contribution.kind === 'capability')
      .flatMap((contribution) => (
        'definitionHash' in contribution && contribution.definitionHash
          ? [contribution.definitionHash]
          : []
      )),
  );
  const availableCapabilityHashes = new Set(
    bootstrap.snapshot.packages.flatMap((manifest) => (
      manifest.components.capabilityPlugins
        .filter((component) => (
          !allRuntimeContributionHashes.has(component.definitionHash)
          || enabledRuntimeContributionHashes.has(component.definitionHash)
        ))
        .map((component) => component.definitionHash)
    )),
  );
  return projectAgentCallableCapabilities([
    ...coreImageDefinitions,
    ...bootstrap.snapshot.capabilities.filter(
      (definition) => availableCapabilityHashes.has(definition.definitionHash),
    ),
  ]);
}
