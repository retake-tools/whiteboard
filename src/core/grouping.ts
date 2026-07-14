import { maxZIndex } from './blockFactory';
import { createId, nowIso } from './id';
import type {
  AssetRecord,
  BlockRecord,
  BoardSnapshot,
  GroupColor,
  GroupKind,
  GroupLayoutMode,
} from './types';

export interface GroupMediaItem {
  asset: AssetRecord;
  block: BlockRecord;
}

const groupPadding = { top: 48, right: 28, bottom: 28, left: 28 };
const minimumGroupSize = { width: 260, height: 180 };

export interface GroupBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface GroupBoundsContext {
  candidateBlocks: BlockRecord[];
  locked: boolean;
  parentGroupId?: string;
}

interface CreateGroupOptions {
  color?: GroupColor;
  executionId?: string;
  kind?: GroupKind;
  layoutMode?: GroupLayoutMode;
  title?: string;
}

export function isGroupBlock(block: BlockRecord | undefined): block is BlockRecord {
  return block?.type === 'group';
}

export function createGroupAroundBlocks(
  snapshot: BoardSnapshot,
  blockIds: readonly string[],
  options: CreateGroupOptions = {},
): BlockRecord | undefined {
  const selectedIds = new Set(blockIds);
  const selectedBlocks = snapshot.blocks.filter((block) => selectedIds.has(block.blockId));
  const topLevelBlocks = selectedBlocks.filter(
    (block) => !blockHasSelectedAncestor(snapshot, block, selectedIds),
  );
  if (topLevelBlocks.length === 0 || topLevelBlocks.some((block) => !canWrapBlock(snapshot, block))) return undefined;

  const parentIds = new Set(topLevelBlocks.map((block) => block.parentGroupId));
  if (parentIds.size !== 1) return undefined;
  const parentGroupId = topLevelBlocks[0].parentGroupId;
  if (parentGroupId) {
    const parentGroup = snapshot.blocks.find((block) => block.blockId === parentGroupId && block.type === 'group');
    if (parentGroup?.data.groupContentsLocked || blockLockedByGroup(snapshot, parentGroupId)) return undefined;
  }
  const bounds = boundsForBlocks(topLevelBlocks);
  const createdAt = nowIso();
  const group: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'group',
    layerId: 'layer_default',
    parentGroupId,
    position: {
      x: bounds.minX - groupPadding.left,
      y: bounds.minY - groupPadding.top,
    },
    size: {
      width: Math.max(minimumGroupSize.width, bounds.maxX - bounds.minX + groupPadding.left + groupPadding.right),
      height: Math.max(minimumGroupSize.height, bounds.maxY - bounds.minY + groupPadding.top + groupPadding.bottom),
    },
    zIndex: Math.min(...topLevelBlocks.map((block) => block.zIndex), maxZIndex(snapshot.blocks)) - 1,
    data: {
      title: options.title ?? 'Group',
      groupColor: options.color ?? 'neutral',
      groupExecutionId: options.executionId,
      groupKind: options.kind ?? 'manual',
      groupLayoutMode: options.layoutMode ?? 'free',
    },
    createdAt,
    updatedAt: createdAt,
  };

  for (const block of topLevelBlocks) {
    block.parentGroupId = group.blockId;
    block.updatedAt = createdAt;
  }
  snapshot.blocks.push(group);
  if (parentGroupId) expandGroupToContain(snapshot, parentGroupId);
  return group;
}

export function createGroupFromBounds(
  snapshot: BoardSnapshot,
  bounds: GroupBounds,
  options: CreateGroupOptions = {},
  excludedGroupIds: readonly string[] = [],
): BlockRecord | undefined {
  const normalizedBounds = normalizeBounds(bounds);
  const context = groupBoundsContext(snapshot, normalizedBounds, excludedGroupIds);
  if (context.locked) return undefined;
  const createdAt = nowIso();
  const group: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'group',
    layerId: 'layer_default',
    parentGroupId: context.parentGroupId,
    position: { x: normalizedBounds.x, y: normalizedBounds.y },
    size: {
      width: Math.max(minimumGroupSize.width, normalizedBounds.width),
      height: Math.max(minimumGroupSize.height, normalizedBounds.height),
    },
    zIndex: context.candidateBlocks.length
      ? Math.min(...context.candidateBlocks.map((block) => block.zIndex)) - 1
      : maxZIndex(snapshot.blocks) + 1,
    data: {
      title: options.title ?? 'Group',
      groupColor: options.color ?? 'neutral',
      groupExecutionId: options.executionId,
      groupKind: options.kind ?? 'manual',
      groupLayoutMode: options.layoutMode ?? 'free',
    },
    createdAt,
    updatedAt: createdAt,
  };
  for (const block of context.candidateBlocks) {
    block.parentGroupId = group.blockId;
    block.updatedAt = createdAt;
  }
  snapshot.blocks.push(group);
  if (context.parentGroupId) expandGroupToContain(snapshot, context.parentGroupId);
  return group;
}

export function groupBoundsContext(
  snapshot: BoardSnapshot,
  bounds: GroupBounds,
  excludedGroupIds: readonly string[] = [],
): GroupBoundsContext {
  const normalizedBounds = normalizeBounds(bounds);
  const excludedIds = new Set(excludedGroupIds);
  const containingGroups = snapshot.blocks
    .filter(
      (block) =>
        block.type === 'group' &&
        !excludedIds.has(block.blockId) &&
        containsBounds(blockBounds(block), normalizedBounds),
    )
    .sort((left, right) => groupAncestorIds(snapshot, right.blockId).length - groupAncestorIds(snapshot, left.blockId).length);
  const parentGroup = containingGroups[0];
  const locked = Boolean(
    parentGroup && (parentGroup.data.groupContentsLocked || blockLockedByGroup(snapshot, parentGroup.blockId)),
  );
  if (locked) return { candidateBlocks: [], locked: true, parentGroupId: parentGroup?.blockId };

  const candidateBlocks = snapshot.blocks.filter((block) => {
    if (block.parentGroupId !== parentGroup?.blockId) return false;
    if (block.blockId === parentGroup?.blockId || excludedIds.has(block.blockId)) return false;
    if (!containsBounds(normalizedBounds, blockBounds(block))) return false;
    return canWrapBlock(snapshot, block);
  });
  return { candidateBlocks, locked: false, parentGroupId: parentGroup?.blockId };
}

export function createExecutionResultGroup(
  snapshot: BoardSnapshot,
  input: {
    executionId: string;
    operationBlock: BlockRecord;
    resultBlocks: readonly BlockRecord[];
  },
): BlockRecord | undefined {
  if (input.resultBlocks.length < 2) {
    for (const block of input.resultBlocks) block.parentGroupId = input.operationBlock.parentGroupId;
    return undefined;
  }

  const existing = snapshot.blocks.find(
    (block) => block.type === 'group' && block.data.groupExecutionId === input.executionId,
  );
  if (existing) return existing;

  for (const block of input.resultBlocks) block.parentGroupId = input.operationBlock.parentGroupId;

  return createGroupAroundBlocks(
    snapshot,
    input.resultBlocks.map((block) => block.blockId),
    {
      color: 'blue',
      executionId: input.executionId,
      kind: 'execution_results',
      layoutMode: 'row',
      title: 'Execution results',
    },
  );
}

export function ensureExecutionResultGroups(snapshot: BoardSnapshot): void {
  for (const execution of snapshot.executions) {
    if (execution.outputBlockIds.length < 2) continue;
    const operationBlockId =
      typeof execution.params?.operationBlockId === 'string' ? execution.params.operationBlockId : undefined;
    const operationBlock = snapshot.blocks.find((block) => block.blockId === operationBlockId && block.type === 'operation');
    if (!operationBlock) continue;
    const resultBlocks = execution.outputBlockIds
      .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
      .filter(
        (block): block is BlockRecord =>
          block?.type === 'image' && block.data.sourceExecutionId === execution.executionId,
      );
    if (resultBlocks.length !== execution.outputBlockIds.length) continue;
    createExecutionResultGroup(snapshot, { executionId: execution.executionId, operationBlock, resultBlocks });
  }
}

export function directGroupChildren(snapshot: BoardSnapshot, groupId: string): BlockRecord[] {
  return snapshot.blocks.filter((block) => block.parentGroupId === groupId);
}

export function descendantBlockIds(snapshot: BoardSnapshot, groupIds: readonly string[]): string[] {
  const descendants = new Set<string>();
  const queue = [...groupIds];
  while (queue.length > 0) {
    const groupId = queue.shift();
    if (!groupId) continue;
    for (const child of directGroupChildren(snapshot, groupId)) {
      if (descendants.has(child.blockId)) continue;
      descendants.add(child.blockId);
      if (child.type === 'group') queue.push(child.blockId);
    }
  }
  return [...descendants];
}

export function groupSelectionScopeBlockIds(snapshot: BoardSnapshot, selectedBlockIds: readonly string[]): string[] {
  const selectedGroupIds = selectedBlockIds.filter(
    (blockId) => snapshot.blocks.find((block) => block.blockId === blockId)?.type === 'group',
  );
  return [...new Set([...selectedBlockIds, ...descendantBlockIds(snapshot, selectedGroupIds)])];
}

export function blockLockedByGroup(snapshot: BoardSnapshot, blockId: string): boolean {
  return groupAncestorIds(snapshot, blockId).some((groupId) => {
    const group = snapshot.blocks.find((block) => block.blockId === groupId && block.type === 'group');
    return group?.data.groupContentsLocked === true;
  });
}

export function groupStructureLocked(snapshot: BoardSnapshot, groupId: string): boolean {
  const group = snapshot.blocks.find((block) => block.blockId === groupId && block.type === 'group');
  return Boolean(
    group &&
    (group.data.groupPositionLocked || group.data.groupContentsLocked || blockLockedByGroup(snapshot, groupId)),
  );
}

export function findGroupDropTarget(
  snapshot: BoardSnapshot,
  blockId: string,
  bounds: GroupBounds,
  excludedGroupIds: readonly string[] = [],
): string | undefined {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  if (!block || !canDragToGroup(snapshot, block)) return block?.parentGroupId;
  const excludedIds = new Set(excludedGroupIds);
  excludedIds.add(blockId);
  if (block.type === 'group') {
    for (const descendantId of descendantBlockIds(snapshot, [blockId])) excludedIds.add(descendantId);
  }
  return snapshot.blocks
    .filter(
      (candidate) =>
        candidate.type === 'group' &&
        !excludedIds.has(candidate.blockId) &&
        !candidate.data.groupContentsLocked &&
        !blockLockedByGroup(snapshot, candidate.blockId) &&
        containsBounds(blockBounds(candidate), normalizeBounds(bounds)),
    )
    .sort((left, right) => groupAncestorIds(snapshot, right.blockId).length - groupAncestorIds(snapshot, left.blockId).length)[0]
    ?.blockId;
}

export function groupMediaItems(snapshot: BoardSnapshot, groupId: string): GroupMediaItem[] {
  const descendantIds = new Set(descendantBlockIds(snapshot, [groupId]));
  const assetById = new Map(snapshot.assets.map((asset) => [asset.assetId, asset]));
  return snapshot.blocks
    .filter((block) => descendantIds.has(block.blockId) && (block.type === 'image' || block.type === 'video'))
    .flatMap((block) => {
      const assetId = typeof block.data.assetId === 'string' ? block.data.assetId : undefined;
      const asset = assetId ? assetById.get(assetId) : undefined;
      if (!asset || (asset.kind !== 'image' && asset.kind !== 'video')) return [];
      return [{ asset, block }];
    })
    .sort((left, right) => left.block.position.y - right.block.position.y || left.block.position.x - right.block.position.x);
}

export function fitGroupToChildren(snapshot: BoardSnapshot, groupId: string): BlockRecord | undefined {
  const group = snapshot.blocks.find((block) => block.blockId === groupId && block.type === 'group');
  if (!group) return undefined;
  const children = directGroupChildren(snapshot, groupId);
  if (children.length === 0) return group;
  const bounds = boundsForBlocks(children);
  group.position = { x: bounds.minX - groupPadding.left, y: bounds.minY - groupPadding.top };
  group.size = {
    width: Math.max(minimumGroupSize.width, bounds.maxX - bounds.minX + groupPadding.left + groupPadding.right),
    height: Math.max(minimumGroupSize.height, bounds.maxY - bounds.minY + groupPadding.top + groupPadding.bottom),
  };
  group.updatedAt = nowIso();
  if (group.parentGroupId) expandGroupToContain(snapshot, group.parentGroupId);
  return group;
}

export function arrangeGroupChildren(
  snapshot: BoardSnapshot,
  groupId: string,
  layoutMode: GroupLayoutMode,
): BlockRecord | undefined {
  const group = snapshot.blocks.find((block) => block.blockId === groupId && block.type === 'group');
  if (!group || groupStructureLocked(snapshot, groupId)) return undefined;
  group.data.groupLayoutMode = layoutMode;
  const children = directGroupChildren(snapshot, groupId);
  if (layoutMode === 'free' || children.length === 0) {
    group.updatedAt = nowIso();
    return group;
  }

  const gap = 24;
  const origin = { x: group.position.x + groupPadding.left, y: group.position.y + groupPadding.top };
  const updatedAt = nowIso();
  if (layoutMode === 'row') {
    let x = origin.x;
    for (const child of children) {
      moveBlockWithDescendants(snapshot, child, { x, y: origin.y }, updatedAt);
      x += child.size.width + gap;
    }
  } else {
    const columns = Math.max(1, Math.ceil(Math.sqrt(children.length)));
    const cellWidth = Math.max(...children.map((child) => child.size.width));
    const cellHeight = Math.max(...children.map((child) => child.size.height));
    children.forEach((child, index) => {
      moveBlockWithDescendants(snapshot, child, {
        x: origin.x + (index % columns) * (cellWidth + gap),
        y: origin.y + Math.floor(index / columns) * (cellHeight + gap),
      }, updatedAt);
    });
  }
  group.updatedAt = updatedAt;
  return fitGroupToChildren(snapshot, groupId);
}

export function groupMinimumDimensions(snapshot: BoardSnapshot, groupId: string): { height: number; width: number } {
  const group = snapshot.blocks.find((block) => block.blockId === groupId && block.type === 'group');
  if (!group) return minimumGroupSize;
  const children = directGroupChildren(snapshot, groupId);
  if (children.length === 0) return minimumGroupSize;
  const maxX = Math.max(...children.map((child) => child.position.x + child.size.width));
  const maxY = Math.max(...children.map((child) => child.position.y + child.size.height));
  return {
    width: Math.max(minimumGroupSize.width, maxX - group.position.x + groupPadding.right),
    height: Math.max(minimumGroupSize.height, maxY - group.position.y + groupPadding.bottom),
  };
}

export function dissolveGroup(snapshot: BoardSnapshot, groupId: string): string[] {
  const group = snapshot.blocks.find((block) => block.blockId === groupId && block.type === 'group');
  if (!group) return [];
  const childIds: string[] = [];
  for (const child of directGroupChildren(snapshot, groupId)) {
    child.parentGroupId = group.parentGroupId;
    child.updatedAt = nowIso();
    childIds.push(child.blockId);
  }
  snapshot.blocks = snapshot.blocks.filter((block) => block.blockId !== groupId);
  if (group.parentGroupId) fitGroupToChildren(snapshot, group.parentGroupId);
  return childIds;
}

export function repairGroupRelationships(snapshot: BoardSnapshot): void {
  const groupIds = new Set(snapshot.blocks.filter((block) => block.type === 'group').map((block) => block.blockId));
  for (const block of snapshot.blocks) {
    if (!block.parentGroupId) continue;
    if (!groupIds.has(block.parentGroupId) || block.parentGroupId === block.blockId) {
      delete block.parentGroupId;
      continue;
    }
    if (block.type === 'group' && groupAncestorIds(snapshot, block.parentGroupId).includes(block.blockId)) {
      delete block.parentGroupId;
    }
  }
}

export function groupAncestorIds(snapshot: BoardSnapshot, blockId: string): string[] {
  const ancestors: string[] = [];
  const visited = new Set<string>();
  let current = snapshot.blocks.find((block) => block.blockId === blockId);
  while (current?.parentGroupId && !visited.has(current.parentGroupId)) {
    visited.add(current.parentGroupId);
    ancestors.push(current.parentGroupId);
    current = snapshot.blocks.find((block) => block.blockId === current?.parentGroupId);
  }
  return ancestors;
}

function expandGroupToContain(snapshot: BoardSnapshot, groupId: string): void {
  const group = snapshot.blocks.find((block) => block.blockId === groupId && block.type === 'group');
  if (!group) return;
  const children = directGroupChildren(snapshot, groupId);
  if (children.length === 0) return;
  const bounds = boundsForBlocks(children);
  const nextMinX = Math.min(group.position.x, bounds.minX - groupPadding.left);
  const nextMinY = Math.min(group.position.y, bounds.minY - groupPadding.top);
  const currentMaxX = group.position.x + group.size.width;
  const currentMaxY = group.position.y + group.size.height;
  const nextMaxX = Math.max(currentMaxX, bounds.maxX + groupPadding.right);
  const nextMaxY = Math.max(currentMaxY, bounds.maxY + groupPadding.bottom);
  group.position = { x: nextMinX, y: nextMinY };
  group.size = { width: nextMaxX - nextMinX, height: nextMaxY - nextMinY };
  group.updatedAt = nowIso();
  if (group.parentGroupId) expandGroupToContain(snapshot, group.parentGroupId);
}

export function expandGroupToContents(snapshot: BoardSnapshot, groupId: string): void {
  expandGroupToContain(snapshot, groupId);
}

function blockHasSelectedAncestor(snapshot: BoardSnapshot, block: BlockRecord, selectedIds: Set<string>): boolean {
  return groupAncestorIds(snapshot, block.blockId).some((groupId) => selectedIds.has(groupId));
}

function boundsForBlocks(blocks: readonly BlockRecord[]): { minX: number; minY: number; maxX: number; maxY: number } {
  return {
    minX: Math.min(...blocks.map((block) => block.position.x)),
    minY: Math.min(...blocks.map((block) => block.position.y)),
    maxX: Math.max(...blocks.map((block) => block.position.x + block.size.width)),
    maxY: Math.max(...blocks.map((block) => block.position.y + block.size.height)),
  };
}

function canWrapBlock(snapshot: BoardSnapshot, block: BlockRecord): boolean {
  return !blockLockedByGroup(snapshot, block.blockId);
}

function canDragToGroup(snapshot: BoardSnapshot, block: BlockRecord): boolean {
  if (blockLockedByGroup(snapshot, block.blockId)) return false;
  return block.type !== 'group' || !block.data.groupPositionLocked;
}

function moveBlockWithDescendants(
  snapshot: BoardSnapshot,
  block: BlockRecord,
  position: { x: number; y: number },
  updatedAt: string,
): void {
  const delta = { x: position.x - block.position.x, y: position.y - block.position.y };
  block.position = position;
  block.updatedAt = updatedAt;
  if (block.type !== 'group' || (delta.x === 0 && delta.y === 0)) return;
  const descendantIds = new Set(descendantBlockIds(snapshot, [block.blockId]));
  for (const descendant of snapshot.blocks) {
    if (!descendantIds.has(descendant.blockId)) continue;
    descendant.position = {
      x: descendant.position.x + delta.x,
      y: descendant.position.y + delta.y,
    };
    descendant.updatedAt = updatedAt;
  }
}

function blockBounds(block: BlockRecord): GroupBounds {
  return { x: block.position.x, y: block.position.y, width: block.size.width, height: block.size.height };
}

function containsBounds(container: GroupBounds, item: GroupBounds): boolean {
  return (
    item.x >= container.x &&
    item.y >= container.y &&
    item.x + item.width <= container.x + container.width &&
    item.y + item.height <= container.y + container.height
  );
}

function normalizeBounds(bounds: GroupBounds): GroupBounds {
  return {
    x: bounds.width < 0 ? bounds.x + bounds.width : bounds.x,
    y: bounds.height < 0 ? bounds.y + bounds.height : bounds.y,
    width: Math.abs(bounds.width),
    height: Math.abs(bounds.height),
  };
}
