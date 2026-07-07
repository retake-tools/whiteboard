import { createId, nowIso } from './id';
import type { BlockRecord, BlockType, BoardSnapshot } from './types';

export function createBlockRecord(
  snapshot: BoardSnapshot,
  type: Exclude<BlockType, 'frame'>,
): BlockRecord {
  const index = snapshot.blocks.length;
  const createdAt = nowIso();

  return {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type,
    layerId: 'layer_default',
    position: { x: 80 + index * 36, y: 80 + index * 24 },
    size: sizeForType(type),
    zIndex: maxZIndex(snapshot.blocks) + 1,
    data: dataForType(type),
    createdAt,
    updatedAt: createdAt,
  };
}

export function touchBoard(snapshot: BoardSnapshot): BoardSnapshot {
  const updatedAt = nowIso();
  snapshot.project.updatedAt = updatedAt;
  snapshot.board.updatedAt = updatedAt;
  return snapshot;
}

export function maxZIndex(blocks: BlockRecord[]): number {
  return blocks.reduce((max, block) => Math.max(max, block.zIndex), 0);
}

function sizeForType(type: Exclude<BlockType, 'frame'>): { width: number; height: number } {
  if (type === 'image') return { width: 300, height: 230 };
  if (type === 'video') return { width: 300, height: 180 };
  if (type === 'task') return { width: 280, height: 160 };
  return { width: 260, height: 170 };
}

function dataForType(type: Exclude<BlockType, 'frame'>): BlockRecord['data'] {
  if (type === 'task') {
    return {
      title: 'New task',
      body: 'Choose capability, skill, and adapter.',
      status: 'queued',
      capabilityId: 'image.generate',
    };
  }

  if (type === 'image') {
    return {
      title: 'Image block',
      body: 'Import or generate an asset to attach assetId.',
    };
  }

  if (type === 'video') {
    return {
      title: 'Video block',
      body: 'Video preview should load lazily in later spikes.',
    };
  }

  return {
    title: 'Text block',
    body: 'Prompt, script note, reference, or story fragment.',
  };
}
