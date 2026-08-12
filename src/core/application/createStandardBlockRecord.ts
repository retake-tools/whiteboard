import { defaultBlockSize } from '../blockSizing';
import { createId, nowIso } from '../id';
import type {
  BlockData,
  BlockRecord,
  BlockType,
  BoardSnapshot,
} from '../types';

export function createStandardBlockRecord(input: {
  body?: string;
  data?: Readonly<Record<string, unknown>>;
  position?: { readonly x: number; readonly y: number };
  size?: { readonly height: number; readonly width: number };
  snapshot: BoardSnapshot;
  title?: string;
  type: BlockType;
}): BlockRecord {
  const createdAt = nowIso();
  const index = input.snapshot.blocks.length;
  const defaultData = standardDataForType(input.type);
  const position = input.position ?? { x: 80 + index * 36, y: 80 + index * 24 };
  const size = input.size ?? defaultBlockSize(input.type);
  assertFinitePoint(position);
  assertPositiveSize(size);

  return {
    blockId: createId('block'),
    boardId: input.snapshot.board.boardId,
    createdAt,
    data: {
      ...defaultData,
      ...structuredClone(input.data ?? {}),
      ...(input.body === undefined ? {} : { body: input.body }),
      ...(input.title === undefined ? {} : { title: input.title }),
    },
    layerId: input.snapshot.layers[0]?.id ?? 'layer_default',
    position: { ...position },
    size: { ...size },
    type: input.type,
    updatedAt: createdAt,
    zIndex: input.snapshot.blocks.reduce(
      (highest, block) => Math.max(highest, block.zIndex),
      0,
    ) + 1,
  };
}

function standardDataForType(type: BlockType): BlockData {
  if (type === 'document') {
    return {
      contentFormat: 'markdown',
      documentCharacterCount: 0,
      documentExcerpt: '',
      documentKind: 'general',
      documentOutline: [],
      title: 'Markdown document',
    };
  }
  if (type === 'group') {
    return {
      groupColor: 'neutral',
      groupKind: 'manual',
      groupLayoutMode: 'free',
      title: 'Group',
    };
  }
  if (type === 'image') return { title: 'Image block' };
  if (type === 'video') return { title: 'Video block' };
  if (type === 'operation') {
    return {
      body: 'Choose capability, inputs, and execution adapter.',
      title: 'New operation',
    };
  }
  return { title: 'Text block' };
}

function assertFinitePoint(point: { readonly x: number; readonly y: number }): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('Block position must contain finite coordinates.');
  }
}

function assertPositiveSize(size: { readonly height: number; readonly width: number }): void {
  if (
    !Number.isFinite(size.height)
    || !Number.isFinite(size.width)
    || size.height <= 0
    || size.width <= 0
  ) {
    throw new Error('Block size must contain positive finite dimensions.');
  }
}
