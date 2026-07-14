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
