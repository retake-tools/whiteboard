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
  type NodeChange,
  type NodeTypes,
  type OnSelectionChangeParams,
  type NodeMouseHandler,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { BoardHistoryPanel } from './components/BoardHistoryPanel';
import { CanvasMiniMap } from './components/CanvasMiniMap';
import { CanvasViewportControls } from './components/CanvasViewportControls';
import { ContextToolbar } from './components/ContextToolbar';
import { ExecutionInspector } from './components/ExecutionInspector';
import { FloatingToolbar, type CanvasTool } from './components/FloatingToolbar';
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
import { appendPromptCopiedEvent } from './core/historyEvents';
import { fitImageBlockSize, readFileAsDataUrl, readImageDimensions } from './core/imageFile';
import { addImageCodexOperation, type ImageCodexOperation, type ImageGenerationParams } from './core/imageOperations';
import { imageOperationDefaultPrompt, imageOperationTitle } from './core/imageOperationText';
import { createId, nowIso } from './core/id';
import { arraysEqual, numberedDefaultName } from './core/listUtils';
import { loadUiPreferences, saveUiPreferences } from './core/uiPreferences';
import { useI18n } from './i18n';
import type { AssetRecord, BlockRecord, BlockType, BoardEdgeRecord, BoardSnapshot, RetakeEdge, RetakeNode, WorkspaceSummary } from './core/types';
import { BlockNode } from './nodes/BlockNode';

const minCanvasZoom = 0.05;
const maxCanvasZoom = 5;
const nodeTypes = { text: BlockNode, image: BlockNode, video: BlockNode, task: BlockNode, frame: BlockNode } satisfies NodeTypes;

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
  const reactFlowRef = useRef<ReactFlowInstance<RetakeNode, RetakeEdge> | null>(null);
  const [nodes, setNodes] = useState<RetakeNode[]>(() => createFlowNodes(initialSnapshot.current!));
  const [edges, setEdges] = useState<RetakeEdge[]>(() => createFlowEdges(initialSnapshot.current!));
  const [selectedBlockIds, setSelectedBlockIds] = useState<string[]>([]);
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [operationToast, setOperationToast] = useState<OperationToast | undefined>();
  const [promptPreview, setPromptPreview] = useState<PromptPreview | undefined>();
  const [copiedPromptKey, setCopiedPromptKey] = useState<string | undefined>();
  const [inspectorBlockId, setInspectorBlockId] = useState<string | undefined>();
  const [activeCanvasTool, setActiveCanvasTool] = useState<CanvasTool>('pan');
  const [canvasZoom, setCanvasZoom] = useState(() => currentViewportRef.current.zoom);
  const [isMiniMapVisible, setIsMiniMapVisible] = useState(() => initialUiPreferences.current.isMiniMapVisible);
  const [showGrid, setShowGrid] = useState(() => initialUiPreferences.current.showGrid);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceSummary | undefined>();
  const [projectBoardDialog, setProjectBoardDialog] = useState<ProjectBoardDialogState | undefined>();
  const copiedPromptTimer = useRef<number | undefined>(undefined);
  const [, setHistoryRevision] = useState(0);
  snapshotRef.current = snapshot;

  useEffect(() => {
    let cancelled = false;

    void loadBoardSnapshot().then((loadedSnapshot) => {
      if (cancelled) return;
      snapshotRef.current = loadedSnapshot;
      restoreViewport(loadedSnapshot.viewport);
      setSnapshot(loadedSnapshot);
      setNodes(createFlowNodes(loadedSnapshot));
      setEdges(createFlowEdges(loadedSnapshot));
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
    saveUiPreferences({ isMiniMapVisible });
  }, [isMiniMapVisible]);

  useEffect(() => {
    saveUiPreferences({ showGrid });
  }, [showGrid]);

  useEffect(() => {
    return subscribeToBoardSnapshotChanges({
      getCurrentSnapshot: () => snapshotRef.current,
      onSnapshot: (remoteSnapshot) => {
        snapshotRef.current = remoteSnapshot;
        setSnapshot(remoteSnapshot);
        setNodes(createFlowNodes(remoteSnapshot));
        setEdges(createFlowEdges(remoteSnapshot));
        setSelectedBlockIds((current) =>
          current.filter((blockId) => remoteSnapshot.blocks.some((block) => block.blockId === blockId)),
        );
        setAutosaveStatus('saved');
      },
    });
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
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
      setNodes(createFlowNodes(nextSnapshot));
      setEdges(createFlowEdges(nextSnapshot));
    }
    if (options.persist) {
      void persistSnapshot(nextSnapshot);
    }
    return nextSnapshot;
  }

  function onNodesChange(changes: NodeChange[]): void {
    setNodes((currentNodes) => applyNodeChanges(changes, currentNodes) as RetakeNode[]);

    const removeChanges = changes.filter((change) => change.type === 'remove');
    if (removeChanges.length === 0) return;

    updateSnapshot((current) => {
      for (const change of removeChanges) {
        current.blocks = current.blocks.filter((block) => block.blockId !== change.id);
        current.edges = current.edges.filter(
          (edge) => edge.sourceBlockId !== change.id && edge.targetBlockId !== change.id,
        );
      }

      return touchBoard(current);
    }, { persist: true, history: true });
  }

  function onEdgesChange(changes: EdgeChange[]): void {
    setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges) as RetakeEdge[]);

    const removeChanges = changes.filter((change) => change.type === 'remove');
    if (removeChanges.length === 0) return;

    updateSnapshot((current) => {
      const removedEdgeIds = new Set(removeChanges.map((change) => change.id));
      current.edges = current.edges.filter((edge) => !removedEdgeIds.has(edge.edgeId));
      return touchBoard(current);
    }, { persist: true, history: true });
  }

  function onNodeDragStop(_event: MouseEvent | TouchEvent, _node: RetakeNode, draggedNodes: RetakeNode[]): void {
    updateSnapshot(
      (current) => {
        for (const draggedNode of draggedNodes) {
          const block = current.blocks.find((candidate) => candidate.blockId === draggedNode.id);
          if (block) {
            block.position = draggedNode.position;
            block.updatedAt = nowIso();
          }
        }

        return touchBoard(current);
      },
      { syncFlow: false, persist: true, history: true },
    );
  }

  function onConnect(connection: Connection): void {
    const edgeId = createId('edge');
    const nextEdge: RetakeEdge = {
      ...connection,
      id: edgeId,
      source: connection.source ?? '',
      target: connection.target ?? '',
      type: 'smoothstep',
      label: 'reference',
      data: { kind: 'reference' },
    };

    const nextEdges = addEdge(nextEdge, edges);
    setEdges(nextEdges);
    updateSnapshot((current) => {
      current.edges = nextEdges.map(
        (edge): BoardEdgeRecord => ({
          edgeId: edge.id,
          sourceBlockId: edge.source,
          targetBlockId: edge.target,
          kind: edge.data?.kind ?? 'reference',
        }),
      );
      return touchBoard(current);
    }, { persist: true, history: true });
  }

  function onSelectionChange(params: OnSelectionChangeParams): void {
    const nextSelectedBlockIds = params.nodes.map((node) => node.id);
    if (nextSelectedBlockIds.length === 0 && document.querySelector('.annotation-popover')) {
      return;
    }
    setSelectedBlockIds((current) =>
      arraysEqual(current, nextSelectedBlockIds) ? current : nextSelectedBlockIds,
    );
  }

  const onNodeClick: NodeMouseHandler<RetakeNode> = (_event, node) => {
    dismissTerminalImageStatus(node.id);
  };

  function dismissTerminalImageStatus(blockId: string): void {
    const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId);
    if (!block || block.type !== 'image') return;
    if (block.data.status !== 'succeeded' && block.data.status !== 'failed') return;
    if (block.data.statusVisualDismissed) return;

    updateSnapshot((current) => {
      const targetBlock = current.blocks.find((candidate) => candidate.blockId === blockId);
      if (!targetBlock || targetBlock.type !== 'image') return current;
      targetBlock.data.statusVisualDismissed = true;
      targetBlock.updatedAt = nowIso();
      return touchBoard(current);
    }, { persist: true });
  }

  function addBlock(type: Exclude<BlockType, 'frame'>): void {
    let newBlockId = '';
    const nextSnapshot = updateSnapshot((current) => {
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
    setActiveCanvasTool('pan');
    setSelectedBlockIds([newBlockId]);
    setNodes(
      createFlowNodes(nextSnapshot).map((node) => ({
        ...node,
        selected: node.id === newBlockId,
      })),
    );
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

  function deleteSelection(): void {
    if (selectedBlockIds.length === 0) return;
    const selectedIds = new Set(selectedBlockIds);
    updateSnapshot((current) => {
      current.blocks = current.blocks.filter((block) => !selectedIds.has(block.blockId));
      current.edges = current.edges.filter(
        (edge) => !selectedIds.has(edge.sourceBlockId) && !selectedIds.has(edge.targetBlockId),
      );
      return touchBoard(current);
    }, { persist: true, history: true });
    setSelectedBlockIds([]);
  }

  function duplicateSelection(): void {
    if (selectedBlockIds.length === 0) return;
    const selectedIds = new Set(selectedBlockIds);
    const newBlockIds: string[] = [];
    const nextSnapshot = updateSnapshot((current) => {
      const selectedBlocks = current.blocks.filter((block) => selectedIds.has(block.blockId));
      const nextZ = maxZIndex(current.blocks) + 1;

      selectedBlocks.forEach((block, index) => {
        const blockId = createId('block');
        newBlockIds.push(blockId);
        current.blocks.push({
          ...structuredClone(block),
          blockId,
          position: {
            x: block.position.x + 36,
            y: block.position.y + 36,
          },
          zIndex: nextZ + index,
          createdAt: nowIso(),
          updatedAt: nowIso(),
        });
      });

      return touchBoard(current);
    }, { persist: true, history: true });

    setSelectedBlockIds(newBlockIds);
    setNodes(
      createFlowNodes(nextSnapshot).map((node) => ({
        ...node,
        selected: newBlockIds.includes(node.id),
      })),
    );
    setEdges(createFlowEdges(nextSnapshot));
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
    setNodes(createFlowNodes(nextSnapshot));
    setEdges(createFlowEdges(nextSnapshot));
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

  async function startImageCodexOperation(
    operation: ImageCodexOperation,
    block: BlockRecord,
    instruction?: string,
    options: {
      annotatedCompositeAsset?: AssetRecord;
      generationParams?: ImageGenerationParams;
      referenceAssets?: AssetRecord[];
    } = {},
  ): Promise<void> {
    let operationPrompt = '';
    let resultBlockId = '';
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
          generationParams: options.generationParams,
          referenceAssets: options.referenceAssets,
        });
        operationPrompt = result.prompt;
        resultBlockId = result.resultBlock.blockId;
        executionId = result.execution.executionId;
        return current;
      },
      { history: true },
    );

    await persistSnapshot(nextSnapshot);
    setSelectedBlock(nextSnapshot, resultBlockId);
    const copyKey = `prompt:${resultBlockId}`;
    const blockIds = [block.blockId, resultBlockId];
    setPromptPreview({ title: t('feedback.promptTitle'), prompt: operationPrompt, copyKey, executionId, blockIds });
    try {
      await copyPromptWithHistory({
        blockIds,
        copyKey,
        executionId,
        prompt: operationPrompt,
        source: 'prompt_preview',
      });
      setOperationToast({
        id: resultBlockId,
        title: t('feedback.taskCreated'),
        body: t('feedback.taskCreatedCopied'),
        tone: 'success',
      });
    } catch {
      setOperationToast({
        id: resultBlockId,
        title: t('feedback.taskCreated'),
        body: t('feedback.taskCreatedCopyFailed'),
        tone: 'error',
      });
    }
  }

  async function importImageIntoBlock(block: BlockRecord, file: File): Promise<void> {
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
        if (!current.assets.some((candidate) => candidate.assetId === asset.assetId)) {
          current.assets.unshift(asset);
        }

        const targetBlock = current.blocks.find((candidate) => candidate.blockId === block.blockId);
        if (targetBlock && targetBlock.type === 'image') {
          targetBlock.data = {
            ...targetBlock.data,
            title: file.name || targetBlock.data.title,
            body: undefined,
            assetId: asset.assetId,
            previewUrl: asset.previewUrl,
          };
          targetBlock.size = fitImageBlockSize(asset.width, asset.height);
          targetBlock.updatedAt = nowIso();
        }

        return touchBoard(current);
      },
      { history: true },
    );

    await persistSnapshot(nextSnapshot);
  }

  async function createReferenceAssets(files: File[]): Promise<AssetRecord[]> {
    return Promise.all(
      files.map(async (file) => {
        const dataUrl = await readFileAsDataUrl(file);
        const imageSize = await readImageDimensions(dataUrl);
        return createImageAssetFromDataUrl({
          projectId: snapshotRef.current.project.projectId,
          dataUrl,
          fileName: file.name,
          width: imageSize?.width,
          height: imageSize?.height,
        });
      }),
    );
  }

  function setSelectedBlock(nextSnapshot: BoardSnapshot, blockId: string): void {
    setSelectedBlockIds([blockId]);
    setNodes(
      createFlowNodes(nextSnapshot).map((node) => ({
        ...node,
        selected: node.id === blockId,
      })),
    );
    setEdges(createFlowEdges(nextSnapshot));
  }

  function selectBlock(blockId: string): void {
    setSelectedBlockIds([blockId]);
    setNodes((currentNodes) =>
      currentNodes.map((node) => ({
        ...node,
        selected: node.id === blockId,
      })),
    );
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

  async function persistSnapshot(nextSnapshot: BoardSnapshot): Promise<void> {
    setAutosaveStatus('saving');
    try {
      await saveBoardSnapshot(nextSnapshot);
      setAutosaveStatus('saved');
    } catch {
      setAutosaveStatus('error');
    }
  }

  function undo(): void {
    const previous = history.current.past.pop();
    if (!previous) return;

    history.current.future.push(structuredClone(snapshotRef.current));
    snapshotRef.current = structuredClone(previous);
    setSnapshot(snapshotRef.current);
    setNodes(createFlowNodes(snapshotRef.current));
    setEdges(createFlowEdges(snapshotRef.current));
    void persistSnapshot(snapshotRef.current);
    setHistoryRevision((revision) => revision + 1);
  }

  function redo(): void {
    const next = history.current.future.pop();
    if (!next) return;

    history.current.past.push(structuredClone(snapshotRef.current));
    snapshotRef.current = structuredClone(next);
    setSnapshot(snapshotRef.current);
    setNodes(createFlowNodes(snapshotRef.current));
    setEdges(createFlowEdges(snapshotRef.current));
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
  const inspectorBlock = inspectorBlockId
    ? snapshot.blocks.find((block) => block.blockId === inspectorBlockId)
    : undefined;
  const projectBoardDialogView = projectBoardDialog
    ? getProjectBoardDialogView(projectBoardDialog, t)
    : undefined;

  return (
    <main className="app-shell">
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
          void copyPromptWithHistory({
            blockIds: promptPreview.blockIds,
            copyKey: promptPreview.copyKey ?? 'prompt-preview',
            executionId: promptPreview.executionId,
            prompt: promptPreview.prompt,
            source: 'prompt_preview',
          });
        }}
      />
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
        onSetActiveTool={setActiveCanvasTool}
      />
      <ExecutionInspector
        copiedPromptKey={copiedPromptKey}
        selectedBlock={inspectorBlock}
        snapshot={snapshot}
        onClose={() => setInspectorBlockId(undefined)}
        onCopyPrompt={copyPromptWithHistory}
      />
      {isHistoryOpen ? (
        <BoardHistoryPanel
          copiedPromptKey={copiedPromptKey}
          snapshot={snapshot}
          onClose={() => setIsHistoryOpen(false)}
          onCopyPrompt={copyPromptWithHistory}
          onLocateBlock={locateBlock}
        />
      ) : null}

      <section ref={canvasAreaRef} className="canvas-area" aria-label="Retake board canvas">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeDragStop={onNodeDragStop}
          onNodeClick={onNodeClick}
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
          nodesDraggable={activeCanvasTool === 'select'}
          panOnDrag={activeCanvasTool === 'pan'}
          selectionOnDrag={activeCanvasTool === 'select'}
          fitView={false}
        >
          {selectedBlock?.type === 'image' ? (
            <NodeToolbar nodeId={selectedBlock.blockId} position={Position.Top} offset={12} isVisible>
              <ContextToolbar
                canvasZoom={canvasZoom}
                selectedBlock={selectedBlock}
                selectedImageUrl={selectedImageUrl}
                onCreateSimilar={() => {
                  if (selectedBlock) void startImageCodexOperation('create_similar', selectedBlock);
                }}
                onGenerateImage={({ generationParams, instruction, referenceFiles }) => {
                  if (!selectedBlock) return;
                  void createReferenceAssets(referenceFiles).then((referenceAssets) => {
                    void startImageCodexOperation('generate_image', selectedBlock, instruction, {
                      generationParams,
                      referenceAssets,
                    });
                  });
                }}
                onImportImage={(file) => {
                  if (selectedBlock) void importImageIntoBlock(selectedBlock, file);
                }}
                onRunAnnotationEdit={({ instruction, composite }) => {
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
                    });
                  });
                }}
                onRunQuickEdit={({ instruction }) => {
                  if (selectedBlock) void startImageCodexOperation('quick_edit', selectedBlock, instruction);
                }}
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
      </section>
    </main>
  );
}
