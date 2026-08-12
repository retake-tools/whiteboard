import type {
  PluginDraftViewV2,
  PluginJsonValueV2,
} from '@retake-tools/package-sdk';
import { nowIso } from '../../core/id';
import type { PluginDraftRunnerRequestV2 } from '../../core/pluginWebModuleLoader';
import type {
  BoardSnapshot,
  RetakePluginDraftRecord,
} from '../../core/types';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardPluginCommandsV1 {
  saveDraft(input: PluginDraftRunnerRequestV2): Promise<{
    committed: boolean;
    draft: PluginDraftViewV2 | null;
  }>;
}

export function createWhiteboardPluginCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardPluginCommandsV1 {
  return Object.freeze({
    async saveDraft(input: PluginDraftRunnerRequestV2) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        return applyWhiteboardPluginDraft(snapshot, input);
      });
      return {
        committed: transaction.committed,
        draft: transaction.result,
      };
    },
  });
}

export function applyWhiteboardPluginDraft(
  snapshot: BoardSnapshot,
  request: PluginDraftRunnerRequestV2,
): { changed: boolean; result: PluginDraftViewV2 | null } {
  const block = snapshot.blocks.find(
    (candidate) => candidate.blockId === request.blockId,
  );
  if (!block) {
    throw new Error(`Plugin draft Block no longer exists: ${request.blockId}`);
  }
  const existing = (block.data.retakePluginDrafts ?? []).find(
    (draft) => draft.pluginModuleId === request.pluginModuleId
      && draft.capabilityId === request.capabilityId,
  );
  const hasLegacyAnnotationDraft = request.capabilityId === 'image.annotation_edit'
    && Boolean(block.data.annotationDraft);
  if (
    request.value !== null
    && existing
    && !hasLegacyAnnotationDraft
    && sameJsonValue(existing.value, request.value)
  ) {
    return { changed: false, result: toPluginDraftView(request.blockId, existing) };
  }
  if (request.value === null && !existing && !hasLegacyAnnotationDraft) {
    return { changed: false, result: null };
  }

  const drafts = (block.data.retakePluginDrafts ?? []).filter(
    (draft) => draft.pluginModuleId !== request.pluginModuleId
      || draft.capabilityId !== request.capabilityId,
  );
  const updatedAt = nowIso();
  let result: PluginDraftViewV2 | null = null;
  if (request.value !== null) {
    const record: RetakePluginDraftRecord = {
      capabilityId: request.capabilityId,
      pluginModuleId: request.pluginModuleId,
      revision: `${updatedAt}:${request.pluginModuleId}:${request.capabilityId}`,
      schemaVersion: 1,
      updatedAt,
      value: structuredClone(request.value),
    };
    drafts.push(record);
    result = toPluginDraftView(request.blockId, record);
  }
  if (drafts.length > 0) block.data.retakePluginDrafts = drafts;
  else delete block.data.retakePluginDrafts;
  if (request.capabilityId === 'image.annotation_edit') {
    delete block.data.annotationDraft;
  }
  block.updatedAt = updatedAt;
  snapshot.board.updatedAt = updatedAt;
  return { changed: true, result };
}

function sameJsonValue(left: PluginJsonValueV2, right: PluginJsonValueV2): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: PluginJsonValueV2): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Readonly<Record<string, PluginJsonValueV2>>;
    return `{${Object.keys(object).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(object[key]!)}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
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
