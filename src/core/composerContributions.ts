import type { ComposerMode } from './imageComposer';
import { listInstalledPluginCapabilityDefinitions } from './pluginCapabilityDefinitions';
import type { ExecutionProviderSettingsSnapshot } from './executionProviders';

export interface ComposerModeContributionV1 {
  capabilityId?: string;
  mode: ComposerMode;
}

export function listAvailableComposerModes(
  settings: ExecutionProviderSettingsSnapshot | undefined,
): ComposerModeContributionV1[] {
  const modes: ComposerModeContributionV1[] = [{ mode: 'agent' }];
  if (hasReadyCapability(settings, 'image.text_to_image')) {
    modes.push({ capabilityId: 'image.text_to_image', mode: 'image' });
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
