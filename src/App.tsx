import { useEffect, useRef, useState, type ReactElement } from 'react';
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
import { useBoardSession } from './app/useBoardSession';
import { useImageOperationController } from './app/useImageOperationController';
import { useOperationInputController } from './app/useOperationInputController';
import { useAnnotationController } from './app/useAnnotationController';
import { useCanvasController } from './app/useCanvasController';
import { useGroupController } from './app/useGroupController';
import { useBlockActions } from './app/useBlockActions';
import { useAppEventBindings } from './app/useAppEventBindings';
import { useVideoGenerationController } from './app/useVideoGenerationController';
import { WhiteboardCanvas } from './app/WhiteboardCanvas';

export function App(): ReactElement {
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
    scheduleAnnotationDraftPersist,
    snapshot,
    snapshotRef,
    undo,
    updateSnapshot,
  } = useBoardSession(t);
  const initialUiPreferences = useRef(loadUiPreferences());
  const directImageImportInputRef = useRef<HTMLInputElement | null>(null);
  const pendingDirectImageImportBlockIdRef = useRef<string | undefined>(undefined);
  const [inspectorBlockId, setInspectorBlockId] = useState<string | undefined>();
  const [isMiniMapVisible, setIsMiniMapVisible] = useState(() => initialUiPreferences.current.isMiniMapVisible);
  const [showGrid, setShowGrid] = useState(() => initialUiPreferences.current.showGrid);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  useEffect(() => {
    void loadExecutionProviderSettings(snapshot.project.projectId).catch(() => undefined);
  }, [snapshot.project.projectId]);
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
    centerBlockGroup,
    centeredBlockPosition,
    centerWorkflowBlocks,
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
    centerBlockGroup,
    centeredBlockPosition,
    centerWorkflowBlocks,
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
    t,
    updateOperationCapability,
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
