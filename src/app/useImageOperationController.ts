import { useEffect, useRef, useState, type RefObject } from 'react';
import { imageMimeTypeFromDataUrl } from '../core/assetStore';
import { loadBoardSnapshot } from '../core/boardStore';
import { localizedBlockData } from '../core/blockLocalization';
import { blockLockedByGroup } from '../core/grouping';
import { readFileAsDataUrl, readImageDimensions } from '../core/imageFile';
import {
  type ImageCodexOperation,
  type ImageGenerationParams,
  type SwitchableOperationMode,
} from '../core/imageOperations';
import type { ImageComposerReference } from '../core/imageComposer';
import { imageOperationDefaultPrompt, imageOperationTitle } from '../core/imageOperationText';
import { imageGenerateCapabilityId } from '../core/imageGenerateContracts';
import { createImageResultRetryPrompt } from '../core/prompts';
import { operationReadinessFor, operationReadinessMessageKey } from '../core/capabilities';
import {
  executionConnection,
} from '../core/executionProviderPreferences';
import type { BlockRecord, BoardSnapshot } from '../core/types';
import type { CompiledCreativeRequest } from '../core/creativeRequestCompiler';
import { startVolcengineArkImage } from '../core/volcengineArkImageClient';
import { startCodexAppServerImage } from '../core/codexAppServerImageClient';
import type { OperationToast, PromptPreview } from '../components/OperationFeedback';
import type { CanvasHostCommandsV1, CanvasHostScopeV1 } from '../host-kit';
import type { useI18n } from '../i18n';
import { operationModeFromBlock } from './appHelpers';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';
import type { WhiteboardImageDraftResultV1 } from '../whiteboard/application/whiteboardImageOperationCommands';

interface ImageOperationControllerOptions {
  adoptDurableSnapshot: (snapshot: BoardSnapshot) => void;
  focusWorkflowBlocks: (blockIds: string[], options?: { maxZoom?: number }) => void;
  getViewportCenter: () => { x: number; y: number };
  persistSnapshot: (snapshot: BoardSnapshot, options?: { requireLocalApi?: boolean }) => Promise<void>;
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
  selectedBlock?: BlockRecord;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  setSelectedBlocks: (snapshot: BoardSnapshot, blockIds: string[]) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
}

export function useImageOperationController(options: ImageOperationControllerOptions) {
  const {
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
  } = options;
  const [operationToast, setOperationToast] = useState<OperationToast>();
  const [promptPreview, setPromptPreview] = useState<PromptPreview>();
  const [copiedPromptKey, setCopiedPromptKey] = useState<string>();
  const copiedPromptTimer = useRef<number | undefined>(undefined);
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
    const scope = scopeFor(snapshotRef.current);
    await copyText(input.prompt);
    setCopiedPromptKey(input.copyKey);
    if (copiedPromptTimer.current) window.clearTimeout(copiedPromptTimer.current);
    copiedPromptTimer.current = window.setTimeout(() => {
      setCopiedPromptKey((current) => (current === input.copyKey ? undefined : current));
    }, 1800);
    if (!input.executionId || !isCurrentScope(scope)) return;
    await requireProductCommands(runProductCommand)(
      (commands) => commands.history.recordPromptCopied({
        blockIds: input.blockIds,
        executionId: input.executionId!,
        expectedScope: scope,
        prompt: input.prompt,
        source: input.source,
      }),
      { syncFlow: false },
    );
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
    const scope = scopeFor(current);
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
        if (
          !connection ||
          connection.status !== 'ready' ||
          !connection.enabledUseCases.includes('image') ||
          (!usesCodexAppServer && !usesVolcengineArk)
        ) {
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
        if (adoptIfCurrent(started.snapshot)) {
          setSelectedBlock(snapshotRef.current, blockId);
        }
        setOperationToast({
          id: copyKey,
          title: t('result.retryPromptTitle'),
          body: t(usesCodexAppServer ? 'feedback.codexImageCostNotice' : 'feedback.seedreamCostNotice'),
          tone: 'success',
        });
        void pollDirectImageExecution(
          execution.executionId,
          scope,
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

  async function retryFailedImageExecution(executionId: string): Promise<void> {
    const current = snapshotRef.current;
    const scope = scopeFor(current);
    const execution = current.executions.find((candidate) => candidate.executionId === executionId);
    const resultBlockIds = execution?.outputBlockIds.filter((blockId) => {
      const block = current.blocks.find((candidate) => candidate.blockId === blockId);
      return block?.type === 'image' && typeof block.data.assetId !== 'string';
    }) ?? [];
    if (
      !execution
      || execution.status !== 'failed'
      || !execution.connectionId
      || resultBlockIds.length === 0
    ) return;
    const connection = executionConnection(execution.connectionId, current.project.projectId);
    const usesCodexAppServer = execution.adapter === 'codex_app_server'
      && connection?.connectorId === 'codex-app-server';
    const usesVolcengineArk = execution.adapter === 'direct_api'
      && connection?.connectorId === 'volcengine-ark';
    if (
      !connection
      || connection.status !== 'ready'
      || !connection.enabledUseCases.includes('image')
      || (!usesCodexAppServer && !usesVolcengineArk)
    ) {
      throw new Error(t('feedback.connectionUnavailable'));
    }
    await persistSnapshot(current, { requireLocalApi: true });
    const started = usesCodexAppServer
      ? await startCodexAppServerImage({
          projectId: current.project.projectId,
          boardId: current.board.boardId,
          executionId,
          connectionId: connection.connectionId,
          resultBlockIds,
        })
      : await startVolcengineArkImage({
          projectId: current.project.projectId,
          boardId: current.board.boardId,
          executionId,
          connectionId: connection.connectionId,
          resultBlockIds,
        });
    if (adoptIfCurrent(started.snapshot)) {
      setSelectedBlocks(snapshotRef.current, resultBlockIds);
    }
    setOperationToast({
      id: `retry-execution:${executionId}`,
      title: t('result.retryPromptTitle'),
      body: t(usesCodexAppServer ? 'feedback.codexImageCostNotice' : 'feedback.seedreamCostNotice'),
      tone: 'success',
    });
    void pollDirectImageExecution(
      executionId,
      scope,
      usesCodexAppServer ? 'codex' : 'seedream',
    );
  }

  async function cancelImageExecution(executionId: string): Promise<void> {
    const current = snapshotRef.current;
    const execution = current.executions.find((candidate) => candidate.executionId === executionId);
    if (!execution || (execution.status !== 'queued' && execution.status !== 'running')) return;
    await requireHostCommands(runHostCommand)(
      (commands) => commands.cancelExecution({ executionId }),
      { history: true },
    );
    setOperationToast({
      id: `execution-canceled:${executionId}`,
      title: t('feedback.executionCanceled'),
      body: t(execution.status === 'running'
        ? 'feedback.runningExecutionCanceled'
        : 'feedback.queuedExecutionCanceled'),
      tone: 'success',
    });
  }

  async function refreshQueuedOperationPrompt(block: BlockRecord): Promise<void> {
    const currentBlock = snapshotRef.current.blocks.find(
      (candidate) => candidate.blockId === block.blockId && candidate.type === 'operation',
    );
    const executionId = typeof currentBlock?.data.sourceExecutionId === 'string'
      ? currentBlock.data.sourceExecutionId
      : undefined;
    const execution = executionId
      ? snapshotRef.current.executions.find((candidate) => candidate.executionId === executionId)
      : undefined;
    if (!currentBlock || execution?.status !== 'queued') return;
    const queuedExecutionId = execution.executionId;
    await requireHostCommands(runHostCommand)(
      (commands) => commands.cancelExecution({ executionId: queuedExecutionId }),
      { history: true },
    );
    const refreshedOperationBlock = snapshotRef.current.blocks.find(
      (candidate) => candidate.blockId === block.blockId && candidate.type === 'operation',
    );
    if (refreshedOperationBlock) {
      await startExistingOperationBlock({
        block: refreshedOperationBlock,
        operation: operationModeFromBlock(refreshedOperationBlock, snapshotRef.current),
      });
    }
  }

  async function createImageToImageDraftOperation(
    block: BlockRecord,
    operation: Exclude<ImageCodexOperation, 'annotation_edit' | 'generate_image'>,
    instruction?: string,
    draftOptions: { centerWorkflow?: boolean } = {},
  ): Promise<WhiteboardImageDraftResultV1> {
    const result = await requireProductCommands(runProductCommand)(
      (commands) => commands.imageOperation.createImageToImageDraft({
        operation,
        sourceBlockId: block.blockId,
        presentation: {
          operationTitle: imageOperationTitle('generate_image', t),
          placementCenter: draftOptions.centerWorkflow ? getViewportCenter() : undefined,
          promptBody: instruction?.trim() || '',
          promptPlaceholder: imageOperationDefaultPrompt(operation, t),
          promptTitle: t('operationToolbar.prompt'),
        },
      }),
      { history: true },
    );
    if (result.blockIds.length > 0) {
      setSelectedBlocks(snapshotRef.current, result.blockIds);
      focusWorkflowBlocks(
        result.blockIds,
        draftOptions.centerWorkflow ? { maxZoom: 0.95 } : undefined,
      );
    }
    return result;
  }

  async function createImageToImageDraftFromMenu(): Promise<void> {
    if (selectedBlock?.type === 'image') {
      await createImageToImageDraftOperation(selectedBlock, 'quick_edit');
      return;
    }
    const placementCenter = getViewportCenter();
    const result = await requireProductCommands(runProductCommand)(
      (commands) => commands.imageOperation.createImageToImageDraft({
        blankSource: {
          data: localizedBlockData('image', t),
          placementCenter,
        },
        operation: 'quick_edit',
        presentation: {
          operationTitle: imageOperationTitle('generate_image', t),
          placementCenter,
          promptBody: '',
          promptPlaceholder: imageOperationDefaultPrompt('quick_edit', t),
          promptTitle: t('operationToolbar.prompt'),
        },
      }),
      { history: true },
    );
    setSelectedBlocks(snapshotRef.current, result.blockIds);
    focusWorkflowBlocks(result.blockIds, { maxZoom: 0.95 });
  }

  async function createTextToImageDraftOperation(input: {
    capabilityId?: typeof imageGenerateCapabilityId;
    connectionId?: string;
    creativeRequest?: CompiledCreativeRequest;
    generationParams?: ImageGenerationParams;
    instruction?: string;
    referenceBlockIds?: string[];
    references?: ImageComposerReference[];
    reuseSelectedImageSlot?: boolean;
    slotBlock?: BlockRecord;
  } = {}, draftOptions: { reveal?: boolean } = {}): Promise<WhiteboardImageDraftResultV1> {
    const hasSourceImage = input.references?.some(
      (reference) => reference.bindingKind === 'source',
    ) ?? false;
    const selectedSlot = !hasSourceImage
      ? input.slotBlock ?? (
          input.reuseSelectedImageSlot
          && selectedBlock?.type === 'image'
          && !selectedBlock.data.assetId
          && !selectedBlock.data.operationBlockId
          && !selectedBlock.data.sourceExecutionId
            ? selectedBlock
            : undefined
        )
      : undefined;
    const composerOperation = hasSourceImage ? 'quick_edit' : 'generate_image';
    const result = await requireProductCommands(runProductCommand)(
      (commands) => commands.imageOperation.createTextToImageDraft({
        capabilityId: input.capabilityId,
        connectionId: input.connectionId,
        creativeRequest: input.creativeRequest,
        generationParams: input.generationParams,
        instruction: input.instruction,
        presentation: {
          operationTitle: imageOperationTitle('generate_image', t),
          placementCenter: selectedSlot ? undefined : getViewportCenter(),
          promptBody: '',
          promptPlaceholder: imageOperationDefaultPrompt(composerOperation, t),
          promptTitle: t('operationToolbar.prompt'),
        },
        referenceBlockIds: input.referenceBlockIds,
        references: input.references,
        slotBlockId: selectedSlot?.blockId,
      }),
      { history: true },
    );
    setSelectedBlocks(snapshotRef.current, result.blockIds);
    if (draftOptions.reveal ?? true) focusWorkflowBlocks(result.blockIds);
    return result;
  }

  async function createAndStartImageComposerOperation(input: {
    capabilityId?: typeof imageGenerateCapabilityId;
    connectionId?: string;
    creativeRequest?: CompiledCreativeRequest;
    generationParams?: ImageGenerationParams;
    instruction?: string;
    references?: ImageComposerReference[];
    reuseSelectedImageSlot?: boolean;
    slotBlock?: BlockRecord;
  }): Promise<void> {
    const created = await createTextToImageDraftOperation(input, {
      reveal: false,
    });
    const operationBlock = snapshotRef.current.blocks.find(
      (block) => block.blockId === created.operationBlockId && block.type === 'operation',
    );
    if (!operationBlock) return;
    await startExistingOperationBlock({
      block: operationBlock,
      operation: operationModeFromBlock(operationBlock, snapshotRef.current),
      revealOnStart: true,
    });
  }

  async function startExistingOperationBlock(input: {
    block: BlockRecord;
    operation: SwitchableOperationMode;
    revealOnStart?: boolean;
  }): Promise<void> {
    if (blockLockedByGroup(snapshotRef.current, input.block.blockId)) return;
    const copyKey = `prompt:${input.block.blockId}`;
    const initialScope = scopeFor(snapshotRef.current);
    try {
      const queued = await requireProductCommands(runProductCommand)(
        (commands) => commands.imageExecution.queue({
          connectionAdapterUnavailableMessage: t('feedback.connectionAdapterUnavailable'),
          connectionUnavailableMessage: t('feedback.connectionUnavailable'),
          expectedScope: initialScope,
          inputBindingRequiredMessage: t('operationReference.bindingRequired'),
          operation: input.operation,
          operationBlockId: input.block.blockId,
        }),
        { history: true },
      );
      if (!isCurrentScope(queued.scope)) return;
      setSelectedBlock(snapshotRef.current, input.block.blockId);
      const blockIds = [
        ...queued.inputBlockIds,
        input.block.blockId,
        ...queued.resultBlockIds,
      ];
      const revealBlockIds = blockIds.filter((blockId) => {
        const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId);
        return (
          block?.type !== 'image'
          || queued.resultBlockIds.includes(blockId)
          || typeof block.data.composerSourceAssetId === 'string'
        );
      });
      if (queued.route === 'volcengine_ark') {
        const started = await startVolcengineArkImage({
          ...queued.scope,
          executionId: queued.executionId,
          connectionId: queued.connectionId,
        });
        if (adoptIfCurrent(started.snapshot)) {
          setSelectedBlocks(snapshotRef.current, started.execution.outputBlockIds);
        }
        if (input.revealOnStart && isCurrentScope(queued.scope)) {
          focusWorkflowBlocks(revealBlockIds, { maxZoom: 1 });
        }
        setOperationToast({
          id: queued.executionId,
          title: t('feedback.seedreamStarted'),
          body: t('feedback.seedreamCostNotice'),
          tone: 'success',
        });
        await pollDirectImageExecution(queued.executionId, queued.scope, 'seedream');
        return;
      }
      if (queued.route === 'codex_app_server') {
        const started = await startCodexAppServerImage({
          ...queued.scope,
          executionId: queued.executionId,
          connectionId: queued.connectionId,
        });
        if (adoptIfCurrent(started.snapshot)) {
          setSelectedBlocks(snapshotRef.current, started.execution.outputBlockIds);
        }
        if (input.revealOnStart && isCurrentScope(queued.scope)) {
          focusWorkflowBlocks(revealBlockIds, { maxZoom: 1 });
        }
        setOperationToast({
          id: queued.executionId,
          title: t('feedback.codexImageStarted'),
          body: t('feedback.codexImageCostNotice'),
          tone: 'success',
        });
        await pollDirectImageExecution(queued.executionId, queued.scope, 'codex');
        return;
      }
      setPromptPreview({
        title: t('feedback.promptTitle'),
        prompt: queued.prompt,
        copyKey,
        executionId: queued.executionId,
        blockIds,
      });
      await copyPromptWithHistory({
        blockIds,
        copyKey,
        executionId: queued.executionId,
        prompt: queued.prompt,
        source: 'prompt_preview',
      });
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
    scope: CanvasHostScopeV1,
    provider: 'codex' | 'seedream',
  ): Promise<void> {
    while (true) {
      await delay(1_500);
      const latest = await loadBoardSnapshot(scope);
      const execution = latest.executions.find((candidate) => candidate.executionId === executionId);
      adoptIfCurrent(latest);
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
          : t(provider === 'codex' ? 'feedback.codexImageFailed' : 'feedback.seedreamFailed'),
        tone: execution.status === 'succeeded' ? 'success' : execution.status === 'canceled' ? undefined : 'error',
      });
      return;
    }
  }

  function adoptIfCurrent(snapshot: BoardSnapshot): boolean {
    if (!isCurrentScope(scopeFor(snapshot))) return false;
    adoptDurableSnapshot(snapshot);
    return true;
  }

  function isCurrentScope(scope: CanvasHostScopeV1): boolean {
    return snapshotRef.current.project.projectId === scope.projectId
      && snapshotRef.current.board.boardId === scope.boardId;
  }

  function updateOperationGenerationParams(blockId: string, generationParams: ImageGenerationParams): void {
    runImageOperationUpdate(blockId, (commands) => (
      commands.imageOperation.updateGenerationParams({ blockId, generationParams })
    ));
  }

  function updateOperationGenerationProfile(blockId: string, generationProfileId: string): void {
    runImageOperationUpdate(blockId, (commands) => (
      commands.imageOperation.updateGenerationProfile({ blockId, generationProfileId })
    ));
  }

  function updateOperationConnection(blockId: string, connectionId: string): void {
    runImageOperationUpdate(blockId, (commands) => (
      commands.imageOperation.updateConnection({ blockId, connectionId })
    ));
  }

  function updateOperationCapability(blockId: string, operation: SwitchableOperationMode): void {
    runImageOperationUpdate(blockId, (commands) => (
      commands.imageOperation.updateCapability({
        blockId,
        operation,
        title: operation === 'text_to_image' ? imageOperationTitle('generate_image', t) : imageOperationTitle('quick_edit', t),
      })
    ));
  }

  function runImageOperationUpdate(
    blockId: string,
    update: (
      commands: WhiteboardProductCommandsV1,
    ) => Promise<{ committed: boolean; updated: boolean }>,
  ): void {
    void requireProductCommands(runProductCommand)(update, {
      history: true,
      shouldKeepHistory: (result) => result.committed,
    }).catch((error) => {
      setOperationToast({
        id: `image-operation-update:${blockId}`,
        title: t('feedback.handoffUnavailable'),
        body: error instanceof Error ? error.message : t('feedback.localApiUnavailable'),
        tone: 'error',
      });
    });
  }

  async function importImageIntoBlock(block: BlockRecord, file: File): Promise<void> {
    const currentBlock = snapshotRef.current.blocks.find((candidate) => candidate.blockId === block.blockId);
    if (currentBlock?.type !== 'image' || currentBlock.data.sourceExecutionId || currentBlock.data.operationBlockId || blockLockedByGroup(snapshotRef.current, block.blockId)) return;
    const dataUrl = await readFileAsDataUrl(file);
    const imageSize = await readImageDimensions(dataUrl);
    await requireHostCommands(runHostCommand)((commands) => commands.attachAsset({
        blockId: block.blockId,
        fileName: file.name,
        height: imageSize?.height,
        kind: 'image',
        mimeType: imageMimeTypeFromDataUrl(dataUrl),
        previewUrl: dataUrl,
        storageKey: `import://${file.name || 'image'}`,
        storageProvider: 'custom',
        width: imageSize?.width,
      }), { history: true });
  }

  return {
    cancelImageExecution,
    closePromptPreviewAfterCopy,
    copiedPromptKey,
    copyPromptWithHistory,
    copyQueuedOperationPrompt,
    createImageToImageDraftFromMenu,
    createImageToImageDraftOperation,
    createAndStartImageComposerOperation,
    createTextToImageDraftOperation,
    importImageIntoBlock,
    operationToast,
    promptPreview,
    refreshQueuedOperationPrompt,
    retryFailedImageExecution,
    retryFailedImageResult,
    setCopiedPromptKey,
    setOperationToast,
    setPromptPreview,
    startExistingOperationBlock,
    updateOperationCapability,
    updateOperationConnection,
    updateOperationGenerationParams,
    updateOperationGenerationProfile,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function scopeFor(snapshot: BoardSnapshot): CanvasHostScopeV1 {
  return { boardId: snapshot.board.boardId, projectId: snapshot.project.projectId };
}

function requireProductCommands(
  runProductCommand: ImageOperationControllerOptions['runProductCommand'],
): NonNullable<ImageOperationControllerOptions['runProductCommand']> {
  if (!runProductCommand) {
    throw new Error('Whiteboard product command facade is unavailable.');
  }
  return runProductCommand;
}

function requireHostCommands(
  runHostCommand: ImageOperationControllerOptions['runHostCommand'],
): NonNullable<ImageOperationControllerOptions['runHostCommand']> {
  if (!runHostCommand) {
    throw new Error('Canvas Host command facade is unavailable.');
  }
  return runHostCommand;
}
