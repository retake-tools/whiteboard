import type { BlockRecord, BoardSnapshot } from './types';

export function moveBlockGroupToNearestFreeArea(
  snapshot: BoardSnapshot,
  blocks: BlockRecord[],
  desiredCenter: { x: number; y: number },
): void {
  if (blocks.length === 0) return;
  const blockIds = new Set(blocks.map((block) => block.blockId));
  const parentGroupId = blocks[0]?.parentGroupId;
  const occupied = snapshot.blocks.filter(
    (block) => !blockIds.has(block.blockId) && block.parentGroupId === parentGroupId,
  );
  const bounds = blockGroupBounds(blocks);
  const desiredOrigin = {
    x: desiredCenter.x - bounds.width / 2,
    y: desiredCenter.y - bounds.height / 2,
  };
  const availableOrigin = nearestGridOffsets(76, 24)
    .map((offset) => ({ x: desiredOrigin.x + offset.x, y: desiredOrigin.y + offset.y }))
    .find((origin) => occupied.every((block) => !rectanglesOverlap(
      origin,
      bounds,
      block.position,
      block.size,
      32,
    ))) ?? desiredOrigin;
  const deltaX = availableOrigin.x - bounds.x;
  const deltaY = availableOrigin.y - bounds.y;
  for (const block of blocks) {
    block.position = { x: block.position.x + deltaX, y: block.position.y + deltaY };
  }
}

export function blockGroupBounds(
  blocks: BlockRecord[],
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(...blocks.map((block) => block.position.x));
  const y = Math.min(...blocks.map((block) => block.position.y));
  const right = Math.max(...blocks.map((block) => block.position.x + block.size.width));
  const bottom = Math.max(...blocks.map((block) => block.position.y + block.size.height));
  return { x, y, width: right - x, height: bottom - y };
}

function nearestGridOffsets(step: number, rings: number): Array<{ x: number; y: number }> {
  const offsets = [{ x: 0, y: 0 }];
  for (let ring = 1; ring <= rings; ring += 1) {
    for (let column = -ring; column <= ring; column += 1) {
      offsets.push({ x: column * step, y: -ring * step });
      offsets.push({ x: column * step, y: ring * step });
    }
    for (let row = -ring + 1; row < ring; row += 1) {
      offsets.push({ x: -ring * step, y: row * step });
      offsets.push({ x: ring * step, y: row * step });
    }
  }
  return offsets;
}

function rectanglesOverlap(
  leftPosition: { x: number; y: number },
  leftSize: { width: number; height: number },
  rightPosition: { x: number; y: number },
  rightSize: { width: number; height: number },
  gap: number,
): boolean {
  return !(
    leftPosition.x + leftSize.width + gap <= rightPosition.x ||
    rightPosition.x + rightSize.width + gap <= leftPosition.x ||
    leftPosition.y + leftSize.height + gap <= rightPosition.y ||
    rightPosition.y + rightSize.height + gap <= leftPosition.y
  );
}
