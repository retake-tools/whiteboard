import { createBlockRecord, touchBoard } from './blockFactory';
import { fitImageBlockSize } from './blockSizing';
import { createId, nowIso } from './id';
import type { AssetRecord, BlockRecord, BoardHistoryEvent, BoardSnapshot } from './types';

export interface ProjectAssetCatalogItem {
  asset: AssetRecord;
  available: boolean;
  fileName: string;
}

export interface ProjectAssetCatalogSnapshot {
  items: ProjectAssetCatalogItem[];
  loadedAt: string;
  projectId: string;
}

export function insertProjectAssetReference(
  snapshot: BoardSnapshot,
  input: {
    item: ProjectAssetCatalogItem;
    position: { x: number; y: number };
  },
): BlockRecord {
  if (input.item.asset.projectId !== snapshot.project.projectId) {
    throw new Error('Material belongs to another project.');
  }
  if (!input.item.available) throw new Error('Material file is missing. Relink it before adding it.');
  if (input.item.asset.kind !== 'image') {
    throw new Error(`Material kind is not supported on the image canvas yet: ${input.item.asset.kind}`);
  }

  if (!snapshot.assets.some((asset) => asset.assetId === input.item.asset.assetId)) {
    snapshot.assets.push(structuredClone(input.item.asset));
  }
  const block = createBlockRecord(snapshot, 'image');
  block.position = input.position;
  block.size = fitImageBlockSize(input.item.asset.width, input.item.asset.height);
  block.data = {
    ...block.data,
    assetId: input.item.asset.assetId,
    previewUrl: input.item.asset.previewUrl,
    title: input.item.fileName || block.data.title,
  };
  const createdAt = nowIso();
  block.updatedAt = createdAt;
  snapshot.blocks.push(block);
  const historyEvent: BoardHistoryEvent = {
    actor: 'user',
    assetIds: [input.item.asset.assetId],
    blockIds: [block.blockId],
    createdAt,
    detail: { assetId: input.item.asset.assetId, source: 'project_materials' },
    eventId: createId('history'),
    summary: input.item.fileName || input.item.asset.assetId,
    type: 'asset_imported',
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);
  return block;
}
