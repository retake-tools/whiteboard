import {
  arrangeGroupChildren,
  blockLockedByGroup,
  createGroupAroundBlocks,
  dissolveGroup as dissolveGroupRecord,
  expandGroupToContents,
  fitGroupToChildren,
  groupStructureLocked,
} from '../../core/grouping';
import { nowIso } from '../../core/id';
import type { BlockRecord, BoardSnapshot } from '../../core/types';
import type {
  CreateGroupCommandV1,
  DissolveGroupCommandV1,
  FitGroupCommandV1,
  LayoutGroupCommandV1,
  ResizeGroupCommandV1,
  UpdateGroupCommandV1,
} from '../contracts';

export function createGroup(
  snapshot: BoardSnapshot,
  command: CreateGroupCommandV1,
): string {
  if (command.blockIds.length === 0) {
    throw new Error('Group creation requires at least one Block.');
  }
  const blockIds = new Set(command.blockIds);
  if (blockIds.size !== command.blockIds.length) {
    throw new Error('Group creation cannot contain duplicate Block IDs.');
  }
  for (const blockId of blockIds) {
    if (!snapshot.blocks.some((block) => block.blockId === blockId)) {
      throw new Error(`Block not found: ${blockId}.`);
    }
  }
  const group = createGroupAroundBlocks(snapshot, command.blockIds, {
    color: command.color,
    kind: 'manual',
    layoutMode: command.layoutMode,
    title: command.title,
  });
  if (!group) {
    throw new Error('Selected Blocks cannot be wrapped by a Group.');
  }
  return group.blockId;
}

export function updateGroup(
  snapshot: BoardSnapshot,
  command: UpdateGroupCommandV1,
): string {
  const group = requireGroup(snapshot, command.groupId);
  if (blockLockedByGroup(snapshot, group.blockId)) {
    throw new Error(`Group is locked by an ancestor: ${group.blockId}.`);
  }
  if (
    command.color === undefined
    && command.contentsLocked === undefined
    && command.positionLocked === undefined
    && command.title === undefined
  ) {
    throw new Error('Group update must include at least one field.');
  }
  group.data = {
    ...group.data,
    ...(command.color === undefined ? {} : { groupColor: command.color }),
    ...(command.contentsLocked === undefined
      ? {}
      : { groupContentsLocked: command.contentsLocked }),
    ...(command.positionLocked === undefined
      ? {}
      : { groupPositionLocked: command.positionLocked }),
    ...(command.title === undefined ? {} : { title: command.title }),
  };
  group.updatedAt = nowIso();
  return group.blockId;
}

export function resizeGroup(
  snapshot: BoardSnapshot,
  command: ResizeGroupCommandV1,
): string {
  assertFinitePoint(command.position);
  assertPositiveSize(command.size);
  const group = requireGroup(snapshot, command.groupId);
  if (
    group.data.groupKind === 'workflow'
    || group.data.groupPositionLocked
    || blockLockedByGroup(snapshot, group.blockId)
  ) {
    throw new Error(`Group cannot be resized: ${group.blockId}.`);
  }
  group.position = { ...command.position };
  group.size = { ...command.size };
  group.updatedAt = nowIso();
  if (group.parentGroupId) expandGroupToContents(snapshot, group.parentGroupId);
  return group.blockId;
}

export function fitGroup(
  snapshot: BoardSnapshot,
  command: FitGroupCommandV1,
): string {
  requireGroup(snapshot, command.groupId);
  if (groupStructureLocked(snapshot, command.groupId)) {
    throw new Error(`Group structure is locked: ${command.groupId}.`);
  }
  fitGroupToChildren(snapshot, command.groupId);
  return command.groupId;
}

export function layoutGroup(
  snapshot: BoardSnapshot,
  command: LayoutGroupCommandV1,
): string {
  requireGroup(snapshot, command.groupId);
  if (groupStructureLocked(snapshot, command.groupId)) {
    throw new Error(`Group structure is locked: ${command.groupId}.`);
  }
  const group = arrangeGroupChildren(snapshot, command.groupId, command.layoutMode);
  if (!group) throw new Error(`Group layout failed: ${command.groupId}.`);
  return group.blockId;
}

export function dissolveGroup(
  snapshot: BoardSnapshot,
  command: DissolveGroupCommandV1,
): string[] {
  requireGroup(snapshot, command.groupId);
  if (groupStructureLocked(snapshot, command.groupId)) {
    throw new Error(`Group structure is locked: ${command.groupId}.`);
  }
  return dissolveGroupRecord(snapshot, command.groupId);
}

function requireGroup(snapshot: BoardSnapshot, groupId: string): BlockRecord {
  const group = snapshot.blocks.find(
    (block) => block.blockId === groupId && block.type === 'group',
  );
  if (!group) throw new Error(`Group not found: ${groupId}.`);
  return group;
}

function assertFinitePoint(point: { readonly x: number; readonly y: number }): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new Error('Group position must contain finite coordinates.');
  }
}

function assertPositiveSize(size: { readonly height: number; readonly width: number }): void {
  if (
    !Number.isFinite(size.height)
    || !Number.isFinite(size.width)
    || size.height <= 0
    || size.width <= 0
  ) {
    throw new Error('Group size must contain positive finite dimensions.');
  }
}
