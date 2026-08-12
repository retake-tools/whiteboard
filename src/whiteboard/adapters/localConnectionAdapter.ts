import { loadExecutionProviderSettings } from '../../core/executionProviderClient';
import type { HostConnectionAdapterV1 } from '../../host-kit';

export function createWhiteboardLocalConnectionAdapter(): HostConnectionAdapterV1 {
  return Object.freeze({
    adapterVersion: 1,
    async cancel() {
      throw new Error('Connection cancellation remains owned by the selected Whiteboard execution Adapter.');
    },
    async execute() {
      throw new Error('Connection execution remains owned by the selected Whiteboard execution Adapter.');
    },
    async list(input: { readonly capabilityId?: string; readonly projectId: string }) {
      const settings = await loadExecutionProviderSettings(input.projectId);
      return settings.connections.filter((connection) => (
        input.capabilityId === undefined
        || connection.supportedCapabilityIds.includes(input.capabilityId)
      ));
    },
  });
}
