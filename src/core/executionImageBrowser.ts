import type { AssetRecord, BlockRecord, BoardSnapshot } from './types';
import { connectedWorkflowBlockIds } from './workflowSelection';

export interface ExecutionImageBrowserItem {
  asset: AssetRecord;
  block: BlockRecord;
}

const browserItemsBySnapshot = new WeakMap<
  BoardSnapshot,
  Map<string, ExecutionImageBrowserItem[]>
>();

const focusItemsBySnapshot = new WeakMap<
  BoardSnapshot,
  Map<string, ExecutionImageBrowserItem[]>
>();

export function executionImageBrowserItems(
  snapshot: BoardSnapshot,
  startBlockId: string,
): ExecutionImageBrowserItem[] {
  const cachedItems = browserItemsBySnapshot.get(snapshot)?.get(startBlockId);
  if (cachedItems) return cachedItems;

  const executionImageBlockIds = new Set(
    snapshot.executions.flatMap((execution) => execution.outputBlockIds),
  );
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const assetById = new Map(snapshot.assets.map((asset) => [asset.assetId, asset]));

  const items = connectedWorkflowBlockIds(snapshot, startBlockId).flatMap((blockId) => {
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
  const cache = browserItemsBySnapshot.get(snapshot) ?? new Map();
  cache.set(startBlockId, items);
  items.forEach((item) => cache.set(item.block.blockId, items));
  browserItemsBySnapshot.set(snapshot, cache);
  return items;
}

/**
 * Returns the stable image lineage shown by Focus view.
 *
 * Execution inspectors intentionally browse generated outputs only. Focus view
 * additionally needs the canonical source image so moving from the source to an
 * edited result does not redefine the candidate/version queue underneath the
 * user. Reference-only images stay out of the lineage.
 */
export function focusImageBrowserItems(
  snapshot: BoardSnapshot,
  startBlockId: string,
): ExecutionImageBrowserItem[] {
  const cachedItems = focusItemsBySnapshot.get(snapshot)?.get(startBlockId);
  if (cachedItems) return cachedItems;

  const connectedBlockIds = connectedWorkflowBlockIds(snapshot, startBlockId);
  const connectedBlockIdSet = new Set(connectedBlockIds);
  const executionImageBlockIds = new Set(
    snapshot.executions.flatMap((execution) => execution.outputBlockIds),
  );
  const sourceImageBlockIds = new Set(
    snapshot.edges
      .filter((edge) => (
        edge.kind === 'execution_input'
        && edge.inputSlotId === 'source_image'
        && connectedBlockIdSet.has(edge.targetBlockId)
      ))
      .map((edge) => edge.sourceBlockId),
  );
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const assetById = new Map(snapshot.assets.map((asset) => [asset.assetId, asset]));
  const startBlockIsLineageMember = sourceImageBlockIds.has(startBlockId)
    || executionImageBlockIds.has(startBlockId)
    || typeof blockById.get(startBlockId)?.data.sourceExecutionId === 'string';

  const items = connectedBlockIds.flatMap((blockId) => {
    const block = blockById.get(blockId);
    const isLineageMember = blockId === startBlockId
      || sourceImageBlockIds.has(blockId)
      || executionImageBlockIds.has(blockId)
      || typeof block?.data.sourceExecutionId === 'string';
    if (block?.type !== 'image' || !isLineageMember) return [];
    const assetId = typeof block.data.assetId === 'string' ? block.data.assetId : undefined;
    const asset = assetId ? assetById.get(assetId) : undefined;
    return asset?.kind === 'image' ? [{ asset, block }] : [];
  });

  const cache = focusItemsBySnapshot.get(snapshot) ?? new Map();
  cache.set(startBlockId, items);
  if (startBlockIsLineageMember) {
    items.forEach((item) => cache.set(item.block.blockId, items));
  }
  focusItemsBySnapshot.set(snapshot, cache);
  return items;
}
