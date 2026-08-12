import { nowIso } from '../../core/id';
import type { BlockRecord, BoardSnapshot } from '../../core/types';
import { moveBlockGroupToNearestFreeArea } from '../../core/workflowPlacement';

export interface ImageComposerWorkflowLayoutInput {
  operationBlockId: string;
  outputSlotBlockId?: string;
  referenceBlockIds: string[];
  textBlockId: string;
}

interface ImageComposerWorkflowLayoutBlock {
  blockId: string;
  size: BlockRecord['size'];
}

interface ImageComposerWorkflowGeometryInput {
  center: { x: number; y: number };
  operationBlock: ImageComposerWorkflowLayoutBlock;
  outputSlotBlock?: ImageComposerWorkflowLayoutBlock;
  referenceBlocks: ImageComposerWorkflowLayoutBlock[];
  textBlock: ImageComposerWorkflowLayoutBlock;
}

export interface ImageComposerWorkflowGeometry {
  blockIds: string[];
  positions: Record<string, { x: number; y: number }>;
}

const inputColumnGap = 32;
const inputRowGap = 28;
const inputStageMaxRowWidth = 760;
const workflowColumnGap = 80;

export function applyWhiteboardImageComposerLayout(
  snapshot: BoardSnapshot,
  input: ImageComposerWorkflowLayoutInput,
  center: { x: number; y: number },
): void {
  const operationBlock = snapshot.blocks.find(
    (block) => block.blockId === input.operationBlockId,
  );
  const textBlock = snapshot.blocks.find(
    (block) => block.blockId === input.textBlockId,
  );
  if (!operationBlock || !textBlock) return;
  const outputSlotBlock = input.outputSlotBlockId
    ? snapshot.blocks.find((block) => block.blockId === input.outputSlotBlockId)
    : undefined;
  const referenceBlocks = input.referenceBlockIds
    .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
    .filter((block): block is BlockRecord => block?.type === 'image');
  const geometry = imageComposerWorkflowGeometry({
    center,
    operationBlock,
    outputSlotBlock,
    referenceBlocks,
    textBlock,
  });
  const positionedBlocks = geometry.blockIds
    .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
    .filter((block): block is BlockRecord => Boolean(block));
  const updatedAt = nowIso();
  for (const block of positionedBlocks) {
    const position = geometry.positions[block.blockId];
    if (!position) continue;
    block.position = position;
    block.updatedAt = updatedAt;
  }
  moveBlockGroupToNearestFreeArea(snapshot, positionedBlocks, center);
}

export function imageComposerWorkflowLayoutBlockIds(
  input: ImageComposerWorkflowLayoutInput,
): string[] {
  return [
    ...input.referenceBlockIds,
    input.textBlockId,
    input.operationBlockId,
    ...(input.outputSlotBlockId ? [input.outputSlotBlockId] : []),
  ];
}

export function imageComposerWorkflowGeometry(
  input: ImageComposerWorkflowGeometryInput,
): ImageComposerWorkflowGeometry {
  const referenceRows = packReferenceRows(input.referenceBlocks);
  const referenceWidth = referenceRows.reduce(
    (max, row) => Math.max(max, row.width),
    0,
  );
  const referenceHeight = referenceRows.reduce(
    (sum, row, index) => sum + row.height + (index > 0 ? inputRowGap : 0),
    0,
  );
  const inputStageWidth = Math.max(input.textBlock.size.width, referenceWidth);
  const inputStageHeight = input.textBlock.size.height
    + (referenceRows.length > 0 ? inputColumnGap + referenceHeight : 0);
  const outputWidth = input.outputSlotBlock
    ? workflowColumnGap + input.outputSlotBlock.size.width
    : 0;
  const workflowWidth = inputStageWidth
    + workflowColumnGap
    + input.operationBlock.size.width
    + outputWidth;
  const workflowHeight = Math.max(
    inputStageHeight,
    input.operationBlock.size.height,
    input.outputSlotBlock?.size.height ?? 0,
  );
  const workflowLeft = input.center.x - workflowWidth / 2;
  const workflowTop = input.center.y - workflowHeight / 2;
  const inputStageTop = workflowTop + (workflowHeight - inputStageHeight) / 2;
  const positions: ImageComposerWorkflowGeometry['positions'] = {
    [input.textBlock.blockId]: {
      x: workflowLeft + (inputStageWidth - input.textBlock.size.width) / 2,
      y: inputStageTop,
    },
    [input.operationBlock.blockId]: {
      x: workflowLeft + inputStageWidth + workflowColumnGap,
      y: workflowTop + (workflowHeight - input.operationBlock.size.height) / 2,
    },
  };

  let nextReferenceY = inputStageTop + input.textBlock.size.height + inputColumnGap;
  for (const row of referenceRows) {
    let nextReferenceX = workflowLeft + (inputStageWidth - row.width) / 2;
    for (const block of row.blocks) {
      positions[block.blockId] = {
        x: nextReferenceX,
        y: nextReferenceY + (row.height - block.size.height) / 2,
      };
      nextReferenceX += block.size.width + inputRowGap;
    }
    nextReferenceY += row.height + inputRowGap;
  }

  if (input.outputSlotBlock) {
    positions[input.outputSlotBlock.blockId] = {
      x: workflowLeft
        + inputStageWidth
        + workflowColumnGap
        + input.operationBlock.size.width
        + workflowColumnGap,
      y: workflowTop + (workflowHeight - input.outputSlotBlock.size.height) / 2,
    };
  }

  return {
    blockIds: imageComposerWorkflowLayoutBlockIds({
      operationBlockId: input.operationBlock.blockId,
      outputSlotBlockId: input.outputSlotBlock?.blockId,
      referenceBlockIds: input.referenceBlocks.map((block) => block.blockId),
      textBlockId: input.textBlock.blockId,
    }),
    positions,
  };
}

function packReferenceRows(
  blocks: ImageComposerWorkflowLayoutBlock[],
): Array<{
  blocks: ImageComposerWorkflowLayoutBlock[];
  height: number;
  width: number;
}> {
  const rows: Array<{
    blocks: ImageComposerWorkflowLayoutBlock[];
    height: number;
    width: number;
  }> = [];
  for (const block of blocks) {
    const row = rows.at(-1);
    const nextWidth = row
      ? row.width + inputRowGap + block.size.width
      : block.size.width;
    if (row && nextWidth <= inputStageMaxRowWidth) {
      row.blocks.push(block);
      row.height = Math.max(row.height, block.size.height);
      row.width = nextWidth;
      continue;
    }
    rows.push({
      blocks: [block],
      height: block.size.height,
      width: block.size.width,
    });
  }
  return rows;
}
