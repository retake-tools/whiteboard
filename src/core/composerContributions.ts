import type { ComposerMode } from './imageComposer';
import { listInstalledPluginCapabilityDefinitions } from './pluginCapabilityDefinitions';
import type { ExecutionProviderSettingsSnapshot } from './executionProviders';
import { imageGenerateCapabilityId } from './imageGenerateContracts';

export interface ComposerModeContributionV1 {
  capabilityId?: string;
  mode: ComposerMode;
}

export function listAvailableComposerModes(
  settings: ExecutionProviderSettingsSnapshot | undefined,
): ComposerModeContributionV1[] {
  const modes: ComposerModeContributionV1[] = [{ mode: 'agent' }];
  if (hasReadyCapability(settings, imageGenerateCapabilityId)) {
    modes.push({ capabilityId: imageGenerateCapabilityId, mode: 'image' });
  }
  const videoCapability = listInstalledPluginCapabilityDefinitions().find(
    (definition) =>
      definition.outputSlots.some((slot) => slot.dataType === 'video')
      && hasReadyCapability(settings, definition.capabilityId),
  );
  if (videoCapability) {
    modes.push({ capabilityId: videoCapability.capabilityId, mode: 'video' });
  }
  return modes;
}

function hasReadyCapability(
  settings: ExecutionProviderSettingsSnapshot | undefined,
  capabilityId: string,
): boolean {
  return Boolean(settings?.connections.some(
    (connection) =>
      connection.enabled
      && connection.status === 'ready'
      && connection.connectorId !== 'codex-managed'
      && connection.supportedCapabilityIds.includes(capabilityId),
  ));
}
