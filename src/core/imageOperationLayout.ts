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
  const horizontalStep = candidateSize.width + 72;
  const verticalStep = candidateSize.height + 72;
  const groupLeft = grouped ? resultGroupPadding.left : 0;
  const groupTop = grouped ? resultGroupPadding.top : 0;
  const candidates: Array<Position & { score: number }> = [];

  for (let distance = 0; distance < 50; distance += 1) {
    candidates.push({
      x: baseX + distance * horizontalStep,
      y: baseY,
      score: distance * horizontalStep,
    });
  }
  for (let distance = 1; distance <= 50; distance += 1) {
    const verticalDistance = 80 + candidateSize.height + (distance - 1) * verticalStep;
    candidates.push({
      x: operationBlock.position.x + groupLeft,
      y: operationBlock.position.y - verticalDistance + groupTop,
      score: verticalDistance + 48,
    });
    candidates.push({
      x: operationBlock.position.x + groupLeft,
      y: operationBlock.position.y + operationBlock.size.height + 80 + (distance - 1) * verticalStep + groupTop,
      score: verticalDistance + 80,
    });
  }

  return candidates.sort((left, right) => left.score - right.score);
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
