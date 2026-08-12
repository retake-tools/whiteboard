import { createId, nowIso } from '../../core/id';
import { activeExecutionsForBlockIds } from '../../core/executionLifecycle';
import {
  blockLockedByGroup,
  blockManagedByWorkflowGroup,
  descendantBlockIds,
  groupStructureLocked,
} from '../../core/grouping';
import type {
  BlockRecord,
  BoardEdgeRecord,
  BoardSnapshot,
} from '../../core/types';
import type {
  ConnectBlocksCommandV1,
  MoveBlocksCommandV1,
  RemoveBlocksCommandV1,
  RemoveConnectionsCommandV1,
  ResizeBlockCommandV1,
  UpdateBlockCommandV1,
} from '../contracts';

export function moveBlocks(
  snapshot: BoardSnapshot,
  command: MoveBlocksCommandV1,
): string[] {
  const movedIds: string[] = [];
  const seen = new Set<string>();
  for (const move of command.moves) {
    if (seen.has(move.blockId)) throw new Error(`Duplicate Block move: ${move.blockId}.`);
    seen.add(move.blockId);
    assertFinitePoint(move.position);
    const block = requireBlock(snapshot, move.blockId);
    assertBlockPositionMutable(snapshot, block);
    block.position = { ...move.position };
    block.updatedAt = nowIso();
    movedIds.push(block.blockId);
  }
  return movedIds;
}

export function resizeBlock(
  snapshot: BoardSnapshot,
  command: ResizeBlockCommandV1,
): string {
  assertPositiveSize(command.size);
  const block = requireBlock(snapshot, command.blockId);
  if (block.type === 'group') {
    throw new Error(`Group must be resized through resizeGroup: ${block.blockId}.`);
  }
  if (
    blockLockedByGroup(snapshot, block.blockId)
    || blockManagedByWorkflowGroup(snapshot, block.blockId)
  ) {
    throw new Error(`Block cannot be resized: ${block.blockId}.`);
  }
  block.size = { ...command.size };
  block.updatedAt = nowIso();
  return block.blockId;
}

export function connectBlocks(
  snapshot: BoardSnapshot,
  command: ConnectBlocksCommandV1,
): BoardEdgeRecord {
  requireBlock(snapshot, command.sourceBlockId);
  requireBlock(snapshot, command.targetBlockId);
  if (command.sourceBlockId === command.targetBlockId) {
    throw new Error('A Block cannot connect to itself.');
  }
  const kind = command.kind ?? 'visual_note';
  const duplicate = snapshot.edges.find((edge) => (
    edge.sourceBlockId === command.sourceBlockId
    && edge.targetBlockId === command.targetBlockId
    && edge.kind === kind
    && edge.inputSlotId === command.inputSlotId
  ));
  if (duplicate) throw new Error(`Connection already exists: ${duplicate.edgeId}.`);
  const edge: BoardEdgeRecord = {
    edgeId: command.edgeId ?? createId('edge'),
    inputSlotId: command.inputSlotId,
    kind,
    sourceBlockId: command.sourceBlockId,
    targetBlockId: command.targetBlockId,
  };
  if (snapshot.edges.some((candidate) => candidate.edgeId === edge.edgeId)) {
    throw new Error(`Connection already exists: ${edge.edgeId}.`);
  }
  snapshot.edges.push(edge);
  return edge;
}

export function removeBlocks(
  snapshot: BoardSnapshot,
  command: RemoveBlocksCommandV1,
): string[] {
  const requestedIds = new Set(command.blockIds);
  for (const blockId of requestedIds) {
    const block = requireBlock(snapshot, blockId);
    if (
      blockLockedByGroup(snapshot, blockId)
      || blockManagedByWorkflowGroup(snapshot, blockId)
      || (block.type === 'group' && groupStructureLocked(snapshot, blockId))
    ) {
      throw new Error(`Block cannot be removed: ${blockId}.`);
    }
  }
  if (command.includeDescendants) {
    let changed = true;
    while (changed) {
      changed = false;
      for (const block of snapshot.blocks) {
        if (block.parentGroupId && requestedIds.has(block.parentGroupId) && !requestedIds.has(block.blockId)) {
          requestedIds.add(block.blockId);
          changed = true;
        }
      }
    }
  } else {
    const child = snapshot.blocks.find(
      (block) => block.parentGroupId && requestedIds.has(block.parentGroupId) && !requestedIds.has(block.blockId),
    );
    if (child) throw new Error(`Block ${child.parentGroupId} still contains child ${child.blockId}.`);
  }
  const groupIds = [...requestedIds].filter(
    (blockId) => snapshot.blocks.find((block) => block.blockId === blockId)?.type === 'group',
  );
  const removalScope = [...requestedIds, ...descendantBlockIds(snapshot, groupIds)];
  const activeExecutions = activeExecutionsForBlockIds(snapshot, removalScope);
  if (activeExecutions.length > 0) {
    throw new Error(
      `Block removal requires active Execution cancellation: ${activeExecutions[0]!.executionId}.`,
    );
  }
  snapshot.blocks = snapshot.blocks.filter((block) => !requestedIds.has(block.blockId));
  snapshot.edges = snapshot.edges.filter(
    (edge) => !requestedIds.has(edge.sourceBlockId) && !requestedIds.has(edge.targetBlockId),
  );
  for (const execution of snapshot.executions) {
    execution.inputBlockIds = execution.inputBlockIds.filter((blockId) => !requestedIds.has(blockId));
    execution.outputBlockIds = execution.outputBlockIds.filter((blockId) => !requestedIds.has(blockId));
  }
  return [...requestedIds];
}

export function removeConnections(
  snapshot: BoardSnapshot,
  command: RemoveConnectionsCommandV1,
): string[] {
  const edgeIds = [...new Set(command.edgeIds)];
  for (const edgeId of edgeIds) {
    if (!snapshot.edges.some((edge) => edge.edgeId === edgeId)) {
      throw new Error(`Connection not found: ${edgeId}.`);
    }
  }
  const removed = new Set(edgeIds);
  snapshot.edges = snapshot.edges.filter((edge) => !removed.has(edge.edgeId));
  return edgeIds;
}

export function updateBlock(
  snapshot: BoardSnapshot,
  command: UpdateBlockCommandV1,
): string {
  const block = requireBlock(snapshot, command.blockId);
  if (
    command.body === undefined
    && command.data === undefined
    && command.title === undefined
  ) {
    throw new Error('Block update must include body, data, or title.');
  }
  block.data = {
    ...block.data,
    ...structuredClone(command.data ?? {}),
    ...(command.body === undefined ? {} : { body: command.body }),
    ...(command.title === undefined ? {} : { title: command.title }),
  };
  block.updatedAt = nowIso();
  return block.blockId;
}

function requireBlock(snapshot: BoardSnapshot, blockId: string): BlockRecord {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  if (!block) throw new Error(`Block not found: ${blockId}.`);
  return block;
}

function assertBlockPositionMutable(snapshot: BoardSnapshot, block: BlockRecord): void {
  if (
    blockLockedByGroup(snapshot, block.blockId)
    || blockManagedByWorkflowGroup(snapshot, block.blockId)
    || (
      block.type === 'group'
      && (block.data.groupKind === 'workflow' || block.data.groupPositionLocked)
    )
  ) {
    throw new Error(`Block cannot be moved: ${block.blockId}.`);
  }
}

function assertFinitePoint(point: { readonly x: number; readonly y: number }): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('Block position must contain finite coordinates.');
  }
}

function assertPositiveSize(size: { readonly height: number; readonly width: number }): void {
  if (
    !Number.isFinite(size.height)
    || !Number.isFinite(size.width)
    || size.height <= 0
    || size.width <= 0
  ) {
    throw new Error('Block size must contain positive finite dimensions.');
  }
}
