import { useEffect, type RefObject } from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import type { DrawRect } from '../components/GroupDrawOverlay';
import type { OperationToast } from '../components/OperationFeedback';
import { touchBoard } from '../core/blockFactory';
import {
  arrangeGroupChildren,
  blockLockedByGroup,
  createGroupFromBounds,
  dissolveGroup,
  expandGroupToContents,
  fitGroupToChildren,
  groupBoundsContext,
  groupMediaItems,
  groupStructureLocked,
  type GroupBounds,
} from '../core/grouping';
import { saveCollapsedGroupIds } from '../core/groupViewState';
import { nowIso } from '../core/id';
import type {
  BoardSnapshot,
  GroupColor,
  GroupLayoutMode,
  RetakeEdge,
  RetakeNode,
} from '../core/types';
import type { CanvasTool } from '../components/FloatingToolbar';
import type { useI18n } from '../i18n';
import { downloadAsset } from './appHelpers';

interface GroupControllerOptions {
  canvasAreaRef: RefObject<HTMLElement | null>;
  collapsedGroupIdsRef: RefObject<string[]>;
  createFlowEdgesForSelection: (snapshot: BoardSnapshot, blockIds?: string[]) => RetakeEdge[];
  createFlowNodesForSelection: (snapshot: BoardSnapshot, blockIds?: string[]) => RetakeNode[];
  reactFlowRef: RefObject<ReactFlowInstance<RetakeNode, RetakeEdge> | null>;
  setActiveCanvasTool: (tool: CanvasTool) => void;
  setCollapsedGroupIds: (ids: string[]) => void;
  setEdges: (edges: RetakeEdge[]) => void;
  setNodes: (nodes: RetakeNode[]) => void;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useGroupController(options: GroupControllerOptions) {
  const {
    canvasAreaRef,
    collapsedGroupIdsRef,
    createFlowEdgesForSelection,
    createFlowNodesForSelection,
    reactFlowRef,
    setActiveCanvasTool,
    setCollapsedGroupIds,
    setEdges,
    setNodes,
    setOperationToast,
    setSelectedBlock,
    setSelectedBlocks,
    snapshotRef,
    t,
    updateSnapshot,
  } = options;

  useEffect(() => {
    function onResizeGroup(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; position?: { x: number; y: number }; size?: { width: number; height: number } }>).detail;
      if (!detail?.blockId || !detail.position || !detail.size) return;
      const { blockId, position, size } = detail;
      updateSnapshot((current) => {
        const group = current.blocks.find((block) => block.blockId === blockId && block.type === 'group');
        if (!group || group.data.groupPositionLocked || blockLockedByGroup(current, blockId)) return current;
        const parent = group.parentGroupId ? current.blocks.find((block) => block.blockId === group.parentGroupId && block.type === 'group') : undefined;
        group.position = { x: position.x + (parent?.position.x ?? 0), y: position.y + (parent?.position.y ?? 0) };
        group.size = { ...size };
        group.updatedAt = nowIso();
        if (group.parentGroupId) expandGroupToContents(current, group.parentGroupId);
        return touchBoard(current);
      }, { persist: true, history: true });
    }
    window.addEventListener('retake:resize-group', onResizeGroup);
    return () => window.removeEventListener('retake:resize-group', onResizeGroup);
  }, []);

  function drawRectToGroupBounds(rect: DrawRect): GroupBounds | undefined {
    const canvasBounds = canvasAreaRef.current?.getBoundingClientRect();
    const reactFlow = reactFlowRef.current;
    if (!canvasBounds || !reactFlow) return undefined;
    const start = reactFlow.screenToFlowPosition({ x: canvasBounds.left + rect.x, y: canvasBounds.top + rect.y });
    const end = reactFlow.screenToFlowPosition({ x: canvasBounds.left + rect.x + rect.width, y: canvasBounds.top + rect.y + rect.height });
    return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
  }

  function groupDrawCandidateCount(rect: DrawRect): number {
    const bounds = drawRectToGroupBounds(rect);
    return bounds ? groupBoundsContext(snapshotRef.current, bounds, collapsedGroupIdsRef.current).candidateBlocks.length : 0;
  }

  function completeGroupDraw(rect: DrawRect): void {
    const bounds = drawRectToGroupBounds(rect);
    if (!bounds) return;
    let groupId = '';
    const nextSnapshot = updateSnapshot((current) => {
      const group = createGroupFromBounds(current, bounds, { color: 'neutral', kind: 'manual', layoutMode: 'free', title: t('group.defaultTitle') }, collapsedGroupIdsRef.current);
      if (!group) return current;
      groupId = group.blockId;
      return touchBoard(current);
    }, { persist: true, history: true });
    setActiveCanvasTool('pan');
    if (groupId) setSelectedBlock(nextSnapshot, groupId);
  }

  function updateGroup(groupId: string, updates: { color?: GroupColor; contentsLocked?: boolean; positionLocked?: boolean; title?: string }): void {
    updateSnapshot((current) => {
      const group = current.blocks.find((block) => block.blockId === groupId && block.type === 'group');
      if (!group || blockLockedByGroup(current, groupId)) return current;
      group.data = {
        ...group.data,
        title: updates.title ?? group.data.title,
        groupColor: updates.color ?? group.data.groupColor,
        groupContentsLocked: updates.contentsLocked ?? group.data.groupContentsLocked,
        groupPositionLocked: updates.positionLocked ?? group.data.groupPositionLocked,
      };
      group.updatedAt = nowIso();
      return touchBoard(current);
    }, { persist: true, history: true });
  }

  function fitSelectedGroup(groupId: string): void {
    updateSnapshot((current) => {
      const group = current.blocks.find((block) => block.blockId === groupId && block.type === 'group');
      if (!group || group.data.groupPositionLocked || blockLockedByGroup(current, groupId)) return current;
      fitGroupToChildren(current, groupId);
      return touchBoard(current);
    }, { persist: true, history: true });
  }

  function layoutSelectedGroup(groupId: string, layoutMode: GroupLayoutMode): void {
    updateSnapshot((current) => {
      arrangeGroupChildren(current, groupId, layoutMode);
      return touchBoard(current);
    }, { persist: true, history: true });
  }

  function ungroupSelectedGroup(groupId: string): void {
    let childIds: string[] = [];
    const nextSnapshot = updateSnapshot((current) => {
      if (groupStructureLocked(current, groupId)) return current;
      childIds = dissolveGroup(current, groupId);
      return touchBoard(current);
    }, { persist: true, history: true });
    setSelectedBlocks(nextSnapshot, childIds);
  }

  function toggleGroupCollapsed(groupId: string): void {
    const nextIds = collapsedGroupIdsRef.current.includes(groupId)
      ? collapsedGroupIdsRef.current.filter((id) => id !== groupId)
      : [...collapsedGroupIdsRef.current, groupId];
    collapsedGroupIdsRef.current = nextIds;
    setCollapsedGroupIds(nextIds);
    saveCollapsedGroupIds(snapshotRef.current.project.projectId, snapshotRef.current.board.boardId, nextIds);
    setNodes(createFlowNodesForSelection(snapshotRef.current));
    setEdges(createFlowEdgesForSelection(snapshotRef.current));
  }

  function downloadGroupAssets(groupId: string): void {
    const uniqueItems = new Map(groupMediaItems(snapshotRef.current, groupId).map((item) => [item.asset.assetId, item]));
    if (uniqueItems.size === 0) return;
    for (const item of uniqueItems.values()) downloadAsset(item.asset, item.block.data.title);
    setOperationToast({ id: `group-download:${groupId}`, title: t('group.downloadAssets'), body: `${uniqueItems.size} ${t('group.downloadStarted')}`, tone: 'success' });
  }

  return { completeGroupDraw, downloadGroupAssets, fitSelectedGroup, groupDrawCandidateCount, layoutSelectedGroup, toggleGroupCollapsed, ungroupSelectedGroup, updateGroup };
}
