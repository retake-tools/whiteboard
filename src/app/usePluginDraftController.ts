import { useCallback } from 'react';
import type {
  PluginDraftViewV2,
  PluginJsonValueV2,
} from '@retake-tools/package-sdk';
import type {
  BoardSnapshot,
  RetakePluginDraftRecord,
} from '../core/types';
import type {
  PluginHostDraftRecordV2,
} from '../host-kit/plugin';
import type {
  PluginDraftRunnerRequestV2,
  PluginDraftRunnerV2,
} from '../host-kit/plugin';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';

interface PluginDraftControllerOptions {
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
}

export function usePluginDraftController({
  runProductCommand,
}: PluginDraftControllerOptions): PluginDraftRunnerV2 {
  return useCallback(
    (request: PluginDraftRunnerRequestV2) => savePluginDraft(
      request,
      { runProductCommand },
    ),
    [runProductCommand],
  );
}

export async function savePluginDraft(
  request: PluginDraftRunnerRequestV2,
  options: PluginDraftControllerOptions,
): Promise<PluginDraftViewV2 | null> {
  if (!options.runProductCommand) {
    throw new Error('Whiteboard Plugin draft command facade is unavailable.');
  }
  const saved = await options.runProductCommand(
    (commands) => commands.plugin.saveDraft(request),
    { syncFlow: false },
  );
  return saved.draft;
}

export function pluginDraftViewsForBlocks(
  snapshot: BoardSnapshot,
  blockIds: ReadonlySet<string>,
): PluginHostDraftRecordV2[] {
  return snapshot.blocks.flatMap((block) => {
    if (!blockIds.has(block.blockId)) return [];
    const drafts: PluginHostDraftRecordV2[] = (
      block.data.retakePluginDrafts ?? []
    ).map((record) => ({
      ...toPluginDraftView(block.blockId, record),
      pluginModuleId: record.pluginModuleId,
    }));
    if (
      block.data.annotationDraft
      && typeof block.data.assetId === 'string'
      && block.data.annotationDraft.sourceAssetId === block.data.assetId
    ) {
      drafts.push({
        blockId: block.blockId,
        capabilityId: 'image.annotation_edit',
        legacy: true,
        pluginModuleId: '',
        revision: `legacy:${block.data.annotationDraft.updatedAt}`,
        updatedAt: block.data.annotationDraft.updatedAt,
        value: structuredClone(
          block.data.annotationDraft,
        ) as unknown as PluginJsonValueV2,
      });
    }
    return drafts;
  });
}

function toPluginDraftView(
  blockId: string,
  record: RetakePluginDraftRecord,
): PluginDraftViewV2 {
  return Object.freeze({
    blockId,
    capabilityId: record.capabilityId,
    revision: record.revision,
    updatedAt: record.updatedAt,
    value: structuredClone(record.value),
  });
}
