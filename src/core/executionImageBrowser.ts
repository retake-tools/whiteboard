import type { AssetRecord, BlockRecord, BoardSnapshot } from './types';
import { connectedWorkflowBlockIds } from './workflowSelection';

export interface ExecutionImageBrowserItem {
  asset: AssetRecord;
  block: BlockRecord;
}

export function executionImageBrowserItems(
  snapshot: BoardSnapshot,
  startBlockId: string,
): ExecutionImageBrowserItem[] {
  const executionImageBlockIds = new Set(
    snapshot.executions.flatMap((execution) => execution.outputBlockIds),
  );
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const assetById = new Map(snapshot.assets.map((asset) => [asset.assetId, asset]));

  return connectedWorkflowBlockIds(snapshot, startBlockId).flatMap((blockId) => {
    const block = blockById.get(blockId);
    if (
      block?.type !== 'image'
      || (
        typeof block.data.sourceExecutionId !== 'string'
        && !executionImageBlockIds.has(block.blockId)
      )
    ) return [];
    const assetId = typeof block.data.assetId === 'string' ? block.data.assetId : undefined;
    const asset = assetId ? assetById.get(assetId) : undefined;
    return asset?.kind === 'image' ? [{ asset, block }] : [];
  });
}
