import { fitImageBlockSize } from './imageFile';
import { createId } from './id';
import { touchBoard } from './blockFactory';
import type { AssetRecord, BoardHistoryEvent, BoardSnapshot } from './types';

export function attachImportedImageAsset(
  snapshot: BoardSnapshot,
  input: {
    asset: AssetRecord;
    blockId: string;
    fileName: string;
    updatedAt: string;
  },
): { changed: boolean; previousAssetId?: string } {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === input.blockId && candidate.type === 'image');
  if (!block || block.data.sourceExecutionId || block.data.operationBlockId) return { changed: false };
  const previousAssetId = typeof block.data.assetId === 'string' ? block.data.assetId : undefined;

  if (!snapshot.assets.some((candidate) => candidate.assetId === input.asset.assetId)) {
    snapshot.assets.unshift(input.asset);
  }
  block.data = {
    ...block.data,
    title: input.fileName || block.data.title,
    body: undefined,
    assetId: input.asset.assetId,
    previewUrl: input.asset.previewUrl,
  };
  block.size = fitImageBlockSize(input.asset.width, input.asset.height);
  block.updatedAt = input.updatedAt;

  const historyEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: previousAssetId ? 'asset_replaced' : 'asset_imported',
    createdAt: input.updatedAt,
    actor: 'user',
    blockIds: [block.blockId],
    assetIds: [previousAssetId, input.asset.assetId].filter(
      (assetId): assetId is string => typeof assetId === 'string',
    ),
    summary: input.fileName || block.data.title,
    detail: {
      assetId: input.asset.assetId,
      previousAssetId,
    },
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);
  return { changed: true, previousAssetId };
}
