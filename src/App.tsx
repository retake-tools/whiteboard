import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { BoardHistoryPanel } from './components/BoardHistoryPanel';
import { AgentWorkspace } from './components/AgentWorkspace';
import { ExecutionInspector } from './components/ExecutionInspector';
import { FloatingToolbar } from './components/FloatingToolbar';
import { GenerationCandidateDock } from './components/GenerationCandidateDock';
import {
  WorkflowCandidateDock,
  workflowCandidateDecision,
} from './components/WorkflowCandidateDock';
import {
  GenerationTaskPanel,
  generationExecutionForBlock,
} from './components/GenerationTaskPanel';
import { GroupInspector } from './components/GroupInspector';
import { ImageInspectorPanel } from './components/ImageInspectorPanel';
import {
  BlankWorkspaceStart,
  blankWorkspacePlaceholderImage,
  isBlankWorkspaceContent,
} from './components/BlankWorkspaceStart';
import { ImageFocusWorkspace } from './components/ImageFocusWorkspace';
import { InputReferencePicker } from './components/InputReferencePicker';
import { OperationFeedback } from './components/OperationFeedback';
import { OperationFromImagePicker } from './components/OperationFromImagePicker';
import { ProjectBoardDialog } from './components/ProjectBoardDialog';
import { getProjectBoardDialogView } from './components/projectBoardDialogView';
import { TopBar } from './components/TopBar';
import { WorkspaceShell } from './components/WorkspaceShell';
import { WorkspaceSidebar } from './components/WorkspaceSidebar';
import { WorkspaceWorkbench } from './components/WorkspaceWorkbench';
import { TextBlockEditorDialog } from './components/TextBlockEditorDialog';
import {
  UnifiedComposerProvider,
  type UnifiedComposerVideoDraftInput,
} from './components/UnifiedComposerProvider';
import { WorkflowContinuationDialog } from './components/WorkflowContinuationDialog';
import { getAssetPreviewUrl } from './core/assetStore';
import { defaultBlockSize } from './core/blockSizing';
import { localizedBlockData } from './core/blockLocalization';
import { blockLockedByGroup, groupMediaItems } from './core/grouping';
import { loadUiPreferences, saveUiPreferences } from './core/uiPreferences';
import { loadExecutionProviderSettings } from './core/executionProviderClient';
import { useI18n } from './i18n';
import { useWorkspaceController } from './app/useWorkspaceController';
import { useWorkspaceSurfaceController } from './app/useWorkspaceSurfaceController';
import { useBoardSession, type ReadyBoardSession } from './app/useBoardSession';
import { useImageOperationController } from './app/useImageOperationController';
import { usePluginExecutionController } from './app/usePluginExecutionController';
import {
  pluginDraftViewsForBlocks,
  usePluginDraftController,
} from './app/usePluginDraftController';
import { useOperationInputController } from './app/useOperationInputController';
import {
  useExecutionConfigurationController,
} from './app/useExecutionConfigurationController';
import { useExecutionOutputSelectionController } from './app/useExecutionOutputSelectionController';
import { useCanvasController } from './app/useCanvasController';
import { useGroupController } from './app/useGroupController';
import { useBlockActions } from './app/useBlockActions';
import { useAppEventBindings } from './app/useAppEventBindings';
import { useVideoGenerationController } from './app/useVideoGenerationController';
import { useTextGenerationController } from './app/useTextGenerationController';
import { useWorkflowDraftController } from './app/useWorkflowDraftController';
import { useWorkflowRuntimeController } from './app/useWorkflowRuntimeController';
import { usePackageEntryPointController } from './app/usePackageEntryPointController';
import { useAgentRuntimeController } from './app/useAgentRuntimeController';
import { useAgentWorkspaceController } from './app/useAgentWorkspaceController';
import { useAgentAttachmentController } from './app/useAgentAttachmentController';
import { useArtifactLibraryController } from './app/useArtifactLibraryController';
import { useDomainVideoLaunchReviewController } from './app/useDomainVideoLaunchReviewController';
import { WhiteboardCanvas } from './app/WhiteboardCanvas';
import { downloadAsset } from './app/appHelpers';
import type {
  PluginAssetV2,
  PluginHostEnvironmentSnapshotV2,
  PluginHostReadSnapshotV2,
} from '@retake-tools/package-sdk';
import { PluginPanelHost } from './components/PluginPanelHost';
import type {
  PluginContributionRegistryV1,
} from './host-kit/plugin';
import type {
  PluginDraftRunnerV2,
  PluginExecutionRunnerV2,
} from './host-kit/plugin';
import type {
  PluginHostDraftRecordV2,
} from './host-kit/plugin';
import { pluginHostBoundScope } from './core/pluginHostScope';
import type {
  PluginActivationDemandV1,
  PluginRuntimeControllerV1,
} from './core/pluginRuntimeManagementClient';
import type {
  PackageLifecycleControllerV1,
} from './core/packageLifecycleClient';
import type {
  PackageBootstrapNoticeV1,
} from './core/installedRuntimeRegistryClient';
import { loadProjectWorkflowAuthoring } from './core/workflowAuthoringClient';
import { configureProjectWorkflowRegistry } from './core/workflowRegistry';
import type { CanvasHostV1 } from './host-kit';

const DocumentReviewWorkspace = lazy(() => import('./components/DocumentReviewWorkspace').then((module) => ({
  default: module.DocumentReviewWorkspace,
})));
const ArtifactLibraryPanel = lazy(() => import('./components/ArtifactLibraryPanel').then((module) => ({
  default: module.ArtifactLibraryPanel,
})));
const DomainVideoLaunchReviewDialog = lazy(() => import('./components/DomainVideoLaunchReviewDialog').then((module) => ({
  default: module.DomainVideoLaunchReviewDialog,
})));
const WorkflowWorkspace = lazy(() => import('./components/WorkflowWorkspace').then((module) => ({
  default: module.WorkflowWorkspace,
})));

export function App({
  canvasHost,
  onPluginContributionFatalFailure,
  onPluginDraftRunnerChange,
  onPluginExecutionRunnerChange,
  onPluginHostEnvironmentChange,
  onPluginHostScopeChange,
  onPluginManagerOpenChange,
  pluginContributionRegistry,
  packageBootstrapFailures = [],
  packageLifecycleController,
  pluginRuntimeController,
}: {
  canvasHost?: CanvasHostV1;
  onPluginContributionFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  onPluginDraftRunnerChange?: (
    runner: PluginDraftRunnerV2 | undefined,
  ) => void;
  onPluginExecutionRunnerChange?: (
    runner: PluginExecutionRunnerV2 | undefined,
  ) => void;
  onPluginHostScopeChange?: (
    snapshot: PluginHostReadSnapshotV2,
    assets: readonly PluginAssetV2[],
    drafts: readonly PluginHostDraftRecordV2[],
    demand: PluginActivationDemandV1,
  ) => void;
  onPluginManagerOpenChange?: (open: boolean) => void;
  onPluginHostEnvironmentChange?: (
    snapshot: PluginHostEnvironmentSnapshotV2,
  ) => void;
  pluginContributionRegistry?: PluginContributionRegistryV1;
  packageBootstrapFailures?: PackageBootstrapNoticeV1[];
  packageLifecycleController?: PackageLifecycleControllerV1;
  pluginRuntimeController?: PluginRuntimeControllerV1;
} = {}): ReactElement {
  const { t } = useI18n();
  const boardSession = useBoardSession(t, canvasHost);

  if (boardSession.status === 'loading') {
    return <WorkspaceLoadState status="loading" />;
  }
  if (boardSession.status === 'error') {
    return (
      <WorkspaceLoadState
        status="error"
        errorMessage={boardSession.errorMessage}
        onRetry={boardSession.retryLoad}
      />
    );
  }

  return (
    <ReadyApp
      boardSession={boardSession}
      onPluginContributionFatalFailure={onPluginContributionFatalFailure}
      onPluginDraftRunnerChange={onPluginDraftRunnerChange}
      onPluginExecutionRunnerChange={onPluginExecutionRunnerChange}
      onPluginHostEnvironmentChange={onPluginHostEnvironmentChange}
      onPluginHostScopeChange={onPluginHostScopeChange}
      onPluginManagerOpenChange={onPluginManagerOpenChange}
      pluginContributionRegistry={pluginContributionRegistry}
      packageBootstrapFailures={packageBootstrapFailures}
      packageLifecycleController={packageLifecycleController}
      pluginRuntimeController={pluginRuntimeController}
    />
  );
}

function ReadyApp({
  boardSession,
  onPluginContributionFatalFailure,
  onPluginDraftRunnerChange,
  onPluginExecutionRunnerChange,
  onPluginHostEnvironmentChange,
  onPluginHostScopeChange,
  onPluginManagerOpenChange,
  pluginContributionRegistry,
  packageBootstrapFailures,
  packageLifecycleController,
  pluginRuntimeController,
}: {
  boardSession: ReadyBoardSession;
  onPluginContributionFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  onPluginDraftRunnerChange?: (
    runner: PluginDraftRunnerV2 | undefined,
  ) => void;
  onPluginExecutionRunnerChange?: (
    runner: PluginExecutionRunnerV2 | undefined,
  ) => void;
  onPluginHostScopeChange?: (
    snapshot: PluginHostReadSnapshotV2,
    assets: readonly PluginAssetV2[],
    drafts: readonly PluginHostDraftRecordV2[],
    demand: PluginActivationDemandV1,
  ) => void;
  onPluginManagerOpenChange?: (open: boolean) => void;
  onPluginHostEnvironmentChange?: (
    snapshot: PluginHostEnvironmentSnapshotV2,
  ) => void;
  pluginContributionRegistry?: PluginContributionRegistryV1;
  packageBootstrapFailures: PackageBootstrapNoticeV1[];
  packageLifecycleController?: PackageLifecycleControllerV1;
  pluginRuntimeController?: PluginRuntimeControllerV1;
}): ReactElement {
  const { locale, t } = useI18n();
  const {
    adoptDurableSnapshot,
    applyLoadedSnapshot,
    autosaveStatus,
    canRedo,
    canUndo,
    connectPorts,
    persistSnapshot,
    redo,
    retrySave,
    runHostCommand,
    runProductCommand,
    snapshot,
    snapshotRef,
    undo,
  } = boardSession;
  const initialUiPreferences = useRef(loadUiPreferences());
  const directImageImportInputRef = useRef<HTMLInputElement | null>(null);
  const blankWorkspaceImageInputRef = useRef<HTMLInputElement | null>(null);
  const agentWorkspaceButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingDirectImageImportBlockIdRef = useRef<string | undefined>(undefined);
  const [isMiniMapVisible, setIsMiniMapVisible] = useState(() => initialUiPreferences.current.isMiniMapVisible);
  const [showGrid, setShowGrid] = useState(() => initialUiPreferences.current.showGrid);
  const {
    surface: workspaceSurface,
    closeSurface: closeWorkspaceSurface,
    inspectorBlockId,
    taskBlockId,
    isAgentWorkspaceOpen,
    isArtifactLibraryOpen,
    isHistoryOpen,
    setAgentWorkspaceOpen: setIsAgentWorkspaceOpen,
    setArtifactLibraryOpen: setIsArtifactLibraryOpen,
    setHistoryOpen: setIsHistoryOpen,
    setInspectorBlockId,
    setTaskBlockId,
  } = useWorkspaceSurfaceController({
    initialAgentOpen: initialUiPreferences.current.isAgentWorkspaceOpen,
  });
  const [workflowWorkspaceRunId, setWorkflowWorkspaceRunId] = useState<string>();
  const [imageFocusBlockId, setImageFocusBlockId] = useState<string>();
  const [imageFocusCompareMode, setImageFocusCompareMode] = useState(false);
  const [imageExecutionDetailsBlockId, setImageExecutionDetailsBlockId] = useState<string>();
  const [reviewDocumentBlockId, setReviewDocumentBlockId] = useState<string | undefined>();
  const [operationFromImagePicker, setOperationFromImagePicker] = useState<{
    anchor: { x: number; y: number };
    sourceBlockId: string;
  }>();
  const [pluginReducedMotion, setPluginReducedMotion] = useState(false);
  useEffect(() => {
    if (workspaceSurface.kind !== 'inspector') {
      setImageFocusBlockId(undefined);
      setImageFocusCompareMode(false);
    }
  }, [workspaceSurface.kind]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setPluginReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    onPluginHostEnvironmentChange?.({
      colorScheme: 'light',
      contrast: 'normal',
      direction: 'ltr',
      locale: locale === 'zh' ? 'zh-CN' : 'en',
      reducedMotion: pluginReducedMotion,
      revision: `${locale}:light:${pluginReducedMotion ? 'reduce' : 'motion'}`,
    });
  }, [
    locale,
    onPluginHostEnvironmentChange,
    pluginReducedMotion,
  ]);
  useEffect(() => {
    void loadExecutionProviderSettings(snapshot.project.projectId).catch(() => undefined);
  }, [snapshot.project.projectId]);
  useEffect(() => {
    const controller = new AbortController();
    const projectId = snapshot.project.projectId;
    configureProjectWorkflowRegistry(projectId, []);
    void loadProjectWorkflowAuthoring(projectId, controller.signal)
      .then((authoring) => configureProjectWorkflowRegistry(
        projectId,
        authoring.revisions
          .filter((revision) => !authoring.archivedRevisionIds.includes(revision.revisionId))
          .map((revision) => revision.definition),
      ))
      .catch(() => undefined);
    return () => controller.abort();
  }, [snapshot.project.projectId]);
  useEffect(() => {
    const openDocumentReview = (event: Event) => {
      const detail = (event as CustomEvent<{ blockId?: string }>).detail;
      if (detail?.blockId) setReviewDocumentBlockId(detail.blockId);
    };
    window.addEventListener('retake:open-document-review', openDocumentReview);
    return () => window.removeEventListener('retake:open-document-review', openDocumentReview);
  }, []);
  useEffect(() => setReviewDocumentBlockId(undefined), [snapshot.board.boardId, snapshot.project.projectId]);
  useEffect(() => {
    setInspectorBlockId(undefined);
    setImageFocusBlockId(undefined);
    setImageExecutionDetailsBlockId(undefined);
    setIsHistoryOpen(false);
    setIsArtifactLibraryOpen(false);
    setWorkflowWorkspaceRunId(undefined);
  }, [snapshot.board.boardId, snapshot.project.projectId]);
  const closeWorkflowWorkspace = useCallback(
    () => setWorkflowWorkspaceRunId(undefined),
    [],
  );
  const canvasController = useCanvasController({
    connectSessionPorts: connectPorts,
    onPluginContributionFatalFailure,
    pluginContributionRegistry,
    redo,
    runHostCommand,
    runProductCommand,
    setHistoryOpen: setIsHistoryOpen,
    setInspectorBlockId,
    snapshot,
    snapshotRef,
    t,
    undo,
  });
  const {
    createBoardFromMenu,
    createProjectFromMenu,
    deleteBoardFromMenu,
    deleteProjectFromMenu,
    duplicateBoardFromMenu,
    projectBoardDialog,
    refreshCurrentBoard,
    renameBoardFromMenu,
    renameProjectFromMenu,
    reorderBoardsFromMenu,
    reorderProjectsFromMenu,
    selectBoard,
    setProjectBoardDialog,
    submitProjectBoardDialog,
    workspace,
  } = useWorkspaceController({ applyLoadedSnapshot, snapshotRef, t });
  const {
    activeCanvasTool,
    canvasAreaRef,
    centeredBlockPosition,
    centerBlockGroup,
    focusWorkflowBlocks,
    getViewportCenter,
    collapsedGroupIdsRef,
    connectActions: connectCanvasActions,
    createFlowEdgesForSelection,
    createFlowNodesForSelection,
    locateBlock,
    reactFlowRef,
    selectedBlockIds,
    selectedBlockIdsRef,
    setActiveCanvasTool,
    setCollapsedGroupIds,
    setEdges,
    setNodes,
    setSelectedBlock,
    setSelectedBlocks,
  } = canvasController;
  const selectedBlock =
    selectedBlockIds.length === 1
      ? snapshot.blocks.find((block) => block.blockId === selectedBlockIds[0])
      : undefined;
  const pluginExecutionRunner = usePluginExecutionController({
    adoptDurableSnapshot,
    runHostCommand,
    runProductCommand,
    setSelectedBlock,
    snapshotRef,
  });
  const pluginDraftRunner = usePluginDraftController({
    runProductCommand,
  });
  useEffect(() => {
    onPluginDraftRunnerChange?.(pluginDraftRunner);
    return () => onPluginDraftRunnerChange?.(undefined);
  }, [onPluginDraftRunnerChange, pluginDraftRunner]);
  useEffect(() => {
    onPluginExecutionRunnerChange?.(pluginExecutionRunner);
    return () => onPluginExecutionRunnerChange?.(undefined);
  }, [
    onPluginExecutionRunnerChange,
    pluginExecutionRunner,
  ]);
  const selectedBlockScopeKey = selectedBlockIds.join('\u0000');
  useEffect(() => {
    if (!onPluginHostScopeChange) return;
    const {
      boundAssetIds,
      boundBlockIds,
      boundGroupIds,
    } = pluginHostBoundScope(
      snapshot,
      selectedBlockIds,
      inspectorBlockId,
    );
    onPluginHostScopeChange({
      boardId: snapshot.board.boardId,
      boundAssetIds,
      boundBlockIds,
      boundGroupIds,
      projectId: snapshot.project.projectId,
      revision: `${snapshot.board.updatedAt}:selection:${selectedBlockScopeKey}`,
      selectedBlockIds: [...selectedBlockIds],
    }, snapshot.assets.filter(
      (asset) => boundAssetIds.includes(asset.assetId),
    ), pluginDraftViewsForBlocks(snapshot, new Set(boundBlockIds)), {
      boardBound: true,
      hasBlocks: snapshot.blocks.length > 0,
      hasOperationBlocks: snapshot.blocks.some(
        (block) => block.type === 'operation',
      ),
      managerOpen: false,
      selectedBlockCount: selectedBlockIds.length,
    });
  }, [
    onPluginHostScopeChange,
    inspectorBlockId,
    selectedBlockScopeKey,
    snapshot.board.boardId,
    snapshot.board.updatedAt,
    snapshot.assets,
    snapshot.project.projectId,
  ]);
  const imageOperationController = useImageOperationController({
    adoptDurableSnapshot,
    focusWorkflowBlocks,
    getViewportCenter,
    persistSnapshot,
    runHostCommand,
    runProductCommand,
    selectedBlock,
    setSelectedBlock,
    setSelectedBlocks,
    snapshotRef,
    t,
  });
  const {
    closePromptPreviewAfterCopy,
    copiedPromptKey,
    copyPromptWithHistory,
    copyQueuedOperationPrompt,
    createAndStartImageComposerOperation,
    createImageToImageDraftOperation,
    createImageToImageDraftFromMenu,
    createTextToImageDraftOperation,
    importImageIntoBlock,
    operationToast,
    promptPreview,
    refreshQueuedOperationPrompt,
    retryFailedImageResult,
    setCopiedPromptKey,
    setOperationToast,
    setPromptPreview,
    startExistingOperationBlock,
    updateOperationCapability,
    updateOperationConnection,
    updateOperationGenerationParams,
    updateOperationGenerationProfile,
  } = imageOperationController;

  useEffect(() => {
    function onCreateOperationFromImage(event: Event): void {
      const detail = (event as CustomEvent<{
        anchor?: { x: number; y: number };
        sourceBlockId?: string;
      }>).detail;
      if (!detail?.anchor || !detail.sourceBlockId) return;
      setOperationFromImagePicker({
        anchor: detail.anchor,
        sourceBlockId: detail.sourceBlockId,
      });
    }
    window.addEventListener(
      'retake:create-operation-from-image',
      onCreateOperationFromImage,
    );
    return () => window.removeEventListener(
      'retake:create-operation-from-image',
      onCreateOperationFromImage,
    );
  }, []);

  async function createOperationFromImage(mode: 'edit' | 'similar' | 'reference'): Promise<void> {
    const request = operationFromImagePicker;
    setOperationFromImagePicker(undefined);
    if (!request) return;
    const sourceBlock = snapshotRef.current.blocks.find(
      (block) => block.blockId === request.sourceBlockId && block.type === 'image',
    );
    if (!sourceBlock) return;
    try {
      if (mode === 'edit' || mode === 'similar') {
        await createImageToImageDraftOperation(
          sourceBlock,
          mode === 'similar' ? 'create_similar' : 'quick_edit',
          undefined,
          { centerWorkflow: true },
        );
        return;
      }
      const result = await createTextToImageDraftOperation(
        { referenceBlockIds: [sourceBlock.blockId] },
        { reveal: false },
      );
      focusWorkflowBlocks(result.blockIds, { maxZoom: 0.95 });
      const edgeId = result.referenceEdgeIds[0];
      if (edgeId) {
        window.dispatchEvent(new CustomEvent('retake:configure-operation-reference', {
          detail: { anchor: request.anchor, edgeId },
        }));
      }
    } catch (error) {
      setOperationToast({
        id: `create-operation-from-image:${sourceBlock.blockId}`,
        title: t('feedback.handoffUnavailable'),
        body: error instanceof Error ? error.message : t('feedback.localApiUnavailable'),
        tone: 'error',
      });
    }
  }
  const artifactLibraryController = useArtifactLibraryController({
    centeredBlockPosition,
    isOpen: isArtifactLibraryOpen,
    projectId: snapshot.project.projectId,
    runProductCommand,
    selectedBlockId: selectedBlock?.blockId,
    setOperationToast,
    setSelectedBlock,
    snapshotRef,
    t,
  });
  const blockActions = useBlockActions({
    centeredBlockPosition,
    collapsedGroupIdsRef,
    selectedBlockIds,
    selectedBlockIdsRef,
    runHostCommand,
    runProductCommand,
    setActiveCanvasTool,
    setCollapsedGroupIds,
    setOperationToast,
    setSelectedBlock,
    setSelectedBlocks,
    snapshotRef,
    t,
  });
  const { addBlock, deleteBlockIds, deleteSelection, duplicateSelection } = blockActions;
  const textGenerationController = useTextGenerationController({
    adoptDurableSnapshot,
    focusWorkflowBlocks,
    getViewportCenter,
    locale,
    runProductCommand,
    setOperationToast,
    setSelectedBlocks,
    selectedBlockIdsRef,
    snapshotRef,
    t,
  });
  const workflowDraftController = useWorkflowDraftController({
    focusWorkflowBlocks,
    getViewportCenter,
    locale,
    runProductCommand,
    setSelectedBlocks,
    snapshotRef,
    t,
  });
  const packageEntryPointController = usePackageEntryPointController({
    createSkillDraft: textGenerationController.createSkillDraft,
    createWorkflowDraft: workflowDraftController.createWorkflowDraft,
    snapshotRef,
  });
  const {
    authorizeDomainVideoGeneration,
    closeDomainVideoLaunchReview,
    domainVideoLaunchReview,
  } = useDomainVideoLaunchReviewController(
    {
      adoptDurableSnapshot,
      boardId: snapshot.board.boardId,
      projectId: snapshot.project.projectId,
      setOperationToast,
      setSelectedBlocks,
      snapshotRef,
    },
  );
  const workflowRuntimeController = useWorkflowRuntimeController({
    adoptDurableSnapshot,
    getCurrentSnapshot: () => snapshotRef.current,
    runProductCommand,
    setOperationToast,
    t,
  });
  useVideoGenerationController({
    adoptDurableSnapshot,
    runProductCommand,
    setOperationToast,
    setSelectedBlocks,
    snapshotRef,
    t,
  });
  connectCanvasActions({ deleteBlockIds });
  const {
    restoreConfigurationVersion,
  } = useExecutionConfigurationController({
    runProductCommand,
    setOperationToast,
    setSelectedBlock,
    snapshotRef,
    t,
  });
  const executionOutputSelectionController = useExecutionOutputSelectionController({
    runProductCommand,
    setOperationToast,
    t,
  });
  const {
    addOperationInputBlock,
    completeInputReferenceMention,
    inputReferencePicker,
    mentionAllowedModes,
    mentionSlotOptions,
    referenceImageOptions,
    selectedReferenceImage,
    setInputReferencePicker,
    runOperation,
  } = useOperationInputController({
    copyQueuedOperationPrompt,
    locale,
    refreshQueuedOperationPrompt,
    runHostCommand,
    runProductCommand,
    setOperationToast,
    setSelectedBlock,
    snapshot,
    snapshotRef,
    startExistingOperationBlock,
    startTextGenerationOperation: textGenerationController.startTextGenerationOperation,
    t,
    updateOperationCapability,
    updateOperationConnection,
    updateOperationGenerationParams,
    updateOperationGenerationProfile,
  });
  const agentRuntimeController = useAgentRuntimeController({
    runOperation,
    runProductCommand,
    setOperationToast,
    snapshot,
    snapshotRef,
    t,
  });
  const agentWorkspaceController = useAgentWorkspaceController({
    adoptDurableSnapshot,
    focusWorkflowBlocks,
    getViewportCenter,
    locale,
    runProductCommand,
    selectedBlockIdsRef,
    setSelectedBlocks,
    snapshot,
    snapshotRef,
    t,
  });
  const activeAgentRun = agentWorkspaceController.selectedSession?.activeAgentRunId
    ? snapshot.agentRuns?.find((run) => (
      run.agentRunId === agentWorkspaceController.selectedSession?.activeAgentRunId
    ))
    : undefined;
  const activeWorkflowCandidateDecision = workflowCandidateDecision(snapshot, activeAgentRun);
  const workflowCandidatePreviewBlockIds = workspaceSurface.kind === 'agent'
    ? activeWorkflowCandidateDecision?.candidates.map((candidate) => candidate.block.blockId) ?? []
    : [];
  useEffect(() => {
    saveUiPreferences({ isAgentWorkspaceOpen });
  }, [isAgentWorkspaceOpen]);
  useEffect(() => {
    if (!isAgentWorkspaceOpen) return;
    void agentWorkspaceController.ensureDefaultSession();
  }, [
    isAgentWorkspaceOpen,
    snapshot.board.boardId,
    snapshot.project.projectId,
  ]);
  const agentAttachmentController = useAgentAttachmentController({
    getViewportCenter,
    runProductCommand,
    scope: {
      boardId: snapshot.board.boardId,
      projectId: snapshot.project.projectId,
    },
  });
  const groupController = useGroupController({
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
  });
  const { downloadGroupAssets } = groupController;

  useAppEventBindings({
    addOperationInputBlock,
    deleteBlockIds: blockActions.deleteBlockIds,
    directImageImportInputRef,
    isMiniMapVisible,
    onBindAgentOperation: (operationBlockId) => {
      void agentWorkspaceController.bindWorkingOperation(operationBlockId);
      setInspectorBlockId(undefined);
      setIsHistoryOpen(false);
      setIsArtifactLibraryOpen(false);
      setIsAgentWorkspaceOpen(true);
    },
    onUseImageInAgent: (imageBlockId) => {
      void agentWorkspaceController.ensureDefaultSession();
      setSelectedBlock(snapshotRef.current, imageBlockId);
      setInspectorBlockId(undefined);
      setIsHistoryOpen(false);
      setIsArtifactLibraryOpen(false);
      setIsAgentWorkspaceOpen(true);
    },
    pendingDirectImageImportBlockIdRef,
    retryFailedImageResult,
    setHistoryOpen: setIsHistoryOpen,
    setImageFocusBlockId,
    setImageExecutionDetailsBlockId,
    setInspectorBlockId,
    setTaskBlockId,
    setSelectedBlock,
    showGrid,
    snapshotRef,
  });


  function toggleHistoryPanel(): void {
    setIsHistoryOpen((current) => {
      const next = !current;
      if (next) {
        setInspectorBlockId(undefined);
        setIsArtifactLibraryOpen(false);
      }
      return next;
    });
  }

  function toggleAgentWorkspace(): void {
    const next = !isAgentWorkspaceOpen;
    if (next) {
      void agentWorkspaceController.ensureDefaultSession();
      setInspectorBlockId(undefined);
      setIsHistoryOpen(false);
      setIsArtifactLibraryOpen(false);
    }
    setIsAgentWorkspaceOpen(next);
  }

  function closeAgentWorkspace(): void {
    setIsAgentWorkspaceOpen(false);
    requestAnimationFrame(() => agentWorkspaceButtonRef.current?.focus());
  }

  function showAgentRun(agentRunId: string): void {
    void agentWorkspaceController.focusAgentRun(agentRunId);
    setWorkflowWorkspaceRunId(undefined);
    setIsAgentWorkspaceOpen(true);
  }

  async function startWorkflowFromWorkspace(workflowRunId: string): Promise<void> {
    const agentRunId = await agentRuntimeController.createWorkflowAgentRun(workflowRunId);
    if (agentRunId) showAgentRun(agentRunId);
  }

  async function startWorkflowStepFromWorkspace(
    workflowRunId: string,
    stepRunId: string,
  ): Promise<void> {
    const agentRunId = await agentRuntimeController.createWorkflowSliceAgentRun(
      workflowRunId,
      stepRunId,
    );
    if (agentRunId) showAgentRun(agentRunId);
  }

  function toggleArtifactLibrary(): void {
    setIsArtifactLibraryOpen((current) => {
      const next = !current;
      if (next) {
        setInspectorBlockId(undefined);
        setIsHistoryOpen(false);
      }
      return next;
    });
  }

  useEffect(() => {
    if (inspectorBlockId || isHistoryOpen) {
      setIsArtifactLibraryOpen(false);
    }
  }, [inspectorBlockId, isHistoryOpen]);

  async function createVideoComposerDraft(input: UnifiedComposerVideoDraftInput): Promise<void> {
    if (!runProductCommand) {
      throw new Error('Whiteboard Video generation command facade is unavailable.');
    }
    const created = await runProductCommand(
      (commands) => commands.videoGeneration.createDraft({
        ...input,
        placementCenter: getViewportCenter(),
        title: t('block.video.title'),
      }),
      { history: true },
    );
    setSelectedBlock(snapshotRef.current, created.blockId);
    focusWorkflowBlocks([created.blockId]);
  }

  async function importBlankWorkspaceImage(file: File): Promise<void> {
    if (!runHostCommand) return;
    try {
      let block = blankWorkspacePlaceholderImage(snapshotRef.current.blocks);
      if (!block) {
        const size = defaultBlockSize('image');
        const created = await runHostCommand(
          (commands) => commands.createBlock({
            data: localizedBlockData('image', t),
            position: centeredBlockPosition(size),
            size,
            type: 'image',
          }),
          { history: true },
        );
        block = snapshotRef.current.blocks.find(
          (candidate) => candidate.blockId === created.blockId && candidate.type === 'image',
        );
      }
      if (!block) return;
      setSelectedBlock(snapshotRef.current, block.blockId);
      await importImageIntoBlock(block, file);
    } catch (error) {
      setOperationToast({
        id: `blank-workspace-import:${Date.now()}`,
        title: t('feedback.handoffUnavailable'),
        body: error instanceof Error ? error.message : t('feedback.localApiUnavailable'),
        tone: 'error',
      });
    }
  }

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
  const inspectorImageAsset = inspectorBlock?.type === 'image'
    && typeof inspectorBlock.data.assetId === 'string'
    ? snapshot.assets.find((asset) => asset.assetId === inspectorBlock.data.assetId)
    : undefined;
  const inspectorImageUrl = inspectorBlock?.type === 'image'
    ? getAssetPreviewUrl(snapshot.assets, inspectorBlock.data.assetId)
    : undefined;
  const imageExecutionDetailsBlock = imageExecutionDetailsBlockId
    ? snapshot.blocks.find((block) => block.blockId === imageExecutionDetailsBlockId)
    : undefined;
  const imageFocusBlock = imageFocusBlockId
    ? snapshot.blocks.find((block) => block.blockId === imageFocusBlockId && block.type === 'image')
    : undefined;
  const taskBlock = taskBlockId
    ? snapshot.blocks.find((block) => block.blockId === taskBlockId)
    : undefined;
  const taskExecution = taskBlock
    ? generationExecutionForBlock(snapshot, taskBlock)
    : undefined;
  const reviewDocumentBlock = reviewDocumentBlockId
    ? snapshot.blocks.find((block) => block.blockId === reviewDocumentBlockId && block.type === 'document')
    : undefined;
  const reviewDocumentAsset = reviewDocumentBlock?.data.assetId
    ? snapshot.assets.find((asset) => asset.assetId === reviewDocumentBlock.data.assetId)
    : undefined;
  const selectedGroupMediaCount = selectedBlock?.type === 'group'
    ? groupMediaItems(snapshot, selectedBlock.blockId).length
    : 0;
  const projectBoardDialogView = projectBoardDialog
    ? getProjectBoardDialogView(projectBoardDialog, t)
    : undefined;
  const imageInspectorOpen = workspaceSurface.kind === 'inspector'
    && inspectorBlock?.type === 'image'
    && Boolean(inspectorImageAsset && inspectorImageUrl);
  const workbenchOpen = imageInspectorOpen
    || Boolean(workspaceSurface.kind === 'task' && taskBlock && taskExecution)
    || workspaceSurface.kind === 'agent'
    || workspaceSurface.kind === 'artifact'
    || workspaceSurface.kind === 'history';
  const appShell = (
    <WorkspaceShell
      hasWorkbench={workbenchOpen}
      workbenchMode={workspaceSurface.kind === 'agent' ? 'wide' : 'compact'}
      sidebar={({ collapsed, onToggleCollapsed }) => (
        <WorkspaceSidebar
          artifactLibraryOpen={isArtifactLibraryOpen}
          collapsed={collapsed}
          currentBoardId={snapshot.board.boardId}
          currentProjectId={snapshot.project.projectId}
          historyOpen={isHistoryOpen}
          workspace={workspace}
          onCreateBoard={(projectId) => void createBoardFromMenu(projectId)}
          onCreateProject={() => void createProjectFromMenu()}
          onDeleteBoard={(projectId, boardId) => void deleteBoardFromMenu(projectId, boardId)}
          onDeleteProject={(projectId) => void deleteProjectFromMenu(projectId)}
          onDuplicateBoard={(projectId, boardId) => void duplicateBoardFromMenu(projectId, boardId)}
          onOpenArtifactLibrary={toggleArtifactLibrary}
          onOpenHistory={toggleHistoryPanel}
          onOpenSettings={() => window.dispatchEvent(new CustomEvent('retake:open-settings'))}
          onRenameBoard={(projectId, boardId, currentName) => void renameBoardFromMenu(projectId, boardId, currentName)}
          onRenameProject={(projectId, currentName) => void renameProjectFromMenu(projectId, currentName)}
          onReorderBoards={(projectId, boardIds) => void reorderBoardsFromMenu(projectId, boardIds)}
          onReorderProjects={(projectIds) => void reorderProjectsFromMenu(projectIds)}
          onSelectBoard={(projectId, boardId) => void selectBoard(projectId, boardId)}
          onToggleCollapsed={onToggleCollapsed}
        />
      )}
    >
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
      <input
        ref={blankWorkspaceImageInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (file) void importBlankWorkspaceImage(file);
        }}
      />
      <TopBar
        agentWorkspaceButtonRef={agentWorkspaceButtonRef}
        packageBootstrapFailures={packageBootstrapFailures}
        packageLifecycleController={packageLifecycleController}
        onPluginManagerOpenChange={onPluginManagerOpenChange}
        pluginRuntimeController={pluginRuntimeController}
        snapshot={snapshot}
        autosaveStatus={autosaveStatus}
        canUndo={canUndo}
        canRedo={canRedo}
        hasSelection={selectedBlockIds.length > 0}
        isArtifactLibraryOpen={isArtifactLibraryOpen}
        isHistoryOpen={isHistoryOpen}
        isAgentWorkspaceOpen={isAgentWorkspaceOpen}
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
        onRetrySave={() => void retrySave()}
        onSelectBoard={(projectId, boardId) => void selectBoard(projectId, boardId)}
        onSetBoardBackground={(background) => {
          const current = snapshotRef.current;
          if (!runProductCommand) throw new Error('Whiteboard product command facade is unavailable.');
          void runProductCommand(
            (commands) => commands.board.setBackground({
              background,
              expectedScope: {
                boardId: current.board.boardId,
                projectId: current.project.projectId,
              },
            }),
            {
              history: true,
              shouldKeepHistory: (result) => result.committed,
            },
          );
        }}
        onToggleGrid={() => setShowGrid((current) => !current)}
        onDeleteSelection={deleteSelection}
        onDuplicateSelection={duplicateSelection}
        onToggleHistory={toggleHistoryPanel}
        onToggleAgentWorkspace={toggleAgentWorkspace}
        onToggleArtifactLibrary={toggleArtifactLibrary}
        onUndo={undo}
        onRedo={redo}
        showSettingsAction={false}
        showWorkspaceNavigation={false}
        showWorkspaceSurfaceActions={false}
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
      {domainVideoLaunchReview ? (
        <Suspense fallback={null}>
          <DomainVideoLaunchReviewDialog
            state={domainVideoLaunchReview}
            onAuthorize={() => void authorizeDomainVideoGeneration()}
            onClose={closeDomainVideoLaunchReview}
          />
        </Suspense>
      ) : null}
      {inputReferencePicker ? (
        <InputReferencePicker
          anchor={inputReferencePicker.anchor}
          allowedModes={mentionAllowedModes}
          images={referenceImageOptions}
          setting={inputReferencePicker.setting}
          selectedImage={selectedReferenceImage}
          selectedSlotId={inputReferencePicker.inputSlotId}
          slotOptions={mentionSlotOptions}
          onCancel={() => setInputReferencePicker(undefined)}
          onChangeSetting={(setting) => {
            setInputReferencePicker((current) => (
              current ? { ...current, setting } : current
            ));
          }}
          onConfirm={completeInputReferenceMention}
          onSelectSlot={(inputSlotId) => {
            const option = mentionSlotOptions.find(
              (candidate) => candidate.slotId === inputSlotId,
            );
            setInputReferencePicker((current) => {
              if (!current || !option) return current;
              const nextSetting = option.mode === 'source'
                ? { instruction: '', mode: 'source' as const }
                : current.setting.mode === 'source'
                  ? { instruction: '', mode: 'auto' as const }
                  : current.setting;
              return { ...current, inputSlotId, setting: nextSetting };
            });
          }}
          onSelectImage={(sourceBlockId) =>
            setInputReferencePicker((current) => (current ? { ...current, sourceBlockId } : current))
          }
        />
      ) : null}
      {operationFromImagePicker ? (
        <OperationFromImagePicker
          anchor={operationFromImagePicker.anchor}
          onCancel={() => setOperationFromImagePicker(undefined)}
          onSelect={(mode) => void createOperationFromImage(mode)}
        />
      ) : null}
      <WorkflowContinuationDialog
        snapshot={snapshot}
        onPrepareComposer={() => {
          setInspectorBlockId(undefined);
          setIsHistoryOpen(false);
          setIsAgentWorkspaceOpen(false);
          setIsArtifactLibraryOpen(false);
        }}
      />
      <TextBlockEditorDialog snapshot={snapshot} />
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
        agentDisabled={agentWorkspaceController.isSending}
        composerVisible={workspaceSurface.kind !== 'agent'}
        onAddBlock={addBlock}
        onAttachFiles={agentAttachmentController.attachFiles}
        onCreateImage={(input) => createAndStartImageComposerOperation({
          ...input,
          reuseSelectedImageSlot: true,
        })}
        onCreateVideoDraft={createVideoComposerDraft}
        onCreateImageToImage={() => void createImageToImageDraftFromMenu()}
        onCreateTextToImage={() => void createTextToImageDraftOperation()}
        onOpenComposer={(detail) => {
          setInspectorBlockId(undefined);
          setIsHistoryOpen(false);
          setIsAgentWorkspaceOpen(false);
          setIsArtifactLibraryOpen(false);
          requestAnimationFrame(() => {
            window.dispatchEvent(new CustomEvent('retake:focus-unified-composer', { detail }));
          });
        }}
        onInvokeEntryPoint={packageEntryPointController.invokeEntryPoint}
        onSubmitAgentMessage={(input) => {
          setIsAgentWorkspaceOpen(true);
          void agentWorkspaceController.submitMessage(input);
        }}
        snapshot={snapshot}
        onSetActiveTool={setActiveCanvasTool}
      />
      {workspaceSurface.kind === 'inspector'
        && inspectorBlock?.type !== 'group'
        && inspectorBlock?.type !== 'image' ? (
        <ExecutionInspector
          copiedPromptKey={copiedPromptKey}
          reserveAgentWorkspace={false}
          selectedBlock={inspectorBlock}
          snapshot={snapshot}
          onClose={() => setInspectorBlockId(undefined)}
          onBeforePluginOperationAction={async () => {
            setInspectorBlockId(undefined);
            await nextAnimationFrame();
            await nextAnimationFrame();
          }}
          onCopyPrompt={copyPromptWithHistory}
          onPluginFatalFailure={onPluginContributionFatalFailure}
          onRestoreConfiguration={restoreConfigurationVersion}
          pluginContributionRegistry={pluginContributionRegistry}
        />
      ) : null}
      {imageExecutionDetailsBlock ? (
        <ExecutionInspector
          copiedPromptKey={copiedPromptKey}
          reserveAgentWorkspace={false}
          selectedBlock={imageExecutionDetailsBlock}
          snapshot={snapshot}
          onClose={() => setImageExecutionDetailsBlockId(undefined)}
          onBeforePluginOperationAction={async () => {
            setImageExecutionDetailsBlockId(undefined);
            setInspectorBlockId(undefined);
            await nextAnimationFrame();
            await nextAnimationFrame();
          }}
          onCopyPrompt={copyPromptWithHistory}
          onPluginFatalFailure={onPluginContributionFatalFailure}
          onRestoreConfiguration={restoreConfigurationVersion}
          pluginContributionRegistry={pluginContributionRegistry}
        />
      ) : null}
      {workspaceSurface.kind === 'inspector' && inspectorBlock?.type === 'group' ? (
        <GroupInspector
          copiedPromptKey={copiedPromptKey}
          group={inspectorBlock}
          snapshot={snapshot}
          onClose={() => setInspectorBlockId(undefined)}
          onCopyPrompt={copyPromptWithHistory}
          onDownloadAll={downloadGroupAssets}
          onDecideWorkflowApproval={workflowRuntimeController.decideWorkflowGate}
          onCancelAgentRun={agentRuntimeController.cancelAgentRun}
          onCreateWorkflowAgentRun={agentRuntimeController.createWorkflowAgentRun}
          onCreateWorkflowArtifactSliceAgentRun={agentRuntimeController.createWorkflowArtifactSliceAgentRun}
          onCreateWorkflowGateSliceAgentRun={agentRuntimeController.createWorkflowGateSliceAgentRun}
          onCreateWorkflowSliceAgentRun={agentRuntimeController.createWorkflowSliceAgentRun}
          onCreateWorkflowStageSliceAgentRun={agentRuntimeController.createWorkflowStageSliceAgentRun}
          onPauseAgentRun={agentRuntimeController.pauseAgentRun}
          onPluginFatalFailure={onPluginContributionFatalFailure}
          onResumeAgentRun={agentRuntimeController.resumeAgentRun}
          onSelectWorkflowOutput={workflowRuntimeController.acceptWorkflowOutput}
          pluginContributionRegistry={pluginContributionRegistry}
        />
      ) : null}
      {workbenchOpen ? (
        <WorkspaceWorkbench surface={workspaceSurface}>
          {imageInspectorOpen && inspectorBlock?.type === 'image' && inspectorImageAsset && inspectorImageUrl ? (
            <ImageInspectorPanel
              asset={inspectorImageAsset}
              block={inspectorBlock}
              copiedPromptKey={copiedPromptKey}
              contentLocked={blockLockedByGroup(snapshot, inspectorBlock.blockId)}
              onClose={() => {
                setImageFocusBlockId(undefined);
                setInspectorBlockId(undefined);
              }}
              onBeforePluginOperationAction={async () => {
                setInspectorBlockId(undefined);
                await nextAnimationFrame();
                await nextAnimationFrame();
              }}
              onCopyPrompt={copyPromptWithHistory}
              onDownload={() => downloadAsset(inspectorImageAsset, inspectorBlock.data.title)}
              onPluginFatalFailure={onPluginContributionFatalFailure}
              onRestoreConfiguration={restoreConfigurationVersion}
              onSelectOutput={executionOutputSelectionController.selectOutput}
              previewUrl={inspectorImageUrl}
              pluginContributionRegistry={pluginContributionRegistry}
              snapshot={snapshot}
            />
          ) : null}
          {workspaceSurface.kind === 'task' && taskBlock && taskExecution ? (
            <GenerationTaskPanel
              block={taskBlock}
              onCancelExecution={imageOperationController.cancelImageExecution}
              onClose={closeWorkspaceSurface}
              onContinueFromResult={async (resultBlock) => {
                await createImageToImageDraftOperation(resultBlock, 'quick_edit', undefined, {
                  centerWorkflow: true,
                });
                setTaskBlockId(undefined);
              }}
              onOpenExecutionDetails={setImageExecutionDetailsBlockId}
              onRetryExecution={async (executionId) => {
                try {
                  await imageOperationController.retryFailedImageExecution(executionId);
                } catch (error) {
                  setOperationToast({
                    id: `retry-execution:${executionId}`,
                    title: t('result.retryPromptTitle'),
                    body: error instanceof Error ? error.message : t('feedback.taskCreatedCopyFailed'),
                    tone: 'error',
                  });
                }
              }}
              selectedBlockId={selectedBlock?.blockId}
              snapshot={snapshot}
            />
          ) : null}
          {workspaceSurface.kind === 'artifact' ? (
            <Suspense fallback={null}>
              <ArtifactLibraryPanel
                error={artifactLibraryController.error}
                isLoading={artifactLibraryController.isLoading}
                isPromoting={artifactLibraryController.isPromoting}
                library={artifactLibraryController.library}
                selectedBlock={selectedBlock}
                snapshot={snapshot}
                onClose={() => setIsArtifactLibraryOpen(false)}
                onInsertReference={artifactLibraryController.insertReference}
                onPromoteSelectedAsset={artifactLibraryController.promoteSelectedAsset}
                onRefresh={artifactLibraryController.refresh}
              />
            </Suspense>
          ) : null}
          {workspaceSurface.kind === 'history' ? (
            <BoardHistoryPanel
              copiedPromptKey={copiedPromptKey}
              snapshot={snapshot}
              onClose={() => setIsHistoryOpen(false)}
              onCopyPrompt={copyPromptWithHistory}
              onLocateBlock={locateBlock}
              onPluginFatalFailure={onPluginContributionFatalFailure}
              pluginContributionRegistry={pluginContributionRegistry}
            />
          ) : null}
          {workspaceSurface.kind === 'agent' ? (
            <AgentWorkspace
          binding={agentWorkspaceController.selectedBinding}
          error={agentWorkspaceController.error}
          focusedAgentRunId={agentWorkspaceController.focusedAgentRunId}
          isSending={agentWorkspaceController.isSending}
          launchingProposalId={agentWorkspaceController.launchingProposalId}
          selectedSession={agentWorkspaceController.selectedSession}
          sessions={agentWorkspaceController.sessions}
          snapshot={snapshot}
          onArchiveSession={agentWorkspaceController.archiveSession}
          onAttachFiles={agentAttachmentController.attachFiles}
          onCancelAgentRun={agentRuntimeController.cancelAgentRun}
          onClose={closeAgentWorkspace}
          onCreateSession={(connectionId) => agentWorkspaceController.newSession(connectionId)}
          onDecideWorkflowApproval={workflowRuntimeController.decideWorkflowGate}
          onDecideProposal={agentWorkspaceController.decideProposal}
          onLaunchProposal={(proposalId, expectedProposalVersion, target, agentPresetEntryPointId) =>
            void agentWorkspaceController.launchProposal(
              proposalId,
              expectedProposalVersion,
              target,
              agentPresetEntryPointId,
            )}
          onLocateBlock={locateBlock}
          onOpenWorkflowRun={setWorkflowWorkspaceRunId}
          onPauseAgentRun={agentRuntimeController.pauseAgentRun}
          onPrepareWorkflowReview={(stepRunId) => workflowRuntimeController.prepareWorkflowReview({
            boardId: snapshot.board.boardId,
            projectId: snapshot.project.projectId,
            stepRunId,
          })}
          onResumeAgentRun={agentRuntimeController.resumeAgentRun}
          onRequestCanvasMode={closeAgentWorkspace}
          onRenameSession={agentWorkspaceController.renameSession}
          onRerunOperation={(operationBlockId) => runOperation(
            operationBlockId,
            false,
            true,
          )}
          onRetryAgentRun={async (agentRunId, retryExecutionId) => {
            if (!retryExecutionId) {
              await agentRuntimeController.retryAgentRun(agentRunId);
              return;
            }
            try {
              await imageOperationController.retryFailedImageExecution(retryExecutionId);
            } catch {
              setOperationToast({
                id: `retry-execution:${retryExecutionId}`,
                title: t('agentRuntime.actionFailed'),
                body: t('feedback.codexImageFailed'),
                tone: 'error',
              });
            }
          }}
          onSelectLaunchConnection={
            imageOperationController.updateOperationConnection
          }
          onSelectAgentRun={agentWorkspaceController.selectAgentRun}
          onSelectSession={agentWorkspaceController.selectSession}
          onSelectWorkflowOutput={workflowRuntimeController.acceptWorkflowOutput}
          onSubmitMessage={(input) => void agentWorkspaceController.submitMessage(input)}
          onViewProposalEffect={agentWorkspaceController.focusProposalEffect}
          onViewProposalRun={agentWorkspaceController.focusProposalRun}
            />
          ) : null}
        </WorkspaceWorkbench>
      ) : null}
      {workspaceSurface.kind === 'task' && taskExecution ? (
        <GenerationCandidateDock
          execution={taskExecution}
          onSelectBlock={(blockId) => setSelectedBlock(snapshotRef.current, blockId)}
          onSelectOutput={executionOutputSelectionController.selectOutput}
          selectedBlockId={selectedBlock?.blockId}
          snapshot={snapshot}
        />
      ) : null}
      {workspaceSurface.kind === 'agent' ? (
        <WorkflowCandidateDock
          agentRun={activeAgentRun}
          onAcceptCandidate={workflowRuntimeController.acceptWorkflowOutput}
          onOpenCandidateDetails={(blockId) => {
            window.dispatchEvent(new CustomEvent('retake:open-execution-inspector', {
              detail: { blockId },
            }));
          }}
          onSelectBlock={(blockId) => setSelectedBlock(snapshotRef.current, blockId)}
          selectedBlockId={selectedBlock?.blockId}
          snapshot={snapshot}
        />
      ) : null}
      {workflowWorkspaceRunId ? (
        <Suspense fallback={null}>
          <WorkflowWorkspace
            activeAgentRun={activeAgentRun}
            initialWorkflowRunId={workflowWorkspaceRunId}
            onClose={closeWorkflowWorkspace}
            onCreateWorkflowRun={workflowRuntimeController.createWorkflowRun}
            onLocateBlock={locateBlock}
            onOpenAgentRun={showAgentRun}
            onProjectWorkflowRevision={workflowDraftController.projectPublishedWorkflowRevision}
            onStartWorkflowRun={startWorkflowFromWorkspace}
            onStartWorkflowStep={startWorkflowStepFromWorkspace}
            selectedBlockIds={selectedBlockIds}
            snapshot={snapshot}
          />
        </Suspense>
      ) : null}
      {reviewDocumentBlock ? (
        <Suspense fallback={null}>
          <DocumentReviewWorkspace
            asset={reviewDocumentAsset}
            block={reviewDocumentBlock}
            onClose={() => setReviewDocumentBlockId(undefined)}
          />
        </Suspense>
      ) : null}

      <WhiteboardCanvas
        blockActions={blockActions}
        canvas={canvasController}
        directImageImportInputRef={directImageImportInputRef}
        groups={groupController}
        imageOperations={imageOperationController}
        isMiniMapVisible={isMiniMapVisible}
        onPluginContributionFatalFailure={
          onPluginContributionFatalFailure
        }
        pendingDirectImageImportBlockIdRef={pendingDirectImageImportBlockIdRef}
        pluginContributionRegistry={pluginContributionRegistry}
        selectedBlock={selectedBlock}
        selectedBlockContentLocked={selectedBlockContentLocked}
        selectedGroupInheritedLocked={selectedGroupInheritedLocked}
        selectedGroupMediaCount={selectedGroupMediaCount}
        selectedImageAsset={selectedImageAsset}
        selectedImageUrl={selectedImageUrl}
        setHistoryOpen={setIsHistoryOpen}
        setInspectorBlockId={setInspectorBlockId}
        setMiniMapVisible={setIsMiniMapVisible}
        imageCandidatePreviewBlockIds={workflowCandidatePreviewBlockIds}
        onOpenWorkflowRun={setWorkflowWorkspaceRunId}
        showGrid={showGrid}
        snapshot={snapshot}
        t={t}
        workflowRuntime={workflowRuntimeController}
      />
      {isBlankWorkspaceContent(snapshot.blocks) ? (
        <BlankWorkspaceStart
          onGenerateImage={() => {
            const placeholder = blankWorkspacePlaceholderImage(snapshotRef.current.blocks);
            if (placeholder) setSelectedBlock(snapshotRef.current, placeholder.blockId);
            window.dispatchEvent(new CustomEvent('retake:focus-unified-composer', {
              detail: { clearEntryPoint: true, mode: 'image' },
            }));
          }}
          onOpenImage={() => blankWorkspaceImageInputRef.current?.click()}
        />
      ) : null}
      {imageFocusBlock ? (
        <ImageFocusWorkspace
          block={imageFocusBlock}
          compareMode={imageFocusCompareMode}
          snapshot={snapshot}
          onBackToCanvas={() => {
            setImageFocusBlockId(undefined);
            setInspectorBlockId(undefined);
            setImageFocusCompareMode(false);
          }}
          onCompareModeChange={setImageFocusCompareMode}
          onSelectBlock={(blockId) => {
            setImageFocusBlockId(blockId);
            setSelectedBlock(snapshotRef.current, blockId);
            setInspectorBlockId(blockId);
          }}
        />
      ) : null}
      {pluginContributionRegistry && onPluginContributionFatalFailure ? (
        <PluginPanelHost
          anchorBlockId={
            selectedBlock?.type === 'image'
              ? selectedBlock.blockId
              : undefined
          }
          onFatalFailure={onPluginContributionFatalFailure}
          registry={pluginContributionRegistry}
        />
      ) : null}
    </WorkspaceShell>
  );
  return (
    <UnifiedComposerProvider key={`${snapshot.project.projectId}:${snapshot.board.boardId}`}>
      {appShell}
    </UnifiedComposerProvider>
  );
}

function nextAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

function WorkspaceLoadState({
  status,
  errorMessage,
  onRetry,
}: {
  status: 'loading' | 'error';
  errorMessage?: string;
  onRetry?: () => void;
}): ReactElement {
  const { t } = useI18n();
  const loading = status === 'loading';
  return (
    <main className="workspace-load-shell">
      <section
        className={`workspace-load-card${loading ? '' : ' is-error'}`}
        role={loading ? 'status' : 'alert'}
        aria-live="polite"
      >
        {loading ? <Loader2 className="workspace-load-spinner" size={24} /> : <TriangleAlert size={24} />}
        <h1>{t(loading ? 'workspace.loadingTitle' : 'workspace.loadErrorTitle')}</h1>
        <p>{loading ? t('workspace.loadingBody') : t('workspace.loadErrorBody')}</p>
        {!loading && errorMessage ? <code>{errorMessage}</code> : null}
        {!loading && onRetry ? (
          <button type="button" onClick={onRetry}>
            <RefreshCw size={16} />
            {t('workspace.retry')}
          </button>
        ) : null}
      </section>
    </main>
  );
}
