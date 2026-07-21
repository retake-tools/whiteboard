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
  viewportShowsAnyBlock,
  type ViewportBasis,
} from '../core/boardViewStateStore';
import { createFlowEdges, createFlowNodes } from '../core/flowProjection';
import {
  blockLockedByGroup,
  findGroupDropTarget,
  groupAncestorIds,
} from '../core/grouping';
import { loadCollapsedGroupIds } from '../core/groupViewState';
import { connectedWorkflowBlockIds } from '../core/workflowSelection';
import { executionInputRoleOptionsFor } from '../core/capabilities';
import { createId, nowIso } from '../core/id';
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

interface CanvasControllerOptions {
  connectSessionPorts: (ports: BoardSessionPorts) => void;
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
  const reactFlowRef = useRef<ReactFlowInstance<RetakeNode, RetakeEdge> | null>(null);
  const selectedBlockIdsRef = useRef<string[]>([]);
  const textBlockDraftsRef = useRef<Map<string, string>>(new Map());
  const pendingFlowSelectionRef = useRef<string[] | undefined>(undefined);
  const flowSelectionSyncTokenRef = useRef(0);
  const collapsedGroupIdsRef = useRef<string[]>(
    loadCollapsedGroupIds(snapshot.project.projectId, snapshot.board.boardId),
  );
  const dropTargetGroupIdRef = useRef<string | undefined>(undefined);
  const dropDetachGroupIdRef = useRef<string | undefined>(undefined);
  const actionPortsRef = useRef<{ deleteBlockIds: (blockIds: string[]) => void }>({ deleteBlockIds: () => undefined });
  const [nodes, setNodes] = useState<RetakeNode[]>(() => createFlowNodes(snapshot));
  const [edges, setEdges] = useState<RetakeEdge[]>(() => createFlowEdges(snapshot));
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>(collapsedGroupIdsRef.current);
  const [activeCanvasTool, setActiveCanvasTool] = useState<CanvasTool>('pan');
  const [, setDropTargetGroupId] = useState<string | undefined>(undefined);
  const [canvasZoom, setCanvasZoom] = useState(() => currentViewportRef.current.zoom);

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
      textBlockDrafts: textBlockDraftsRef.current,
    }).map((node) => ({ ...node, selected: blockIds.includes(node.id) }));
  }

  function createFlowEdgesForSelection(nextSnapshot: BoardSnapshot, blockIds = selectedBlockIdsRef.current): RetakeEdge[] {
    return createFlowEdges(nextSnapshot, { collapsedGroupIds: collapsedGroupIdsRef.current, selectedBlockIds: blockIds });
  }

  connectSessionPorts({
    onBoardLoaded: (loadedSnapshot) => {
      setNodes(createFlowNodesForSelection(loadedSnapshot, []));
      setEdges(createFlowEdgesForSelection(loadedSnapshot, []));
      setSelectedBlockIds([]);
      setInspectorBlockId(undefined);
      setHistoryOpen(false);
      restoreBoardViewport(loadedSnapshot);
    },
    onRemoteSnapshot: (remoteSnapshot) => {
      setNodes(createFlowNodesForSelection(remoteSnapshot));
      setEdges(createFlowEdgesForSelection(remoteSnapshot));
      setSelectedBlockIds((current) => current.filter((blockId) => remoteSnapshot.blocks.some((block) => block.blockId === blockId)));
    },
    syncFlow: (nextSnapshot) => {
      setNodes(createFlowNodesForSelection(nextSnapshot));
      setEdges(createFlowEdgesForSelection(nextSnapshot));
    },
  });

  useEffect(() => {
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
      const isUndo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey;
      const isRedo = ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z') || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y');
      if (isUndo) { event.preventDefault(); undo(); }
      if (isRedo) { event.preventDefault(); redo(); }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedBlockIdsRef.current.length > 0) {
        event.preventDefault();
        actionPortsRef.current.deleteBlockIds(selectedBlockIdsRef.current);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

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
  }

  function onConnect(connection: Connection): void {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const sourceBlock = snapshotRef.current.blocks.find((block) => block.blockId === connection.source);
    const targetBlock = snapshotRef.current.blocks.find((block) => block.blockId === connection.target);
    if (blockLockedByGroup(snapshotRef.current, connection.source) || blockLockedByGroup(snapshotRef.current, connection.target)) return;
    const kind = connectionKindForBlocks(sourceBlock, targetBlock);
    const requiresInputRole = kind === 'execution_input' && sourceBlock && targetBlock && executionInputRoleOptionsFor(sourceBlock, targetBlock).length > 0;
    const edgeId = createId('edge');
    const nextEdges = addEdge({ ...connection, id: edgeId, source: connection.source, target: connection.target, type: 'default', label: kind, data: { kind } } satisfies RetakeEdge, edges);
    setEdges(nextEdges);
    const nextSnapshot = updateSnapshot((current) => {
      current.edges = nextEdges.map((edge): BoardEdgeRecord => ({ edgeId: edge.id, sourceBlockId: edge.source, targetBlockId: edge.target, kind: edge.data?.kind ?? 'visual_note', inputRole: edge.data?.inputRole }));
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
    if (nextSelectedBlockIds.length === 0 && document.querySelector('.annotation-popover')) return;
    if (!sameBlockSelection(selectedBlockIdsRef.current, nextSelectedBlockIds)) setSelectedBlocks(snapshotRef.current, nextSelectedBlockIds, { source: 'flow' });
  }

  const onNodeClick: NodeMouseHandler<RetakeNode> = (_event, node) => dismissTerminalImageStatus(node.id);
  const onNodeDoubleClick: NodeMouseHandler<RetakeNode> = (event, node) => {
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

  function dismissTerminalImageStatus(blockId: string): void {
    const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId);
    if (block?.type !== 'image' || block.data.status !== 'succeeded' || block.data.statusVisualDismissed) return;
    updateSnapshot((current) => {
      const targetBlock = current.blocks.find((candidate) => candidate.blockId === blockId);
      if (targetBlock?.type !== 'image') return current;
      targetBlock.data.statusVisualDismissed = true;
      targetBlock.updatedAt = nowIso();
      return touchBoard(current);
    }, { persist: true });
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
    const node = reactFlowRef.current?.getNode(blockId);
    if (!node) return;
    selectBlock(blockId);
    const width = node.measured?.width ?? node.width ?? 280;
    const height = node.measured?.height ?? node.height ?? 180;
    void reactFlowRef.current?.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: Math.max(currentViewportRef.current.zoom, 0.85),
      duration: 260,
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

  function restoreViewport(viewport: Viewport): void {
    currentViewportRef.current = viewport;
    setCanvasZoom(viewport.zoom);
    window.requestAnimationFrame(() => { void reactFlowRef.current?.setViewport(viewport, { duration: 0 }); });
  }

  function persistViewport(viewport: Viewport): void {
    currentViewportRef.current = viewport;
    setCanvasZoom(viewport.zoom);
    const current = snapshotRef.current;
    const basis = viewportBasisFromElement(canvasAreaRef.current);
    const saved = loadBoardViewState(current.project.projectId, current.board.boardId);
    if (
      saved &&
      Math.abs(saved.viewport.x - viewport.x) < 0.5 &&
      Math.abs(saved.viewport.y - viewport.y) < 0.5 &&
      Math.abs(saved.viewport.zoom - viewport.zoom) < 0.001 &&
      Math.abs(saved.viewportBasis.canvasWidth - basis.canvasWidth) < 0.5 &&
      Math.abs(saved.viewportBasis.canvasHeight - basis.canvasHeight) < 0.5
    ) return;
    saveViewportForBoard(current, viewport, basis);
  }

  function restoreBoardViewport(loadedSnapshot: BoardSnapshot): void {
    const restoreToken = ++boardViewportRestoreTokenRef.current;
    const basis = viewportBasisFromElement(canvasAreaRef.current);
    const saved = loadBoardViewState(loadedSnapshot.project.projectId, loadedSnapshot.board.boardId);
    if (saved) {
      const adapted = adaptViewportToBasis(saved.viewport, saved.viewportBasis, basis, minBoardZoom, maxBoardZoom);
      if (viewportShowsAnyBlock(adapted, basis, loadedSnapshot.blocks)) {
        restoreViewport(adapted);
        return;
      }
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
    saveBoardViewState({
      schemaVersion: 1,
      projectId: current.project.projectId,
      boardId: current.board.boardId,
      viewport,
      viewportBasis: basis,
      updatedAt: new Date().toISOString(),
    });
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
    onNodeDragStop,
    onNodesChange,
    onSelectionChange,
    persistViewport,
    reactFlowRef,
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
  };
}
