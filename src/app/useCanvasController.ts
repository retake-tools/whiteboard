import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type NodeMouseHandler,
  type OnNodeDrag,
  type OnConnectEnd,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import { useEffect, useRef, useState, type RefObject } from 'react';
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
  blockManagedByWorkflowGroup,
  findGroupDropTarget,
  groupAncestorIds,
} from '../core/grouping';
import { loadCollapsedGroupIds } from '../core/groupViewState';
import { connectedWorkflowBlockIds } from '../core/workflowSelection';
import {
  compatibleInputSlotIdsFor,
} from '../core/capabilities';
import { createId, nowIso } from '../core/id';
import { suggestedExecutionInputSlotId } from '../core/operationInputSlots';
import { moveBlockGroupToNearestFreeArea } from '../core/workflowPlacement';
import type {
  BlockRecord,
  BoardEdgeRecord,
  BoardSnapshot,
} from '../core/types';
import type { RetakeEdge, RetakeNode } from '../canvas/reactFlowTypes';
import type { CanvasTool } from '../components/FloatingToolbar';
import type { useI18n } from '../i18n';
import {
  absoluteFlowNodeBounds,
  absoluteFlowNodePositions,
  flowNodeSize,
  isEditableNodeTarget,
  isInteractiveNodeTarget,
  sameBlockSelection,
  selectedOperationBlockIdFor,
} from './appHelpers';
import { safeViewportForBounds } from './canvasFocus';
import {
  projectFlowEdgeSelection,
  projectFlowNodeSelection,
} from './canvasSelectionProjection';
import { retainFlowNodeMeasurements } from './canvasLiveProjection';
import {
  imageComposerWorkflowGeometry,
  type ImageComposerWorkflowLayoutInput,
} from './imageComposerWorkflowLayout';
import type { BoardSessionPorts } from './useBoardSession';
import type {
  PluginContributionRegistryV1,
  RegisteredPluginCommandV1,
} from '../host-kit/plugin';
import type { CanvasHostCommandsV1 } from '../host-kit';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';

const terminalImageStatusDismissDelayMs = 500;

interface CanvasControllerOptions {
  connectSessionPorts: (ports: BoardSessionPorts) => void;
  onPluginContributionFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  pluginContributionRegistry?: PluginContributionRegistryV1;
  redo: () => void;
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
  setHistoryOpen: (open: boolean) => void;
  setInspectorBlockId: (blockId: string | undefined) => void;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  undo: () => void;
}

export function useCanvasController(options: CanvasControllerOptions) {
  const {
    connectSessionPorts,
    onPluginContributionFatalFailure,
    pluginContributionRegistry,
    redo,
    runHostCommand,
    runProductCommand,
    setHistoryOpen,
    setInspectorBlockId,
    snapshot,
    snapshotRef,
    undo,
  } = options;
  const canvasAreaRef = useRef<HTMLElement | null>(null);
  const currentViewportRef = useRef<Viewport>(defaultBoardViewport);
  const boardViewportRestoreTokenRef = useRef(0);
  const focusRequestTokenRef = useRef(0);
  const pendingViewportPersistRef = useRef<Viewport | undefined>(undefined);
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
  const canvasZoomRef = useRef(canvasZoom);
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
      focusRequestTokenRef.current += 1;
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
      if (!nodeDragActiveRef.current) {
        setNodes((current) => retainFlowNodeMeasurements(
          createFlowNodesForSelection(remoteSnapshot),
          current,
        ));
      }
      setEdges(createFlowEdgesForSelection(remoteSnapshot));
      setSelectedBlockIds((current) => current.filter((blockId) => remoteSnapshot.blocks.some((block) => block.blockId === blockId)));
    },
    syncFlow: (nextSnapshot) => {
      setNodes((current) => retainFlowNodeMeasurements(
        createFlowNodesForSelection(nextSnapshot),
        current,
      ));
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
    setNodes((current) => retainFlowNodeMeasurements(
      createFlowNodesForSelection(snapshotRef.current),
      current,
    ));
    setEdges(createFlowEdgesForSelection(snapshotRef.current));
  }, [snapshot]);

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
    const removableEdgeIds = removeChanges
      .map((change) => snapshotRef.current.edges.find((edge) => edge.edgeId === change.id))
      .filter((edge): edge is BoardEdgeRecord => Boolean(edge)
        && !blockLockedByGroup(snapshotRef.current, edge!.sourceBlockId)
        && !blockLockedByGroup(snapshotRef.current, edge!.targetBlockId)
        && !blockManagedByWorkflowGroup(snapshotRef.current, edge!.sourceBlockId)
        && !blockManagedByWorkflowGroup(snapshotRef.current, edge!.targetBlockId))
      .map((edge) => edge.edgeId);
    if (removableEdgeIds.length > 0) {
      void requireHostCommands(runHostCommand)(
        (commands) => commands.removeConnections({ edgeIds: removableEdgeIds }),
        { history: true },
      ).catch((error: unknown) => {
        console.error('Canvas connection removal failed.', error);
        setEdges(createFlowEdgesForSelection(snapshotRef.current));
      });
      return;
    }
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
    const simpleMoves = topLevelDraggedBlockIds.flatMap((blockId) => {
      const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId);
      const position = absolutePositions.get(blockId);
      if (
        !block
        || !position
        || block.type === 'group'
        || block.parentGroupId
        || blockLockedByGroup(snapshotRef.current, blockId)
        || findGroupDropTarget(
          snapshotRef.current,
          blockId,
          { ...position, ...flowNodeSize(flowNodeById.get(blockId), block) },
          collapsedGroupIdsRef.current,
        )
      ) return [];
      return block.position.x === position.x && block.position.y === position.y
        ? []
        : [{ blockId, position }];
    });
    if (
      runHostCommand
      && simpleMoves.length > 0
      && simpleMoves.length === topLevelDraggedBlockIds.length
    ) {
      void runHostCommand(
        (commands) => commands.moveBlocks({ moves: simpleMoves }),
        { history: true },
      ).catch((error: unknown) => {
        console.error('Canvas Block move failed.', error);
        setNodes((current) => retainFlowNodeMeasurements(
          createFlowNodesForSelection(snapshotRef.current),
          current,
        ));
      }).finally(() => {
        nodeDragActiveRef.current = false;
      });
      return;
    }
    const current = snapshotRef.current;
    const draggedBlocks = topLevelDraggedBlockIds.flatMap((blockId) => {
      const block = current.blocks.find((candidate) => candidate.blockId === blockId);
      const position = absolutePositions.get(blockId);
      return block && position
        ? [{ blockId, position, size: flowNodeSize(flowNodeById.get(blockId), block) }]
        : [];
    });
    void requireProductCommands(runProductCommand)(
      (commands) => commands.canvas.commitDrag({
        absolutePositions: [...absolutePositions].map(([blockId, position]) => ({ blockId, position })),
        collapsedGroupIds: collapsedGroupIdsRef.current,
        draggedBlocks,
        expectedScope: {
          boardId: current.board.boardId,
          projectId: current.project.projectId,
        },
      }),
      { history: true, shouldKeepHistory: (result) => result.committed },
    ).catch((error: unknown) => {
      console.error('Canvas complex Block move failed.', error);
      setNodes((current) => retainFlowNodeMeasurements(
        createFlowNodesForSelection(snapshotRef.current),
        current,
      ));
    }).finally(() => {
      nodeDragActiveRef.current = false;
    });
  }

  function onConnect(connection: Connection): void {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const sourceBlock = snapshotRef.current.blocks.find((block) => block.blockId === connection.source);
    const targetBlock = snapshotRef.current.blocks.find((block) => block.blockId === connection.target);
    if (blockLockedByGroup(snapshotRef.current, connection.source) || blockLockedByGroup(snapshotRef.current, connection.target)) return;
    if (
      blockManagedByWorkflowGroup(snapshotRef.current, connection.source)
      || blockManagedByWorkflowGroup(snapshotRef.current, connection.target)
    ) return;
    const kind = connectionKindForBlocks(sourceBlock, targetBlock);
    const edgeId = createId('edge');
    const compatibleInputSlotIds = kind === 'execution_input' && sourceBlock && targetBlock
      ? compatibleInputSlotIdsFor(sourceBlock, targetBlock)
      : [];
    const inputSlotId = kind === 'execution_input' && sourceBlock && targetBlock
      ? suggestedExecutionInputSlotId(snapshotRef.current, sourceBlock, targetBlock)
      : undefined;
    const nextEdges = addEdge({ ...connection, id: edgeId, source: connection.source, target: connection.target, type: 'default', label: kind, data: { kind, inputSlotId } } satisfies RetakeEdge, edges);
    setEdges(nextEdges);
    const nextSnapshot = snapshotRef.current;
    void requireHostCommands(runHostCommand)(
        (commands) => commands.connectBlocks({
          edgeId,
          inputSlotId,
          kind,
          sourceBlockId: connection.source!,
          targetBlockId: connection.target!,
        }),
        { history: true },
      ).catch((error: unknown) => {
        console.error('Canvas connection creation failed.', error);
        setEdges(createFlowEdgesForSelection(snapshotRef.current));
      });
    if (
      kind === 'execution_input'
      && sourceBlock?.type === 'image'
      && targetBlock?.type === 'operation'
      && compatibleInputSlotIds.length > 0
    ) {
      const targetElement = document.querySelector<HTMLElement>(
        `.react-flow__node[data-id="${CSS.escape(targetBlock.blockId)}"]`,
      );
      const rect = targetElement?.getBoundingClientRect();
      window.dispatchEvent(new CustomEvent('retake:configure-operation-reference', {
        detail: {
          edgeId,
          anchor: {
            x: rect ? rect.left + Math.min(rect.width, 180) : window.innerWidth / 2,
            y: rect ? rect.bottom + 8 : window.innerHeight / 2,
          },
        },
      }));
      setSelectedBlock(nextSnapshot, targetBlock.blockId);
    }
  }

  const onConnectEnd: OnConnectEnd = (event, connectionState) => {
    if (connectionState.isValid || !connectionState.fromNode) return;
    const sourceBlock = snapshotRef.current.blocks.find(
      (block) => block.blockId === connectionState.fromNode?.id,
    );
    if (sourceBlock?.type !== 'image') return;
    const point = 'changedTouches' in event
      ? event.changedTouches[0]
      : event;
    if (!point) return;
    window.dispatchEvent(new CustomEvent('retake:create-operation-from-image', {
      detail: {
        anchor: { x: point.clientX, y: point.clientY },
        sourceBlockId: sourceBlock.blockId,
      },
    }));
  };

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
    if (node.type === 'image') {
      if (isImageDetailNodeEventTarget(event.target)) {
        window.dispatchEvent(new CustomEvent('retake:open-execution-inspector', {
          detail: { blockId: node.id },
        }));
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }
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
      void requireHostCommands(runHostCommand)((commands) => commands.updateBlock({
          blockId,
          data: { statusVisualDismissed: true },
        })).catch((error: unknown) => {
          console.error('Canvas image status update failed.', error);
        });
    }, terminalImageStatusDismissDelayMs);
  }

  function cancelTerminalImageStatusDismiss(): void {
    if (terminalImageStatusDismissTimerRef.current === undefined) return;
    window.clearTimeout(terminalImageStatusDismissTimerRef.current);
    terminalImageStatusDismissTimerRef.current = undefined;
  }

  function updateTextBlockBody(blockId: string, body: string): void {
    const current = snapshotRef.current;
    const block = current.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'text');
    if (!block || blockLockedByGroup(current, blockId) || block.data.body === body) return;
    void requireHostCommands(runHostCommand)(
        (commands) => commands.updateBlock({ blockId, body }),
        { history: true },
      ).catch((error: unknown) => {
        console.error('Canvas Text Block update failed.', error);
      });
  }

  function setSelectedBlock(nextSnapshot: BoardSnapshot, blockId: string): void {
    setSelectedBlocks(nextSnapshot, [blockId]);
  }

  function setSelectedBlocks(
    nextSnapshot: BoardSnapshot,
    blockIds: string[],
    selectionOptions: { source?: 'app' | 'flow' } = {},
  ): void {
    const currentNodes = reactFlowRef.current?.getNodes() ?? nodes;
    const visibleBlockIds = new Set(currentNodes.map((node) => node.id));
    const requiresProjectionRefresh = blockIds.some(
      (blockId) => !visibleBlockIds.has(blockId),
    );
    const refreshedNodes = requiresProjectionRefresh
      ? createFlowNodesForSelection(nextSnapshot, blockIds)
      : undefined;
    if (refreshedNodes) {
      visibleBlockIds.clear();
      refreshedNodes.forEach((node) => visibleBlockIds.add(node.id));
    }
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
    setNodes((current) => refreshedNodes
      ? retainFlowNodeMeasurements(refreshedNodes, current)
      : projectFlowNodeSelection(current, nextSnapshot, nextSelectedBlockIds));
    setEdges((current) => requiresProjectionRefresh
      ? createFlowEdgesForSelection(nextSnapshot, nextSelectedBlockIds)
      : projectFlowEdgeSelection(current, nextSnapshot, nextSelectedBlockIds));
  }

  function selectBlock(blockId: string): void {
    setSelectedBlock(snapshotRef.current, blockId);
  }

  function locateBlock(blockId: string): void {
    const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId);
    if (!block) return;
    selectBlock(blockId);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const reactFlow = reactFlowRef.current;
        if (!reactFlow) return;
        const bounds = absoluteFlowNodeBounds(reactFlow.getNodes(), block);
        if (!bounds) return;
        void reactFlow.setCenter(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, {
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

  function layoutImageComposerWorkflow(
    current: BoardSnapshot,
    input: ImageComposerWorkflowLayoutInput,
  ): void {
    const operationBlock = current.blocks.find(
      (block) => block.blockId === input.operationBlockId,
    );
    const textBlock = current.blocks.find(
      (block) => block.blockId === input.textBlockId,
    );
    if (!operationBlock || !textBlock) return;
    const outputSlotBlock = input.outputSlotBlockId
      ? current.blocks.find((block) => block.blockId === input.outputSlotBlockId)
      : undefined;
    const referenceBlocks = input.referenceBlockIds
      .map((blockId) => current.blocks.find((block) => block.blockId === blockId))
      .filter((block): block is BlockRecord => block?.type === 'image');
    const center = viewportCenter();
    const geometry = imageComposerWorkflowGeometry({
      center,
      operationBlock,
      outputSlotBlock,
      referenceBlocks,
      textBlock,
    });
    const positionedBlocks = geometry.blockIds
      .map((blockId) => current.blocks.find((block) => block.blockId === blockId))
      .filter((block): block is BlockRecord => Boolean(block));
    const updatedAt = nowIso();
    for (const block of positionedBlocks) {
      const position = geometry.positions[block.blockId];
      if (!position) continue;
      block.position = position;
      block.updatedAt = updatedAt;
    }
    moveBlockGroupToNearestFreeArea(current, positionedBlocks, center);
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

  function focusWorkflowBlocks(
    blockIds: string[],
    options: { maxZoom?: number } = {},
  ): void {
    const uniqueBlockIds = [...new Set(blockIds)];
    if (uniqueBlockIds.length === 0) return;
    const boardId = snapshotRef.current.board.boardId;
    const restoreToken = boardViewportRestoreTokenRef.current;
    const focusToken = ++focusRequestTokenRef.current;
    const attemptFocus = (attemptsRemaining: number): void => {
      if (
        focusToken !== focusRequestTokenRef.current
        || boardId !== snapshotRef.current.board.boardId
        || restoreToken !== boardViewportRestoreTokenRef.current
      ) return;
      const reactFlow = reactFlowRef.current;
      const canvasBounds = canvasAreaRef.current?.getBoundingClientRect();
      const nodes = reactFlow
        ? uniqueBlockIds
            .map((blockId) => reactFlow.getNode(blockId))
            .filter((node): node is RetakeNode => Boolean(node))
        : [];
      const viewport = reactFlow && nodes.length === uniqueBlockIds.length && canvasBounds
        ? safeViewportForBounds({
            bounds: reactFlow.getNodesBounds(nodes),
            canvas: { height: canvasBounds.height, width: canvasBounds.width },
            maxZoom: Math.min(options.maxZoom ?? 1, maxBoardZoom),
            minZoom: minBoardZoom,
          })
        : undefined;
      if (!reactFlow || !viewport) {
        if (attemptsRemaining > 0) {
          window.requestAnimationFrame(() => attemptFocus(attemptsRemaining - 1));
        }
        return;
      }
      void reactFlow.setViewport(viewport, { duration: 260 });
    };
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => attemptFocus(4));
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
    setSelectedBlocks(snapshotRef.current, selectedBlockIdsRef.current);
  }

  function restoreViewport(
    viewport: Viewport,
    restoreToken = boardViewportRestoreTokenRef.current,
    onApplied?: (viewport: Viewport) => void,
  ): void {
    syncCurrentViewport(viewport);
    window.requestAnimationFrame(() => {
      if (restoreToken !== boardViewportRestoreTokenRef.current) return;
      const reactFlow = reactFlowRef.current;
      if (!reactFlow) return;
      void reactFlow.setViewport(viewport, { duration: 0 }).then(() => {
        if (restoreToken !== boardViewportRestoreTokenRef.current) return;
        const appliedViewport = reactFlow.getViewport();
        syncCurrentViewport(appliedViewport);
        onApplied?.(appliedViewport);
      });
    });
  }

  function persistViewport(viewport: Viewport): void {
    syncCurrentViewport(viewport);
    clearScheduledViewportPersist();
    persistBoardViewState(boardViewStateFor(
      snapshotRef.current,
      viewport,
      viewportBasisFromElement(canvasAreaRef.current),
    ));
  }

  function scheduleViewportPersist(viewport: Viewport): void {
    syncCurrentViewport(viewport);
    pendingViewportPersistRef.current = viewport;
    if (viewportPersistTimerRef.current !== undefined) return;
    viewportPersistTimerRef.current = window.setTimeout(flushScheduledViewportPersist, 80);
  }

  function flushScheduledViewportPersist(): void {
    if (viewportPersistTimerRef.current !== undefined) {
      window.clearTimeout(viewportPersistTimerRef.current);
      viewportPersistTimerRef.current = undefined;
    }
    const pendingViewport = pendingViewportPersistRef.current;
    pendingViewportPersistRef.current = undefined;
    if (pendingViewport) {
      persistBoardViewState(boardViewStateFor(
        snapshotRef.current,
        pendingViewport,
        viewportBasisFromElement(canvasAreaRef.current),
      ));
    }
  }

  function syncCurrentViewport(viewport: Viewport): void {
    currentViewportRef.current = viewport;
    if (Math.abs(canvasZoomRef.current - viewport.zoom) < 0.0005) return;
    canvasZoomRef.current = viewport.zoom;
    setCanvasZoom(viewport.zoom);
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
      restoreViewport(adapted, restoreToken);
      return;
    }

    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (restoreToken !== boardViewportRestoreTokenRef.current) return;
      const reactFlow = reactFlowRef.current;
      if (!reactFlow) return;
      const nextBasis = viewportBasisFromElement(canvasAreaRef.current);
      if (loadedSnapshot.blocks.length === 0) {
        const emptyViewport = { x: nextBasis.canvasWidth / 2, y: nextBasis.canvasHeight / 2, zoom: 1 };
        restoreViewport(emptyViewport, restoreToken, (appliedViewport) => {
          saveViewportForBoard(loadedSnapshot, appliedViewport, nextBasis);
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
      setNodes((current) => retainFlowNodeMeasurements(
        createFlowNodesForSelection(snapshotRef.current),
        current,
      ));
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
    layoutImageComposerWorkflow,
    focusWorkflowBlocks,
    getViewportCenter: viewportCenter,
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
    onConnectEnd,
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

function isImageDetailNodeEventTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return !target.closest([
    '.block-heading',
    '.react-flow__handle',
    '.react-flow__resize-control',
    'button',
    'input',
    'select',
    'textarea',
  ].join(','));
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

function requireHostCommands(
  runHostCommand: CanvasControllerOptions['runHostCommand'],
): NonNullable<CanvasControllerOptions['runHostCommand']> {
  if (!runHostCommand) throw new Error('Canvas Host command facade is unavailable.');
  return runHostCommand;
}

function requireProductCommands(
  runProductCommand: CanvasControllerOptions['runProductCommand'],
): NonNullable<CanvasControllerOptions['runProductCommand']> {
  if (!runProductCommand) throw new Error('Whiteboard product command facade is unavailable.');
  return runProductCommand;
}
