import { touchBoard } from '../../core/blockFactory';
import {
  blockLockedByGroup,
  blockManagedByWorkflowGroup,
  createGroupFromBounds,
  descendantBlockIds,
  findGroupDropTarget,
  type GroupBounds,
} from '../../core/grouping';
import { nowIso } from '../../core/id';
import type {
  BoardSnapshot,
  GroupColor,
  GroupLayoutMode,
} from '../../core/types';
import type { CanvasHostScopeV1 } from '../../host-kit';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

interface AbsoluteBlockPositionV1 {
  blockId: string;
  position: { x: number; y: number };
}

interface DraggedBlockPlacementV1 extends AbsoluteBlockPositionV1 {
  size: { height: number; width: number };
}

export interface WhiteboardCanvasCommandsV1 {
  commitDrag(input: {
    absolutePositions: readonly AbsoluteBlockPositionV1[];
    collapsedGroupIds: readonly string[];
    draggedBlocks: readonly DraggedBlockPlacementV1[];
    expectedScope: CanvasHostScopeV1;
  }): Promise<{ committed: boolean; movedBlockIds: string[]; reparentedBlockIds: string[] }>;
  createGroupFromBounds(input: {
    bounds: GroupBounds;
    color?: GroupColor;
    excludedGroupIds?: readonly string[];
    expectedScope: CanvasHostScopeV1;
    layoutMode?: GroupLayoutMode;
    title?: string;
  }): Promise<{ committed: boolean; groupId?: string }>;
}

export function createWhiteboardCanvasCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardCanvasCommandsV1 {
  return Object.freeze({
    async commitDrag(input: Parameters<WhiteboardCanvasCommandsV1['commitDrag']>[0]) {
      const transaction = await transactions.executeConditionalProductTransaction<{
        movedBlockIds: string[];
        reparentedBlockIds: string[];
      }>((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        const positionByBlockId = new Map(
          input.absolutePositions.map((entry) => [entry.blockId, entry.position]),
        );
        const validDraggedBlockIds = new Set(input.draggedBlocks.flatMap((placement) => {
          const block = snapshot.blocks.find((candidate) => candidate.blockId === placement.blockId);
          if (
            !block
            || blockLockedByGroup(snapshot, placement.blockId)
            || blockManagedByWorkflowGroup(snapshot, placement.blockId)
            || (
              block.type === 'group'
              && (block.data.groupKind === 'workflow' || block.data.groupPositionLocked)
            )
          ) return [];
          return [placement.blockId];
        }));
        const affectedBlockIds = new Set(validDraggedBlockIds);
        for (const blockId of validDraggedBlockIds) {
          const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
          if (block?.type !== 'group') continue;
          for (const descendantId of descendantBlockIds(snapshot, [blockId])) {
            affectedBlockIds.add(descendantId);
          }
        }
        const movedBlockIds: string[] = [];
        const reparentedBlockIds: string[] = [];
        const updatedAt = nowIso();
        for (const block of snapshot.blocks) {
          if (!affectedBlockIds.has(block.blockId)) continue;
          const position = positionByBlockId.get(block.blockId);
          if (!position || samePosition(block.position, position)) continue;
          block.position = structuredClone(position);
          block.updatedAt = updatedAt;
          movedBlockIds.push(block.blockId);
        }
        let layoutChanged = false;
        for (const placement of input.draggedBlocks) {
          if (!validDraggedBlockIds.has(placement.blockId)) continue;
          const block = snapshot.blocks.find((candidate) => candidate.blockId === placement.blockId);
          if (!block) continue;
          const previousParent = block.parentGroupId
            ? snapshot.blocks.find(
                (candidate) => candidate.blockId === block.parentGroupId && candidate.type === 'group',
              )
            : undefined;
          if (previousParent && previousParent.data.groupLayoutMode !== 'free') {
            previousParent.data.groupLayoutMode = 'free';
            previousParent.updatedAt = updatedAt;
            layoutChanged = true;
          }
          const parentGroupId = findGroupDropTarget(
            snapshot,
            placement.blockId,
            { ...placement.position, ...placement.size },
            input.collapsedGroupIds,
          );
          if (parentGroupId === block.parentGroupId) continue;
          block.parentGroupId = parentGroupId;
          block.updatedAt = updatedAt;
          reparentedBlockIds.push(block.blockId);
        }
        const changed = movedBlockIds.length > 0
          || reparentedBlockIds.length > 0
          || layoutChanged;
        if (!changed) {
          return { changed: false, result: { movedBlockIds: [], reparentedBlockIds: [] } };
        }
        touchBoard(snapshot);
        return { changed: true, result: { movedBlockIds, reparentedBlockIds } };
      });
      return { ...transaction.result, committed: transaction.committed };
    },

    async createGroupFromBounds(
      input: Parameters<WhiteboardCanvasCommandsV1['createGroupFromBounds']>[0],
    ) {
      const transaction = await transactions.executeConditionalProductTransaction<{
        groupId?: string;
      }>((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        const group = createGroupFromBounds(snapshot, input.bounds, {
          color: input.color,
          kind: 'manual',
          layoutMode: input.layoutMode,
          title: input.title,
        }, input.excludedGroupIds);
        if (!group) return { changed: false, result: {} };
        touchBoard(snapshot);
        return { changed: true, result: { groupId: group.blockId } };
      });
      return { ...transaction.result, committed: transaction.committed };
    },
  });
}

function samePosition(
  left: { x: number; y: number },
  right: { x: number; y: number },
): boolean {
  return left.x === right.x && left.y === right.y;
}

function assertScope(snapshot: BoardSnapshot, expected: CanvasHostScopeV1): void {
  if (
    snapshot.project.projectId !== expected.projectId
    || snapshot.board.boardId !== expected.boardId
  ) {
    throw new Error('Canvas command scope changed before commit.');
  }
}
