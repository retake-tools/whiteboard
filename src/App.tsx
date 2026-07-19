import {
  Background,
  NodeToolbar,
  Position,
  ReactFlow,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Connection,
  type EdgeChange,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
  type OnSelectionChangeParams,
  type NodeMouseHandler,
  type OnNodeDrag,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { BoardHistoryPanel } from './components/BoardHistoryPanel';
import { CanvasMiniMap } from './components/CanvasMiniMap';
import { CanvasViewportControls } from './components/CanvasViewportControls';
import { ContextToolbar } from './components/ContextToolbar';
import { ExecutionInspector } from './components/ExecutionInspector';
import { ExecutionOutputEdge } from './components/ExecutionOutputEdge';
import { FloatingToolbar, type CanvasTool } from './components/FloatingToolbar';
import { GroupDrawOverlay, type DrawRect } from './components/GroupDrawOverlay';
import { GroupToolbar } from './components/GroupToolbar';
import { GroupInspector } from './components/GroupInspector';
import {
  InputReferencePicker,
  type ReferenceImageOption,
} from './components/InputReferencePicker';
import { OperationFeedback, type OperationToast, type PromptPreview } from './components/OperationFeedback';
import { ProjectBoardDialog } from './components/ProjectBoardDialog';
import { getProjectBoardDialogView } from './components/projectBoardDialogView';
import type { ProjectBoardDialogState } from './components/projectBoardTypes';
import { type AutosaveStatus, TopBar } from './components/TopBar';
import { createImageAssetFromDataUrl, getAssetPreviewUrl } from './core/assetStore';
import { localizedBlockData } from './core/blockLocalization';
import { createBlockRecord, maxZIndex, touchBoard } from './core/blockFactory';
import {
  createWorkspaceBoard,
  createWorkspaceProject,
  createFallbackBoardSnapshot,
  deleteWorkspaceBoard,
  deleteWorkspaceProject,
  duplicateWorkspaceBoard,
  loadBoardSnapshot,
  loadWorkspaceSummary,
  rememberCurrentBoard,
  renameWorkspaceBoard,
  renameWorkspaceProject,
  reorderWorkspaceBoards,
  reorderWorkspaceProjects,
  saveBoardSnapshot,
  subscribeToBoardSnapshotChanges,
} from './core/boardStore';
import { createFlowEdges, createFlowNodes } from './core/flowProjection';
import {
  arrangeGroupChildren,
  blockLockedByGroup,
  createGroupFromBounds,
  createGroupAroundBlocks,
  descendantBlockIds,
  dissolveGroup,
  expandGroupToContents,
  findGroupDropTarget,
  fitGroupToChildren,
  groupAncestorIds,
  groupBoundsContext,
  groupMediaItems,
  groupStructureLocked,
  type GroupBounds,
} from './core/grouping';
import { loadCollapsedGroupIds, saveCollapsedGroupIds } from './core/groupViewState';
import { connectedWorkflowBlockIds } from './core/workflowSelection';
import {
  activeExecutionsForBlockIds,
  cancelExecution,
  executionCancellationRequiresConfirmation,
} from './core/executionLifecycle';
import { appendPromptCopiedEvent } from './core/historyEvents';
import { readFileAsDataUrl, readImageDimensions } from './core/imageFile';
import { attachImportedImageAsset } from './core/imageBlockAsset';
import { imageBranchDraftSelectionBlockIds } from './core/imageOperationLayout';
import {
  disabledExecutionInputRolesFor,
  executionInputRoleOptionsFor,
  operationReadinessFor,
  operationReadinessMessageKey,
  schemaForCapability,
} from './core/capabilities';
import {
  addImageCodexOperation,
  addLocalImageOperation,
  completeLocalImageOperation,
  createDraftImageToImageOperation,
  createDraftTextToImageOperation,
  displaySlotSizeForGenerationParams,
  executeExistingImageOperationBlock,
  failLocalImageOperation,
  type ImageCodexOperation,
  type ImageGenerationParams,
  type SwitchableOperationMode,
} from './core/imageOperations';
import { renderAdjustedImage, type LocalImageAdjustments } from './core/localImageTransforms';
import { imageOperationDefaultPrompt, imageOperationTitle } from './core/imageOperationText';
import { createId, nowIso } from './core/id';
import { arraysEqual, numberedDefaultName } from './core/listUtils';
import { createImageResultRetryPrompt } from './core/prompts';
import { loadUiPreferences, saveUiPreferences } from './core/uiPreferences';
import { restoreExecutionConfiguration } from './core/restoreExecutionConfiguration';
import {
  annotationDraftRestoreContext,
  restoreExecutionAnnotationDraft,
} from './core/restoreAnnotationDraft';
import { dismissPopoversEvent } from './hooks/useDismissiblePopover';
import { useI18n } from './i18n';
import type {
  AssetRecord,
  BlockRecord,
  BlockType,
  BoardEdgeRecord,
  BoardSnapshot,
  ExecutionInputRole,
  GroupColor,
  GroupLayoutMode,
  RetakeEdge,
  RetakeNode,
  WorkspaceSummary,
} from './core/types';
import {
  annotationDraftContentEquals,
  annotationDraftHasContent,
  annotationDraftMatches,
  type AnnotationDraftContent,
  type AnnotationManifest,
} from './core/imageAnnotations';
import { BlockNode } from './nodes/BlockNode';

const minCanvasZoom = 0.05;
const maxCanvasZoom = 5;
const nodeTypes = { text: BlockNode, image: BlockNode, video: BlockNode, operation: BlockNode, group: BlockNode } satisfies NodeTypes;
const edgeTypes = { executionOutput: ExecutionOutputEdge } satisfies EdgeTypes;

interface InputReferencePickerState {
  anchor: { x: number; y: number };
  body: string;
  cursorIndex: number;
  operationBlockId: string;
  sourceBlockId?: string;
  textBlockId: string;
}

export function App(): ReactElement {
  const { t } = useI18n();
  const initialSnapshot = useRef<BoardSnapshot | null>(null);
  const initialUiPreferences = useRef(loadUiPreferences());
  const history = useRef<{ past: BoardSnapshot[]; future: BoardSnapshot[] }>({ past: [], future: [] });
  if (initialSnapshot.current === null) {
    initialSnapshot.current = createFallbackBoardSnapshot();
  }

  const [snapshot, setSnapshot] = useState<BoardSnapshot>(() => initialSnapshot.current!);
  const snapshotRef = useRef<BoardSnapshot>(initialSnapshot.current);
  const canvasAreaRef = useRef<HTMLElement | null>(null);
  const currentViewportRef = useRef<Viewport>(initialSnapshot.current.viewport);
  const directImageImportInputRef = useRef<HTMLInputElement | null>(null);
  const pendingDirectImageImportBlockIdRef = useRef<string | undefined>(undefined);
  const reactFlowRef = useRef<ReactFlowInstance<RetakeNode, RetakeEdge> | null>(null);
  const pendingPersistCountRef = useRef(0);
  const initialSnapshotLoadedRef = useRef(false);
  const annotationDraftPersistTimerRef = useRef<number | undefined>(undefined);
  const selectedBlockIdsRef = useRef<string[]>([]);
  const textBlockDraftsRef = useRef<Map<string, string>>(new Map());
  const pendingFlowSelectionRef = useRef<string[] | undefined>(undefined);
  const flowSelectionSyncTokenRef = useRef(0);
  const collapsedGroupIdsRef = useRef<string[]>(
    loadCollapsedGroupIds(initialSnapshot.current.project.projectId, initialSnapshot.current.board.boardId),
  );
  const dropTargetGroupIdRef = useRef<string | undefined>(undefined);
  const dropDetachGroupIdRef = useRef<string | undefined>(undefined);
  const [nodes, setNodes] = useState<RetakeNode[]>(() => createFlowNodes(initialSnapshot.current!));
  const [edges, setEdges] = useState<RetakeEdge[]>(() => createFlowEdges(initialSnapshot.current!));
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<string[]>(collapsedGroupIdsRef.current);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [operationToast, setOperationToast] = useState<OperationToast | undefined>();
  const [promptPreview, setPromptPreview] = useState<PromptPreview | undefined>();
  const [copiedPromptKey, setCopiedPromptKey] = useState<string | undefined>();
  const [inspectorBlockId, setInspectorBlockId] = useState<string | undefined>();
  const [activeCanvasTool, setActiveCanvasTool] = useState<CanvasTool>('pan');
  const [, setDropTargetGroupId] = useState<string | undefined>();
  const [canvasZoom, setCanvasZoom] = useState(() => currentViewportRef.current.zoom);
  const [isMiniMapVisible, setIsMiniMapVisible] = useState(() => initialUiPreferences.current.isMiniMapVisible);
  const [showGrid, setShowGrid] = useState(() => initialUiPreferences.current.showGrid);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | undefined>();
  const [projectBoardDialog, setProjectBoardDialog] = useState<ProjectBoardDialogState | undefined>();
  const [inputReferencePicker, setInputReferencePicker] = useState<InputReferencePickerState | undefined>();
  const copiedPromptTimer = useRef<number | undefined>(undefined);
  const [, setHistoryRevision] = useState(0);
  snapshotRef.current = snapshot;

  useEffect(() => {
    let cancelled = false;

    void loadBoardSnapshot().then((loadedSnapshot) => {
      if (cancelled) return;
      initialSnapshotLoadedRef.current = true;
      snapshotRef.current = loadedSnapshot;
      restoreViewport(loadedSnapshot.viewport);
      setSnapshot(loadedSnapshot);
      setNodes(createFlowNodesForSelection(loadedSnapshot, []));
      setEdges(createFlowEdgesForSelection(loadedSnapshot, []));
      history.current = { past: [], future: [] };
      setHistoryRevision((revision) => revision + 1);
    });
    void loadWorkspaceSummary()
      .then((loadedWorkspace) => {
        if (!cancelled) setWorkspace(loadedWorkspace);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onResizeGroup(event: Event): void {
      const detail = (event as CustomEvent<{
        blockId?: string;
        position?: { x: number; y: number };
        size?: { width: number; height: number };
      }>).detail;
      if (!detail?.blockId || !detail.position || !detail.size) return;
      const { blockId, position, size } = detail;
      updateSnapshot(
        (current) => {
          const group = current.blocks.find((block) => block.blockId === blockId && block.type === 'group');
          if (!group || group.data.groupPositionLocked || blockLockedByGroup(current, blockId)) return current;
          const parent = group.parentGroupId
            ? current.blocks.find((block) => block.blockId === group.parentGroupId && block.type === 'group')
            : undefined;
          group.position = {
            x: position.x + (parent?.position.x ?? 0),
            y: position.y + (parent?.position.y ?? 0),
          };
          group.size = { ...size };
          group.updatedAt = nowIso();
          if (group.parentGroupId) expandGroupToContents(current, group.parentGroupId);
          return touchBoard(current);
        },
        { persist: true, history: true },
      );
    }

    window.addEventListener('retake:resize-group', onResizeGroup);
    return () => window.removeEventListener('retake:resize-group', onResizeGroup);
  }, []);

  useEffect(() => {
    saveUiPreferences({ isMiniMapVisible });
  }, [isMiniMapVisible]);

  useEffect(() => {
    saveUiPreferences({ showGrid });
  }, [showGrid]);

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
    return subscribeToBoardSnapshotChanges({
      getCurrentSnapshot: () => snapshotRef.current,
      isPaused: () => pendingPersistCountRef.current > 0,
      onSnapshot: (remoteSnapshot) => {
        if (pendingPersistCountRef.current > 0) return;
        if (isOlderSnapshot(remoteSnapshot, snapshotRef.current)) return;
        snapshotRef.current = remoteSnapshot;
        setSnapshot(remoteSnapshot);
        setNodes(createFlowNodesForSelection(remoteSnapshot));
        setEdges(createFlowEdgesForSelection(remoteSnapshot));
        setSelectedBlockIds((current) =>
          current.filter((blockId) => remoteSnapshot.blocks.some((block) => block.blockId === blockId)),
        );
        setAutosaveStatus('saved');
      },
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.target instanceof HTMLElement && isEditableNodeTarget(event.target)) return;
      const isUndo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey;
      const isRedo =
        ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'z') ||
        ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y');

      if (isUndo) {
        event.preventDefault();
        undo();
      }
      if (isRedo) {
        event.preventDefault();
        redo();
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && selectedBlockIdsRef.current.length > 0) {
        event.preventDefault();
        deleteBlockIds(selectedBlockIdsRef.current);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    return () => {
      if (copiedPromptTimer.current) window.clearTimeout(copiedPromptTimer.current);
    };
  }, []);

  useEffect(() => {
    function onOpenInspector(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string }>).detail;
      if (!detail?.blockId) return;
      const current = snapshotRef.current;
      if (!current.blocks.some((block) => block.blockId === detail.blockId)) return;
      setIsHistoryOpen(false);
      setInspectorBlockId(detail.blockId);
      setSelectedBlock(current, detail.blockId);
    }

    window.addEventListener('retake:open-execution-inspector', onOpenInspector);
    return () => window.removeEventListener('retake:open-execution-inspector', onOpenInspector);
  }, []);

  useEffect(() => {
    function onRetryImageResult(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string }>).detail;
      if (!detail?.blockId) return;
      void retryFailedImageResult(detail.blockId);
    }

    window.addEventListener('retake:retry-image-result', onRetryImageResult);
    return () => window.removeEventListener('retake:retry-image-result', onRetryImageResult);
  }, []);

  useEffect(() => {
    function onAddOperationInput(event: Event): void {
      const detail = (event as CustomEvent<{ operationBlockId?: string; type?: BlockType }>).detail;
      if (!detail?.operationBlockId) return;
      if (detail.type !== 'text' && detail.type !== 'image' && detail.type !== 'video') return;
      addOperationInputBlock(detail.operationBlockId, detail.type);
    }

    window.addEventListener('retake:add-operation-input', onAddOperationInput);
    return () => window.removeEventListener('retake:add-operation-input', onAddOperationInput);
  }, []);

  useEffect(() => {
    function onPreviewTextBlock(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; body?: string }>).detail;
      if (!detail?.blockId || typeof detail.body !== 'string') return;
      const block = snapshotRef.current.blocks.find(
        (candidate) => candidate.blockId === detail.blockId && candidate.type === 'text',
      );
      if (!block || blockLockedByGroup(snapshotRef.current, block.blockId)) return;
      textBlockDraftsRef.current.set(block.blockId, detail.body);
      setNodes(createFlowNodesForSelection(snapshotRef.current));
    }

    window.addEventListener('retake:preview-text-block', onPreviewTextBlock);
    return () => window.removeEventListener('retake:preview-text-block', onPreviewTextBlock);
  }, []);

  useEffect(() => {
    function onUpdateTextBlock(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; body?: string }>).detail;
      if (!detail?.blockId || typeof detail.body !== 'string') return;
      textBlockDraftsRef.current.delete(detail.blockId);
      updateTextBlockBody(detail.blockId, detail.body);
    }

    window.addEventListener('retake:update-text-block', onUpdateTextBlock);
    return () => window.removeEventListener('retake:update-text-block', onUpdateTextBlock);
  }, []);

  useEffect(() => {
    function onRequestImageMention(event: Event): void {
      const detail = (
        event as CustomEvent<{
          anchor?: { x: number; y: number };
          body?: string;
          cursorIndex?: number;
          textBlockId?: string;
        }>
      ).detail;
      if (
        !detail?.anchor ||
        typeof detail.body !== 'string' ||
        typeof detail.cursorIndex !== 'number' ||
        !detail.textBlockId
      ) {
        return;
      }
      const promptEdge = snapshotRef.current.edges.find(
        (edge) =>
          edge.sourceBlockId === detail.textBlockId &&
          edge.kind === 'execution_input' &&
          snapshotRef.current.blocks.some(
            (block) => block.blockId === edge.targetBlockId && block.type === 'operation',
          ),
      );
      if (!promptEdge) return;
      setInputReferencePicker({
        anchor: detail.anchor,
        body: detail.body,
        cursorIndex: detail.cursorIndex,
        operationBlockId: promptEdge.targetBlockId,
        textBlockId: detail.textBlockId,
      });
    }

    window.addEventListener('retake:request-image-mention', onRequestImageMention);
    return () => window.removeEventListener('retake:request-image-mention', onRequestImageMention);
  }, []);

  useEffect(() => {
    function onUpdateOperationInputRole(event: Event): void {
      const detail = (event as CustomEvent<{ edgeId?: string; inputRole?: ExecutionInputRole }>).detail;
      if (!detail?.edgeId || !detail.inputRole) return;
      updateOperationInputRole(detail.edgeId, detail.inputRole);
    }

    window.addEventListener('retake:update-operation-input-role', onUpdateOperationInputRole);
    return () => window.removeEventListener('retake:update-operation-input-role', onUpdateOperationInputRole);
  }, []);

  useEffect(() => {
    function onRemoveOperationInput(event: Event): void {
      const detail = (event as CustomEvent<{ edgeId?: string }>).detail;
      if (!detail?.edgeId) return;
      removeOperationInput(detail.edgeId);
    }

    window.addEventListener('retake:remove-operation-input', onRemoveOperationInput);
    return () => window.removeEventListener('retake:remove-operation-input', onRemoveOperationInput);
  }, []);

  useEffect(() => {
    function onSelectConnectedWorkflow(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string }>).detail;
      if (!detail?.blockId) return;
      selectConnectedWorkflow(detail.blockId);
    }

    window.addEventListener('retake:select-connected-workflow', onSelectConnectedWorkflow);
    return () => window.removeEventListener('retake:select-connected-workflow', onSelectConnectedWorkflow);
  }, []);

  useEffect(() => {
    function onRequestImageImport(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string }>).detail;
      if (!detail?.blockId) return;
      const block = snapshotRef.current.blocks.find(
        (candidate) => candidate.blockId === detail.blockId && candidate.type === 'image',
      );
      if (!block || block.data.assetId || blockLockedByGroup(snapshotRef.current, block.blockId)) return;
      pendingDirectImageImportBlockIdRef.current = block.blockId;
      directImageImportInputRef.current?.click();
    }

    window.addEventListener('retake:request-image-import', onRequestImageImport);
    return () => window.removeEventListener('retake:request-image-import', onRequestImageImport);
  }, []);

  function updateSnapshot(
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options: { syncFlow?: boolean; persist?: boolean; history?: boolean } = {},
  ): BoardSnapshot {
    const shouldSyncFlow = options.syncFlow ?? true;
    const currentSnapshot = snapshotRef.current;
    const nextSnapshot = updater(structuredClone(currentSnapshot));

    if (options.history) {
      history.current.past.push(structuredClone(currentSnapshot));
      history.current.future = [];
      setHistoryRevision((revision) => revision + 1);
    }

    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    if (shouldSyncFlow) {
      setNodes(createFlowNodesForSelection(nextSnapshot));
      setEdges(createFlowEdgesForSelection(nextSnapshot));
    }
    if (options.persist) {
      void persistSnapshot(nextSnapshot);
    }
    return nextSnapshot;
  }

  function createFlowNodesForSelection(
    nextSnapshot: BoardSnapshot,
    blockIds = selectedBlockIdsRef.current,
  ): RetakeNode[] {
    return createFlowNodes(nextSnapshot, {
      collapsedGroupIds: collapsedGroupIdsRef.current,
      dropDetachGroupId: dropDetachGroupIdRef.current,
      dropTargetGroupId: dropTargetGroupIdRef.current,
      selectedBlockIds: blockIds,
      selectedOperationBlockId: selectedOperationBlockIdFor(nextSnapshot, blockIds),
      textBlockDrafts: textBlockDraftsRef.current,
    }).map((node) => ({
      ...node,
      selected: blockIds.includes(node.id),
    }));
  }

  function createFlowEdgesForSelection(nextSnapshot: BoardSnapshot, blockIds = selectedBlockIds): RetakeEdge[] {
    return createFlowEdges(nextSnapshot, {
      collapsedGroupIds: collapsedGroupIdsRef.current,
      selectedBlockIds: blockIds,
    });
  }

  function onNodesChange(changes: NodeChange[]): void {
    const removeChanges = changes.filter((change) => change.type === 'remove');
    if (removeChanges.length > 0) {
      deleteBlockIds(removeChanges.map((change) => change.id));
      return;
    }
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes) as RetakeNode[]);
  }

  function onEdgesChange(changes: EdgeChange[]): void {
    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges) as RetakeEdge[]);

    const removeChanges = changes.filter((change) => change.type === 'remove');
    if (removeChanges.length === 0) return;

    updateSnapshot((current) => {
      const removedEdgeIds = new Set(
        removeChanges
          .map((change) => current.edges.find((edge) => edge.edgeId === change.id))
          .filter(
            (edge): edge is BoardEdgeRecord =>
              Boolean(edge) &&
              !blockLockedByGroup(current, edge!.sourceBlockId) &&
              !blockLockedByGroup(current, edge!.targetBlockId),
          )
          .map((edge) => edge.edgeId),
      );
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
    const targetGroupId = findGroupDropTarget(
      snapshotRef.current,
      node.id,
      { ...position, ...size },
      collapsedGroupIdsRef.current,
    );
    const isChangingParent = targetGroupId !== sourceBlock.parentGroupId;
    setGroupDropFeedback(
      isChangingParent ? targetGroupId : undefined,
      isChangingParent ? sourceBlock.parentGroupId : undefined,
    );
  };

  function setGroupDropFeedback(targetGroupId: string | undefined, detachGroupId: string | undefined): void {
    if (
      dropTargetGroupIdRef.current === targetGroupId &&
      dropDetachGroupIdRef.current === detachGroupId
    ) return;
    dropTargetGroupIdRef.current = targetGroupId;
    dropDetachGroupIdRef.current = detachGroupId;
    setDropTargetGroupId(targetGroupId);
    setNodes((currentNodes) => currentNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        groupDropDetach: node.id === detachGroupId,
        groupDropTarget: node.id === targetGroupId,
      },
    })));
  }

  function onNodeDragStop(_event: MouseEvent | TouchEvent, node: RetakeNode, draggedNodes: RetakeNode[]): void {
    const flowNodes = reactFlowRef.current?.getNodes() ?? nodes;
    const absolutePositions = absoluteFlowNodePositions(flowNodes);
    const flowNodeById = new Map(flowNodes.map((flowNode) => [flowNode.id, flowNode]));
    const draggedBlockIds = new Set([node.id, ...draggedNodes.map((draggedNode) => draggedNode.id)]);
    const topLevelDraggedBlockIds = [...draggedBlockIds].filter(
      (blockId) => !groupAncestorIds(snapshotRef.current, blockId).some((groupId) => draggedBlockIds.has(groupId)),
    );
    setGroupDropFeedback(undefined, undefined);
    updateSnapshot(
      (current) => {
        const updatedAt = nowIso();
        for (const block of current.blocks) {
          const position = absolutePositions.get(block.blockId);
          if (!position) continue;
          if (block.position.x === position.x && block.position.y === position.y) continue;
          block.position = position;
          block.updatedAt = updatedAt;
        }

        for (const blockId of topLevelDraggedBlockIds) {
          const block = current.blocks.find((candidate) => candidate.blockId === blockId);
          const position = absolutePositions.get(blockId);
          if (!block || !position || blockLockedByGroup(current, blockId)) continue;
          const previousParent = block.parentGroupId
            ? current.blocks.find((candidate) => candidate.blockId === block.parentGroupId && candidate.type === 'group')
            : undefined;
          if (previousParent && previousParent.data.groupLayoutMode !== 'free') {
            previousParent.data.groupLayoutMode = 'free';
            previousParent.updatedAt = updatedAt;
          }
          const size = flowNodeSize(flowNodeById.get(blockId), block);
          const parentGroupId = findGroupDropTarget(
            current,
            blockId,
            { ...position, ...size },
            collapsedGroupIdsRef.current,
          );
          if (parentGroupId === block.parentGroupId) continue;
          block.parentGroupId = parentGroupId;
          block.updatedAt = updatedAt;
        }

        return touchBoard(current);
      },
      { syncFlow: true, persist: true, history: true },
    );
  }

  function onConnect(connection: Connection): void {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    const sourceBlock = snapshotRef.current.blocks.find((block) => block.blockId === connection.source);
    const targetBlock = snapshotRef.current.blocks.find((block) => block.blockId === connection.target);
    if (
      blockLockedByGroup(snapshotRef.current, connection.source) ||
      blockLockedByGroup(snapshotRef.current, connection.target)
    ) return;
    const kind = connectionKindForBlocks(sourceBlock, targetBlock);
    const requiresInputRole =
      kind === 'execution_input' &&
      sourceBlock &&
      targetBlock &&
      executionInputRoleOptionsFor(sourceBlock, targetBlock).length > 0;
    const edgeId = createId('edge');
    const nextEdge: RetakeEdge = {
      ...connection,
      id: edgeId,
      source: connection.source,
      target: connection.target,
      type: 'default',
      label: kind,
      data: { kind },
    };

    const nextEdges = addEdge(nextEdge, edges);
    setEdges(nextEdges);
    const nextSnapshot = updateSnapshot((current) => {
      current.edges = nextEdges.map(
        (edge): BoardEdgeRecord => ({
          edgeId: edge.id,
          sourceBlockId: edge.source,
          targetBlockId: edge.target,
          kind: edge.data?.kind ?? 'visual_note',
          inputRole: edge.data?.inputRole,
        }),
      );
      return touchBoard(current);
    }, { persist: true, history: true });
    if (requiresInputRole && targetBlock) setSelectedBlock(nextSnapshot, targetBlock.blockId);
  }

  function connectionKindForBlocks(sourceBlock?: BlockRecord, targetBlock?: BlockRecord): BoardEdgeRecord['kind'] {
    if (targetBlock?.type === 'operation' && sourceBlock?.type !== 'operation') return 'execution_input';
    if (sourceBlock?.type === 'operation' && targetBlock?.type !== 'operation') return 'execution_output';
    return 'visual_note';
  }

  function onSelectionChange(params: OnSelectionChangeParams): void {
    const nextSelectedBlockIds = params.nodes.map((node) => node.id);
    const pendingSelection = pendingFlowSelectionRef.current;
    if (pendingSelection) {
      if (sameBlockSelection(pendingSelection, nextSelectedBlockIds)) {
        pendingFlowSelectionRef.current = undefined;
      }
      return;
    }
    if (nextSelectedBlockIds.length === 0 && document.querySelector('.annotation-popover')) {
      return;
    }
    if (sameBlockSelection(selectedBlockIdsRef.current, nextSelectedBlockIds)) return;
    setSelectedBlocks(snapshotRef.current, nextSelectedBlockIds, { source: 'flow' });
  }

  const onNodeClick: NodeMouseHandler<RetakeNode> = (_event, node) => {
    dismissTerminalImageStatus(node.id);
  };

  const onNodeDoubleClick: NodeMouseHandler<RetakeNode> = (event, node) => {
    if (
      node.type !== 'text' &&
      node.type !== 'operation' &&
      event.target instanceof HTMLElement &&
      isInteractiveNodeTarget(event.target)
    ) return;
    selectConnectedWorkflow(node.id);
  };

  function selectConnectedWorkflow(blockId: string): void {
    const connectedBlockIds = connectedWorkflowBlockIds(snapshotRef.current, blockId);
    if (connectedBlockIds.length <= 1) return;
    window.requestAnimationFrame(() => {
      const currentConnectedBlockIds = connectedWorkflowBlockIds(snapshotRef.current, blockId);
      if (currentConnectedBlockIds.length <= 1) return;
      setSelectedBlocks(snapshotRef.current, currentConnectedBlockIds);
    });
  }

  function dismissTerminalImageStatus(blockId: string): void {
    const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId);
    if (!block || block.type !== 'image') return;
    if (block.data.status !== 'succeeded') return;
    if (block.data.statusVisualDismissed) return;

    updateSnapshot((current) => {
      const targetBlock = current.blocks.find((candidate) => candidate.blockId === blockId);
      if (!targetBlock || targetBlock.type !== 'image') return current;
      targetBlock.data.statusVisualDismissed = true;
      targetBlock.updatedAt = nowIso();
      return touchBoard(current);
    }, { persist: true });
  }

  function addBlock(type: BlockType): void {
    if (type === 'group' && selectedBlockIdsRef.current.length === 0) {
      setActiveCanvasTool((current) => (current === 'group' ? 'pan' : 'group'));
      return;
    }
    let newBlockId = '';
    const nextSnapshot = updateSnapshot((current) => {
      if (type === 'group' && selectedBlockIdsRef.current.length > 0) {
        const group = createGroupAroundBlocks(current, selectedBlockIdsRef.current, {
          color: 'neutral',
          kind: 'manual',
          layoutMode: 'free',
          title: t('group.defaultTitle'),
        });
        if (!group) return current;
        newBlockId = group.blockId;
        return touchBoard(current);
      }
      const block = createBlockRecord(current, type);
      block.position = centeredBlockPosition(block.size);
      block.data = {
        ...block.data,
        ...localizedBlockData(type, t),
      };
      newBlockId = block.blockId;
      current.blocks.push(block);
      return touchBoard(current);
    }, { persist: true, history: true });

    if (!newBlockId) return;
    setActiveCanvasTool(type === 'group' ? 'pan' : 'select');
    setSelectedBlock(nextSnapshot, newBlockId);
  }

  function drawRectToGroupBounds(rect: DrawRect): GroupBounds | undefined {
    const canvasBounds = canvasAreaRef.current?.getBoundingClientRect();
    const reactFlow = reactFlowRef.current;
    if (!canvasBounds || !reactFlow) return undefined;
    const start = reactFlow.screenToFlowPosition({ x: canvasBounds.left + rect.x, y: canvasBounds.top + rect.y });
    const end = reactFlow.screenToFlowPosition({
      x: canvasBounds.left + rect.x + rect.width,
      y: canvasBounds.top + rect.y + rect.height,
    });
    return { x: start.x, y: start.y, width: end.x - start.x, height: end.y - start.y };
  }

  function groupDrawCandidateCount(rect: DrawRect): number {
    const bounds = drawRectToGroupBounds(rect);
    if (!bounds) return 0;
    return groupBoundsContext(snapshotRef.current, bounds, collapsedGroupIdsRef.current).candidateBlocks.length;
  }

  function completeGroupDraw(rect: DrawRect): void {
    const bounds = drawRectToGroupBounds(rect);
    if (!bounds) return;
    let groupId = '';
    const nextSnapshot = updateSnapshot(
      (current) => {
        const group = createGroupFromBounds(
          current,
          bounds,
          { color: 'neutral', kind: 'manual', layoutMode: 'free', title: t('group.defaultTitle') },
          collapsedGroupIdsRef.current,
        );
        if (!group) return current;
        groupId = group.blockId;
        return touchBoard(current);
      },
      { persist: true, history: true },
    );
    setActiveCanvasTool('pan');
    if (groupId) setSelectedBlock(nextSnapshot, groupId);
  }

  function updateTextBlockBody(blockId: string, body: string): void {
    updateSnapshot(
      (current) => {
        const block = current.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'text');
        if (!block || blockLockedByGroup(current, blockId) || block.data.body === body) return current;
        block.data = {
          ...block.data,
          body,
        };
        block.updatedAt = nowIso();
        return touchBoard(current);
      },
      { persist: true, history: true },
    );
  }

  function updateAnnotationDraft(blockId: string, content: AnnotationDraftContent): void {
    const sourceBlock = snapshotRef.current.blocks.find(
      (block) => block.blockId === blockId && block.type === 'image',
    );
    const sourceAssetId = typeof sourceBlock?.data.assetId === 'string' ? sourceBlock.data.assetId : undefined;
    if (!sourceBlock || !sourceAssetId) return;

    const existingDraft = annotationDraftMatches(sourceBlock.data.annotationDraft, sourceAssetId)
      ? sourceBlock.data.annotationDraft
      : undefined;
    if (annotationDraftContentEquals(existingDraft, content)) return;
    if (!annotationDraftHasContent(content) && !sourceBlock.data.annotationDraft) return;

    updateSnapshot(
      (current) => {
        const block = current.blocks.find(
          (candidate) => candidate.blockId === blockId && candidate.type === 'image',
        );
        if (!block || block.data.assetId !== sourceAssetId) return current;

        const updatedAt = nowIso();
        block.data = { ...block.data };
        if (annotationDraftHasContent(content)) {
          block.data.annotationDraft = {
            schemaVersion: 1,
            sourceAssetId,
            globalInstruction: content.globalInstruction,
            marks: structuredClone(content.marks),
            updatedAt,
          };
        } else {
          delete block.data.annotationDraft;
        }
        block.updatedAt = updatedAt;
        return touchBoard(current);
      },
      { syncFlow: false },
    );
    scheduleAnnotationDraftPersist();
  }

  function addOperationInputBlock(operationBlockId: string, type: Extract<BlockType, 'image' | 'text' | 'video'>): void {
    let newBlockId = '';
    const nextSnapshot = updateSnapshot((current) => {
      const operationBlock = current.blocks.find((block) => block.blockId === operationBlockId && block.type === 'operation');
      if (!operationBlock || blockLockedByGroup(current, operationBlockId)) return current;
      if (!operationAllowsInputType(operationBlock, type)) return current;

      const block = createBlockRecord(current, type);
      block.position = operationInputBlockPosition(current, operationBlock, block.size);
      block.parentGroupId = operationBlock.parentGroupId;
      block.data = {
        ...block.data,
        ...localizedBlockData(type, t),
      };
      if (type === 'text') {
        block.data.title = t('operationToolbar.prompt');
        block.data.promptRole = 'operation_prompt';
        block.data.placeholder = operationPlaceholderForBlock(operationBlock, t);
      }

      current.blocks.push(block);
      if (operationBlock.parentGroupId) expandGroupToContents(current, operationBlock.parentGroupId);
      current.edges.push({
        edgeId: createId('edge'),
        sourceBlockId: block.blockId,
        targetBlockId: operationBlock.blockId,
        kind: 'execution_input',
      });
      newBlockId = block.blockId;
      return touchBoard(current);
    }, { persist: true, history: true });

    if (!newBlockId) return;
    setSelectedBlock(nextSnapshot, newBlockId);
  }

  function operationPlaceholderForBlock(
    operationBlock: BlockRecord,
    translate: ReturnType<typeof useI18n>['t'],
  ): string {
    const mode = operationBlock.data.operationMode;
    if (operationBlock.data.operationVariant === 'create_similar') return imageOperationDefaultPrompt('create_similar', translate);
    if (mode === 'image_to_image' || mode === 'quick_edit' || mode === 'create_similar') {
      return imageOperationDefaultPrompt('quick_edit', translate);
    }
    return imageOperationDefaultPrompt('generate_image', translate);
  }

  useEffect(() => {
    function onRunOperation(event: Event): void {
      const detail = (event as CustomEvent<{
        blockId?: string;
        queuedConfigurationStale?: boolean;
      }>).detail;
      if (!detail?.blockId) return;
      const block = snapshotRef.current.blocks.find(
        (candidate) => candidate.blockId === detail.blockId && candidate.type === 'operation',
      );
      if (!block || blockLockedByGroup(snapshotRef.current, block.blockId)) return;
      if (block.data.status === 'running') return;
      if (block.data.status === 'queued') {
        if (detail.queuedConfigurationStale) {
          void refreshQueuedOperationPrompt(block);
        } else {
          void copyQueuedOperationPrompt(block);
        }
        return;
      }
      const readiness = operationReadinessFor(snapshotRef.current, block);
      if (!readiness.canRun) {
        const issue = readiness.issues[0];
        setOperationToast({
          id: `operation-input:${block.blockId}`,
          title: t('feedback.inputRequired'),
          body: issue ? t(operationReadinessMessageKey(issue)) : undefined,
          tone: 'error',
        });
        return;
      }
      void startExistingOperationBlock({
        block,
        operation: operationModeFromBlock(block),
      });
    }

    window.addEventListener('retake:run-operation', onRunOperation);
    return () => window.removeEventListener('retake:run-operation', onRunOperation);
  }, []);

  useEffect(() => {
    function onUpdateOperationGenerationParams(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; generationParams?: ImageGenerationParams }>).detail;
      if (!detail?.blockId || !detail.generationParams) return;
      updateOperationGenerationParams(detail.blockId, detail.generationParams);
    }

    window.addEventListener('retake:update-operation-generation-params', onUpdateOperationGenerationParams);
    return () => window.removeEventListener('retake:update-operation-generation-params', onUpdateOperationGenerationParams);
  }, []);

  useEffect(() => {
    function onUpdateOperationGenerationProfile(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; generationProfileId?: string }>).detail;
      if (!detail?.blockId || !detail.generationProfileId) return;
      updateOperationGenerationProfile(detail.blockId, detail.generationProfileId);
    }

    window.addEventListener('retake:update-operation-generation-profile', onUpdateOperationGenerationProfile);
    return () => window.removeEventListener('retake:update-operation-generation-profile', onUpdateOperationGenerationProfile);
  }, []);

  useEffect(() => {
    function onUpdateOperationCapability(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; operation?: SwitchableOperationMode }>).detail;
      if (!detail?.blockId || !detail.operation) return;
      updateOperationCapability(detail.blockId, detail.operation);
    }

    window.addEventListener('retake:update-operation-capability', onUpdateOperationCapability);
    return () => window.removeEventListener('retake:update-operation-capability', onUpdateOperationCapability);
  }, []);

  function updateOperationInputRole(edgeId: string, inputRole: ExecutionInputRole): void {
    let operationBlockId = '';
    const nextSnapshot = updateSnapshot(
      (current) => {
        const edge = current.edges.find((candidate) => candidate.edgeId === edgeId && candidate.kind === 'execution_input');
        if (!edge) return current;
        const sourceBlock = current.blocks.find((block) => block.blockId === edge.sourceBlockId);
        const operationBlock = current.blocks.find((block) => block.blockId === edge.targetBlockId && block.type === 'operation');
        if (
          !sourceBlock ||
          !operationBlock ||
          blockLockedByGroup(current, sourceBlock.blockId) ||
          blockLockedByGroup(current, operationBlock.blockId)
        ) return current;
        const supportedRoles = executionInputRoleOptionsFor(sourceBlock, operationBlock);
        if (!supportedRoles.includes(inputRole)) return current;
        const disabledRoles = disabledExecutionInputRolesFor(
          current,
          sourceBlock,
          operationBlock,
          edge.edgeId,
        );
        if (disabledRoles.includes(inputRole) && edge.inputRole !== inputRole) return current;

        operationBlockId = operationBlock.blockId;
        edge.inputRole = inputRole;
        return touchBoard(current);
      },
      { persist: true, history: true },
    );
    if (operationBlockId) setSelectedBlock(nextSnapshot, operationBlockId);
  }

  function removeOperationInput(edgeId: string): void {
    updateSnapshot(
      (current) => {
        const edge = current.edges.find((candidate) => candidate.edgeId === edgeId);
        if (
          edge &&
          (blockLockedByGroup(current, edge.sourceBlockId) || blockLockedByGroup(current, edge.targetBlockId))
        ) return current;
        const nextEdges = current.edges.filter((edge) => edge.edgeId !== edgeId);
        if (nextEdges.length === current.edges.length) return current;
        current.edges = nextEdges;
        return touchBoard(current);
      },
      { persist: true, history: true },
    );
  }

  function completeInputReferenceMention(inputRole: ExecutionInputRole): void {
    const picker = inputReferencePicker;
    if (!picker?.sourceBlockId) return;
    let selectedOperationId = '';
    const nextSnapshot = updateSnapshot(
      (current) => {
        const sourceBlock = current.blocks.find(
          (block) => block.blockId === picker.sourceBlockId && block.type === 'image' && block.data.assetId,
        );
        const textBlock = current.blocks.find(
          (block) => block.blockId === picker.textBlockId && block.type === 'text',
        );
        const operationBlock = current.blocks.find(
          (block) => block.blockId === picker.operationBlockId && block.type === 'operation',
        );
        if (
          !sourceBlock ||
          !textBlock ||
          !operationBlock ||
          blockLockedByGroup(current, textBlock.blockId) ||
          blockLockedByGroup(current, operationBlock.blockId)
        ) return current;
        const supportedRoles = executionInputRoleOptionsFor(sourceBlock, operationBlock);
        if (!supportedRoles.includes(inputRole)) return current;

        let inputEdge = current.edges.find(
          (edge) =>
            edge.sourceBlockId === sourceBlock.blockId &&
            edge.targetBlockId === operationBlock.blockId &&
            edge.kind === 'execution_input',
        );
        const disabledRoles = disabledExecutionInputRolesFor(
          current,
          sourceBlock,
          operationBlock,
          inputEdge?.edgeId,
        );
        if (disabledRoles.includes(inputRole) && inputEdge?.inputRole !== inputRole) return current;

        if (inputEdge) inputEdge.inputRole = inputRole;
        else {
          inputEdge = {
            edgeId: createId('edge'),
            sourceBlockId: sourceBlock.blockId,
            targetBlockId: operationBlock.blockId,
            kind: 'execution_input',
            inputRole,
          };
          current.edges.push(inputEdge);
        }

        const imageTitle = sourceBlock.data.title.trim() || t('block.image.title');
        const mentionStart = Math.max(0, picker.cursorIndex - 1);
        const beforeMention = picker.body.slice(0, mentionStart);
        const afterMention = picker.body.slice(picker.cursorIndex);
        const separator = afterMention.length > 0 && !/^\s/.test(afterMention) ? ' ' : '';
        textBlock.data.body = `${beforeMention}@${imageTitle}${separator}${afterMention}`;
        textBlock.updatedAt = nowIso();
        selectedOperationId = operationBlock.blockId;
        return touchBoard(current);
      },
      { persist: true, history: true },
    );
    setInputReferencePicker(undefined);
    if (selectedOperationId) setSelectedBlock(nextSnapshot, selectedOperationId);
  }

  function operationInputBlockPosition(
    snapshot: BoardSnapshot,
    operationBlock: BlockRecord,
    size: { width: number; height: number },
  ): { x: number; y: number } {
    const inputCount = snapshot.edges.filter(
      (edge) => edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input',
    ).length;
    const slotOffset = inputCount === 0 ? 0 : inputCount * 54;
    return {
      x: operationBlock.position.x - size.width - 90,
      y: operationBlock.position.y + slotOffset,
    };
  }

  function centeredBlockPosition(size: { width: number; height: number }): { x: number; y: number } {
    const rect = canvasAreaRef.current?.getBoundingClientRect();
    if (!rect) {
      const { x, y, zoom } = currentViewportRef.current;
      return {
        x: (window.innerWidth / 2 - x) / zoom - size.width / 2,
        y: (window.innerHeight / 2 - y) / zoom - size.height / 2,
      };
    }

    const { x, y, zoom } = currentViewportRef.current;
    const screenCenter = {
      x: rect.width / 2,
      y: rect.height / 2,
    };
    return {
      x: (screenCenter.x - x) / zoom - size.width / 2,
      y: (screenCenter.y - y) / zoom - size.height / 2,
    };
  }

  function viewportCenter(): { x: number; y: number } {
    const rect = canvasAreaRef.current?.getBoundingClientRect();
    const { x, y, zoom } = currentViewportRef.current;
    const screenCenter = rect
      ? { x: rect.width / 2, y: rect.height / 2 }
      : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    return {
      x: (screenCenter.x - x) / zoom,
      y: (screenCenter.y - y) / zoom,
    };
  }

  function centerWorkflowBlocks(snapshot: BoardSnapshot, blockIds: string[], gap = 80): void {
    const workflowBlocks = blockIds
      .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
      .filter((block): block is BlockRecord => Boolean(block));
    if (workflowBlocks.length === 0) return;

    const totalWidth =
      workflowBlocks.reduce((sum, block) => sum + block.size.width, 0) +
      Math.max(0, workflowBlocks.length - 1) * gap;
    const maxHeight = workflowBlocks.reduce((max, block) => Math.max(max, block.size.height), 0);
    const center = viewportCenter();
    let nextX = center.x - totalWidth / 2;
    const nextY = center.y - maxHeight / 2;
    const updatedAt = nowIso();

    for (const block of workflowBlocks) {
      block.position = {
        x: nextX,
        y: nextY + (maxHeight - block.size.height) / 2,
      };
      block.updatedAt = updatedAt;
      nextX += block.size.width + gap;
    }
  }

  function centerBlockGroup(snapshot: BoardSnapshot, blockIds: string[]): void {
    const workflowBlocks = blockIds
      .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
      .filter((block): block is BlockRecord => Boolean(block));
    if (workflowBlocks.length === 0) return;

    const minX = workflowBlocks.reduce((min, block) => Math.min(min, block.position.x), Number.POSITIVE_INFINITY);
    const minY = workflowBlocks.reduce((min, block) => Math.min(min, block.position.y), Number.POSITIVE_INFINITY);
    const maxX = workflowBlocks.reduce(
      (max, block) => Math.max(max, block.position.x + block.size.width),
      Number.NEGATIVE_INFINITY,
    );
    const maxY = workflowBlocks.reduce(
      (max, block) => Math.max(max, block.position.y + block.size.height),
      Number.NEGATIVE_INFINITY,
    );
    const center = viewportCenter();
    const deltaX = center.x - (minX + maxX) / 2;
    const deltaY = center.y - (minY + maxY) / 2;
    const updatedAt = nowIso();

    for (const block of workflowBlocks) {
      block.position = {
        x: block.position.x + deltaX,
        y: block.position.y + deltaY,
      };
      block.updatedAt = updatedAt;
    }
  }

  function deleteSelection(): void {
    deleteBlockIds(selectedBlockIds);
  }

  function deleteBlockIds(blockIds: string[]): void {
    if (blockIds.length === 0) return;
    const initialSnapshot = snapshotRef.current;
    const mutableRootIds = deletableRootBlockIds(initialSnapshot, blockIds);
    if (mutableRootIds.length === 0) return;
    const groupIds = mutableRootIds.filter(
      (blockId) => initialSnapshot.blocks.find((block) => block.blockId === blockId)?.type === 'group',
    );
    const deletionScopeIds = [
      ...mutableRootIds,
      ...descendantBlockIds(initialSnapshot, groupIds),
    ];
    const activeExecutions = activeExecutionsForBlockIds(initialSnapshot, deletionScopeIds);
    const hasRunningExecution = executionCancellationRequiresConfirmation(activeExecutions);
    if (hasRunningExecution && !window.confirm(t('feedback.runningExecutionCancelConfirm'))) return;

    let deletedBlockIds: string[] = [];
    let canceledExecutionCount = 0;
    updateSnapshot((current) => {
      const canceledRemovedIds = new Set<string>();
      for (const execution of activeExecutions) {
        const cancellation = cancelExecution(current, execution.executionId);
        if (cancellation.execution?.status !== 'canceled') continue;
        canceledExecutionCount += 1;
        for (const blockId of cancellation.removedBlockIds) canceledRemovedIds.add(blockId);
      }

      const mutableBlockIds = deletableRootBlockIds(current, mutableRootIds);
      const remainingGroupIds = mutableBlockIds.filter(
        (blockId) => current.blocks.find((block) => block.blockId === blockId)?.type === 'group',
      );
      const selectedIds = new Set([
        ...mutableBlockIds,
        ...descendantBlockIds(current, remainingGroupIds),
      ]);
      deletedBlockIds = [...new Set([...canceledRemovedIds, ...selectedIds])];
      if (selectedIds.size === 0) return current;
      const affectedParentIds = new Set(
        current.blocks
          .filter((block) => selectedIds.has(block.blockId) && block.parentGroupId && !selectedIds.has(block.parentGroupId))
          .map((block) => block.parentGroupId as string),
      );
      current.blocks = current.blocks.filter((block) => !selectedIds.has(block.blockId));
      current.edges = current.edges.filter(
        (edge) => !selectedIds.has(edge.sourceBlockId) && !selectedIds.has(edge.targetBlockId),
      );
      for (const parentGroupId of affectedParentIds) fitGroupToChildren(current, parentGroupId);
      return touchBoard(current);
    }, { persist: true, history: true });
    if (canceledExecutionCount > 0) {
      setOperationToast({
        id: `execution-canceled:${Date.now()}`,
        title: t('feedback.executionCanceled'),
        body: t(hasRunningExecution ? 'feedback.runningExecutionCanceled' : 'feedback.queuedExecutionCanceled'),
        tone: 'success',
      });
    }
    if (deletedBlockIds.length === 0) return;
    const deletedIdSet = new Set(deletedBlockIds);
    const nextCollapsedGroupIds = collapsedGroupIdsRef.current.filter((groupId) => !deletedIdSet.has(groupId));
    if (nextCollapsedGroupIds.length !== collapsedGroupIdsRef.current.length) {
      collapsedGroupIdsRef.current = nextCollapsedGroupIds;
      setCollapsedGroupIds(nextCollapsedGroupIds);
      saveCollapsedGroupIds(
        snapshotRef.current.project.projectId,
        snapshotRef.current.board.boardId,
        nextCollapsedGroupIds,
      );
    }
    selectedBlockIdsRef.current = [];
    setSelectedBlockIds([]);
  }

  function deletableRootBlockIds(current: BoardSnapshot, blockIds: readonly string[]): string[] {
    return blockIds.filter((blockId) => {
      const block = current.blocks.find((candidate) => candidate.blockId === blockId);
      if (!block || blockLockedByGroup(current, blockId)) return false;
      return block.type !== 'group' || !groupStructureLocked(current, blockId);
    });
  }

  function duplicateSelection(): void {
    if (selectedBlockIds.length === 0) return;
    const newBlockIds: string[] = [];
    const nextSnapshot = updateSnapshot((current) => {
      const selectedGroupIds = selectedBlockIds.filter(
        (blockId) => current.blocks.find((block) => block.blockId === blockId)?.type === 'group',
      );
      const copiedIds = new Set([...selectedBlockIds, ...descendantBlockIds(current, selectedGroupIds)]);
      const selectedBlocks = current.blocks.filter((block) => copiedIds.has(block.blockId));
      const nextZ = maxZIndex(current.blocks) + 1;
      const idMap = new Map(selectedBlocks.map((block) => [block.blockId, createId('block')]));
      const externalParentGroupIds = new Set<string>();

      selectedBlocks.forEach((block, index) => {
        const blockId = idMap.get(block.blockId)!;
        if (selectedBlockIds.includes(block.blockId)) newBlockIds.push(blockId);
        const nextParentGroupId = block.parentGroupId ? idMap.get(block.parentGroupId) ?? block.parentGroupId : undefined;
        if (nextParentGroupId && !idMap.has(block.parentGroupId ?? '')) {
          externalParentGroupIds.add(nextParentGroupId);
        }
        const clonedData = { ...structuredClone(block.data) };
        if (block.type === 'group' && clonedData.groupKind === 'execution_results') {
          clonedData.groupKind = 'manual';
          delete clonedData.groupExecutionId;
        }
        current.blocks.push({
          ...structuredClone(block),
          blockId,
          parentGroupId: nextParentGroupId,
          position: {
            x: block.position.x + 36,
            y: block.position.y + 36,
          },
          zIndex: nextZ + index,
          data: clonedData,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      });
      for (const parentGroupId of externalParentGroupIds) expandGroupToContents(current, parentGroupId);

      const duplicatedEdges = current.edges.flatMap((edge) => {
        const sourceBlockId = idMap.get(edge.sourceBlockId);
        const targetBlockId = idMap.get(edge.targetBlockId);
        if (!sourceBlockId || !targetBlockId) return [];
        return [{ ...structuredClone(edge), edgeId: createId('edge'), sourceBlockId, targetBlockId }];
      });
      current.edges.push(...duplicatedEdges);

      return touchBoard(current);
    }, { persist: true, history: true });

    setSelectedBlockIds(newBlockIds);
    setNodes(createFlowNodesForSelection(nextSnapshot, newBlockIds));
    setEdges(createFlowEdgesForSelection(nextSnapshot, newBlockIds));
  }

  function updateGroup(
    groupId: string,
    updates: { color?: GroupColor; contentsLocked?: boolean; positionLocked?: boolean; title?: string },
  ): void {
    updateSnapshot(
      (current) => {
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
      },
      { persist: true, history: true },
    );
  }

  function fitSelectedGroup(groupId: string): void {
    updateSnapshot(
      (current) => {
        const group = current.blocks.find((block) => block.blockId === groupId && block.type === 'group');
        if (!group || group.data.groupPositionLocked || blockLockedByGroup(current, groupId)) return current;
        fitGroupToChildren(current, groupId);
        return touchBoard(current);
      },
      { persist: true, history: true },
    );
  }

  function layoutSelectedGroup(groupId: string, layoutMode: GroupLayoutMode): void {
    updateSnapshot(
      (current) => {
        arrangeGroupChildren(current, groupId, layoutMode);
        return touchBoard(current);
      },
      { persist: true, history: true },
    );
  }

  function ungroupSelectedGroup(groupId: string): void {
    let childIds: string[] = [];
    const nextSnapshot = updateSnapshot(
      (current) => {
        if (groupStructureLocked(current, groupId)) return current;
        childIds = dissolveGroup(current, groupId);
        return touchBoard(current);
      },
      { persist: true, history: true },
    );
    setSelectedBlocks(nextSnapshot, childIds);
  }

  function toggleGroupCollapsed(groupId: string): void {
    const nextCollapsedGroupIds = collapsedGroupIdsRef.current.includes(groupId)
      ? collapsedGroupIdsRef.current.filter((candidate) => candidate !== groupId)
      : [...collapsedGroupIdsRef.current, groupId];
    collapsedGroupIdsRef.current = nextCollapsedGroupIds;
    setCollapsedGroupIds(nextCollapsedGroupIds);
    saveCollapsedGroupIds(
      snapshotRef.current.project.projectId,
      snapshotRef.current.board.boardId,
      nextCollapsedGroupIds,
    );
    setNodes(createFlowNodesForSelection(snapshotRef.current));
    setEdges(createFlowEdgesForSelection(snapshotRef.current));
  }

  function downloadGroupAssets(groupId: string): void {
    const uniqueItems = new Map(
      groupMediaItems(snapshotRef.current, groupId).map((item) => [item.asset.assetId, item]),
    );
    if (uniqueItems.size === 0) return;
    for (const item of uniqueItems.values()) downloadAsset(item.asset, item.block.data.title);
    setOperationToast({
      id: `group-download:${groupId}`,
      title: t('group.downloadAssets'),
      body: `${uniqueItems.size} ${t('group.downloadStarted')}`,
      tone: 'success',
    });
  }

  async function refreshWorkspace(): Promise<void> {
    setWorkspace(await loadWorkspaceSummary());
  }

  async function refreshCurrentBoard(): Promise<void> {
    const nextSnapshot = await loadBoardSnapshot({
      projectId: snapshotRef.current.project.projectId,
      boardId: snapshotRef.current.board.boardId,
    });
    applyLoadedSnapshot(nextSnapshot);
    await refreshWorkspace();
    setAutosaveStatus('idle');
  }

  function applyLoadedSnapshot(nextSnapshot: BoardSnapshot): void {
    rememberCurrentBoard(nextSnapshot);
    snapshotRef.current = nextSnapshot;
    restoreViewport(nextSnapshot.viewport);
    setSnapshot(nextSnapshot);
    setNodes(createFlowNodesForSelection(nextSnapshot, []));
    setEdges(createFlowEdgesForSelection(nextSnapshot, []));
    setSelectedBlockIds([]);
    setInspectorBlockId(undefined);
    setIsHistoryOpen(false);
    history.current = { past: [], future: [] };
    setHistoryRevision((revision) => revision + 1);
  }

  function restoreViewport(viewport: Viewport): void {
    currentViewportRef.current = viewport;
    setCanvasZoom(viewport.zoom);
    window.requestAnimationFrame(() => {
      void reactFlowRef.current?.setViewport(viewport, { duration: 0 });
    });
  }

  function persistViewport(viewport: Viewport): void {
    currentViewportRef.current = viewport;
    setCanvasZoom(viewport.zoom);
    const current = snapshotRef.current;
    if (sameViewport(current.viewport, viewport)) return;

    const nextSnapshot = { ...structuredClone(current), viewport };
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    void persistSnapshot(nextSnapshot);
  }

  function sameViewport(left: Viewport, right: Viewport): boolean {
    return (
      Math.abs(left.x - right.x) < 0.5 &&
      Math.abs(left.y - right.y) < 0.5 &&
      Math.abs(left.zoom - right.zoom) < 0.001
    );
  }

  async function selectBoard(projectId: string, boardId: string): Promise<void> {
    const nextSnapshot = await loadBoardSnapshot({ projectId, boardId });
    applyLoadedSnapshot(nextSnapshot);
    await refreshWorkspace();
  }

  function createProjectFromMenu(): void {
    setProjectBoardDialog({
      action: 'createProject',
      defaultName: numberedDefaultName(t('projectBoard.newProjectName'), (workspace?.projects.length ?? 0) + 1),
    });
  }

  function createBoardFromMenu(projectId: string): void {
    const boardCount = workspace?.projects.find((project) => project.projectId === projectId)?.boards.length ?? 0;
    setProjectBoardDialog({
      action: 'createBoard',
      projectId,
      defaultName: numberedDefaultName(t('projectBoard.newBoardName'), boardCount + 1),
    });
  }

  function renameProjectFromMenu(projectId: string, currentName: string): void {
    setProjectBoardDialog({ action: 'renameProject', projectId, currentName });
  }

  function renameBoardFromMenu(projectId: string, boardId: string, currentName: string): void {
    setProjectBoardDialog({ action: 'renameBoard', projectId, boardId, currentName });
  }

  function duplicateBoardFromMenu(projectId: string, boardId: string): void {
    const sourceBoard = workspace?.projects
      .find((project) => project.projectId === projectId)
      ?.boards.find((candidate) => candidate.boardId === boardId);
    setProjectBoardDialog({
      action: 'duplicateBoard',
      projectId,
      boardId,
      currentName: `${sourceBoard?.name ?? t('projectBoard.newBoardName')} Copy`,
    });
  }

  function deleteBoardFromMenu(projectId: string, boardId: string): void {
    setProjectBoardDialog({ action: 'deleteBoard', projectId, boardId });
  }

  function deleteProjectFromMenu(projectId: string): void {
    setProjectBoardDialog({ action: 'deleteProject', projectId });
  }

  async function submitProjectBoardDialog(value: string): Promise<void> {
    const dialog = projectBoardDialog;
    if (!dialog) return;
    setProjectBoardDialog(undefined);

    if (dialog.action === 'createProject') {
      const result = await createWorkspaceProject(value || dialog.defaultName);
      setWorkspace(result.workspace);
      applyLoadedSnapshot(result.snapshot);
      return;
    }

    if (dialog.action === 'createBoard') {
      const result = await createWorkspaceBoard(dialog.projectId, value || dialog.defaultName);
      setWorkspace(result.workspace);
      applyLoadedSnapshot(result.snapshot);
      return;
    }

    if (dialog.action === 'renameProject') {
      await renameProjectByValue(dialog.projectId, value || dialog.currentName);
      return;
    }

    if (dialog.action === 'renameBoard') {
      const result = await renameWorkspaceBoard(dialog.projectId, dialog.boardId, value || dialog.currentName);
      setWorkspace(result.workspace);
      if (dialog.projectId === snapshotRef.current.project.projectId && dialog.boardId === snapshotRef.current.board.boardId) {
        applyLoadedSnapshot(result.snapshot);
      }
      return;
    }

    if (dialog.action === 'duplicateBoard') {
      const result = await duplicateWorkspaceBoard(dialog.projectId, dialog.boardId, value || dialog.currentName);
      setWorkspace(result.workspace);
      applyLoadedSnapshot(result.snapshot);
      return;
    }

    if (dialog.action === 'deleteBoard') {
      const result = await deleteWorkspaceBoard(dialog.projectId, dialog.boardId);
      setWorkspace(result.workspace);
      if (dialog.projectId === snapshotRef.current.project.projectId && dialog.boardId === snapshotRef.current.board.boardId) {
        applyLoadedSnapshot(result.snapshot);
      }
      return;
    }

    if (dialog.action === 'deleteProject') {
      const result = await deleteWorkspaceProject(dialog.projectId);
      setWorkspace(result.workspace);
      if (dialog.projectId === snapshotRef.current.project.projectId) {
        applyLoadedSnapshot(result.snapshot);
      }
    }
  }

  async function renameProjectByValue(projectId: string, name: string): Promise<void> {
    const result = await renameWorkspaceProject(projectId, name);
    setWorkspace(result.workspace);
    if (result.snapshot && result.snapshot.project.projectId === snapshotRef.current.project.projectId) {
      applyLoadedSnapshot(result.snapshot);
    } else if (projectId === snapshotRef.current.project.projectId) {
      updateSnapshot((current) => {
        current.project.name = name.trim() || current.project.name;
        return touchBoard(current);
      }, { persist: true });
    }
  }

  async function reorderProjectsFromMenu(projectIds: string[]): Promise<void> {
    const result = await reorderWorkspaceProjects(projectIds);
    setWorkspace(result.workspace);
  }

  async function reorderBoardsFromMenu(projectId: string, boardIds: string[]): Promise<void> {
    const result = await reorderWorkspaceBoards(projectId, boardIds);
    setWorkspace(result.workspace);
  }

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.append(textarea);
      textarea.select();
      document.execCommand('copy');
      textarea.remove();
    }
  }

  async function copyPromptWithHistory(input: {
    blockIds?: string[];
    copyKey: string;
    executionId?: string;
    prompt: string;
    source: string;
  }): Promise<void> {
    await copyText(input.prompt);
    setCopiedPromptKey(input.copyKey);
    if (copiedPromptTimer.current) window.clearTimeout(copiedPromptTimer.current);
    copiedPromptTimer.current = window.setTimeout(() => {
      setCopiedPromptKey((current) => (current === input.copyKey ? undefined : current));
    }, 1800);
    if (!input.executionId) return;
    updateSnapshot(
      (current) => touchBoard(appendPromptCopiedEvent(current, input)),
      { syncFlow: false, persist: true },
    );
  }

  function closePromptPreviewAfterCopy(copyKey: string): void {
    setPromptPreview((current) => {
      if (!current) return current;
      if ((current.copyKey ?? 'prompt-preview') !== copyKey) return current;
      return undefined;
    });
  }

  async function copyQueuedOperationPrompt(block: BlockRecord): Promise<void> {
    const executionId = typeof block.data.sourceExecutionId === 'string' ? block.data.sourceExecutionId : undefined;
    const execution = executionId
      ? snapshotRef.current.executions.find((candidate) => candidate.executionId === executionId)
      : undefined;
    const prompt =
      typeof block.data.agentPrompt === 'string'
        ? block.data.agentPrompt
        : execution?.agentPrompt;
    const copyKey = `prompt:${block.blockId}`;
    if (!prompt) {
      setOperationToast({
        id: copyKey,
        title: t('feedback.promptTitle'),
        body: t('feedback.taskCreatedCopyFailed'),
        tone: 'error',
      });
      return;
    }
    const blockIds = execution
      ? [...execution.inputBlockIds, block.blockId, ...execution.outputBlockIds]
      : [block.blockId];
    setPromptPreview({ title: t('feedback.promptTitle'), prompt, copyKey, executionId, blockIds });
    try {
      await copyPromptWithHistory({
        blockIds,
        copyKey,
        executionId,
        prompt,
        source: 'prompt_preview',
      });
      closePromptPreviewAfterCopy(copyKey);
      setOperationToast({
        id: copyKey,
        title: t('feedback.taskCreated'),
        body: t('feedback.taskCreatedCopied'),
        tone: 'success',
      });
    } catch {
      setOperationToast({
        id: copyKey,
        title: t('feedback.promptTitle'),
        body: t('feedback.taskCreatedCopyFailed'),
        tone: 'error',
      });
    }
  }

  async function retryFailedImageResult(blockId: string): Promise<void> {
    const current = snapshotRef.current;
    const resultBlock = current.blocks.find((block) => block.blockId === blockId && block.type === 'image');
    const executionId = typeof resultBlock?.data.sourceExecutionId === 'string'
      ? resultBlock.data.sourceExecutionId
      : undefined;
    const execution = current.executions.find((candidate) => candidate.executionId === executionId);
    const copyKey = `retry-result:${blockId}`;
    if (!resultBlock || !execution) return;

    try {
      await persistSnapshot(current, { requireLocalApi: true });
      const prompt = createImageResultRetryPrompt(current, resultBlock);
      const operationBlockId = typeof resultBlock.data.operationBlockId === 'string'
        ? resultBlock.data.operationBlockId
        : undefined;
      const blockIds = [...execution.inputBlockIds, operationBlockId, blockId].filter(
        (candidate): candidate is string => Boolean(candidate),
      );
      setPromptPreview({
        title: t('result.retryPromptTitle'),
        prompt,
        copyKey,
        executionId: execution.executionId,
        blockIds,
      });
      await copyPromptWithHistory({
        blockIds,
        copyKey,
        executionId: execution.executionId,
        prompt,
        source: 'failed_result_retry',
      });
      closePromptPreviewAfterCopy(copyKey);
      setOperationToast({
        id: copyKey,
        title: t('result.retryPromptTitle'),
        body: t('feedback.taskCreatedCopied'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: copyKey,
        title: t('result.retryPromptTitle'),
        body: error instanceof Error ? error.message : t('feedback.taskCreatedCopyFailed'),
        tone: 'error',
      });
    }
  }

  async function refreshQueuedOperationPrompt(block: BlockRecord): Promise<void> {
    let refreshedOperationBlock: BlockRecord | undefined;
    updateSnapshot((current) => {
      const currentBlock = current.blocks.find(
        (candidate) => candidate.blockId === block.blockId && candidate.type === 'operation',
      );
      const executionId = typeof currentBlock?.data.sourceExecutionId === 'string'
        ? currentBlock.data.sourceExecutionId
        : undefined;
      const execution = executionId
        ? current.executions.find((candidate) => candidate.executionId === executionId)
        : undefined;
      if (!currentBlock || execution?.status !== 'queued') return current;
      cancelExecution(current, execution.executionId);
      refreshedOperationBlock = currentBlock;
      return current;
    }, { history: true });

    if (!refreshedOperationBlock) return;
    await startExistingOperationBlock({
      block: refreshedOperationBlock,
      operation: operationModeFromBlock(refreshedOperationBlock),
    });
  }

  async function startImageCodexOperation(
    operation: ImageCodexOperation,
    block: BlockRecord,
    instruction?: string,
    options: {
      annotatedCompositeAsset?: AssetRecord;
      annotationManifest?: AnnotationManifest;
      generationParams?: ImageGenerationParams;
      referenceAssets?: AssetRecord[];
    } = {},
  ): Promise<void> {
    try {
      await persistSnapshot(snapshotRef.current, { requireLocalApi: true });
    } catch (error) {
      setOperationToast({
        id: `handoff:${block.blockId}`,
        title: t('feedback.handoffUnavailable'),
        body: error instanceof Error ? error.message : t('feedback.localApiUnavailable'),
        tone: 'error',
      });
      return;
    }

    let operationPrompt = '';
    let resultBlockIds: string[] = [];
    let operationBlockId = '';
    let executionId = '';
    const nextSnapshot = updateSnapshot(
      (current) => {
        const result = addImageCodexOperation(current, {
          operation,
          sourceBlockId: block.blockId,
          instruction,
          taskTitle: imageOperationTitle(operation, t),
          waitingBody: t('operation.waitingBody'),
          defaultPrompt: imageOperationDefaultPrompt(operation, t),
          annotatedCompositeAsset: options.annotatedCompositeAsset,
          annotationManifest: options.annotationManifest,
          generationParams: options.generationParams,
          referenceAssets: options.referenceAssets,
        });
        operationPrompt = result.prompt;
        operationBlockId = result.operationBlock.blockId;
        resultBlockIds = result.resultBlocks.map((resultBlock) => resultBlock.blockId);
        executionId = result.execution.executionId;
        return current;
      },
      { history: true },
    );

    setSelectedBlock(nextSnapshot, operationBlockId);
    const copyKey = `prompt:${operationBlockId}`;
    const blockIds = [block.blockId, operationBlockId, ...resultBlockIds];
    try {
      await persistSnapshot(nextSnapshot, { requireLocalApi: true });
    } catch (error) {
      setOperationToast({
        id: operationBlockId,
        title: t('feedback.handoffUnavailable'),
        body: error instanceof Error ? error.message : t('feedback.localApiUnavailable'),
        tone: 'error',
      });
      return;
    }
    setPromptPreview({ title: t('feedback.promptTitle'), prompt: operationPrompt, copyKey, executionId, blockIds });
    try {
      await copyPromptWithHistory({
        blockIds,
        copyKey,
        executionId,
        prompt: operationPrompt,
        source: 'prompt_preview',
      });
      closePromptPreviewAfterCopy(copyKey);
      setOperationToast({
        id: operationBlockId,
        title: t('feedback.taskCreated'),
        body: t('feedback.taskCreatedCopied'),
        tone: 'success',
      });
    } catch {
      setOperationToast({
        id: operationBlockId,
        title: t('feedback.taskCreated'),
        body: t('feedback.taskCreatedCopyFailed'),
        tone: 'error',
      });
    }
  }

  function createImageToImageDraftOperation(
    block: BlockRecord,
    operation: Exclude<ImageCodexOperation, 'annotation_edit' | 'generate_image'>,
    instruction?: string,
    options: { centerWorkflow?: boolean } = {},
  ): void {
    let selectedWorkflowIds: string[] = [];
    const nextSnapshot = updateSnapshot(
      (current) => {
        const result = createDraftImageToImageOperation(current, {
          operation,
          sourceBlockId: block.blockId,
          textBlockTitle: t('operationToolbar.prompt'),
          textBlockBody: instruction?.trim() || '',
          textBlockPlaceholder: imageOperationDefaultPrompt(operation, t),
          operationTitle: imageOperationTitle(operation, t),
        });
        selectedWorkflowIds = imageBranchDraftSelectionBlockIds(
          block,
          result.textBlock,
          result.operationBlock,
        );
        if (options.centerWorkflow) {
          centerBlockGroup(current, selectedWorkflowIds);
        }
        return current;
      },
      { persist: true, history: true },
    );

    if (selectedWorkflowIds.length === 0) return;
    setSelectedBlocks(nextSnapshot, selectedWorkflowIds);
  }

  function createImageToImageDraftFromMenu(): void {
    if (selectedBlock?.type === 'image') {
      createImageToImageDraftOperation(selectedBlock, 'quick_edit');
      return;
    }

    let imageBlock: BlockRecord | undefined;
    const nextSnapshot = updateSnapshot(
      (current) => {
        imageBlock = createBlockRecord(current, 'image');
        imageBlock.position = centeredBlockPosition(imageBlock.size);
        imageBlock.data = {
          ...imageBlock.data,
          ...localizedBlockData('image', t),
        };
        current.blocks.push(imageBlock);
        return touchBoard(current);
      },
      { persist: true, history: true },
    );

    if (!imageBlock) return;
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    createImageToImageDraftOperation(imageBlock, 'quick_edit', undefined, { centerWorkflow: true });
  }

  function createTextToImageDraftOperation(input: {
    generationParams?: ImageGenerationParams;
    instruction?: string;
    slotBlock?: BlockRecord;
  } = {}): void {
    let selectedWorkflowIds: string[] = [];
    const nextSnapshot = updateSnapshot(
      (current) => {
        const result = createDraftTextToImageOperation(current, {
          generationParams: input.generationParams,
          operationTitle: imageOperationTitle('generate_image', t),
          slotBlockId: input.slotBlock?.blockId,
          textBlockTitle: t('operationToolbar.prompt'),
          textBlockBody: input.instruction?.trim() || '',
          textBlockPlaceholder: imageOperationDefaultPrompt('generate_image', t),
        });
        selectedWorkflowIds = input.slotBlock
          ? [input.slotBlock.blockId, result.textBlock.blockId, result.operationBlock.blockId]
          : [result.textBlock.blockId, result.operationBlock.blockId];
        if (!input.slotBlock) {
          centerWorkflowBlocks(current, selectedWorkflowIds);
        }
        return current;
      },
      { persist: true, history: true },
    );

    if (selectedWorkflowIds.length === 0) return;
    setSelectedBlocks(nextSnapshot, selectedWorkflowIds);
  }

  async function createLocalImageEditOperation(
    block: BlockRecord,
    input: {
      body: string;
      capabilityId: 'image.local_adjust';
      params: LocalImageAdjustments;
      title: string;
    },
  ): Promise<void> {
    const sourceImageUrl = getAssetPreviewUrl(snapshotRef.current.assets, block.data.assetId);
    if (!sourceImageUrl) return;
    let executionId = '';
    let operationBlockId = '';
    let resultBlockId = '';
    const runningSnapshot = updateSnapshot(
      (current) => {
        const result = addLocalImageOperation(current, {
          body: input.body,
          capabilityId: input.capabilityId,
          params: input.params,
          sourceBlockId: block.blockId,
          title: input.title,
        });
        executionId = result.execution.executionId;
        operationBlockId = result.operationBlock.blockId;
        resultBlockId = result.resultBlock.blockId;
        return current;
      },
      { history: true },
    );

    if (!executionId || !operationBlockId || !resultBlockId) return;
    setSelectedBlock(runningSnapshot, operationBlockId);

    try {
      await persistSnapshot(runningSnapshot);
      const rendered = await renderAdjustedImage(sourceImageUrl, input.params);
      const asset = await createImageAssetFromDataUrl({
        projectId: runningSnapshot.project.projectId,
        dataUrl: rendered.dataUrl,
        fileName: `adjusted-${block.blockId}.png`,
        width: rendered.width,
        height: rendered.height,
        sourceExecutionId: executionId,
      });
      const completedSnapshot = updateSnapshot((current) => {
        completeLocalImageOperation(current, { asset, executionId });
        return current;
      });
      await persistSnapshot(completedSnapshot);
      setSelectedBlock(completedSnapshot, resultBlockId);
      setOperationToast({
        id: executionId,
        title: t('feedback.localEditCompleted'),
        tone: 'success',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('feedback.localEditFailed');
      const failedSnapshot = updateSnapshot((current) => {
        failLocalImageOperation(current, { errorMessage, executionId });
        return current;
      });
      await persistSnapshot(failedSnapshot);
      setSelectedBlock(failedSnapshot, operationBlockId);
      setOperationToast({
        id: executionId,
        title: t('feedback.localEditFailed'),
        body: errorMessage,
        tone: 'error',
      });
    }
  }

  async function startExistingOperationBlock(input: {
    block: BlockRecord;
    operation: SwitchableOperationMode;
  }): Promise<void> {
    if (blockLockedByGroup(snapshotRef.current, input.block.blockId)) return;
    let operationPrompt = '';
    let resultBlockIds: string[] = [];
    let executionId = '';
    let inputBlockIds: string[] = [];
    const copyKey = `prompt:${input.block.blockId}`;

    try {
      await persistSnapshot(snapshotRef.current, { requireLocalApi: true });
      const nextSnapshot = updateSnapshot(
        (current) => {
          const currentOperationBlock = current.blocks.find((block) => block.blockId === input.block.blockId);
          if (!currentOperationBlock || blockLockedByGroup(current, currentOperationBlock.blockId)) return current;
          const hasPendingImageRole = current.edges.some((edge) => {
            if (
              edge.targetBlockId !== input.block.blockId ||
              edge.kind !== 'execution_input' ||
              edge.inputRole
            ) {
              return false;
            }
            const sourceBlock = current.blocks.find((block) => block.blockId === edge.sourceBlockId);
            return sourceBlock?.type === 'image' && Boolean(sourceBlock.data.assetId);
          });
          if (hasPendingImageRole) throw new Error(t('operationInputRole.required'));
          const result = executeExistingImageOperationBlock(current, {
            operationBlockId: input.block.blockId,
            operation: input.operation,
            instruction: '',
            generationParams: generationParamsFromBlock(currentOperationBlock),
          });
          operationPrompt = result.prompt;
          resultBlockIds = result.resultBlocks.map((resultBlock) => resultBlock.blockId);
          inputBlockIds = result.execution.inputBlockIds;
          executionId = result.execution.executionId;
          return current;
        },
        { history: true },
      );

      await persistSnapshot(nextSnapshot, { requireLocalApi: true });
      setSelectedBlock(nextSnapshot, input.block.blockId);
      const blockIds = [...inputBlockIds, input.block.blockId, ...resultBlockIds].filter(Boolean);
      setPromptPreview({ title: t('feedback.promptTitle'), prompt: operationPrompt, copyKey, executionId, blockIds });
      await copyPromptWithHistory({
        blockIds,
        copyKey,
        executionId,
        prompt: operationPrompt,
        source: 'prompt_preview',
      });
      closePromptPreviewAfterCopy(copyKey);
      setOperationToast({
        id: input.block.blockId,
        title: t('feedback.taskCreated'),
        body: t('feedback.taskCreatedCopied'),
        tone: 'success',
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('feedback.localApiUnavailable');
      const currentOperationBlock = snapshotRef.current.blocks.find(
        (block) => block.blockId === input.block.blockId && block.type === 'operation',
      );
      const readiness = currentOperationBlock
        ? operationReadinessFor(snapshotRef.current, currentOperationBlock)
        : undefined;
      const readinessIssue = readiness?.issues[0];
      setOperationToast({
        id: input.block.blockId,
        title: readinessIssue ? t('feedback.inputRequired') : t('feedback.handoffUnavailable'),
        body: readinessIssue ? t(operationReadinessMessageKey(readinessIssue)) : errorMessage,
        tone: 'error',
      });
    }
  }

  function updateOperationGenerationParams(blockId: string, generationParams: ImageGenerationParams): void {
    updateSnapshot(
      (current) => {
        const operationBlock = current.blocks.find((block) => block.blockId === blockId && block.type === 'operation');
        if (!operationBlock || blockLockedByGroup(current, blockId)) return current;

        operationBlock.data = {
          ...operationBlock.data,
          generationParams,
        };
        operationBlock.updatedAt = nowIso();
        resizeEmptyOperationOutputSlot(current, operationBlock, generationParams);
        return touchBoard(current);
      },
      { persist: true },
    );
  }

  function updateOperationGenerationProfile(blockId: string, generationProfileId: string): void {
    updateSnapshot(
      (current) => {
        const operationBlock = current.blocks.find((block) => block.blockId === blockId && block.type === 'operation');
        if (!operationBlock || blockLockedByGroup(current, blockId)) return current;

        operationBlock.data = {
          ...operationBlock.data,
          generationProfileId,
        };
        operationBlock.updatedAt = nowIso();
        return touchBoard(current);
      },
      { persist: true },
    );
  }

  function updateOperationCapability(
    blockId: string,
    operation: SwitchableOperationMode,
  ): void {
    updateSnapshot(
      (current) => {
        const operationBlock = current.blocks.find((block) => block.blockId === blockId && block.type === 'operation');
        if (!operationBlock || blockLockedByGroup(current, blockId)) return current;

        operationBlock.data = {
          ...operationBlock.data,
          title: operation === 'text_to_image' ? imageOperationTitle('generate_image', t) : imageOperationTitle('quick_edit', t),
          capabilityId: capabilityIdForOperationMode(operation),
          operationMode: operation,
          operationVariant: undefined,
        };
        operationBlock.updatedAt = nowIso();

        for (const edge of current.edges) {
          if (edge.targetBlockId !== operationBlock.blockId || edge.kind !== 'execution_input') continue;
          const sourceBlock = current.blocks.find((block) => block.blockId === edge.sourceBlockId);
          if (!sourceBlock) continue;
          const supportedRoles = executionInputRoleOptionsFor(sourceBlock, operationBlock);
          if (!edge.inputRole || !supportedRoles.includes(edge.inputRole)) {
            delete edge.inputRole;
          }
        }

        return touchBoard(current);
      },
      { persist: true, history: true },
    );
  }

  async function importImageIntoBlock(block: BlockRecord, file: File): Promise<void> {
    const currentBlock = snapshotRef.current.blocks.find((candidate) => candidate.blockId === block.blockId);
    if (
      currentBlock?.type !== 'image' ||
      currentBlock.data.sourceExecutionId ||
      currentBlock.data.operationBlockId ||
      blockLockedByGroup(snapshotRef.current, block.blockId)
    ) return;
    const dataUrl = await readFileAsDataUrl(file);
    const imageSize = await readImageDimensions(dataUrl);
    const asset = await createImageAssetFromDataUrl({
      projectId: snapshotRef.current.project.projectId,
      dataUrl,
      fileName: file.name,
      width: imageSize?.width,
      height: imageSize?.height,
    });

    const nextSnapshot = updateSnapshot(
      (current) => {
        attachImportedImageAsset(current, {
          asset,
          blockId: block.blockId,
          fileName: file.name,
          updatedAt: nowIso(),
        });
        return current;
      },
      { history: true },
    );

    await persistSnapshot(nextSnapshot);
  }

  function setSelectedBlock(nextSnapshot: BoardSnapshot, blockId: string): void {
    setSelectedBlocks(nextSnapshot, [blockId]);
  }

  function restoreConfigurationVersion(executionId: string): void {
    const candidate = structuredClone(snapshotRef.current);
    const result = restoreExecutionConfiguration(candidate, executionId);
    if (!result.restored || !result.operationBlockId) {
      setOperationToast({
        id: `configuration-restore:${executionId}`,
        title: t('feedback.configurationRestoreUnavailable'),
        body: result.missingAssetIds.length
          ? `${t('feedback.configurationRestoreMissingAssets')} ${result.missingAssetIds.join(', ')}`
          : undefined,
        tone: 'error',
      });
      return;
    }
    const nextSnapshot = updateSnapshot(() => candidate, { persist: true, history: true });
    setSelectedBlock(nextSnapshot, result.operationBlockId);
    setOperationToast({
      id: `configuration-restored:${executionId}`,
      title: t('feedback.configurationRestored'),
    });
  }

  function restoreAnnotationDraftVersion(executionId: string): void {
    const execution = snapshotRef.current.executions.find(
      (candidate) => candidate.executionId === executionId,
    );
    const restoreContext = execution
      ? annotationDraftRestoreContext(snapshotRef.current, execution)
      : undefined;
    if (
      !restoreContext ||
      restoreContext.state !== 'available' ||
      !restoreContext.sourceBlock ||
      !restoreContext.manifest
    ) {
      setOperationToast({
        id: `annotation-draft-restore:${executionId}`,
        title: t('feedback.annotationDraftRestoreUnavailable'),
        body: restoreContext?.state === 'source_replaced'
          ? t('inspector.annotationSourceChanged')
          : restoreContext?.state === 'source_missing'
            ? t('inspector.annotationSourceMissing')
            : undefined,
        tone: 'error',
      });
      return;
    }

    const currentDraft = restoreContext.sourceBlock.data.annotationDraft;
    if (
      currentDraft &&
      !annotationDraftContentEquals(currentDraft, restoreContext.manifest) &&
      !window.confirm(t('inspector.annotationDraftRestoreConfirm'))
    ) {
      return;
    }

    const candidate = structuredClone(snapshotRef.current);
    const result = restoreExecutionAnnotationDraft(candidate, executionId);
    if (!result.restored || !result.sourceBlock) return;
    const nextSnapshot = updateSnapshot(() => candidate, { persist: true, history: true });
    setSelectedBlock(nextSnapshot, result.sourceBlock.blockId);
    setIsHistoryOpen(false);
    setOperationToast({
      id: `annotation-draft-restored:${executionId}`,
      title: t('feedback.annotationDraftRestored'),
      body: result.sourceBlock.data.title,
      tone: 'success',
    });
  }

  function setSelectedBlocks(
    nextSnapshot: BoardSnapshot,
    blockIds: string[],
    options: { source?: 'flow' | 'programmatic' } = {},
  ): void {
    const validBlockIds = blockIds.filter((blockId) =>
      nextSnapshot.blocks.some((block) => block.blockId === blockId),
    );
    if (!sameBlockSelection(selectedBlockIdsRef.current, validBlockIds)) {
      window.dispatchEvent(new Event(dismissPopoversEvent));
    }
    if (options.source === 'flow') {
      flowSelectionSyncTokenRef.current += 1;
      pendingFlowSelectionRef.current = undefined;
    } else {
      const syncToken = flowSelectionSyncTokenRef.current + 1;
      flowSelectionSyncTokenRef.current = syncToken;
      pendingFlowSelectionRef.current = validBlockIds;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (flowSelectionSyncTokenRef.current !== syncToken) return;
          pendingFlowSelectionRef.current = undefined;
        });
      });
    }
    selectedBlockIdsRef.current = validBlockIds;
    setSelectedBlockIds(validBlockIds);
    setNodes(createFlowNodesForSelection(nextSnapshot, validBlockIds));
    setEdges(createFlowEdgesForSelection(nextSnapshot, validBlockIds));
  }

  function selectBlock(blockId: string): void {
    setSelectedBlocks(snapshotRef.current, [blockId]);
  }

  function locateBlock(blockId: string): void {
    const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId);
    if (!block) return;

    selectBlock(blockId);
    const centerX = block.position.x + block.size.width / 2;
    const centerY = block.position.y + block.size.height / 2;
    void reactFlowRef.current?.setCenter(centerX, centerY, {
      duration: 260,
      zoom: Math.min(maxCanvasZoom, Math.max(currentViewportRef.current.zoom, 0.8)),
    });
  }

  function toggleHistoryPanel(): void {
    setIsHistoryOpen((current) => {
      const next = !current;
      if (next) setInspectorBlockId(undefined);
      return next;
    });
  }

  async function persistSnapshot(
    nextSnapshot: BoardSnapshot,
    options: { requireLocalApi?: boolean } = {},
  ): Promise<void> {
    if (!initialSnapshotLoadedRef.current) return;
    pendingPersistCountRef.current += 1;
    setAutosaveStatus('saving');
    try {
      const result = await saveBoardSnapshot(nextSnapshot);
      if (options.requireLocalApi && result.persistedTo !== 'local-api') {
        throw new Error(t('feedback.localApiUnavailable'));
      }
      setAutosaveStatus('saved');
    } catch (error) {
      setAutosaveStatus('error');
      if (options.requireLocalApi) throw error;
    } finally {
      pendingPersistCountRef.current = Math.max(0, pendingPersistCountRef.current - 1);
    }
  }

  function scheduleAnnotationDraftPersist(): void {
    if (annotationDraftPersistTimerRef.current !== undefined) {
      window.clearTimeout(annotationDraftPersistTimerRef.current);
    }
    annotationDraftPersistTimerRef.current = window.setTimeout(() => {
      annotationDraftPersistTimerRef.current = undefined;
      void persistSnapshot(snapshotRef.current);
    }, 300);
  }

  function flushAnnotationDraftPersist(): void {
    if (annotationDraftPersistTimerRef.current === undefined) return;
    window.clearTimeout(annotationDraftPersistTimerRef.current);
    annotationDraftPersistTimerRef.current = undefined;
    void persistSnapshot(snapshotRef.current);
  }

  function undo(): void {
    const previous = history.current.past.pop();
    if (!previous) return;

    history.current.future.push(structuredClone(snapshotRef.current));
    snapshotRef.current = structuredClone(previous);
    setSnapshot(snapshotRef.current);
    setNodes(createFlowNodesForSelection(snapshotRef.current));
    setEdges(createFlowEdgesForSelection(snapshotRef.current));
    void persistSnapshot(snapshotRef.current);
    setHistoryRevision((revision) => revision + 1);
  }

  function redo(): void {
    const next = history.current.future.pop();
    if (!next) return;

    history.current.past.push(structuredClone(snapshotRef.current));
    snapshotRef.current = structuredClone(next);
    setSnapshot(snapshotRef.current);
    setNodes(createFlowNodesForSelection(snapshotRef.current));
    setEdges(createFlowEdgesForSelection(snapshotRef.current));
    void persistSnapshot(snapshotRef.current);
    setHistoryRevision((revision) => revision + 1);
  }

  const canUndo = history.current.past.length > 0;
  const canRedo = history.current.future.length > 0;
  const selectedBlock =
    selectedBlockIds.length === 1
      ? snapshot.blocks.find((block) => block.blockId === selectedBlockIds[0])
      : undefined;
  const selectedImageUrl =
    selectedBlock?.type === 'image' ? getAssetPreviewUrl(snapshot.assets, selectedBlock.data.assetId) : undefined;
  const selectedImageAsset =
    selectedBlock?.type === 'image' && typeof selectedBlock.data.assetId === 'string'
      ? snapshot.assets.find((asset) => asset.assetId === selectedBlock.data.assetId)
      : undefined;
  const selectedBlockContentLocked = selectedBlock
    ? blockLockedByGroup(snapshot, selectedBlock.blockId)
    : false;
  const selectedGroupInheritedLocked = selectedBlock?.type === 'group'
    ? blockLockedByGroup(snapshot, selectedBlock.blockId)
    : false;
  const inspectorBlock = inspectorBlockId
    ? snapshot.blocks.find((block) => block.blockId === inspectorBlockId)
    : undefined;
  const selectedGroupMediaCount = selectedBlock?.type === 'group'
    ? groupMediaItems(snapshot, selectedBlock.blockId).length
    : 0;
  const projectBoardDialogView = projectBoardDialog
    ? getProjectBoardDialogView(projectBoardDialog, t)
    : undefined;
  const referenceImageOptions: ReferenceImageOption[] = snapshot.blocks.flatMap((block) => {
    if (block.type !== 'image' || !block.data.assetId) return [];
    const previewUrl = getAssetPreviewUrl(snapshot.assets, block.data.assetId);
    if (!previewUrl) return [];
    return [{ blockId: block.blockId, previewUrl, title: block.data.title.trim() || t('block.image.title') }];
  });
  const selectedReferenceImage = inputReferencePicker?.sourceBlockId
    ? referenceImageOptions.find((image) => image.blockId === inputReferencePicker.sourceBlockId)
    : undefined;
  const mentionOperation = inputReferencePicker
    ? snapshot.blocks.find(
        (block) => block.blockId === inputReferencePicker.operationBlockId && block.type === 'operation',
      )
    : undefined;
  const mentionSourceBlock = selectedReferenceImage
    ? snapshot.blocks.find((block) => block.blockId === selectedReferenceImage.blockId)
    : undefined;
  const mentionRoleOptions = mentionOperation && mentionSourceBlock
    ? executionInputRoleOptionsFor(mentionSourceBlock, mentionOperation)
    : [];
  const mentionExistingEdge = mentionOperation && mentionSourceBlock
    ? snapshot.edges.find(
        (edge) =>
          edge.sourceBlockId === mentionSourceBlock.blockId &&
          edge.targetBlockId === mentionOperation.blockId &&
          edge.kind === 'execution_input',
      )
    : undefined;
  const mentionDisabledRoles = mentionOperation && mentionSourceBlock
    ? disabledExecutionInputRolesFor(
        snapshot,
        mentionSourceBlock,
        mentionOperation,
        mentionExistingEdge?.edgeId,
      )
    : [];
  return (
    <main className="app-shell">
      <input
        ref={directImageImportInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          const blockId = pendingDirectImageImportBlockIdRef.current;
          pendingDirectImageImportBlockIdRef.current = undefined;
          event.currentTarget.value = '';
          if (!file || !blockId) return;
          const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId);
          if (block) void importImageIntoBlock(block, file);
        }}
      />
      <TopBar
        snapshot={snapshot}
        autosaveStatus={autosaveStatus}
        canUndo={canUndo}
        canRedo={canRedo}
        hasSelection={selectedBlockIds.length > 0}
        isHistoryOpen={isHistoryOpen}
        isProjectBoardDialogOpen={Boolean(projectBoardDialog)}
        showGrid={showGrid}
        workspace={workspace}
        onCreateBoard={(projectId) => void createBoardFromMenu(projectId)}
        onCreateProject={() => void createProjectFromMenu()}
        onDeleteBoard={(projectId, boardId) => void deleteBoardFromMenu(projectId, boardId)}
        onDeleteProject={(projectId) => void deleteProjectFromMenu(projectId)}
        onDuplicateBoard={(projectId, boardId) => void duplicateBoardFromMenu(projectId, boardId)}
        onRenameBoard={(projectId, boardId, currentName) => void renameBoardFromMenu(projectId, boardId, currentName)}
        onRenameProject={(projectId, currentName) => void renameProjectFromMenu(projectId, currentName)}
        onReorderBoards={(projectId, boardIds) => void reorderBoardsFromMenu(projectId, boardIds)}
        onReorderProjects={(projectIds) => void reorderProjectsFromMenu(projectIds)}
        onRefreshBoard={() => void refreshCurrentBoard()}
        onSelectBoard={(projectId, boardId) => void selectBoard(projectId, boardId)}
        onToggleGrid={() => setShowGrid((current) => !current)}
        onDeleteSelection={deleteSelection}
        onDuplicateSelection={duplicateSelection}
        onToggleHistory={toggleHistoryPanel}
        onUndo={undo}
        onRedo={redo}
      />
      <OperationFeedback
        copiedPromptKey={copiedPromptKey}
        promptPreview={promptPreview}
        toast={operationToast}
        onClosePromptPreview={() => setPromptPreview(undefined)}
        onCloseToast={() => setOperationToast(undefined)}
        onCopyPrompt={() => {
          if (!promptPreview) return;
          const previewCopyKey = promptPreview.copyKey ?? 'prompt-preview';
          void copyPromptWithHistory({
            blockIds: promptPreview.blockIds,
            copyKey: previewCopyKey,
            executionId: promptPreview.executionId,
            prompt: promptPreview.prompt,
            source: 'prompt_preview',
          }).then(() => {
            setCopiedPromptKey(previewCopyKey);
            closePromptPreviewAfterCopy(previewCopyKey);
          });
        }}
      />
      {inputReferencePicker ? (
        <InputReferencePicker
          anchor={inputReferencePicker.anchor}
          disabledRoles={mentionDisabledRoles}
          images={referenceImageOptions}
          roles={mentionRoleOptions}
          selectedImage={selectedReferenceImage}
          onCancel={() => setInputReferencePicker(undefined)}
          onSelectImage={(sourceBlockId) =>
            setInputReferencePicker((current) => (current ? { ...current, sourceBlockId } : current))
          }
          onSelectRole={completeInputReferenceMention}
        />
      ) : null}
      {projectBoardDialog && projectBoardDialogView ? (
        <ProjectBoardDialog
          cancelLabel={t('projectBoard.cancel')}
          closeLabel={t('context.close')}
          confirmMessage={projectBoardDialogView.confirmMessage}
          defaultValue={projectBoardDialogView.defaultValue}
          destructive={projectBoardDialogView.destructive}
          isNameRequired={projectBoardDialogView.isNameRequired}
          submitLabel={projectBoardDialogView.submitLabel}
          title={projectBoardDialogView.title}
          onCancel={() => setProjectBoardDialog(undefined)}
          onSubmit={(value) => void submitProjectBoardDialog(value)}
        />
      ) : null}
      <FloatingToolbar
        activeTool={activeCanvasTool}
        onAddBlock={addBlock}
        onCreateImageToImage={createImageToImageDraftFromMenu}
        onCreateTextToImage={() => createTextToImageDraftOperation()}
        onSetActiveTool={setActiveCanvasTool}
      />
      <ExecutionInspector
        copiedPromptKey={copiedPromptKey}
        selectedBlock={inspectorBlock}
        snapshot={snapshot}
        onClose={() => setInspectorBlockId(undefined)}
        onCopyPrompt={copyPromptWithHistory}
        onRestoreConfiguration={restoreConfigurationVersion}
      />
      <GroupInspector
        copiedPromptKey={copiedPromptKey}
        group={inspectorBlock}
        snapshot={snapshot}
        onClose={() => setInspectorBlockId(undefined)}
        onCopyPrompt={copyPromptWithHistory}
        onDownloadAll={downloadGroupAssets}
      />
      {isHistoryOpen ? (
        <BoardHistoryPanel
          copiedPromptKey={copiedPromptKey}
          snapshot={snapshot}
          onClose={() => setIsHistoryOpen(false)}
          onCopyPrompt={copyPromptWithHistory}
          onLocateBlock={locateBlock}
          onRestoreAnnotationDraft={restoreAnnotationDraftVersion}
        />
      ) : null}

      <section ref={canvasAreaRef} className="canvas-area" aria-label="Retake board canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          edgeTypes={edgeTypes}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onConnect={onConnect}
          onInit={(instance) => {
            reactFlowRef.current = instance;
            void instance.setViewport(currentViewportRef.current, { duration: 0 });
          }}
          onMove={(_event, viewport) => {
            currentViewportRef.current = viewport;
            setCanvasZoom(viewport.zoom);
          }}
          onMoveEnd={(_event, viewport) => persistViewport(viewport)}
          onSelectionChange={onSelectionChange}
          defaultViewport={snapshot.viewport}
          minZoom={minCanvasZoom}
          maxZoom={maxCanvasZoom}
          zoomOnDoubleClick={false}
          deleteKeyCode={null}
          nodesDraggable={activeCanvasTool === 'select'}
          panOnDrag={activeCanvasTool === 'pan'}
          selectionOnDrag={activeCanvasTool === 'select'}
          fitView={false}
        >
          {selectedBlock?.type === 'image' && selectedImageUrl && !selectedBlockContentLocked ? (
            <NodeToolbar nodeId={selectedBlock.blockId} position={Position.Top} offset={12} isVisible>
              <ContextToolbar
                canvasZoom={canvasZoom}
                selectedBlock={selectedBlock}
                selectedImageUrl={selectedImageUrl}
                onAnnotationDraftChange={(draft) => updateAnnotationDraft(selectedBlock.blockId, draft)}
                onAnnotationDraftFlush={flushAnnotationDraftPersist}
                onCreateSimilar={() => {
                  if (selectedBlock) createImageToImageDraftOperation(selectedBlock, 'create_similar');
                }}
                onCreateLocalEdit={(input) => {
                  if (!selectedBlock) return;
                  void createLocalImageEditOperation(selectedBlock, input);
                }}
                onDownloadImage={() => {
                  if (!selectedImageAsset) return;
                  downloadAsset(selectedImageAsset, selectedBlock?.data.title);
                }}
                onReplaceImage={() => {
                  if (!selectedBlock || selectedBlock.data.sourceExecutionId || selectedBlock.data.operationBlockId) return;
                  pendingDirectImageImportBlockIdRef.current = selectedBlock.blockId;
                  directImageImportInputRef.current?.click();
                }}
                onRunAnnotationEdit={({ instruction, manifest, composite }) => {
                  if (!selectedBlock) return;
                  void createImageAssetFromDataUrl({
                    projectId: snapshotRef.current.project.projectId,
                    dataUrl: composite.dataUrl,
                    fileName: `annotation-${selectedBlock.blockId}.png`,
                    width: composite.width,
                    height: composite.height,
                  }).then((annotatedCompositeAsset) => {
                    void startImageCodexOperation('annotation_edit', selectedBlock, instruction, {
                      annotatedCompositeAsset,
                      annotationManifest: {
                        ...manifest,
                        compositeAssetId: annotatedCompositeAsset.assetId,
                      },
                    });
                  });
                }}
                onRunQuickEdit={({ instruction }) => {
                  if (!selectedBlock) return;
                  createImageToImageDraftOperation(selectedBlock, 'quick_edit', instruction);
                }}
              />
            </NodeToolbar>
          ) : null}
          {selectedBlock?.type === 'group' ? (
            <NodeToolbar nodeId={selectedBlock.blockId} position={Position.Top} offset={34} isVisible>
              <GroupToolbar
                collapsed={collapsedGroupIds.includes(selectedBlock.blockId)}
                group={selectedBlock}
                inheritedLocked={selectedGroupInheritedLocked}
                mediaCount={selectedGroupMediaCount}
                onBrowse={() => {
                  setIsHistoryOpen(false);
                  setInspectorBlockId(selectedBlock.blockId);
                }}
                onDelete={() => {
                  if (window.confirm(t('group.deleteConfirm'))) deleteBlockIds([selectedBlock.blockId]);
                }}
                onDownload={() => downloadGroupAssets(selectedBlock.blockId)}
                onFit={() => fitSelectedGroup(selectedBlock.blockId)}
                onLayout={(layoutMode) => layoutSelectedGroup(selectedBlock.blockId, layoutMode)}
                onToggleCollapsed={() => toggleGroupCollapsed(selectedBlock.blockId)}
                onUngroup={() => ungroupSelectedGroup(selectedBlock.blockId)}
                onUpdate={(updates) => updateGroup(selectedBlock.blockId, updates)}
              />
            </NodeToolbar>
          ) : null}
          {showGrid ? <Background /> : null}
          {isMiniMapVisible ? <CanvasMiniMap onSelectBlock={selectBlock} /> : null}
          <CanvasViewportControls
            isMiniMapVisible={isMiniMapVisible}
            onToggleMiniMap={() => setIsMiniMapVisible((current) => !current)}
          />
        </ReactFlow>
        {activeCanvasTool === 'group' ? (
          <GroupDrawOverlay
            getCandidateCount={groupDrawCandidateCount}
            onCancel={() => setActiveCanvasTool('pan')}
            onComplete={completeGroupDraw}
          />
        ) : null}
      </section>
    </main>
  );
}

function absoluteFlowNodePositions(flowNodes: readonly RetakeNode[]): Map<string, { x: number; y: number }> {
  const nodeById = new Map(flowNodes.map((node) => [node.id, node]));
  const positions = new Map<string, { x: number; y: number }>();
  const resolving = new Set<string>();

  function resolve(node: RetakeNode): { x: number; y: number } {
    const cached = positions.get(node.id);
    if (cached) return cached;
    if (resolving.has(node.id)) return { ...node.position };
    resolving.add(node.id);
    const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
    const parentPosition = parent ? resolve(parent) : { x: 0, y: 0 };
    const absolute = { x: parentPosition.x + node.position.x, y: parentPosition.y + node.position.y };
    resolving.delete(node.id);
    positions.set(node.id, absolute);
    return absolute;
  }

  for (const node of flowNodes) resolve(node);
  return positions;
}

function flowNodeSize(node: RetakeNode | undefined, block: BlockRecord): { height: number; width: number } {
  return {
    width: node?.measured?.width ?? block.size.width,
    height: node?.measured?.height ?? block.size.height,
  };
}

function downloadAsset(asset: AssetRecord, title?: unknown): void {
  const link = document.createElement('a');
  link.href = asset.previewUrl;
  link.download = assetFileName(asset, title);
  document.body.append(link);
  link.click();
  link.remove();
}

function generationParamsFromBlock(block: BlockRecord | undefined): ImageGenerationParams | undefined {
  const value = block?.data.generationParams;
  if (!isRecord(value)) return undefined;

  return {
    aspectRatioPreset: typeof value.aspectRatioPreset === 'string' ? value.aspectRatioPreset : undefined,
    durationSeconds: finiteNumber(value.durationSeconds),
    model: typeof value.model === 'string' && value.model !== 'codex-mcp' ? value.model : undefined,
    motion: typeof value.motion === 'string' ? value.motion : undefined,
    strength: finiteNumber(value.strength),
    targetAspectRatio: finiteNumber(value.targetAspectRatio),
    targetHeight: finiteNumber(value.targetHeight),
    targetResolution: typeof value.targetResolution === 'string' ? value.targetResolution : undefined,
    targetWidth: finiteNumber(value.targetWidth),
    variationCount: finiteNumber(value.variationCount),
  };
}

function resizeEmptyOperationOutputSlot(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  generationParams: ImageGenerationParams,
): void {
  const outputBlockIds = new Set(
    snapshot.edges
      .filter((edge) => edge.sourceBlockId === operationBlock.blockId && edge.kind === 'execution_output')
      .map((edge) => edge.targetBlockId),
  );
  const updatedAt = nowIso();
  for (const outputBlock of snapshot.blocks) {
    if (!outputBlockIds.has(outputBlock.blockId) || outputBlock.type !== 'image' || outputBlock.data.assetId) continue;
    outputBlock.size = displaySlotSizeForGenerationParams(generationParams, outputBlock.size);
    outputBlock.updatedAt = updatedAt;
  }
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function selectedOperationBlockIdFor(snapshot: BoardSnapshot, blockIds: string[]): string | undefined {
  if (blockIds.length !== 1) return undefined;
  const selectedBlockId = blockIds[0];
  const selectedOperation = snapshot.blocks.find(
    (block) => block.blockId === selectedBlockId && block.type === 'operation',
  );
  if (selectedOperation) return selectedOperation.blockId;
  return snapshot.edges.find(
    (edge) =>
      edge.sourceBlockId === selectedBlockId &&
      edge.kind === 'execution_input' &&
      snapshot.blocks.some((block) => block.blockId === edge.targetBlockId && block.type === 'operation'),
  )?.targetBlockId;
}

function isInteractiveNodeTarget(target: HTMLElement): boolean {
  return Boolean(
    target.closest(
      [
        'button',
        'input',
        'select',
        'textarea',
        '[role="menu"]',
        '.operation-param-popover',
        '.operation-input-quick-add',
        '.operation-input-role-control',
        '.block-heading-info-button',
      ].join(','),
    ),
  );
}

function sameBlockSelection(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((blockId) => rightIds.has(blockId));
}

function isEditableNodeTarget(target: HTMLElement): boolean {
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function applyOperationInputRoleBadges(
  nodes: RetakeNode[],
  snapshot: BoardSnapshot,
  selectedBlockIds: string[],
): RetakeNode[] {
  const selectedOperationBlockId = selectedOperationBlockIdFor(snapshot, selectedBlockIds);
  const selectedOperation = snapshot.blocks.find(
    (block) => block.blockId === selectedOperationBlockId && block.type === 'operation',
  );
  const inputMetadataByBlockId = new Map(
    snapshot.edges
      .filter(
        (edge) => edge.kind === 'execution_input' && edge.targetBlockId === selectedOperationBlockId,
      )
      .flatMap((edge) => {
        const sourceBlock = snapshot.blocks.find((block) => block.blockId === edge.sourceBlockId);
        if (sourceBlock?.type !== 'image' || !selectedOperation) return [];
        return [[
          edge.sourceBlockId,
          {
            edgeId: edge.edgeId,
            role: edge.inputRole,
            roleOptions: executionInputRoleOptionsFor(sourceBlock, selectedOperation),
            disabledRoleOptions: disabledExecutionInputRolesFor(
              snapshot,
              sourceBlock,
              selectedOperation,
              edge.edgeId,
            ),
          },
        ] as const];
      }),
  );

  let changed = false;
  const nextNodes = nodes.map((node) => {
    const nextMetadata = inputMetadataByBlockId.get(node.id);
    const nextEdgeId = nextMetadata?.edgeId;
    const nextRole = nextMetadata?.role;
    const nextRoleOptions = nextMetadata?.roleOptions;
    const nextDisabledRoleOptions = nextMetadata?.disabledRoleOptions;
    if (
      node.data.operationInputEdgeId === nextEdgeId &&
      node.data.operationInputRole === nextRole &&
      arraysEqual(node.data.operationInputRoleOptions ?? [], nextRoleOptions ?? []) &&
      arraysEqual(node.data.operationInputRoleDisabledOptions ?? [], nextDisabledRoleOptions ?? []) &&
      node.data.operationInputRolePending === Boolean(nextEdgeId && !nextRole)
    ) {
      return node;
    }

    changed = true;
    const nextData = { ...node.data };
    if (nextRole) {
      nextData.operationInputEdgeId = nextEdgeId;
      nextData.operationInputRole = nextRole;
      nextData.operationInputRoleOptions = nextRoleOptions;
      nextData.operationInputRoleDisabledOptions = nextDisabledRoleOptions;
      nextData.operationInputRolePending = false;
    } else if (nextEdgeId) {
      nextData.operationInputEdgeId = nextEdgeId;
      nextData.operationInputRoleOptions = nextRoleOptions;
      nextData.operationInputRoleDisabledOptions = nextDisabledRoleOptions;
      nextData.operationInputRolePending = true;
      delete nextData.operationInputRole;
    } else {
      delete nextData.operationInputEdgeId;
      delete nextData.operationInputRole;
      delete nextData.operationInputRoleDisabledOptions;
      delete nextData.operationInputRoleOptions;
      delete nextData.operationInputRolePending;
    }
    return {
      ...node,
      data: nextData,
    };
  });

  return changed ? nextNodes : nodes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function operationModeFromBlock(block: BlockRecord): SwitchableOperationMode {
  if (block.data.operationMode === 'text_to_image' || block.data.operationMode === 'generate_image') return 'text_to_image';
  if (block.data.operationMode === 'image_to_image' || block.data.operationMode === 'quick_edit' || block.data.operationMode === 'create_similar') {
    return 'image_to_image';
  }
  if (block.data.capabilityId === 'image.image_to_image' || block.data.capabilityId === 'image.edit') return 'image_to_image';
  if (block.data.capabilityId === 'image.generate.similar') return 'image_to_image';
  return 'text_to_image';
}

function capabilityIdForOperationMode(operation: SwitchableOperationMode): string {
  if (operation === 'text_to_image') return 'image.text_to_image';
  return 'image.image_to_image';
}

function operationAllowsInputType(operationBlock: BlockRecord, type: Extract<BlockType, 'image' | 'text' | 'video'>): boolean {
  const capabilityId =
    typeof operationBlock.data.capabilityId === 'string' ? operationBlock.data.capabilityId : 'image.text_to_image';
  return schemaForCapability(capabilityId).inputContracts.some(
    (contract) => contract.source === 'block' && contract.type === type,
  );
}

function isOlderSnapshot(candidate: BoardSnapshot, current: BoardSnapshot): boolean {
  if (candidate.project.projectId !== current.project.projectId || candidate.board.boardId !== current.board.boardId) {
    return false;
  }
  return timestampMs(candidate.board.updatedAt) < timestampMs(current.board.updatedAt);
}

function timestampMs(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function assetFileName(asset: AssetRecord, title?: unknown): string {
  const urlName = asset.previewUrl.split('/').pop();
  const extension = urlName?.includes('.') ? `.${urlName.split('.').pop()}` : extensionForMime(asset.mimeType);
  const titleBase = typeof title === 'string' && title.trim() ? title.trim() : asset.assetId;
  const safeBase = titleBase
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${safeBase || asset.assetId}${extension}`;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/svg+xml') return '.svg';
  if (mimeType === 'video/mp4') return '.mp4';
  return '.bin';
}
