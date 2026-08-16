import {
  useEffect,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { ReactFlowInstance } from '@xyflow/react';
import type { DrawRect } from '../components/GroupDrawOverlay';
import type { OperationToast } from '../components/OperationFeedback';
import {
  blockLockedByGroup,
  groupBoundsContext,
  groupMediaItems,
  type GroupBounds,
} from '../core/grouping';
import { saveCollapsedGroupIds } from '../core/groupViewState';
import type {
  BoardSnapshot,
  GroupColor,
  GroupLayoutMode,
} from '../core/types';
import type { RetakeEdge, RetakeNode } from '../canvas/reactFlowTypes';
import { retainFlowNodeMeasurements } from './canvasLiveProjection';
import type { CanvasTool } from '../components/FloatingToolbar';
import type { useI18n } from '../i18n';
import type { CanvasHostCommandsV1 } from '../host-kit';
import { downloadAsset } from './appHelpers';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';

interface GroupControllerOptions {
  canvasAreaRef: RefObject<HTMLElement | null>;
  collapsedGroupIdsRef: RefObject<string[]>;
  createFlowEdgesForSelection: (snapshot: BoardSnapshot, blockIds?: string[]) => RetakeEdge[];
  createFlowNodesForSelection: (snapshot: BoardSnapshot, blockIds?: string[]) => RetakeNode[];
  reactFlowRef: RefObject<ReactFlowInstance<RetakeNode, RetakeEdge> | null>;
  runHostCommand?: <Result>(
    operation: (commands: CanvasHostCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: {
      history?: boolean;
      shouldKeepHistory?: (result: Result) => boolean;
      syncFlow?: boolean;
    },
  ) => Promise<Result>;
  setActiveCanvasTool: (tool: CanvasTool) => void;
  setCollapsedGroupIds: (ids: string[]) => void;
  setEdges: (edges: RetakeEdge[]) => void;
  setNodes: Dispatch<SetStateAction<RetakeNode[]>>;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
}

export function useGroupController(options: GroupControllerOptions) {
  const {
    canvasAreaRef,
    collapsedGroupIdsRef,
    createFlowEdgesForSelection,
    createFlowNodesForSelection,
    reactFlowRef,
    runHostCommand,
    runProductCommand,
    setActiveCanvasTool,
    setCollapsedGroupIds,
    setEdges,
    setNodes,
    setOperationToast,
    setSelectedBlock,
    setSelectedBlocks,
    snapshotRef,
    t,
  } = options;

  useEffect(() => {
    function onResizeGroup(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; position?: { x: number; y: number }; size?: { width: number; height: number } }>).detail;
      if (!detail?.blockId || !detail.position || !detail.size) return;
      const { blockId, position, size } = detail;
      const current = snapshotRef.current;
      const group = current.blocks.find((block) => block.blockId === blockId && block.type === 'group');
      if (
        !group
        || group.data.groupKind === 'workflow'
        || group.data.groupPositionLocked
        || blockLockedByGroup(current, blockId)
      ) return;
      const parent = group.parentGroupId
        ? current.blocks.find((block) => block.blockId === group.parentGroupId && block.type === 'group')
        : undefined;
      void requireHostCommands(runHostCommand)(
        (commands) => commands.resizeGroup({
          groupId: blockId,
          position: {
            x: position.x + (parent?.position.x ?? 0),
            y: position.y + (parent?.position.y ?? 0),
          },
          size,
        }),
        { history: true },
      ).catch((error: unknown) => reportGroupCommandFailure('resize', error));
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
    setActiveCanvasTool('pan');
    const current = snapshotRef.current;
    void requireProductCommands(runProductCommand)(
      (commands) => commands.canvas.createGroupFromBounds({
        bounds,
        color: 'neutral',
        excludedGroupIds: collapsedGroupIdsRef.current,
        expectedScope: {
          boardId: current.board.boardId,
          projectId: current.project.projectId,
        },
        layoutMode: 'free',
        title: t('group.defaultTitle'),
      }),
      { history: true, shouldKeepHistory: (result) => result.committed },
    ).then((result) => {
      if (result.groupId) setSelectedBlock(snapshotRef.current, result.groupId);
    }).catch((error: unknown) => reportGroupCommandFailure('create', error));
  }

  function updateGroup(groupId: string, updates: { color?: GroupColor; contentsLocked?: boolean; positionLocked?: boolean; title?: string }): void {
    void requireHostCommands(runHostCommand)(
        (commands) => commands.updateGroup({ groupId, ...updates }),
        { history: true },
      ).catch((error: unknown) => reportGroupCommandFailure('update', error));
  }

  function fitSelectedGroup(groupId: string): void {
    void requireHostCommands(runHostCommand)(
        (commands) => commands.fitGroup({ groupId }),
        { history: true },
      ).catch((error: unknown) => reportGroupCommandFailure('fit', error));
  }

  function layoutSelectedGroup(groupId: string, layoutMode: GroupLayoutMode): void {
    void requireHostCommands(runHostCommand)(
        (commands) => commands.layoutGroup({ groupId, layoutMode }),
        { history: true },
      ).catch((error: unknown) => reportGroupCommandFailure('layout', error));
  }

  function ungroupSelectedGroup(groupId: string): void {
    void requireHostCommands(runHostCommand)(
        (commands) => commands.dissolveGroup({ groupId }),
        { history: true },
      ).then((result) => {
        setSelectedBlocks(snapshotRef.current, [...result.childBlockIds]);
      }).catch((error: unknown) => reportGroupCommandFailure('dissolve', error));
  }

  function toggleGroupCollapsed(groupId: string): void {
    const nextIds = collapsedGroupIdsRef.current.includes(groupId)
      ? collapsedGroupIdsRef.current.filter((id) => id !== groupId)
      : [...collapsedGroupIdsRef.current, groupId];
    collapsedGroupIdsRef.current = nextIds;
    setCollapsedGroupIds(nextIds);
    saveCollapsedGroupIds(snapshotRef.current.project.projectId, snapshotRef.current.board.boardId, nextIds);
    setNodes((current) => retainFlowNodeMeasurements(
      createFlowNodesForSelection(snapshotRef.current),
      current,
    ));
    setEdges(createFlowEdgesForSelection(snapshotRef.current));
  }

  function downloadGroupAssets(groupId: string): void {
    const uniqueItems = new Map(groupMediaItems(snapshotRef.current, groupId).map((item) => [item.asset.assetId, item]));
    if (uniqueItems.size === 0) return;
    for (const item of uniqueItems.values()) downloadAsset(item.asset, item.block.data.title);
    setOperationToast({ id: `group-download:${groupId}`, title: t('group.downloadAssets'), body: `${uniqueItems.size} ${t('group.downloadStarted')}`, tone: 'success' });
  }

  function reportGroupCommandFailure(action: string, error: unknown): void {
    console.error(`Canvas Group ${action} failed.`, error);
    setOperationToast({
      body: error instanceof Error ? error.message : String(error),
      id: `group-${action}-failed:${Date.now()}`,
      title: t('feedback.handoffUnavailable'),
      tone: 'error',
    });
  }

  return { completeGroupDraw, downloadGroupAssets, fitSelectedGroup, groupDrawCandidateCount, layoutSelectedGroup, toggleGroupCollapsed, ungroupSelectedGroup, updateGroup };
}

function requireProductCommands(
  runProductCommand: GroupControllerOptions['runProductCommand'],
): NonNullable<GroupControllerOptions['runProductCommand']> {
  if (!runProductCommand) throw new Error('Whiteboard product command facade is unavailable.');
  return runProductCommand;
}

function requireHostCommands(
  runHostCommand: GroupControllerOptions['runHostCommand'],
): NonNullable<GroupControllerOptions['runHostCommand']> {
  if (!runHostCommand) throw new Error('Canvas Host command facade is unavailable.');
  return runHostCommand;
}
