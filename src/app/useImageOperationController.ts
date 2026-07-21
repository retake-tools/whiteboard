import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { createImageAssetFromDataUrl, getAssetPreviewUrl } from '../core/assetStore';
import { loadBoardSnapshot } from '../core/boardStore';
import { localizedBlockData } from '../core/blockLocalization';
import { createBlockRecord, touchBoard } from '../core/blockFactory';
import { blockLockedByGroup } from '../core/grouping';
import { appendPromptCopiedEvent } from '../core/historyEvents';
import { readFileAsDataUrl, readImageDimensions } from '../core/imageFile';
import { attachImportedImageAsset } from '../core/imageBlockAsset';
import { imageBranchDraftSelectionBlockIds } from '../core/imageOperationLayout';
import {
  addImageCodexOperation,
  addLocalImageOperation,
  completeLocalImageOperation,
  createDraftImageToImageOperation,
  createDraftTextToImageOperation,
  executeExistingImageOperationBlock,
  failLocalImageOperation,
  type ImageCodexOperation,
  type ImageGenerationParams,
  type SwitchableOperationMode,
} from '../core/imageOperations';
import { renderAdjustedImage, type LocalImageAdjustments } from '../core/localImageTransforms';
import { imageOperationDefaultPrompt, imageOperationTitle } from '../core/imageOperationText';
import { nowIso } from '../core/id';
import { createImageResultRetryPrompt } from '../core/prompts';
import {
  executionInputRoleOptionsFor,
  operationReadinessFor,
  operationReadinessMessageKey,
} from '../core/capabilities';
import { cancelExecution } from '../core/executionLifecycle';
import {
  currentExecutionProviderSettings,
  executionConnection,
  executionDefaultConnection,
  subscribeExecutionProviderSettings,
} from '../core/executionProviderPreferences';
import type { ExecutionConnectionSummary, ExecutionProviderSettingsSnapshot } from '../core/executionProviders';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../core/types';
import { startVolcengineArkImage } from '../core/volcengineArkImageClient';
import { startCodexAppServerImage } from '../core/codexAppServerImageClient';
import type { OperationToast, PromptPreview } from '../components/OperationFeedback';
import type { useI18n } from '../i18n';
import {
  capabilityIdForOperationMode,
  generationParamsFromBlock,
  operationModeFromBlock,
  resizeEmptyOperationOutputSlot,
} from './appHelpers';

interface ImageOperationControllerOptions {
  centeredBlockPosition: (size: { width: number; height: number }) => { x: number; y: number };
  centerWorkflowBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  focusWorkflowBlocks: (blockIds: string[]) => void;
  persistSnapshot: (snapshot: BoardSnapshot, options?: { requireLocalApi?: boolean }) => Promise<void>;
  selectedBlock?: BlockRecord;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useImageOperationController(options: ImageOperationControllerOptions) {
  const {
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
  } = options;
  const [operationToast, setOperationToast] = useState<OperationToast>();
  const [promptPreview, setPromptPreview] = useState<PromptPreview>();
  const [copiedPromptKey, setCopiedPromptKey] = useState<string>();
  const copiedPromptTimer = useRef<number | undefined>(undefined);
  const providerSettings = useSyncExternalStore(
    subscribeExecutionProviderSettings,
    currentExecutionProviderSettings,
    currentExecutionProviderSettings,
  );

  useEffect(() => () => {
    if (copiedPromptTimer.current) window.clearTimeout(copiedPromptTimer.current);
  }, []);

  async function copyText(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
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
    updateSnapshot((current) => touchBoard(appendPromptCopiedEvent(current, input)), {
      syncFlow: false,
      persist: true,
    });
  }

  function closePromptPreviewAfterCopy(copyKey: string): void {
    setPromptPreview((current) =>
      current && (current.copyKey ?? 'prompt-preview') === copyKey ? undefined : current,
    );
  }

  async function copyQueuedOperationPrompt(block: BlockRecord): Promise<void> {
    const executionId = typeof block.data.sourceExecutionId === 'string' ? block.data.sourceExecutionId : undefined;
    const execution = executionId
      ? snapshotRef.current.executions.find((candidate) => candidate.executionId === executionId)
      : undefined;
    const prompt = typeof block.data.agentPrompt === 'string' ? block.data.agentPrompt : execution?.agentPrompt;
    const copyKey = `prompt:${block.blockId}`;
    if (!prompt) {
      setOperationToast({ id: copyKey, title: t('feedback.promptTitle'), body: t('feedback.taskCreatedCopyFailed'), tone: 'error' });
      return;
    }
    const blockIds = execution ? [...execution.inputBlockIds, block.blockId, ...execution.outputBlockIds] : [block.blockId];
    setPromptPreview({ title: t('feedback.promptTitle'), prompt, copyKey, executionId, blockIds });
    try {
      await copyPromptWithHistory({ blockIds, copyKey, executionId, prompt, source: 'prompt_preview' });
      closePromptPreviewAfterCopy(copyKey);
      setOperationToast({ id: copyKey, title: t('feedback.taskCreated'), body: t('feedback.taskCreatedCopied'), tone: 'success' });
    } catch {
      setOperationToast({ id: copyKey, title: t('feedback.promptTitle'), body: t('feedback.taskCreatedCopyFailed'), tone: 'error' });
    }
  }

  async function retryFailedImageResult(blockId: string): Promise<void> {
    const current = snapshotRef.current;
    const resultBlock = current.blocks.find((block) => block.blockId === blockId && block.type === 'image');
    const executionId = typeof resultBlock?.data.sourceExecutionId === 'string' ? resultBlock.data.sourceExecutionId : undefined;
    const execution = current.executions.find((candidate) => candidate.executionId === executionId);
    const copyKey = `retry-result:${blockId}`;
    if (!resultBlock || !execution) return;
    try {
      await persistSnapshot(current, { requireLocalApi: true });
      if (execution.adapter === 'codex_app_server' || execution.adapter === 'direct_api') {
        if (!execution.connectionId) throw new Error(t('feedback.connectionUnavailable'));
        const connection = executionConnection(execution.connectionId, current.project.projectId);
        const usesCodexAppServer = execution.adapter === 'codex_app_server' && connection?.connectorId === 'codex-app-server';
        const usesVolcengineArk = execution.adapter === 'direct_api' && connection?.connectorId === 'volcengine-ark';
        if (!connection || connection.status !== 'ready' || (!usesCodexAppServer && !usesVolcengineArk)) {
          throw new Error(t('feedback.connectionUnavailable'));
        }
        const started = usesCodexAppServer
          ? await startCodexAppServerImage({
              projectId: current.project.projectId,
              boardId: current.board.boardId,
              executionId: execution.executionId,
              connectionId: connection.connectionId,
              resultBlockId: blockId,
            })
          : await startVolcengineArkImage({
              projectId: current.project.projectId,
              boardId: current.board.boardId,
              executionId: execution.executionId,
              connectionId: connection.connectionId,
              resultBlockId: blockId,
            });
        const runningSnapshot = updateSnapshot(() => started.snapshot, { persist: false, history: true });
        setSelectedBlock(runningSnapshot, blockId);
        setOperationToast({
          id: copyKey,
          title: t('result.retryPromptTitle'),
          body: t(usesCodexAppServer ? 'feedback.codexImageCostNotice' : 'feedback.seedreamCostNotice'),
          tone: 'success',
        });
        void pollDirectImageExecution(
          execution.executionId,
          runningSnapshot,
          usesCodexAppServer ? 'codex' : 'seedream',
        );
        return;
      }
      const prompt = createImageResultRetryPrompt(current, resultBlock);
      const operationBlockId = typeof resultBlock.data.operationBlockId === 'string' ? resultBlock.data.operationBlockId : undefined;
      const blockIds = [...execution.inputBlockIds, operationBlockId, blockId].filter((candidate): candidate is string => Boolean(candidate));
      setPromptPreview({ title: t('result.retryPromptTitle'), prompt, copyKey, executionId: execution.executionId, blockIds });
      await copyPromptWithHistory({ blockIds, copyKey, executionId: execution.executionId, prompt, source: 'failed_result_retry' });
      closePromptPreviewAfterCopy(copyKey);
      setOperationToast({ id: copyKey, title: t('result.retryPromptTitle'), body: t('feedback.taskCreatedCopied'), tone: 'success' });
    } catch (error) {
      setOperationToast({ id: copyKey, title: t('result.retryPromptTitle'), body: error instanceof Error ? error.message : t('feedback.taskCreatedCopyFailed'), tone: 'error' });
    }
  }

  async function refreshQueuedOperationPrompt(block: BlockRecord): Promise<void> {
    let refreshedOperationBlock: BlockRecord | undefined;
    updateSnapshot((current) => {
      const currentBlock = current.blocks.find((candidate) => candidate.blockId === block.blockId && candidate.type === 'operation');
      const executionId = typeof currentBlock?.data.sourceExecutionId === 'string' ? currentBlock.data.sourceExecutionId : undefined;
      const execution = executionId ? current.executions.find((candidate) => candidate.executionId === executionId) : undefined;
      if (!currentBlock || execution?.status !== 'queued') return current;
      cancelExecution(current, execution.executionId);
      refreshedOperationBlock = currentBlock;
      return current;
    }, { history: true });
    if (refreshedOperationBlock) {
      await startExistingOperationBlock({ block: refreshedOperationBlock, operation: operationModeFromBlock(refreshedOperationBlock) });
    }
  }

  async function startImageCodexOperation(
    operation: ImageCodexOperation,
    block: BlockRecord,
    instruction?: string,
    operationOptions: {
      annotatedCompositeAsset?: AssetRecord;
      annotationManifest?: import('../core/imageAnnotations').AnnotationManifest;
      connectionId?: string;
      generationParams?: ImageGenerationParams;
      referenceAssets?: AssetRecord[];
    } = {},
  ): Promise<boolean> {
    const capabilityId = capabilityIdForImmediateImageOperation(operation);
    const connection = preferredReadyImageConnection(
      snapshotRef.current,
      capabilityId,
      providerSettings,
      operationOptions.connectionId,
    );
    if (!connection) {
      setOperationToast({
        id: `connection:${block.blockId}`,
        title: t('feedback.handoffUnavailable'),
        body: t('feedback.connectionUnavailable'),
        tone: 'error',
      });
      return false;
    }
    try {
      await persistSnapshot(snapshotRef.current, { requireLocalApi: true });
    } catch (error) {
      setOperationToast({ id: `handoff:${block.blockId}`, title: t('feedback.handoffUnavailable'), body: error instanceof Error ? error.message : t('feedback.localApiUnavailable'), tone: 'error' });
      return false;
    }
    let operationPrompt = '';
    let resultBlockIds: string[] = [];
    let operationBlockId = '';
    let executionId = '';
    const usesVolcengineArk = connection.connectorId === 'volcengine-ark';
    const usesCodexAppServer = connection.connectorId === 'codex-app-server';
    const nextSnapshot = updateSnapshot((current) => {
      const result = addImageCodexOperation(current, {
        connection,
        operation,
        sourceBlockId: block.blockId,
        instruction,
        taskTitle: imageOperationTitle(operation, t),
        waitingBody: t('operation.waitingBody'),
        defaultPrompt: imageOperationDefaultPrompt(operation, t),
        annotatedCompositeAsset: operationOptions.annotatedCompositeAsset,
        annotationManifest: operationOptions.annotationManifest,
        generationParams: operationOptions.generationParams,
        referenceAssets: operationOptions.referenceAssets,
      });
      operationPrompt = result.prompt;
      operationBlockId = result.operationBlock.blockId;
      resultBlockIds = result.resultBlocks.map((resultBlock) => resultBlock.blockId);
      executionId = result.execution.executionId;
      return current;
    }, { history: true });
    setSelectedBlock(nextSnapshot, operationBlockId);
    const copyKey = `prompt:${operationBlockId}`;
    const blockIds = [block.blockId, operationBlockId, ...resultBlockIds];
    try {
      await persistSnapshot(nextSnapshot, { requireLocalApi: true });
    } catch (error) {
      setOperationToast({ id: operationBlockId, title: t('feedback.handoffUnavailable'), body: error instanceof Error ? error.message : t('feedback.localApiUnavailable'), tone: 'error' });
      return false;
    }
    if (usesVolcengineArk || usesCodexAppServer) {
      try {
        const started = usesVolcengineArk
          ? await startVolcengineArkImage({
              projectId: nextSnapshot.project.projectId,
              boardId: nextSnapshot.board.boardId,
              executionId,
              connectionId: connection.connectionId,
            })
          : await startCodexAppServerImage({
              projectId: nextSnapshot.project.projectId,
              boardId: nextSnapshot.board.boardId,
              executionId,
              connectionId: connection.connectionId,
            });
        const runningSnapshot = updateSnapshot(() => started.snapshot, { persist: false, history: true });
        setSelectedBlocks(runningSnapshot, started.execution.outputBlockIds);
        setOperationToast({
          id: executionId,
          title: t(usesCodexAppServer ? 'feedback.codexImageStarted' : 'feedback.seedreamStarted'),
          body: t(usesCodexAppServer ? 'feedback.codexImageCostNotice' : 'feedback.seedreamCostNotice'),
          tone: 'success',
        });
        void pollDirectImageExecution(executionId, runningSnapshot, usesCodexAppServer ? 'codex' : 'seedream').catch((error) => {
          setOperationToast({
            id: executionId,
            title: t(usesCodexAppServer ? 'feedback.codexImageFailed' : 'feedback.seedreamFailed'),
            body: error instanceof Error ? error.message : t('feedback.localApiUnavailable'),
            tone: 'error',
          });
        });
        return true;
      } catch (error) {
        setOperationToast({
          id: executionId,
          title: t('feedback.handoffUnavailable'),
          body: error instanceof Error ? error.message : t('feedback.localApiUnavailable'),
          tone: 'error',
        });
        return false;
      }
    }
    setPromptPreview({ title: t('feedback.promptTitle'), prompt: operationPrompt, copyKey, executionId, blockIds });
    try {
      await copyPromptWithHistory({ blockIds, copyKey, executionId, prompt: operationPrompt, source: 'prompt_preview' });
      closePromptPreviewAfterCopy(copyKey);
      setOperationToast({ id: operationBlockId, title: t('feedback.taskCreated'), body: t('feedback.taskCreatedCopied'), tone: 'success' });
    } catch {
      setOperationToast({ id: operationBlockId, title: t('feedback.taskCreated'), body: t('feedback.taskCreatedCopyFailed'), tone: 'error' });
    }
    return true;
  }

  function createImageToImageDraftOperation(
    block: BlockRecord,
    operation: Exclude<ImageCodexOperation, 'annotation_edit' | 'generate_image'>,
    instruction?: string,
    draftOptions: { centerWorkflow?: boolean } = {},
  ): void {
    let selectedWorkflowIds: string[] = [];
    const nextSnapshot = updateSnapshot((current) => {
      const result = createDraftImageToImageOperation(current, {
        operation,
        sourceBlockId: block.blockId,
        textBlockTitle: t('operationToolbar.prompt'),
        textBlockBody: instruction?.trim() || '',
        textBlockPlaceholder: imageOperationDefaultPrompt(operation, t),
        operationTitle: imageOperationTitle(operation, t),
      });
      result.operationBlock.data.connectionId = preferredImageConnection(current);
      selectedWorkflowIds = imageBranchDraftSelectionBlockIds(block, result.textBlock, result.operationBlock);
      if (draftOptions.centerWorkflow) centerWorkflowBlocks(current, selectedWorkflowIds);
      return current;
    }, { persist: true, history: true });
    if (selectedWorkflowIds.length > 0) {
      setSelectedBlocks(nextSnapshot, selectedWorkflowIds);
      focusWorkflowBlocks(selectedWorkflowIds);
    }
  }

  function createImageToImageDraftFromMenu(): void {
    if (selectedBlock?.type === 'image') {
      createImageToImageDraftOperation(selectedBlock, 'quick_edit');
      return;
    }
    let imageBlock: BlockRecord | undefined;
    updateSnapshot((current) => {
      imageBlock = createBlockRecord(current, 'image');
      imageBlock.position = centeredBlockPosition(imageBlock.size);
      imageBlock.data = { ...imageBlock.data, ...localizedBlockData('image', t) };
      current.blocks.push(imageBlock);
      return touchBoard(current);
    }, { persist: true, history: true });
    if (imageBlock) createImageToImageDraftOperation(imageBlock, 'quick_edit', undefined, { centerWorkflow: true });
  }

  function createTextToImageDraftOperation(input: {
    generationParams?: ImageGenerationParams;
    instruction?: string;
    slotBlock?: BlockRecord;
  } = {}): void {
    let selectedWorkflowIds: string[] = [];
    const nextSnapshot = updateSnapshot((current) => {
      const result = createDraftTextToImageOperation(current, {
        generationParams: input.generationParams,
        operationTitle: imageOperationTitle('generate_image', t),
        slotBlockId: input.slotBlock?.blockId,
        textBlockTitle: t('operationToolbar.prompt'),
        textBlockBody: input.instruction?.trim() || '',
        textBlockPlaceholder: imageOperationDefaultPrompt('generate_image', t),
      });
      result.operationBlock.data.connectionId = preferredImageConnection(current);
      selectedWorkflowIds = input.slotBlock
        ? [input.slotBlock.blockId, result.textBlock.blockId, result.operationBlock.blockId]
        : [result.textBlock.blockId, result.operationBlock.blockId];
      if (!input.slotBlock) centerWorkflowBlocks(current, selectedWorkflowIds);
      return current;
    }, { persist: true, history: true });
    if (selectedWorkflowIds.length > 0) {
      setSelectedBlocks(nextSnapshot, selectedWorkflowIds);
      focusWorkflowBlocks(selectedWorkflowIds);
    }
  }

  async function createLocalImageEditOperation(
    block: BlockRecord,
    input: { body: string; capabilityId: 'image.local_adjust'; params: LocalImageAdjustments; title: string },
  ): Promise<void> {
    const sourceImageUrl = getAssetPreviewUrl(snapshotRef.current.assets, block.data.assetId);
    if (!sourceImageUrl) return;
    let executionId = '';
    let operationBlockId = '';
    let resultBlockId = '';
    const runningSnapshot = updateSnapshot((current) => {
      const result = addLocalImageOperation(current, { body: input.body, capabilityId: input.capabilityId, params: input.params, sourceBlockId: block.blockId, title: input.title });
      executionId = result.execution.executionId;
      operationBlockId = result.operationBlock.blockId;
      resultBlockId = result.resultBlock.blockId;
      return current;
    }, { history: true });
    if (!executionId || !operationBlockId || !resultBlockId) return;
    setSelectedBlock(runningSnapshot, operationBlockId);
    try {
      await persistSnapshot(runningSnapshot);
      const rendered = await renderAdjustedImage(sourceImageUrl, input.params);
      const asset = await createImageAssetFromDataUrl({ projectId: runningSnapshot.project.projectId, dataUrl: rendered.dataUrl, fileName: `adjusted-${block.blockId}.png`, width: rendered.width, height: rendered.height, sourceExecutionId: executionId });
      const completedSnapshot = updateSnapshot((current) => {
        completeLocalImageOperation(current, { asset, executionId });
        return current;
      });
      await persistSnapshot(completedSnapshot);
      setSelectedBlock(completedSnapshot, resultBlockId);
      setOperationToast({ id: executionId, title: t('feedback.localEditCompleted'), tone: 'success' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('feedback.localEditFailed');
      const failedSnapshot = updateSnapshot((current) => {
        failLocalImageOperation(current, { errorMessage, executionId });
        return current;
      });
      await persistSnapshot(failedSnapshot);
      setSelectedBlock(failedSnapshot, operationBlockId);
      setOperationToast({ id: executionId, title: t('feedback.localEditFailed'), body: errorMessage, tone: 'error' });
    }
  }

  async function startExistingOperationBlock(input: { block: BlockRecord; operation: SwitchableOperationMode }): Promise<void> {
    if (blockLockedByGroup(snapshotRef.current, input.block.blockId)) return;
    let operationPrompt = '';
    let resultBlockIds: string[] = [];
    let executionId = '';
    let inputBlockIds: string[] = [];
    let selectedConnectionId = '';
    let usesVolcengineArk = false;
    let usesCodexAppServer = false;
    const copyKey = `prompt:${input.block.blockId}`;
    try {
      await persistSnapshot(snapshotRef.current, { requireLocalApi: true });
      const nextSnapshot = updateSnapshot((current) => {
        const currentOperationBlock = current.blocks.find((block) => block.blockId === input.block.blockId);
        if (!currentOperationBlock || blockLockedByGroup(current, currentOperationBlock.blockId)) return current;
        selectedConnectionId = typeof currentOperationBlock.data.connectionId === 'string'
          ? currentOperationBlock.data.connectionId
          : 'codex-managed';
        const connection = executionConnection(selectedConnectionId, current.project.projectId);
        if (!connection || connection.status !== 'ready' || !connection.supportedCapabilityIds.includes(
          capabilityIdForOperationMode(input.operation),
        )) {
          throw new Error(t('feedback.connectionUnavailable'));
        }
        if (
          connection.connectorId !== 'codex-managed' &&
          connection.connectorId !== 'codex-app-server' &&
          connection.connectorId !== 'volcengine-ark'
        ) {
          throw new Error(t('feedback.connectionAdapterUnavailable'));
        }
        usesVolcengineArk = connection.connectorId === 'volcengine-ark';
        usesCodexAppServer = connection.connectorId === 'codex-app-server';
        const hasPendingImageRole = current.edges.some((edge) => {
          if (edge.targetBlockId !== input.block.blockId || edge.kind !== 'execution_input' || edge.inputRole) return false;
          const sourceBlock = current.blocks.find((block) => block.blockId === edge.sourceBlockId);
          return sourceBlock?.type === 'image' && Boolean(sourceBlock.data.assetId);
        });
        if (hasPendingImageRole) throw new Error(t('operationInputRole.required'));
        const result = executeExistingImageOperationBlock(current, {
          operationBlockId: input.block.blockId,
          operation: input.operation,
          instruction: '',
          generationParams: generationParamsFromBlock(currentOperationBlock),
          connection,
        });
        operationPrompt = result.prompt;
        resultBlockIds = result.resultBlocks.map((resultBlock) => resultBlock.blockId);
        inputBlockIds = result.execution.inputBlockIds;
        executionId = result.execution.executionId;
        return current;
      }, { history: true });
      await persistSnapshot(nextSnapshot, { requireLocalApi: true });
      setSelectedBlock(nextSnapshot, input.block.blockId);
      const blockIds = [...inputBlockIds, input.block.blockId, ...resultBlockIds].filter(Boolean);
      if (usesVolcengineArk) {
        const started = await startVolcengineArkImage({
          projectId: nextSnapshot.project.projectId,
          boardId: nextSnapshot.board.boardId,
          executionId,
          connectionId: selectedConnectionId,
        });
        const runningSnapshot = updateSnapshot(() => started.snapshot, { persist: false, history: true });
        setSelectedBlocks(runningSnapshot, started.execution.outputBlockIds);
        setOperationToast({
          id: executionId,
          title: t('feedback.seedreamStarted'),
          body: t('feedback.seedreamCostNotice'),
          tone: 'success',
        });
        await pollDirectImageExecution(executionId, runningSnapshot, 'seedream');
        return;
      }
      if (usesCodexAppServer) {
        const started = await startCodexAppServerImage({
          projectId: nextSnapshot.project.projectId,
          boardId: nextSnapshot.board.boardId,
          executionId,
          connectionId: selectedConnectionId,
        });
        const runningSnapshot = updateSnapshot(() => started.snapshot, { persist: false, history: true });
        setSelectedBlocks(runningSnapshot, started.execution.outputBlockIds);
        setOperationToast({
          id: executionId,
          title: t('feedback.codexImageStarted'),
          body: t('feedback.codexImageCostNotice'),
          tone: 'success',
        });
        await pollDirectImageExecution(executionId, runningSnapshot, 'codex');
        return;
      }
      setPromptPreview({ title: t('feedback.promptTitle'), prompt: operationPrompt, copyKey, executionId, blockIds });
      await copyPromptWithHistory({ blockIds, copyKey, executionId, prompt: operationPrompt, source: 'prompt_preview' });
      closePromptPreviewAfterCopy(copyKey);
      setOperationToast({ id: input.block.blockId, title: t('feedback.taskCreated'), body: t('feedback.taskCreatedCopied'), tone: 'success' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : t('feedback.localApiUnavailable');
      const currentOperationBlock = snapshotRef.current.blocks.find((block) => block.blockId === input.block.blockId && block.type === 'operation');
      const readinessIssue = currentOperationBlock ? operationReadinessFor(snapshotRef.current, currentOperationBlock).issues[0] : undefined;
      setOperationToast({ id: input.block.blockId, title: readinessIssue ? t('feedback.inputRequired') : t('feedback.handoffUnavailable'), body: readinessIssue ? t(operationReadinessMessageKey(readinessIssue)) : errorMessage, tone: 'error' });
    }
  }

  async function pollDirectImageExecution(
    executionId: string,
    scope: BoardSnapshot,
    provider: 'codex' | 'seedream',
  ): Promise<void> {
    while (true) {
      await delay(1_500);
      const latest = await loadBoardSnapshot({
        projectId: scope.project.projectId,
        boardId: scope.board.boardId,
      });
      const execution = latest.executions.find((candidate) => candidate.executionId === executionId);
      if (
        snapshotRef.current.project.projectId === scope.project.projectId &&
        snapshotRef.current.board.boardId === scope.board.boardId
      ) {
        updateSnapshot(() => latest, { persist: false, history: false });
      }
      if (!execution) throw new Error(`Image execution disappeared while waiting: ${executionId}`);
      if (execution.status === 'queued' || execution.status === 'running') continue;
      setOperationToast({
        id: executionId,
        title: t(execution.status === 'succeeded'
          ? provider === 'codex' ? 'feedback.codexImageCompleted' : 'feedback.seedreamCompleted'
          : execution.status === 'canceled'
            ? 'feedback.executionCanceled'
            : provider === 'codex' ? 'feedback.codexImageFailed' : 'feedback.seedreamFailed'),
        body: execution.status === 'succeeded'
          ? t(provider === 'codex' ? 'feedback.codexImageCompletedNotice' : 'feedback.seedreamCompletedNotice')
          : execution.errorMessage ?? t(provider === 'codex' ? 'feedback.codexImageFailed' : 'feedback.seedreamFailed'),
        tone: execution.status === 'succeeded' ? 'success' : execution.status === 'canceled' ? undefined : 'error',
      });
      return;
    }
  }

  function updateOperationGenerationParams(blockId: string, generationParams: ImageGenerationParams): void {
    updateSnapshot((current) => {
      const operationBlock = current.blocks.find((block) => block.blockId === blockId && block.type === 'operation');
      if (!operationBlock || blockLockedByGroup(current, blockId)) return current;
      operationBlock.data = { ...operationBlock.data, generationParams };
      operationBlock.updatedAt = nowIso();
      resizeEmptyOperationOutputSlot(current, operationBlock, generationParams);
      return touchBoard(current);
    }, { persist: true });
  }

  function updateOperationGenerationProfile(blockId: string, generationProfileId: string): void {
    updateSnapshot((current) => {
      const operationBlock = current.blocks.find((block) => block.blockId === blockId && block.type === 'operation');
      if (!operationBlock || blockLockedByGroup(current, blockId)) return current;
      operationBlock.data = { ...operationBlock.data, generationProfileId };
      operationBlock.updatedAt = nowIso();
      return touchBoard(current);
    }, { persist: true });
  }

  function updateOperationConnection(blockId: string, connectionId: string): void {
    updateSnapshot((current) => {
      const operationBlock = current.blocks.find((block) => block.blockId === blockId && block.type === 'operation');
      if (!operationBlock || blockLockedByGroup(current, blockId)) return current;
      operationBlock.data = { ...operationBlock.data, connectionId };
      operationBlock.updatedAt = nowIso();
      return touchBoard(current);
    }, { persist: true });
  }

  function updateOperationCapability(blockId: string, operation: SwitchableOperationMode): void {
    updateSnapshot((current) => {
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
        if (!edge.inputRole || !supportedRoles.includes(edge.inputRole)) delete edge.inputRole;
      }
      return touchBoard(current);
    }, { persist: true, history: true });
  }

  async function importImageIntoBlock(block: BlockRecord, file: File): Promise<void> {
    const currentBlock = snapshotRef.current.blocks.find((candidate) => candidate.blockId === block.blockId);
    if (currentBlock?.type !== 'image' || currentBlock.data.sourceExecutionId || currentBlock.data.operationBlockId || blockLockedByGroup(snapshotRef.current, block.blockId)) return;
    const dataUrl = await readFileAsDataUrl(file);
    const imageSize = await readImageDimensions(dataUrl);
    const asset = await createImageAssetFromDataUrl({ projectId: snapshotRef.current.project.projectId, dataUrl, fileName: file.name, width: imageSize?.width, height: imageSize?.height });
    const nextSnapshot = updateSnapshot((current) => {
      attachImportedImageAsset(current, { asset, blockId: block.blockId, fileName: file.name, updatedAt: nowIso() });
      return current;
    }, { history: true });
    await persistSnapshot(nextSnapshot);
  }

  const annotationConnections = readyConnectionsForCapability(providerSettings, 'image.annotation_edit');
  const preferredAnnotationConnectionId = preferredReadyImageConnection(
    snapshotRef.current,
    'image.annotation_edit',
    providerSettings,
  )?.connectionId;

  return {
    annotationConnections,
    closePromptPreviewAfterCopy,
    copiedPromptKey,
    copyPromptWithHistory,
    copyQueuedOperationPrompt,
    createImageToImageDraftFromMenu,
    createImageToImageDraftOperation,
    createLocalImageEditOperation,
    createTextToImageDraftOperation,
    importImageIntoBlock,
    operationToast,
    promptPreview,
    preferredAnnotationConnectionId,
    refreshQueuedOperationPrompt,
    retryFailedImageResult,
    setCopiedPromptKey,
    setOperationToast,
    setPromptPreview,
    startExistingOperationBlock,
    startImageCodexOperation,
    updateOperationCapability,
    updateOperationConnection,
    updateOperationGenerationParams,
    updateOperationGenerationProfile,
  };
}

function preferredImageConnection(snapshot: BoardSnapshot): string {
  const defaultConnectionId = executionDefaultConnection('image', snapshot.project.projectId);
  const defaultConnection = executionConnection(defaultConnectionId, snapshot.project.projectId);
  return defaultConnection?.status === 'ready' ? defaultConnection.connectionId : 'codex-managed';
}

function preferredReadyImageConnection(
  snapshot: BoardSnapshot,
  capabilityId: string,
  settings: ExecutionProviderSettingsSnapshot | undefined = currentExecutionProviderSettings(),
  requestedConnectionId?: string,
): ExecutionConnectionSummary | undefined {
  if (requestedConnectionId) {
    const requested = settings?.connections.find((connection) => connection.connectionId === requestedConnectionId);
    return requested?.status === 'ready' && requested.supportedCapabilityIds.includes(capabilityId)
      ? requested
      : undefined;
  }
  const preferredConnection = executionConnection(
    executionDefaultConnection('image', snapshot.project.projectId),
    snapshot.project.projectId,
  );
  if (
    preferredConnection?.status === 'ready' &&
    preferredConnection.supportedCapabilityIds.includes(capabilityId)
  ) {
    return preferredConnection;
  }
  return settings?.connections.find(
    (connection) =>
      connection.status === 'ready' &&
      connection.supportedCapabilityIds.includes(capabilityId),
  );
}

function readyConnectionsForCapability(
  settings: ExecutionProviderSettingsSnapshot | undefined,
  capabilityId: string,
): ExecutionConnectionSummary[] {
  return settings?.connections.filter(
    (connection) => connection.status === 'ready' && connection.supportedCapabilityIds.includes(capabilityId),
  ) ?? [];
}

function capabilityIdForImmediateImageOperation(operation: ImageCodexOperation): string {
  if (operation === 'annotation_edit') return 'image.annotation_edit';
  if (operation === 'generate_image') return 'image.text_to_image';
  return 'image.image_to_image';
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
