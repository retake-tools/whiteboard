import type { BlockRecord, BoardSnapshot } from './types';

export function sourceImageBlockForOperation(
  snapshot: BoardSnapshot,
  operationBlockId: string,
): BlockRecord | undefined {
  const sourceEdge = snapshot.edges.find(
    (edge) =>
      edge.targetBlockId === operationBlockId &&
      edge.kind === 'execution_input' &&
      edge.inputRole === 'source',
  );
  return snapshot.blocks.find(
    (block) => block.blockId === sourceEdge?.sourceBlockId && block.type === 'image',
  );
}

export function imageBlockAspectRatio(snapshot: BoardSnapshot, block: BlockRecord): number | undefined {
  const asset = typeof block.data.assetId === 'string'
    ? snapshot.assets.find((candidate) => candidate.assetId === block.data.assetId)
    : undefined;
  return validRatio(asset?.width, asset?.height) ?? validRatio(block.size.width, block.size.height);
}

export function sourceImageAspectRatio(
  snapshot: BoardSnapshot,
  operationBlockId: string,
): number | undefined {
  const sourceBlock = sourceImageBlockForOperation(snapshot, operationBlockId);
  return sourceBlock ? imageBlockAspectRatio(snapshot, sourceBlock) : undefined;
}

function validRatio(width?: number, height?: number): number | undefined {
  if (!width || !height || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return undefined;
  }
  return width / height;
}
