import { lazy, Suspense, useEffect, useRef, useState, type ReactElement } from 'react';
import { Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { BoardHistoryPanel } from './components/BoardHistoryPanel';
import { ExecutionInspector } from './components/ExecutionInspector';
import { FloatingToolbar } from './components/FloatingToolbar';
import { GroupInspector } from './components/GroupInspector';
import { InputReferencePicker } from './components/InputReferencePicker';
import { OperationFeedback } from './components/OperationFeedback';
import { ProjectBoardDialog } from './components/ProjectBoardDialog';
import { getProjectBoardDialogView } from './components/projectBoardDialogView';
import { TopBar } from './components/TopBar';
import { getAssetPreviewUrl } from './core/assetStore';
import { blockLockedByGroup, groupMediaItems } from './core/grouping';
import { loadUiPreferences } from './core/uiPreferences';
import { loadExecutionProviderSettings } from './core/executionProviderClient';
import { useI18n } from './i18n';
import { useWorkspaceController } from './app/useWorkspaceController';
import { useBoardSession, type ReadyBoardSession } from './app/useBoardSession';
import { useImageOperationController } from './app/useImageOperationController';
import { useOperationInputController } from './app/useOperationInputController';
import { useAnnotationController } from './app/useAnnotationController';
import { useCanvasController } from './app/useCanvasController';
import { useGroupController } from './app/useGroupController';
import { useBlockActions } from './app/useBlockActions';
import { useAppEventBindings } from './app/useAppEventBindings';
import { useVideoGenerationController } from './app/useVideoGenerationController';
import { useTextGenerationController } from './app/useTextGenerationController';
import { WhiteboardCanvas } from './app/WhiteboardCanvas';

const DocumentReviewWorkspace = lazy(() => import('./components/DocumentReviewWorkspace').then((module) => ({
  default: module.DocumentReviewWorkspace,
})));

export function App(): ReactElement {
  const { t } = useI18n();
  const boardSession = useBoardSession(t);

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

  return <ReadyApp boardSession={boardSession} />;
}

function ReadyApp({ boardSession }: { boardSession: ReadyBoardSession }): ReactElement {
  const { t } = useI18n();
  const {
    applyLoadedSnapshot,
    autosaveStatus,
    canRedo,
    canUndo,
    connectPorts,
    flushAnnotationDraftPersist,
    persistSnapshot,
    redo,
    retrySave,
    scheduleAnnotationDraftPersist,
    snapshot,
    snapshotRef,
    undo,
    updateSnapshot,
  } = boardSession;
  const initialUiPreferences = useRef(loadUiPreferences());
  const directImageImportInputRef = useRef<HTMLInputElement | null>(null);
  const pendingDirectImageImportBlockIdRef = useRef<string | undefined>(undefined);
  const [inspectorBlockId, setInspectorBlockId] = useState<string | undefined>();
  const [isMiniMapVisible, setIsMiniMapVisible] = useState(() => initialUiPreferences.current.isMiniMapVisible);
  const [showGrid, setShowGrid] = useState(() => initialUiPreferences.current.showGrid);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [reviewDocumentBlockId, setReviewDocumentBlockId] = useState<string | undefined>();
  useEffect(() => {
    void loadExecutionProviderSettings(snapshot.project.projectId).catch(() => undefined);
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
  const canvasController = useCanvasController({
    connectSessionPorts: connectPorts,
    redo,
    setHistoryOpen: setIsHistoryOpen,
    setInspectorBlockId,
    snapshot,
    snapshotRef,
    t,
    undo,
    updateSnapshot,
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
  } = useWorkspaceController({ applyLoadedSnapshot, snapshotRef, t, updateSnapshot });
  const {
    activeCanvasTool,
    canvasAreaRef,
    centeredBlockPosition,
    centerWorkflowBlocks,
    focusWorkflowBlocks,
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
  const imageOperationController = useImageOperationController({
    centeredBlockPosition,
    centerWorkflowBlocks,
    focusWorkflowBlocks,
    persistSnapshot,
    selectedBlock,
    setSelectedBlock,
    setSelectedBlocks,
    snapshotRef,
    t,
    updateSnapshot,
  });
  const {
    closePromptPreviewAfterCopy,
    copiedPromptKey,
    copyPromptWithHistory,
    copyQueuedOperationPrompt,
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
  const blockActions = useBlockActions({
    centeredBlockPosition,
    collapsedGroupIdsRef,
    selectedBlockIds,
    selectedBlockIdsRef,
    setActiveCanvasTool,
    setCollapsedGroupIds,
    setOperationToast,
    setSelectedBlock,
    setSelectedBlocks,
    snapshotRef,
    t,
    updateSnapshot,
  });
  const { addBlock, deleteBlockIds, deleteSelection, duplicateSelection } = blockActions;
  const textGenerationController = useTextGenerationController({
    centerWorkflowBlocks,
    focusWorkflowBlocks,
    persistSnapshot,
    setOperationToast,
    setSelectedBlocks,
    selectedBlockIdsRef,
    snapshotRef,
    t,
    updateSnapshot,
  });
  useVideoGenerationController({
    setOperationToast,
    setSelectedBlocks,
    snapshotRef,
    t,
    updateSnapshot,
  });
  connectCanvasActions({ deleteBlockIds });
  const annotationController = useAnnotationController({
    scheduleAnnotationDraftPersist,
    setHistoryOpen: setIsHistoryOpen,
    setInspectorBlockId,
    setOperationToast,
    setSelectedBlock,
    snapshotRef,
    t,
    updateSnapshot,
  });
  const {
    addOperationInputBlock,
    completeInputReferenceMention,
    inputReferencePicker,
    mentionDisabledRoles,
    mentionRoleOptions,
    referenceImageOptions,
    selectedReferenceImage,
    setInputReferencePicker,
  } = useOperationInputController({
    copyQueuedOperationPrompt,
    refreshQueuedOperationPrompt,
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
    updateSnapshot,
  });
  const {
    openHistoricalAnnotationVersion,
    restoreConfigurationVersion,
  } = annotationController;
  const groupController = useGroupController({
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
  });
  const { downloadGroupAssets } = groupController;

  useAppEventBindings({
    addOperationInputBlock,
    directImageImportInputRef,
    isMiniMapVisible,
    openHistoricalAnnotationVersion,
    pendingDirectImageImportBlockIdRef,
    retryFailedImageResult,
    setHistoryOpen: setIsHistoryOpen,
    setInspectorBlockId,
    setSelectedBlock,
    showGrid,
    snapshotRef,
  });


  function toggleHistoryPanel(): void {
    setIsHistoryOpen((current) => {
      const next = !current;
      if (next) setInspectorBlockId(undefined);
      return next;
    });
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
        onRetrySave={() => void retrySave()}
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
        onCreateSkill={textGenerationController.createSkillDraft}
        onCreateTextToImage={() => createTextToImageDraftOperation()}
        onSetActiveTool={setActiveCanvasTool}
      />
      <ExecutionInspector
        copiedPromptKey={copiedPromptKey}
        selectedBlock={inspectorBlock}
        snapshot={snapshot}
        onClose={() => setInspectorBlockId(undefined)}
        onCopyPrompt={copyPromptWithHistory}
        onOpenAnnotationEditor={openHistoricalAnnotationVersion}
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
          onOpenAnnotationEditor={openHistoricalAnnotationVersion}
        />
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
        annotations={annotationController}
        blockActions={blockActions}
        canvas={canvasController}
        directImageImportInputRef={directImageImportInputRef}
        flushAnnotationDraftPersist={flushAnnotationDraftPersist}
        groups={groupController}
        imageOperations={imageOperationController}
        isMiniMapVisible={isMiniMapVisible}
        pendingDirectImageImportBlockIdRef={pendingDirectImageImportBlockIdRef}
        selectedBlock={selectedBlock}
        selectedBlockContentLocked={selectedBlockContentLocked}
        selectedGroupInheritedLocked={selectedGroupInheritedLocked}
        selectedGroupMediaCount={selectedGroupMediaCount}
        selectedImageAsset={selectedImageAsset}
        selectedImageUrl={selectedImageUrl}
        setHistoryOpen={setIsHistoryOpen}
        setInspectorBlockId={setInspectorBlockId}
        setMiniMapVisible={setIsMiniMapVisible}
        showGrid={showGrid}
        snapshot={snapshot}
        snapshotRef={snapshotRef}
        t={t}
      />
    </main>
  );
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
