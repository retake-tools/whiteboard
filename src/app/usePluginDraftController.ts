import { useCallback, type RefObject } from 'react';
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
} from '../core/pluginDrafts';
import type {
  PluginDraftRunnerRequestV2,
  PluginDraftRunnerV2,
} from '../core/pluginWebModuleLoader';

interface PluginDraftControllerOptions {
  persistSnapshot: (snapshot: BoardSnapshot) => Promise<void>;
  snapshotRef: RefObject<BoardSnapshot>;
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: {
      history?: boolean;
      persist?: boolean;
      syncFlow?: boolean;
    },
  ) => BoardSnapshot;
}

export function usePluginDraftController({
  persistSnapshot,
  snapshotRef,
  updateSnapshot,
}: PluginDraftControllerOptions): PluginDraftRunnerV2 {
  return useCallback(
    (request: PluginDraftRunnerRequestV2) => savePluginDraft(
      request,
      { persistSnapshot, snapshotRef, updateSnapshot },
    ),
    [persistSnapshot, snapshotRef, updateSnapshot],
  );
}

export async function savePluginDraft(
  request: PluginDraftRunnerRequestV2,
  options: PluginDraftControllerOptions,
): Promise<PluginDraftViewV2 | null> {
  const initial = options.snapshotRef.current;
  const block = initial.blocks.find(
    (candidate) => candidate.blockId === request.blockId,
  );
  if (!block) {
    throw new Error(`Plugin draft Block no longer exists: ${request.blockId}`);
  }

  const now = new Date().toISOString();
  let saved: PluginDraftViewV2 | null = null;
  const next = options.updateSnapshot((current) => {
    const currentBlock = current.blocks.find(
      (candidate) => candidate.blockId === request.blockId,
    );
    if (!currentBlock) {
      throw new Error(
        `Plugin draft Block no longer exists: ${request.blockId}`,
      );
    }
    const drafts = (currentBlock.data.retakePluginDrafts ?? []).filter(
      (draft) => (
        draft.pluginModuleId !== request.pluginModuleId
        || draft.capabilityId !== request.capabilityId
      ),
    );
    if (request.value !== null) {
      const record: RetakePluginDraftRecord = {
        capabilityId: request.capabilityId,
        pluginModuleId: request.pluginModuleId,
        revision: `${now}:${request.pluginModuleId}:${request.capabilityId}`,
        schemaVersion: 1,
        updatedAt: now,
        value: structuredClone(request.value),
      };
      drafts.push(record);
      saved = toPluginDraftView(request.blockId, record);
    }
    if (drafts.length > 0) {
      currentBlock.data.retakePluginDrafts = drafts;
    } else {
      delete currentBlock.data.retakePluginDrafts;
    }
    if (request.capabilityId === 'image.annotation_edit') {
      delete currentBlock.data.annotationDraft;
    }
    currentBlock.updatedAt = now;
    current.board.updatedAt = now;
    return current;
  }, { history: false, persist: false });
  await options.persistSnapshot(next);
  return saved;
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
