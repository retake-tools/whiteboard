import type { BlockRecord, BoardSnapshot } from './types';
import { mediaBlockMaxSide } from './blockSizing';

interface Size {
  height: number;
  width: number;
}

interface Position {
  x: number;
  y: number;
}

export interface ImageBranchDraftLayout {
  operationPosition: Position;
  parentGroupId?: string;
  textPosition: Position;
}

export interface ImageOperationResultRowLayout {
  x: number;
  y: number;
}

export interface AnnotationOperationBranchLayout {
  operationPosition: Position;
  parentGroupId?: string;
  resultPosition: Position;
}

export function imageBranchDraftSelectionBlockIds(
  sourceBlock: BlockRecord,
  textBlock: BlockRecord,
  operationBlock: BlockRecord,
): string[] {
  const sourceIsManagedResult = Boolean(sourceBlock.data.sourceExecutionId || sourceBlock.data.operationBlockId);
  return [
    ...(sourceIsManagedResult ? [] : [sourceBlock.blockId]),
    textBlock.blockId,
    operationBlock.blockId,
  ];
}

const branchGap = 64;
const branchLaneOutputClearance = 160;
const collisionGap = 28;
const resultHorizontalGap = 32;
const resultGroupPadding = { top: 48, right: 28, bottom: 28, left: 28 };

export function annotationOperationBranchLayout(
  snapshot: BoardSnapshot,
  sourceBlock: BlockRecord,
  operationSize: Size,
  resultSize: Size,
  count: number,
): AnnotationOperationBranchLayout | undefined {
  const sourceGroup = sourceBlock.parentGroupId
    ? snapshot.blocks.find((block) => block.blockId === sourceBlock.parentGroupId && block.type === 'group')
    : undefined;
  if (!sourceGroup) return undefined;

  const parentGroupId = sourceGroup.parentGroupId;
  const grouped = count > 1;
  const resultRowWidth = count * resultSize.width + Math.max(0, count - 1) * resultHorizontalGap;
  const resultEnvelope = {
    width: resultRowWidth + (grouped ? resultGroupPadding.left + resultGroupPadding.right : 0),
    height: resultSize.height + (grouped ? resultGroupPadding.top + resultGroupPadding.bottom : 0),
  };
  const operationResultGap = 80;
  const branchSize = {
    width: operationSize.width + operationResultGap + resultEnvelope.width,
    height: Math.max(operationSize.height, resultEnvelope.height),
  };
  const placementGap = 64;
  const occupied = snapshot.blocks.filter((block) => block.parentGroupId === parentGroupId);
  const aboveY = sourceGroup.position.y - branchSize.height - placementGap;
  const candidates: Position[] = [];

  for (let row = 0; row < 16; row += 1) {
    const y = aboveY - row * (branchSize.height + placementGap);
    for (let offset = 0; offset < 16; offset += 1) {
      const distance = Math.ceil(offset / 2) * 96;
      const direction = offset === 0 || offset % 2 === 1 ? 1 : -1;
      candidates.push({ x: sourceGroup.position.x + distance * direction, y });
    }
  }

  for (let step = 0; step < 24; step += 1) {
    const verticalOffset = step * (branchSize.height + placementGap);
    candidates.push({
      x: sourceGroup.position.x + sourceGroup.size.width + placementGap,
      y: sourceGroup.position.y + verticalOffset,
    });
    candidates.push({
      x: sourceGroup.position.x - branchSize.width - placementGap,
      y: sourceGroup.position.y + verticalOffset,
    });
    candidates.push({
      x: sourceGroup.position.x,
      y: sourceGroup.position.y + sourceGroup.size.height + placementGap + verticalOffset,
    });
  }

  const branchPosition = candidates.find((candidate) =>
    occupied.every((block) => !rectanglesOverlap(candidate, branchSize, block.position, block.size, collisionGap)))
    ?? { x: sourceGroup.position.x, y: aboveY };
  const operationPosition = {
    x: branchPosition.x,
    y: branchPosition.y + Math.max(0, (branchSize.height - operationSize.height) / 2),
  };
  const resultPosition = {
    x: branchPosition.x + operationSize.width + operationResultGap + (grouped ? resultGroupPadding.left : 0),
    y: branchPosition.y + Math.max(0, (branchSize.height - resultEnvelope.height) / 2)
      + (grouped ? resultGroupPadding.top : 0),
  };
  return { operationPosition, parentGroupId, resultPosition };
}

export function imageBranchDraftLayout(
  snapshot: BoardSnapshot,
  sourceBlock: BlockRecord,
  textSize: Size,
  operationSize: Size,
): ImageBranchDraftLayout {
  const sourceParent = sourceBlock.parentGroupId
    ? snapshot.blocks.find((block) => block.blockId === sourceBlock.parentGroupId && block.type === 'group')
    : undefined;
  const resultGroup = sourceParent?.data.groupKind === 'execution_results' ? sourceParent : undefined;
  const parentGroupId = resultGroup ? resultGroup.parentGroupId : sourceBlock.parentGroupId;
  const anchorBottom = resultGroup
    ? resultGroup.position.y + resultGroup.size.height
    : sourceBlock.position.y + sourceBlock.size.height;
  const textX = sourceBlock.position.x;
  const operationX = textX + Math.max(sourceBlock.size.width, textSize.width) + 100;
  const laneHeight = Math.max(
    textSize.height,
    operationSize.height,
    sourceBlock.size.height,
    mediaBlockMaxSide,
  ) + branchLaneOutputClearance;
  const scopeBlocks = snapshot.blocks.filter(
    (block) => block.parentGroupId === parentGroupId && block.blockId !== sourceBlock.blockId,
  );

  for (let lane = 0; lane < 200; lane += 1) {
    const y = anchorBottom + branchGap + lane * laneHeight;
    const textPosition = { x: textX, y };
    const operationPosition = { x: operationX, y };
    if (
      scopeBlocks.every(
        (block) =>
          !rectanglesOverlap(textPosition, textSize, block.position, block.size, collisionGap) &&
          !rectanglesOverlap(operationPosition, operationSize, block.position, block.size, collisionGap),
      )
    ) {
      return { operationPosition, parentGroupId, textPosition };
    }
  }

  return {
    operationPosition: { x: operationX, y: anchorBottom + branchGap },
    parentGroupId,
    textPosition: { x: textX, y: anchorBottom + branchGap },
  };
}

export function imageOperationResultRowLayout(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  resultSize: Size,
  count: number,
  excludedBlockIds: readonly string[] = [],
): ImageOperationResultRowLayout {
  const excluded = new Set([operationBlock.blockId, ...excludedBlockIds]);
  const scopeBlocks = snapshot.blocks.filter(
    (block) => block.parentGroupId === operationBlock.parentGroupId && !excluded.has(block.blockId),
  );
  const rowWidth = count * resultSize.width + Math.max(0, count - 1) * resultHorizontalGap;
  const grouped = count > 1;
  const candidateSize = {
    width: rowWidth + (grouped ? resultGroupPadding.left + resultGroupPadding.right : 0),
    height: resultSize.height + (grouped ? resultGroupPadding.top + resultGroupPadding.bottom : 0),
  };
  const baseX = operationBlock.position.x + operationBlock.size.width + 80;
  const baseY = operationBlock.position.y;
  const candidates = resultPlacementCandidates(operationBlock, candidateSize, grouped, baseX, baseY);

  for (const candidate of candidates) {
    const candidatePosition = {
      x: candidate.x - (grouped ? resultGroupPadding.left : 0),
      y: candidate.y - (grouped ? resultGroupPadding.top : 0),
    };
    if (scopeBlocks.every(
      (block) => !rectanglesOverlap(candidatePosition, candidateSize, block.position, block.size, collisionGap),
    )) {
      return { x: candidate.x, y: candidate.y };
    }
  }

  return { x: baseX, y: baseY + candidateSize.height + 72 };
}

function resultPlacementCandidates(
  operationBlock: BlockRecord,
  candidateSize: Size,
  grouped: boolean,
  baseX: number,
  baseY: number,
): Array<Position & { score: number }> {
  const placementGap = 48;
  const horizontalStep = candidateSize.width + placementGap;
  const verticalStep = candidateSize.height + placementGap;
  const groupLeft = grouped ? resultGroupPadding.left : 0;
  const groupTop = grouped ? resultGroupPadding.top : 0;
  const candidates: Array<Position & { score: number; order: number }> = [];
  const seen = new Set<string>();
  let order = 0;

  function addCandidate(position: Position, directionPenalty: number): void {
    const key = `${position.x}:${position.y}`;
    if (seen.has(key)) return;
    seen.add(key);
    const dx = position.x - baseX;
    const dy = position.y - baseY;
    candidates.push({
      ...position,
      order: order++,
      score: Math.hypot(dx, dy) + directionPenalty,
    });
  }

  for (let column = 0; column < 24; column += 1) {
    addCandidate({ x: baseX + column * horizontalStep, y: baseY }, 0);
    for (let row = 1; row < 24; row += 1) {
      addCandidate({ x: baseX + column * horizontalStep, y: baseY - row * verticalStep }, 12);
      addCandidate({ x: baseX + column * horizontalStep, y: baseY + row * verticalStep }, 24);
    }
  }

  for (let distance = 1; distance <= 50; distance += 1) {
    const verticalDistance = candidateSize.height + placementGap + (distance - 1) * verticalStep;
    addCandidate({
      x: operationBlock.position.x + groupLeft,
      y: operationBlock.position.y - verticalDistance + groupTop,
    }, 36);
    addCandidate({
      x: operationBlock.position.x + groupLeft,
      y: operationBlock.position.y + operationBlock.size.height + placementGap + (distance - 1) * verticalStep + groupTop,
    }, 48);
  }

  return candidates
    .sort((left, right) => left.score - right.score || left.order - right.order)
    .map(({ x, y, score }) => ({ x, y, score }));
}

function rectanglesOverlap(
  leftPosition: Position,
  leftSize: Size,
  rightPosition: Position,
  rightSize: Size,
  gap: number,
): boolean {
  return !(
    leftPosition.x + leftSize.width + gap <= rightPosition.x ||
    rightPosition.x + rightSize.width + gap <= leftPosition.x ||
    leftPosition.y + leftSize.height + gap <= rightPosition.y ||
    rightPosition.y + rightSize.height + gap <= leftPosition.y
  );
}
