import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { touchBoard } from '../core/blockFactory';
import {
  adaptViewportToBasis,
  defaultBoardViewport,
  loadBoardViewState,
  maxBoardZoom,
  minBoardZoom,
  saveBoardViewState,
  viewportBasisFromElement,
  type BoardViewState,
  type ViewportBasis,
} from '../core/boardViewStateStore';
import { createFlowEdges, createFlowNodes } from '../core/flowProjection';
import {
  loadCanvasProjectionMode,
  saveCanvasProjectionMode,
  type CanvasProjectionMode,
} from '../core/canvasProjectionViewState';
import {
  blockLockedByGroup,
  findGroupDropTarget,
  groupAncestorIds,
} from '../core/grouping';
import { loadCollapsedGroupIds } from '../core/groupViewState';
import { connectedWorkflowBlockIds } from '../core/workflowSelection';
import { executionInputRoleOptionsFor } from '../core/capabilities';
import { createId, nowIso } from '../core/id';
import { suggestedTextInputSlotId } from '../core/textOperations';
import { moveBlockGroupToNearestFreeArea } from '../core/workflowPlacement';
import type {
  BlockRecord,
  BoardEdgeRecord,
  BoardSnapshot,
  RetakeEdge,
  RetakeNode,
} from '../core/types';
import type { CanvasTool } from '../components/FloatingToolbar';
import type { useI18n } from '../i18n';
import {
  absoluteFlowNodePositions,
  applyOperationInputRoleBadges,
  flowNodeSize,
  isEditableNodeTarget,
  isInteractiveNodeTarget,
  sameBlockSelection,
  selectedOperationBlockIdFor,
} from './appHelpers';
import type { BoardSessionPorts } from './useBoardSession';
import type {
  PluginContributionRegistryV1,
  RegisteredPluginCommandV1,
} from '../core/pluginContributionRegistry';

const terminalImageStatusDismissDelayMs = 500;

interface CanvasControllerOptions {
  connectSessionPorts: (ports: BoardSessionPorts) => void;
  onPluginContributionFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  pluginContributionRegistry?: PluginContributionRegistryV1;
  redo: () => void;
  setHistoryOpen: (open: boolean) => void;
  setInspectorBlockId: (blockId: string | undefined) => void;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  undo: () => void;
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useCanvasController(options: CanvasControllerOptions) {
  const {
    connectSessionPorts,
    onPluginContributionFatalFailure,
    pluginContributionRegistry,
    redo,
    setHistoryOpen,
    setInspectorBlockId,
    snapshot,
    snapshotRef,
    undo,
    updateSnapshot,
  } = options;
  const canvasAreaRef = useRef<HTMLElement | null>(null);
  const currentViewportRef = useRef<Viewport>(defaultBoardViewport);
  const boardViewportRestoreTokenRef = useRef(0);
  const pendingViewportPersistRef = useRef<BoardViewState | undefined>(undefined);
  const viewportPersistTimerRef = useRef<number | undefined>(undefined);
  const reactFlowRef = useRef<ReactFlowInstance<RetakeNode, RetakeEdge> | null>(null);
  const selectedBlockIdsRef = useRef<string[]>([]);
  const textBlockDraftsRef = useRef<Map<string, string>>(new Map());
  const pendingFlowSelectionRef = useRef<string[] | undefined>(undefined);
  const flowSelectionSyncTokenRef = useRef(0);
  const terminalImageStatusDismissTimerRef = useRef<number | undefined>(
    undefined,
  );
  const collapsedGroupIdsRef = useRef<string[]>(
    loadCollapsedGroupIds(snapshot.project.projectId, snapshot.board.boardId),
  );
  const dropTargetGroupIdRef = useRef<string | undefined>(undefined);
  const dropDetachGroupIdRef = useRef<string | undefined>(undefined);
  const nodeDragActiveRef = useRef(false);
  const projectionModeRef = useRef<CanvasProjectionMode>(
    loadCanvasProjectionMode(snapshot.project.projectId, snapshot.board.boardId),
  );
  const actionPortsRef = useRef<{ deleteBlockIds: (blockIds: string[]) => void }>({ deleteBlockIds: () => undefined });
  const [nodes, setNodes] = useState<RetakeNode[]>(() => createFlowNodes(snapshot, {
    projectionMode: projectionModeRef.current,
  }));
  const [edges, setEdges] = useState<RetakeEdge[]>(() => createFlowEdges(snapshot, {
    projectionMode: projectionModeRef.current,
  }));
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>(collapsedGroupIdsRef.current);
  const [activeCanvasTool, setActiveCanvasTool] = useState<CanvasTool>('pan');
  const [, setDropTargetGroupId] = useState<string | undefined>(undefined);
  const [canvasZoom, setCanvasZoom] = useState(() => currentViewportRef.current.zoom);
  const [projectionMode, setProjectionMode] = useState<CanvasProjectionMode>(
    projectionModeRef.current,
  );

  function connectActions(actions: { deleteBlockIds: (blockIds: string[]) => void }): void {
    actionPortsRef.current = actions;
  }

  function createFlowNodesForSelection(nextSnapshot: BoardSnapshot, blockIds = selectedBlockIdsRef.current): RetakeNode[] {
    return createFlowNodes(nextSnapshot, {
      collapsedGroupIds: collapsedGroupIdsRef.current,
      dropDetachGroupId: dropDetachGroupIdRef.current,
      dropTargetGroupId: dropTargetGroupIdRef.current,
      selectedBlockIds: blockIds,
      selectedOperationBlockId: selectedOperationBlockIdFor(nextSnapshot, blockIds),
      projectionMode: projectionModeRef.current,
      textBlockDrafts: textBlockDraftsRef.current,
    }).map((node) => ({ ...node, selected: blockIds.includes(node.id) }));
  }

  function createFlowEdgesForSelection(nextSnapshot: BoardSnapshot, blockIds = selectedBlockIdsRef.current): RetakeEdge[] {
    return createFlowEdges(nextSnapshot, {
      collapsedGroupIds: collapsedGroupIdsRef.current,
      projectionMode: projectionModeRef.current,
      selectedBlockIds: blockIds,
    });
  }

  connectSessionPorts({
    onBoardLoaded: (loadedSnapshot) => {
      const loadedProjectionMode = loadCanvasProjectionMode(
        loadedSnapshot.project.projectId,
        loadedSnapshot.board.boardId,
      );
      projectionModeRef.current = loadedProjectionMode;
      setProjectionMode(loadedProjectionMode);
      cancelTerminalImageStatusDismiss();
      flushScheduledViewportPersist();
      nodeDragActiveRef.current = false;
      setNodes(createFlowNodesForSelection(loadedSnapshot, []));
      setEdges(createFlowEdgesForSelection(loadedSnapshot, []));
      setSelectedBlockIds([]);
      setInspectorBlockId(undefined);
      setHistoryOpen(false);
      restoreBoardViewport(loadedSnapshot);
    },
    onRemoteSnapshot: (remoteSnapshot) => {
      if (!nodeDragActiveRef.current) setNodes(createFlowNodesForSelection(remoteSnapshot));
      setEdges(createFlowEdgesForSelection(remoteSnapshot));
      setSelectedBlockIds((current) => current.filter((blockId) => remoteSnapshot.blocks.some((block) => block.blockId === blockId)));
    },
    syncFlow: (nextSnapshot) => {
      setNodes(createFlowNodesForSelection(nextSnapshot));
      setEdges(createFlowEdgesForSelection(nextSnapshot));
    },
  });

  useEffect(() => {
    restoreBoardViewport(snapshotRef.current);
    return cancelTerminalImageStatusDismiss;
  }, []);

  useEffect(() => {
    const flushViewport = () => flushScheduledViewportPersist();
    window.addEventListener('beforeunload', flushViewport);
    window.addEventListener('pagehide', flushViewport);
    return () => {
      window.removeEventListener('beforeunload', flushViewport);
      window.removeEventListener('pagehide', flushViewport);
      flushScheduledViewportPersist();
    };
  }, []);

  useEffect(() => {
    const nextProjectionMode = loadCanvasProjectionMode(
      snapshot.project.projectId,
      snapshot.board.boardId,
    );
    projectionModeRef.current = nextProjectionMode;
    setProjectionMode(nextProjectionMode);
    const nextCollapsedGroupIds = loadCollapsedGroupIds(snapshot.project.projectId, snapshot.board.boardId)
      .filter((groupId) => snapshot.blocks.some((block) => block.blockId === groupId && block.type === 'group'));
    collapsedGroupIdsRef.current = nextCollapsedGroupIds;
    setCollapsedGroupIds(nextCollapsedGroupIds);
    setNodes(createFlowNodesForSelection(snapshotRef.current));
    setEdges(createFlowEdgesForSelection(snapshotRef.current));
  }, [snapshot.board.boardId, snapshot.project.projectId]);

  useEffect(() => {
    selectedBlockIdsRef.current = selectedBlockIds;
  }, [selectedBlockIds]);

  useEffect(() => {
    setNodes((currentNodes) => applyOperationInputRoleBadges(currentNodes, snapshotRef.current, selectedBlockIds));
    setEdges(createFlowEdgesForSelection(snapshotRef.current, selectedBlockIds));
  }, [selectedBlockIds, snapshot]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.target instanceof HTMLElement && isEditableNodeTarget(event.target)) return;
      const shortcut = commandShortcutFromKeyboardEvent(event);
      const binding = shortcut
        ? pluginContributionRegistry
          ?.getShortcutResolution()
          .bindings
          .find((candidate) => candidate.shortcut === shortcut)
        : undefined;
      if (
        binding?.commandId === 'retake.command.undo'
        || (!pluginContributionRegistry && shortcut === 'Mod+Z')
      ) {
        event.preventDefault();
        undo();
        return;
      }
      if (
        binding?.commandId === 'retake.command.redo'
        || (
          !pluginContributionRegistry
          && (shortcut === 'Mod+Shift+Z' || shortcut === 'Mod+Y')
        )
      ) {
        event.preventDefault();
        redo();
        return;
      }
      if (binding?.source === 'plugin' && pluginContributionRegistry) {
        const command = pluginContributionRegistry
          .getCommandSnapshot()
          .find((candidate) => candidate.commandId === binding.commandId);
        const context = command
          ? pluginCommandContextForSelection(
              command,
              snapshotRef.current,
              selectedBlockIdsRef.current,
            )
          : null;
        if (command && context) {
          event.preventDefault();
          void pluginContributionRegistry.invoke(command, context).catch(
            async (error) => {
              const message = error instanceof Error
                ? error.message
                : String(error);
              await onPluginContributionFatalFailure?.(
                command.pluginModuleId,
                `Plugin command ${command.commandId} failed: ${message}`,
              );
            },
          );
          return;
        }
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedBlockIdsRef.current.length > 0) {
        if (event.target instanceof HTMLElement && isInteractiveNodeTarget(event.target)) return;
        event.preventDefault();
        actionPortsRef.current.deleteBlockIds(selectedBlockIdsRef.current);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    onPluginContributionFatalFailure,
    pluginContributionRegistry,
    redo,
    snapshotRef,
    undo,
  ]);

  function onNodesChange(changes: NodeChange[]): void {
    const removeChanges = changes.filter((change) => change.type === 'remove');
    if (removeChanges.length > 0) {
      actionPortsRef.current.deleteBlockIds(removeChanges.map((change) => change.id));
      return;
    }
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes) as RetakeNode[]);
  }

  function onEdgesChange(changes: EdgeChange[]): void {
    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges) as RetakeEdge[]);
    const removeChanges = changes.filter((change) => change.type === 'remove');
    if (removeChanges.length === 0) return;
    updateSnapshot((current) => {
      const removedEdgeIds = new Set(removeChanges
        .map((change) => current.edges.find((edge) => edge.edgeId === change.id))
        .filter((edge): edge is BoardEdgeRecord => Boolean(edge) && !blockLockedByGroup(current, edge!.sourceBlockId) && !blockLockedByGroup(current, edge!.targetBlockId))
        .map((edge) => edge.edgeId));
      current.edges = current.edges.filter((edge) => !removedEdgeIds.has(edge.edgeId));
      return touchBoard(current);
    }, { persist: true, history: true });
  }

  const onNodeDrag: OnNodeDrag<RetakeNode> = (_event, node) => {
    nodeDragActiveRef.current = true;
    const sourceBlock = snapshotRef.current.blocks.find((block) => block.blockId === node.id);
    if (!sourceBlock || blockLockedByGroup(snapshotRef.current, node.id)) return;
    const flowNodes = reactFlowRef.current?.getNodes() ?? nodes;
    const position = absoluteFlowNodePositions(flowNodes).get(node.id);
    if (!position) return;
    const size = flowNodeSize(node, sourceBlock);
    const targetGroupId = findGroupDropTarget(snapshotRef.current, node.id, { ...position, ...size }, collapsedGroupIdsRef.current);
    const isChangingParent = targetGroupId !== sourceBlock.parentGroupId;
    setGroupDropFeedback(isChangingParent ? targetGroupId : undefined, isChangingParent ? sourceBlock.parentGroupId : undefined);
  };

  const onNodeDragStart: OnNodeDrag<RetakeNode> = () => {
    nodeDragActiveRef.current = true;
  };

  function setGroupDropFeedback(targetGroupId: string | undefined, detachGroupId: string | undefined): void {
    if (dropTargetGroupIdRef.current === targetGroupId && dropDetachGroupIdRef.current === detachGroupId) return;
    dropTargetGroupIdRef.current = targetGroupId;
    dropDetachGroupIdRef.current = detachGroupId;
    setDropTargetGroupId(targetGroupId);
    setNodes((currentNodes) => currentNodes.map((node) => ({
      ...node,
      data: { ...node.data, groupDropDetach: node.id === detachGroupId, groupDropTarget: node.id === targetGroupId },
    })));
  }

  function onNodeDragStop(_event: MouseEvent | TouchEvent, node: RetakeNode, draggedNodes: RetakeNode[]): void {
    const flowNodes = reactFlowRef.current?.getNodes() ?? nodes;
    const absolutePositions = absoluteFlowNodePositions(flowNodes);
    const flowNodeById = new Map(flowNodes.map((flowNode) => [flowNode.id, flowNode]));
    const draggedBlockIds = new Set([node.id, ...draggedNodes.map((draggedNode) => draggedNode.id)]);
    const topLevelDraggedBlockIds = [...draggedBlockIds].filter((blockId) => !groupAncestorIds(snapshotRef.current, blockId).some((groupId) => draggedBlockIds.has(groupId)));
    setGroupDropFeedback(undefined, undefined);
    try {
      updateSnapshot((current) => {
        const updatedAt = nowIso();
        for (const block of current.blocks) {
          const position = absolutePositions.get(block.blockId);
          if (!position || (block.position.x === position.x && block.position.y === position.y)) continue;
          block.position = position;
          block.updatedAt = updatedAt;
        }
        for (const blockId of topLevelDraggedBlockIds) {
          const block = current.blocks.find((candidate) => candidate.blockId === blockId);
          const position = absolutePositions.get(blockId);
          if (!block || !position || blockLockedByGroup(current, blockId)) continue;
          const previousParent = block.parentGroupId ? current.blocks.find((candidate) => candidate.blockId === block.parentGroupId && candidate.type === 'group') : undefined;
          if (previousParent && previousParent.data.groupLayoutMode !== 'free') {
            previousParent.data.groupLayoutMode = 'free';
            previousParent.updatedAt = updatedAt;
          }
          const size = flowNodeSize(flowNodeById.get(blockId), block);
          const parentGroupId = findGroupDropTarget(current, blockId, { ...position, ...size }, collapsedGroupIdsRef.current);
          if (parentGroupId !== block.parentGroupId) {
            block.parentGroupId = parentGroupId;
            block.updatedAt = updatedAt;
          }
        }
        return touchBoard(current);
      }, { syncFlow: true, persist: true, history: true });
    } finally {
      nodeDragActiveRef.current = false;
    }
  }

  function onConnect(connection: Connection): void {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const sourceBlock = snapshotRef.current.blocks.find((block) => block.blockId === connection.source);
    const targetBlock = snapshotRef.current.blocks.find((block) => block.blockId === connection.target);
    if (blockLockedByGroup(snapshotRef.current, connection.source) || blockLockedByGroup(snapshotRef.current, connection.target)) return;
    const kind = connectionKindForBlocks(sourceBlock, targetBlock);
    const requiresInputRole = kind === 'execution_input' && sourceBlock && targetBlock && executionInputRoleOptionsFor(sourceBlock, targetBlock).length > 0;
    const edgeId = createId('edge');
    const inputSlotId = kind === 'execution_input' && sourceBlock && targetBlock?.type === 'operation'
      ? suggestedTextInputSlotId(snapshotRef.current, targetBlock, sourceBlock)
      : undefined;
    const nextEdges = addEdge({ ...connection, id: edgeId, source: connection.source, target: connection.target, type: 'default', label: kind, data: { kind, inputSlotId } } satisfies RetakeEdge, edges);
    setEdges(nextEdges);
    const nextSnapshot = updateSnapshot((current) => {
      current.edges = nextEdges.map((edge): BoardEdgeRecord => ({ edgeId: edge.id, sourceBlockId: edge.source, targetBlockId: edge.target, kind: edge.data?.kind ?? 'visual_note', inputRole: edge.data?.inputRole, inputSlotId: edge.data?.inputSlotId }));
      return touchBoard(current);
    }, { persist: true, history: true });
    if (requiresInputRole && targetBlock) setSelectedBlock(nextSnapshot, targetBlock.blockId);
  }

  function connectionKindForBlocks(sourceBlock?: BlockRecord, targetBlock?: BlockRecord): BoardEdgeRecord['kind'] {
    if (targetBlock?.type === 'operation' && sourceBlock?.type !== 'operation') return 'execution_input';
    if (targetBlock?.type === 'video' && sourceBlock?.type === 'image') return 'execution_input';
    if (sourceBlock?.type === 'operation' && targetBlock?.type !== 'operation') return 'execution_output';
    return 'visual_note';
  }

  function onSelectionChange(params: OnSelectionChangeParams): void {
    const nextSelectedBlockIds = params.nodes.map((node) => node.id);
    const pendingSelection = pendingFlowSelectionRef.current;
    if (pendingSelection) {
      if (sameBlockSelection(pendingSelection, nextSelectedBlockIds)) pendingFlowSelectionRef.current = undefined;
      return;
    }
    if (!sameBlockSelection(selectedBlockIdsRef.current, nextSelectedBlockIds)) setSelectedBlocks(snapshotRef.current, nextSelectedBlockIds, { source: 'flow' });
  }

  const onNodeClick: NodeMouseHandler<RetakeNode> = (event, node) => {
    cancelTerminalImageStatusDismiss();
    if (event.detail > 1) return;
    scheduleTerminalImageStatusDismiss(node.id);
  };
  const onNodeDoubleClick: NodeMouseHandler<RetakeNode> = (event, node) => {
    cancelTerminalImageStatusDismiss();
    if (node.type !== 'text' && node.type !== 'operation' && event.target instanceof HTMLElement && isInteractiveNodeTarget(event.target)) return;
    selectConnectedWorkflow(node.id);
  };

  function selectConnectedWorkflow(blockId: string): void {
    if (connectedWorkflowBlockIds(snapshotRef.current, blockId).length <= 1) return;
    window.requestAnimationFrame(() => {
      const blockIds = connectedWorkflowBlockIds(snapshotRef.current, blockId);
      if (blockIds.length > 1) setSelectedBlocks(snapshotRef.current, blockIds);
    });
  }

  function scheduleTerminalImageStatusDismiss(blockId: string): void {
    const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId);
    if (block?.type !== 'image' || block.data.status !== 'succeeded' || block.data.statusVisualDismissed) return;
    terminalImageStatusDismissTimerRef.current = window.setTimeout(() => {
      terminalImageStatusDismissTimerRef.current = undefined;
      updateSnapshot((current) => {
        const targetBlock = current.blocks.find((candidate) => candidate.blockId === blockId);
        if (targetBlock?.type !== 'image') return current;
        targetBlock.data.statusVisualDismissed = true;
        targetBlock.updatedAt = nowIso();
        return touchBoard(current);
      }, { persist: true });
    }, terminalImageStatusDismissDelayMs);
  }

  function cancelTerminalImageStatusDismiss(): void {
    if (terminalImageStatusDismissTimerRef.current === undefined) return;
    window.clearTimeout(terminalImageStatusDismissTimerRef.current);
    terminalImageStatusDismissTimerRef.current = undefined;
  }

  function updateTextBlockBody(blockId: string, body: string): void {
    updateSnapshot((current) => {
      const block = current.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'text');
      if (!block || blockLockedByGroup(current, blockId) || block.data.body === body) return current;
      block.data = { ...block.data, body };
      block.updatedAt = nowIso();
      return touchBoard(current);
    }, { persist: true, history: true });
  }

  function setSelectedBlock(nextSnapshot: BoardSnapshot, blockId: string): void {
    setSelectedBlocks(nextSnapshot, [blockId]);
  }

  function setSelectedBlocks(
    nextSnapshot: BoardSnapshot,
    blockIds: string[],
    selectionOptions: { source?: 'app' | 'flow' } = {},
  ): void {
    const visibleBlockIds = new Set(createFlowNodesForSelection(nextSnapshot, blockIds).map((node) => node.id));
    const nextSelectedBlockIds = blockIds.filter((blockId) => visibleBlockIds.has(blockId));
    if (selectionOptions.source !== 'flow') {
      pendingFlowSelectionRef.current = nextSelectedBlockIds;
      flowSelectionSyncTokenRef.current += 1;
      const token = flowSelectionSyncTokenRef.current;
      window.requestAnimationFrame(() => {
        if (flowSelectionSyncTokenRef.current === token) pendingFlowSelectionRef.current = undefined;
      });
    }
    selectedBlockIdsRef.current = nextSelectedBlockIds;
    setSelectedBlockIds(nextSelectedBlockIds);
    setNodes(createFlowNodesForSelection(nextSnapshot, nextSelectedBlockIds));
    setEdges(createFlowEdgesForSelection(nextSnapshot, nextSelectedBlockIds));
  }

  function selectBlock(blockId: string): void {
    setSelectedBlock(snapshotRef.current, blockId);
  }

  function locateBlock(blockId: string): void {
    if (!snapshotRef.current.blocks.some((block) => block.blockId === blockId)) return;
    selectBlock(blockId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const node = reactFlowRef.current?.getNode(blockId);
        if (!node) return;
        const width = node.measured?.width ?? node.width ?? 280;
        const height = node.measured?.height ?? node.height ?? 180;
        void reactFlowRef.current?.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
          zoom: Math.max(currentViewportRef.current.zoom, 0.85),
          duration: 260,
        });
      });
    });
  }

  function viewportCenter(): { x: number; y: number } {
    const viewport = currentViewportRef.current;
    const bounds = canvasAreaRef.current?.getBoundingClientRect();
    return {
      x: ((bounds?.width ?? window.innerWidth) / 2 - viewport.x) / viewport.zoom,
      y: ((bounds?.height ?? window.innerHeight) / 2 - viewport.y) / viewport.zoom,
    };
  }

  function centeredBlockPosition(size: { width: number; height: number }): { x: number; y: number } {
    const center = viewportCenter();
    return { x: center.x - size.width / 2, y: center.y - size.height / 2 };
  }

  function centerWorkflowBlocks(current: BoardSnapshot, blockIds: string[], gap = 80): void {
    const blocks = blockIds.map((blockId) => current.blocks.find((block) => block.blockId === blockId)).filter((block): block is BlockRecord => Boolean(block));
    if (blocks.length === 0) return;
    const totalWidth = blocks.reduce((sum, block) => sum + block.size.width, 0) + Math.max(0, blocks.length - 1) * gap;
    const maxHeight = blocks.reduce((max, block) => Math.max(max, block.size.height), 0);
    const center = viewportCenter();
    let nextX = center.x - totalWidth / 2;
    const nextY = center.y - maxHeight / 2;
    const updatedAt = nowIso();
    for (const block of blocks) {
      block.position = { x: nextX, y: nextY + (maxHeight - block.size.height) / 2 };
      block.updatedAt = updatedAt;
      nextX += block.size.width + gap;
    }
    moveBlockGroupToNearestFreeArea(current, blocks, center);
  }

  function centerBlockGroup(current: BoardSnapshot, blockIds: string[]): void {
    const blocks = blockIds.map((blockId) => current.blocks.find((block) => block.blockId === blockId)).filter((block): block is BlockRecord => Boolean(block));
    if (blocks.length === 0) return;
    const minX = Math.min(...blocks.map((block) => block.position.x));
    const minY = Math.min(...blocks.map((block) => block.position.y));
    const maxX = Math.max(...blocks.map((block) => block.position.x + block.size.width));
    const maxY = Math.max(...blocks.map((block) => block.position.y + block.size.height));
    const center = viewportCenter();
    const deltaX = center.x - (minX + maxX) / 2;
    const deltaY = center.y - (minY + maxY) / 2;
    const updatedAt = nowIso();
    for (const block of blocks) {
      block.position = { x: block.position.x + deltaX, y: block.position.y + deltaY };
      block.updatedAt = updatedAt;
    }
    moveBlockGroupToNearestFreeArea(current, blocks, center);
  }

  function focusWorkflowBlocks(blockIds: string[]): void {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const reactFlow = reactFlowRef.current;
        if (!reactFlow) return;
        const nodes = blockIds
          .map((blockId) => reactFlow.getNode(blockId))
          .filter((node): node is RetakeNode => Boolean(node));
        if (nodes.length === 0) return;
        const bounds = reactFlow.getNodesBounds(nodes);
        void reactFlow.fitBounds(bounds, { duration: 260, padding: 0.2 });
      });
    });
  }

  function changeProjectionMode(next: CanvasProjectionMode): void {
    if (projectionModeRef.current === next) return;
    projectionModeRef.current = next;
    setProjectionMode(next);
    saveCanvasProjectionMode(
      snapshotRef.current.project.projectId,
      snapshotRef.current.board.boardId,
      next,
    );
    const retainedSelection = selectedBlockIdsRef.current.filter((blockId) => (
      snapshotRef.current.blocks.find((block) => block.blockId === blockId)?.type !== 'operation'
    ));
    setSelectedBlocks(snapshotRef.current, retainedSelection);
  }

  function restoreViewport(viewport: Viewport): void {
    currentViewportRef.current = viewport;
    setCanvasZoom(viewport.zoom);
    window.requestAnimationFrame(() => { void reactFlowRef.current?.setViewport(viewport, { duration: 0 }); });
  }

  function persistViewport(viewport: Viewport): void {
    currentViewportRef.current = viewport;
    setCanvasZoom(viewport.zoom);
    clearScheduledViewportPersist();
    persistBoardViewState(boardViewStateFor(
      snapshotRef.current,
      viewport,
      viewportBasisFromElement(canvasAreaRef.current),
    ));
  }

  function scheduleViewportPersist(viewport: Viewport): void {
    currentViewportRef.current = viewport;
    setCanvasZoom(viewport.zoom);
    pendingViewportPersistRef.current = boardViewStateFor(
      snapshotRef.current,
      viewport,
      viewportBasisFromElement(canvasAreaRef.current),
    );
    if (viewportPersistTimerRef.current !== undefined) return;
    viewportPersistTimerRef.current = window.setTimeout(flushScheduledViewportPersist, 80);
  }

  function flushScheduledViewportPersist(): void {
    if (viewportPersistTimerRef.current !== undefined) {
      window.clearTimeout(viewportPersistTimerRef.current);
      viewportPersistTimerRef.current = undefined;
    }
    const pending = pendingViewportPersistRef.current;
    pendingViewportPersistRef.current = undefined;
    if (pending) persistBoardViewState(pending);
  }

  function clearScheduledViewportPersist(): void {
    if (viewportPersistTimerRef.current !== undefined) {
      window.clearTimeout(viewportPersistTimerRef.current);
      viewportPersistTimerRef.current = undefined;
    }
    pendingViewportPersistRef.current = undefined;
  }

  function persistBoardViewState(next: BoardViewState): void {
    const saved = loadBoardViewState(next.projectId, next.boardId);
    if (
      saved &&
      Math.abs(saved.viewport.x - next.viewport.x) < 0.5 &&
      Math.abs(saved.viewport.y - next.viewport.y) < 0.5 &&
      Math.abs(saved.viewport.zoom - next.viewport.zoom) < 0.001 &&
      Math.abs(saved.viewportBasis.canvasWidth - next.viewportBasis.canvasWidth) < 0.5 &&
      Math.abs(saved.viewportBasis.canvasHeight - next.viewportBasis.canvasHeight) < 0.5
    ) return;
    saveBoardViewState(next);
  }

  function restoreBoardViewport(loadedSnapshot: BoardSnapshot): void {
    const restoreToken = ++boardViewportRestoreTokenRef.current;
    const basis = viewportBasisFromElement(canvasAreaRef.current);
    const saved = loadBoardViewState(loadedSnapshot.project.projectId, loadedSnapshot.board.boardId);
    if (saved) {
      const adapted = adaptViewportToBasis(saved.viewport, saved.viewportBasis, basis, minBoardZoom, maxBoardZoom);
      restoreViewport(adapted);
      return;
    }

    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (restoreToken !== boardViewportRestoreTokenRef.current) return;
      const reactFlow = reactFlowRef.current;
      if (!reactFlow) return;
      const nextBasis = viewportBasisFromElement(canvasAreaRef.current);
      if (loadedSnapshot.blocks.length === 0) {
        const emptyViewport = { x: nextBasis.canvasWidth / 2, y: nextBasis.canvasHeight / 2, zoom: 1 };
        void reactFlow.setViewport(emptyViewport, { duration: 0 }).then(() => {
          if (restoreToken === boardViewportRestoreTokenRef.current) saveViewportForBoard(loadedSnapshot, emptyViewport, nextBasis);
        });
        return;
      }
      void reactFlow.fitView({ duration: 0, padding: 0.18 }).then(() => {
        if (restoreToken !== boardViewportRestoreTokenRef.current) return;
        const fittedViewport = reactFlow.getViewport();
        currentViewportRef.current = fittedViewport;
        setCanvasZoom(fittedViewport.zoom);
        saveViewportForBoard(loadedSnapshot, fittedViewport, nextBasis);
      });
    }));
  }

  function saveViewportForBoard(current: BoardSnapshot, viewport: Viewport, basis: ViewportBasis): void {
    persistBoardViewState(boardViewStateFor(current, viewport, basis));
  }

  function boardViewStateFor(current: BoardSnapshot, viewport: Viewport, basis: ViewportBasis): BoardViewState {
    return {
      schemaVersion: 1,
      projectId: current.project.projectId,
      boardId: current.board.boardId,
      viewport,
      viewportBasis: basis,
      updatedAt: new Date().toISOString(),
    };
  }

  useEffect(() => {
    function onPreviewTextBlock(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; body?: string }>).detail;
      if (!detail?.blockId || typeof detail.body !== 'string') return;
      const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === detail.blockId && candidate.type === 'text');
      if (!block || blockLockedByGroup(snapshotRef.current, block.blockId)) return;
      textBlockDraftsRef.current.set(block.blockId, detail.body);
      setNodes(createFlowNodesForSelection(snapshotRef.current));
    }
    function onUpdateTextBlock(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; body?: string }>).detail;
      if (!detail?.blockId || typeof detail.body !== 'string') return;
      textBlockDraftsRef.current.delete(detail.blockId);
      updateTextBlockBody(detail.blockId, detail.body);
    }
    window.addEventListener('retake:preview-text-block', onPreviewTextBlock);
    window.addEventListener('retake:update-text-block', onUpdateTextBlock);
    return () => {
      window.removeEventListener('retake:preview-text-block', onPreviewTextBlock);
      window.removeEventListener('retake:update-text-block', onUpdateTextBlock);
    };
  }, []);

  useEffect(() => {
    function onSelectConnectedWorkflow(event: Event): void {
      const blockId = (event as CustomEvent<{ blockId?: string }>).detail?.blockId;
      if (blockId) selectConnectedWorkflow(blockId);
    }
    window.addEventListener('retake:select-connected-workflow', onSelectConnectedWorkflow);
    return () => window.removeEventListener('retake:select-connected-workflow', onSelectConnectedWorkflow);
  }, []);

  return {
    activeCanvasTool,
    canvasAreaRef,
    canvasZoom,
    centerBlockGroup,
    centeredBlockPosition,
    centerWorkflowBlocks,
    focusWorkflowBlocks,
    collapsedGroupIds,
    collapsedGroupIdsRef,
    connectActions,
    createFlowEdgesForSelection,
    createFlowNodesForSelection,
    currentViewportRef,
    edges,
    locateBlock,
    nodes,
    onConnect,
    onEdgesChange,
    onNodeClick,
    onNodeDoubleClick,
    onNodeDrag,
    onNodeDragStart,
    onNodeDragStop,
    onNodesChange,
    onSelectionChange,
    persistViewport,
    projectionMode,
    reactFlowRef,
    scheduleViewportPersist,
    selectedBlockIds,
    selectedBlockIdsRef,
    selectBlock,
    setActiveCanvasTool,
    setCollapsedGroupIds,
    setCanvasZoom,
    setEdges,
    setNodes,
    setSelectedBlock,
    setSelectedBlockIds,
    setSelectedBlocks,
    changeProjectionMode,
  };
}

export function commandShortcutFromKeyboardEvent(
  event: Pick<
    KeyboardEvent,
    'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'
  >,
): string | null {
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = event.key.toUpperCase();
  if (!/^[A-Z0-9]$/.test(key)) return null;
  return [
    'Mod',
    ...(event.altKey ? ['Alt'] : []),
    ...(event.shiftKey ? ['Shift'] : []),
    key,
  ].join('+');
}

function pluginCommandContextForSelection(
  command: RegisteredPluginCommandV1,
  snapshot: BoardSnapshot,
  selectedBlockIds: readonly string[],
) {
  const images = selectedBlockIds.flatMap((blockId) => {
    const block = snapshot.blocks.find((candidate) => (
      candidate.blockId === blockId
      && candidate.type === 'image'
    ));
    if (!block || block.type !== 'image' || !block.data.assetId) return [];
    return [Object.freeze({
      assetId: block.data.assetId,
      blockId: block.blockId,
      title: block.data.title,
      type: 'image' as const,
    })];
  });
  if (command.contextKind === 'image' && images.length === 1) {
    return Object.freeze({
      block: images[0]!,
      host: command.host,
      kind: 'image' as const,
    });
  }
  if (command.contextKind === 'selection' && images.length > 0) {
    return Object.freeze({
      blocks: Object.freeze(images),
      host: command.host,
      kind: 'selection' as const,
    });
  }
  return null;
}
