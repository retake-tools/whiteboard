import type { BlockRecord } from './types';

const attachmentGap = 28;
const attachmentMaxRowWidth = 760;

export function layoutAttachmentBlocks(
  blocks: BlockRecord[],
  center: { x: number; y: number },
): void {
  if (blocks.length === 0) return;
  const rows = packAttachmentRows(blocks);
  const width = rows.reduce((max, row) => Math.max(max, row.width), 0);
  const height = rows.reduce(
    (sum, row, index) => sum + row.height + (index > 0 ? attachmentGap : 0),
    0,
  );
  let nextY = center.y - height / 2;
  for (const row of rows) {
    let nextX = center.x - row.width / 2;
    for (const block of row.blocks) {
      block.position = {
        x: nextX,
        y: nextY + (row.height - block.size.height) / 2,
      };
      nextX += block.size.width + attachmentGap;
    }
    nextY += row.height + attachmentGap;
  }
}

function packAttachmentRows(blocks: BlockRecord[]): Array<{
  blocks: BlockRecord[];
  height: number;
  width: number;
}> {
  const rows: Array<{
    blocks: BlockRecord[];
    height: number;
    width: number;
  }> = [];
  for (const block of blocks) {
    const row = rows.at(-1);
    const nextWidth = row
      ? row.width + attachmentGap + block.size.width
      : block.size.width;
    if (row && nextWidth <= attachmentMaxRowWidth) {
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
