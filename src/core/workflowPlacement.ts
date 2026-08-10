import type { BlockRecord, BoardSnapshot } from './types';

export function moveBlockGroupToNearestFreeArea(
  snapshot: BoardSnapshot,
  blocks: BlockRecord[],
  desiredCenter: { x: number; y: number },
): void {
  if (blocks.length === 0) return;
  const blockIds = new Set(blocks.map((block) => block.blockId));
  const topLevelBlocks = blocks.filter(
    (block) => !block.parentGroupId || !blockIds.has(block.parentGroupId),
  );
  const parentGroupIds = new Set(topLevelBlocks.map((block) => block.parentGroupId));
  const parentGroupId = parentGroupIds.size === 1
    ? topLevelBlocks[0]?.parentGroupId
    : undefined;
  const occupied = snapshot.blocks.filter(
    (block) => !blockIds.has(block.blockId) && block.parentGroupId === parentGroupId,
  );
  const bounds = blockGroupBounds(blocks);
  const desiredOrigin = {
    x: desiredCenter.x - bounds.width / 2,
    y: desiredCenter.y - bounds.height / 2,
  };
  const availableOrigin = collisionCandidateOrigins(desiredOrigin, bounds, occupied, 32)
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

function collisionCandidateOrigins(
  desiredOrigin: { x: number; y: number },
  movingBounds: { width: number; height: number },
  occupied: readonly BlockRecord[],
  gap: number,
): Array<{ x: number; y: number }> {
  const xCandidates = new Set([desiredOrigin.x]);
  const yCandidates = new Set([desiredOrigin.y]);
  for (const block of occupied) {
    xCandidates.add(block.position.x - movingBounds.width - gap);
    xCandidates.add(block.position.x + block.size.width + gap);
    yCandidates.add(block.position.y - movingBounds.height - gap);
    yCandidates.add(block.position.y + block.size.height + gap);
  }
  return [...xCandidates].flatMap((x) => [...yCandidates].map((y) => ({ x, y })))
    .sort((left, right) => (
      squaredDistance(left, desiredOrigin) - squaredDistance(right, desiredOrigin)
      || left.y - right.y
      || left.x - right.x
    ));
}

function squaredDistance(
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
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
