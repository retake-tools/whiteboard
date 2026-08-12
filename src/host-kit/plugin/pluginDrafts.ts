import type { PluginDraftViewV2 } from '@retake-tools/package-sdk';

export interface PluginHostDraftRecordV2 extends PluginDraftViewV2 {
  legacy?: true;
  pluginModuleId: string;
}
export function pluginDraftView(
  draft: PluginHostDraftRecordV2,
): PluginDraftViewV2 {
  return Object.freeze({
    blockId: draft.blockId,
    capabilityId: draft.capabilityId,
    revision: draft.revision,
    updatedAt: draft.updatedAt,
    value: structuredClone(draft.value),
  });
}
