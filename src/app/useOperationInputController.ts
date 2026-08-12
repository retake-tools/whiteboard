import { useEffect, useRef, useState, type RefObject } from 'react';
import type {
  ReferenceImageOption,
  ReferenceInputSlotOption,
} from '../components/InputReferencePicker';
import { referenceInputSlotLabel } from '../components/referenceInputLabels';
import { getAssetPreviewUrl } from '../core/assetStore';
import { localizedBlockData } from '../core/blockLocalization';
import {
  compatibleInputSlotIdsFor,
  disabledInputSlotIdsFor,
  nextRequiredInputSlotId,
  operationReadinessFor,
  operationReadinessMessageKey,
} from '../core/capabilities';
import {
  capabilityDefinitionFor,
  isTextDocumentCapability,
} from '../core/capabilityRegistry';
import { blockLockedByGroup } from '../core/grouping';
import { imageOperationDefaultPrompt } from '../core/imageOperationText';
import type {
  ImageGenerationParams,
  SwitchableOperationMode,
} from '../core/imageOperations';
import { executionConnection } from '../core/executionProviderPreferences';
import { domainVideoGenerationCapabilityId } from '../core/domainVideoGenerationContracts';
import { resolvedSkillUiDefinitionFor } from '../core/skillRegistry';
import type {
  BlockRecord,
  BlockType,
  BoardEdgeRecord,
  BoardSnapshot,
} from '../core/types';
import {
  createReferenceIntent,
  type ComposerImageReferenceMode,
  type ComposerImageReferenceSetting,
} from '../core/referenceIntent';
import type { OperationToast } from '../components/OperationFeedback';
import type { useI18n } from '../i18n';
import type { CanvasHostCommandsV1 } from '../host-kit';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';
import { inputSlotIdForReferenceSetting } from '../whiteboard/application/whiteboardOperationInputCommands';
import {
  operationAllowsInputType,
  operationModeFromBlock,
} from './appHelpers';

interface InputReferencePickerState {
  anchor: { x: number; y: number };
  body?: string;
  cursorIndex?: number;
  edgeId?: string;
  inputSlotId?: string;
  operationBlockId: string;
  setting: ComposerImageReferenceSetting;
  sourceBlockId?: string;
  textBlockId?: string;
}

interface OperationInputControllerOptions {
  copyQueuedOperationPrompt: (block: BlockRecord) => Promise<void>;
  locale: string;
  refreshQueuedOperationPrompt: (block: BlockRecord) => Promise<void>;
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
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  startExistingOperationBlock: (input: {
    block: BlockRecord;
    operation: SwitchableOperationMode;
    revealOnStart?: boolean;
  }) => Promise<void>;
  startTextGenerationOperation: (block: BlockRecord) => Promise<void>;
  t: ReturnType<typeof useI18n>['t'];
  updateOperationCapability: (blockId: string, operation: SwitchableOperationMode) => void;
  updateOperationConnection: (blockId: string, connectionId: string) => void;
  updateOperationGenerationParams: (blockId: string, params: ImageGenerationParams) => void;
  updateOperationGenerationProfile: (blockId: string, profileId: string) => void;
}

export function useOperationInputController(options: OperationInputControllerOptions) {
  const {
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
    startTextGenerationOperation,
    t,
    updateOperationCapability,
    updateOperationConnection,
    updateOperationGenerationParams,
    updateOperationGenerationProfile,
  } = options;
  const [inputReferencePicker, setInputReferencePicker] = useState<InputReferencePickerState>();
  const inFlightOperationBlockIdsRef = useRef(new Set<string>());

  function operationPlaceholderForBlock(operationBlock: BlockRecord): string {
    if (operationBlock.data.capabilityId === 'text.generate') return t('operationToolbar.promptPlaceholder');
    if (typeof operationBlock.data.skillId === 'string') {
      const ui = resolvedSkillUiDefinitionFor(operationBlock.data.skillId, locale);
      const slotId = nextRequiredInputSlotId(snapshotRef.current, operationBlock);
      const slot = ui.inputSlots?.find((candidate) => candidate.slotId === slotId);
      return slot?.placeholder ?? ui.placeholder;
    }
    const mode = operationModeFromBlock(operationBlock, snapshotRef.current);
    if (operationBlock.data.operationVariant === 'create_similar') {
      return imageOperationDefaultPrompt('create_similar', t);
    }
    if (mode === 'image_to_image') {
      return imageOperationDefaultPrompt('quick_edit', t);
    }
    return imageOperationDefaultPrompt('generate_image', t);
  }

  function addOperationInputBlock(
    operationBlockId: string,
    type: Extract<BlockType, 'image' | 'text' | 'video'>,
  ): void {
    const current = snapshotRef.current;
    const operationBlock = current.blocks.find(
      (block) => block.blockId === operationBlockId && block.type === 'operation',
    );
    if (
      !operationBlock
      || blockLockedByGroup(current, operationBlockId)
      || !operationAllowsInputType(operationBlock, type)
    ) return;
    const blockData = { ...localizedBlockData(type, t) };
    if (type === 'text') {
      const slotId = nextRequiredInputSlotId(current, operationBlock);
      const skillUi = typeof operationBlock.data.skillId === 'string'
        ? resolvedSkillUiDefinitionFor(operationBlock.data.skillId, locale)
        : undefined;
      const slotUi = skillUi?.inputSlots?.find((candidate) => candidate.slotId === slotId);
      blockData.title = slotUi?.label ?? t('operationToolbar.prompt');
      Object.assign(blockData, {
        placeholder: operationPlaceholderForBlock(operationBlock),
        promptRole: 'operation_prompt',
      });
    }
    void requireProductCommands(runProductCommand)(
      (commands) => commands.operationInput.addBlock({
        blockData,
        expectedScope: scopeFor(current),
        operationBlockId,
        type,
      }),
      { history: true, shouldKeepHistory: (result) => result.committed },
    ).then((result) => {
      if (result.blockId) setSelectedBlock(snapshotRef.current, result.blockId);
    }).catch((error: unknown) => reportOperationInputCommandFailure('add', error));
  }

  function removeOperationInput(edgeId: string): void {
    const edge = snapshotRef.current.edges.find((candidate) => candidate.edgeId === edgeId);
    if (
      !edge
      || blockLockedByGroup(snapshotRef.current, edge.sourceBlockId)
      || blockLockedByGroup(snapshotRef.current, edge.targetBlockId)
    ) return;
    void requireHostCommands(runHostCommand)(
      (commands) => commands.removeConnections({ edgeIds: [edgeId] }),
      { history: true },
    ).catch((error: unknown) => {
      console.error('Operation input removal failed.', error);
      setOperationToast({
        body: error instanceof Error ? error.message : String(error),
        id: `operation-input-remove-failed:${Date.now()}`,
        title: t('feedback.handoffUnavailable'),
        tone: 'error',
      });
    });
  }

  function completeInputReferenceMention(): void {
    const picker = inputReferencePicker;
    if (!picker?.sourceBlockId) return;
    const current = snapshotRef.current;
    setInputReferencePicker(undefined);
    void requireProductCommands(runProductCommand)(
      (commands) => commands.operationInput.bindImageReference({
        body: picker.body,
        cursorIndex: picker.cursorIndex,
        edgeId: picker.edgeId,
        expectedScope: scopeFor(current),
        fallbackImageTitle: t('block.image.title'),
        inputSlotId: picker.inputSlotId,
        operationBlockId: picker.operationBlockId,
        setting: picker.setting,
        sourceBlockId: picker.sourceBlockId!,
        textBlockId: picker.textBlockId,
      }),
      { history: true, shouldKeepHistory: (result) => result.committed },
    ).then((result) => {
      if (result.operationBlockId) setSelectedBlock(snapshotRef.current, result.operationBlockId);
    }).catch((error: unknown) => reportOperationInputCommandFailure('reference', error));
  }

  useEffect(() => {
    function onRequestImageMention(event: Event): void {
      const detail = (event as CustomEvent<{
        anchor?: { x: number; y: number };
        body?: string;
        cursorIndex?: number;
        textBlockId?: string;
      }>).detail;
      if (!detail?.anchor || typeof detail.body !== 'string' || typeof detail.cursorIndex !== 'number' || !detail.textBlockId) return;
      const promptEdge = snapshotRef.current.edges.find(
        (edge) => edge.sourceBlockId === detail.textBlockId && edge.kind === 'execution_input' && snapshotRef.current.blocks.some((block) => block.blockId === edge.targetBlockId && block.type === 'operation'),
      );
      if (!promptEdge) return;
      setInputReferencePicker({
        anchor: detail.anchor,
        body: detail.body,
        cursorIndex: detail.cursorIndex,
        operationBlockId: promptEdge.targetBlockId,
        setting: { instruction: '', mode: 'auto' },
        textBlockId: detail.textBlockId,
      });
    }
    window.addEventListener('retake:request-image-mention', onRequestImageMention);
    function onConfigureOperationReference(event: Event): void {
      const detail = (event as CustomEvent<{
        anchor?: { x: number; y: number };
        edgeId?: string;
      }>).detail;
      if (!detail?.anchor || !detail.edgeId) return;
      const edge = snapshotRef.current.edges.find(
        (candidate) => candidate.edgeId === detail.edgeId
          && candidate.kind === 'execution_input',
      );
      if (!edge) return;
      const operation = snapshotRef.current.blocks.find(
        (block) => block.blockId === edge.targetBlockId && block.type === 'operation',
      );
      if (!operation) return;
      setInputReferencePicker({
        anchor: detail.anchor,
        edgeId: edge.edgeId,
        inputSlotId: edge.inputSlotId,
        operationBlockId: operation.blockId,
        setting: referenceSettingForEdge(operation, edge),
        sourceBlockId: edge.sourceBlockId,
      });
    }
    window.addEventListener(
      'retake:configure-operation-reference',
      onConfigureOperationReference,
    );
    return () => {
      window.removeEventListener('retake:request-image-mention', onRequestImageMention);
      window.removeEventListener(
        'retake:configure-operation-reference',
        onConfigureOperationReference,
      );
    };
  }, []);

  async function runOperation(
    blockId: string,
    queuedConfigurationStale = false,
    revealOnStart = false,
  ): Promise<void> {
    if (inFlightOperationBlockIdsRef.current.has(blockId)) return;
    const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'operation');
    if (!block || blockLockedByGroup(snapshotRef.current, block.blockId) || block.data.status === 'running') return;
    inFlightOperationBlockIdsRef.current.add(blockId);
    try {
      if (block.data.capabilityId === domainVideoGenerationCapabilityId) {
        window.dispatchEvent(new CustomEvent('retake:open-domain-video-launch-review', {
          detail: { blockId: block.blockId },
        }));
        return;
      }
      const capabilityId = typeof block.data.capabilityId === 'string'
        ? block.data.capabilityId
        : '';
      const isTextDocument = isTextDocumentCapability(capabilityId);
      if (isTextDocument && block.data.status === 'queued') return;
      if (block.data.status === 'queued') {
        const connection = executionConnection(
          typeof block.data.connectionId === 'string' ? block.data.connectionId : 'codex-managed',
          snapshotRef.current.project.projectId,
        );
        if (connection?.connectorId !== 'codex-managed') return;
        await (queuedConfigurationStale ? refreshQueuedOperationPrompt(block) : copyQueuedOperationPrompt(block));
        return;
      }
      const readiness = operationReadinessFor(snapshotRef.current, block);
      if (!readiness.canRun) {
        const issue = readiness.issues[0];
        setOperationToast({ id: `operation-input:${block.blockId}`, title: t('feedback.inputRequired'), body: issue ? t(operationReadinessMessageKey(issue)) : undefined, tone: 'error' });
        return;
      }
      if (isTextDocument) {
        await startTextGenerationOperation(block);
      } else {
        await startExistingOperationBlock({
          block,
          operation: operationModeFromBlock(block, snapshotRef.current),
          revealOnStart,
        });
      }
    } finally {
      inFlightOperationBlockIdsRef.current.delete(blockId);
    }
  }

  const runOperationRef = useRef(runOperation);
  runOperationRef.current = runOperation;

  useEffect(() => {
    function onRunOperation(event: Event): void {
      const detail = (event as CustomEvent<{
        blockId?: string;
        queuedConfigurationStale?: boolean;
        revealOnStart?: boolean;
      }>).detail;
      if (!detail?.blockId) return;
      void runOperationRef.current(
        detail.blockId,
        detail.queuedConfigurationStale,
        detail.revealOnStart,
      );
    }
    window.addEventListener('retake:run-operation', onRunOperation);
    return () => window.removeEventListener('retake:run-operation', onRunOperation);
  }, []);

  useEffect(() => {
    function onUpdateParams(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; generationParams?: ImageGenerationParams }>).detail;
      if (detail?.blockId && detail.generationParams) updateOperationGenerationParams(detail.blockId, detail.generationParams);
    }
    function onUpdateProfile(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; generationProfileId?: string }>).detail;
      if (detail?.blockId && detail.generationProfileId) updateOperationGenerationProfile(detail.blockId, detail.generationProfileId);
    }
    function onUpdateConnection(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; connectionId?: string }>).detail;
      if (detail?.blockId && detail.connectionId) updateOperationConnection(detail.blockId, detail.connectionId);
    }
    function onUpdateDomainVideoParameters(event: Event): void {
      const detail = (event as CustomEvent<{
        blockId?: string;
        parameters?: Record<string, unknown>;
      }>).detail;
      if (!detail?.blockId || !detail.parameters) return;
      const current = snapshotRef.current;
      void requireProductCommands(runProductCommand)(
        (commands) => commands.operationInput.updateDomainVideoParameters({
          blockId: detail.blockId!,
          expectedScope: scopeFor(current),
          parameters: detail.parameters!,
        }),
        { history: true, shouldKeepHistory: (result) => result.committed },
      ).catch((error: unknown) => reportOperationInputCommandFailure('video-parameters', error));
    }
    function onUpdateSkill(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; skillId?: string }>).detail;
      if (!detail?.blockId || !detail.skillId) return;
      const current = snapshotRef.current;
      void requireProductCommands(runProductCommand)(
        (commands) => commands.operationInput.updateSkill({
          blockId: detail.blockId!,
          expectedScope: scopeFor(current),
          skillId: detail.skillId!,
        }),
        { history: true, shouldKeepHistory: (result) => result.committed },
      ).catch((error: unknown) => reportOperationInputCommandFailure('skill', error));
    }
    function onUpdateCapability(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; operation?: SwitchableOperationMode }>).detail;
      if (detail?.blockId && detail.operation) updateOperationCapability(detail.blockId, detail.operation);
    }
    function onRemoveInput(event: Event): void {
      const detail = (event as CustomEvent<{ edgeId?: string }>).detail;
      if (detail?.edgeId) removeOperationInput(detail.edgeId);
    }
    window.addEventListener('retake:update-operation-generation-params', onUpdateParams);
    window.addEventListener('retake:update-operation-generation-profile', onUpdateProfile);
    window.addEventListener('retake:update-operation-connection', onUpdateConnection);
    window.addEventListener('retake:update-domain-video-parameters', onUpdateDomainVideoParameters);
    window.addEventListener('retake:update-operation-skill', onUpdateSkill);
    window.addEventListener('retake:update-operation-capability', onUpdateCapability);
    window.addEventListener('retake:remove-operation-input', onRemoveInput);
    return () => {
      window.removeEventListener('retake:update-operation-generation-params', onUpdateParams);
      window.removeEventListener('retake:update-operation-generation-profile', onUpdateProfile);
      window.removeEventListener('retake:update-operation-connection', onUpdateConnection);
      window.removeEventListener('retake:update-domain-video-parameters', onUpdateDomainVideoParameters);
      window.removeEventListener('retake:update-operation-skill', onUpdateSkill);
      window.removeEventListener('retake:update-operation-capability', onUpdateCapability);
      window.removeEventListener('retake:remove-operation-input', onRemoveInput);
    };
  }, []);

  function reportOperationInputCommandFailure(action: string, error: unknown): void {
    console.error(`Operation Input ${action} failed.`, error);
    setOperationToast({
      body: error instanceof Error ? error.message : String(error),
      id: `operation-input-${action}-failed:${Date.now()}`,
      title: t('feedback.handoffUnavailable'),
      tone: 'error',
    });
  }

  const referenceImageOptions: ReferenceImageOption[] = snapshot.blocks.flatMap((block) => {
    if (block.type !== 'image' || !block.data.assetId) return [];
    const previewUrl = getAssetPreviewUrl(snapshot.assets, block.data.assetId);
    if (!previewUrl) return [];
    return [{ blockId: block.blockId, previewUrl, title: block.data.title.trim() || t('block.image.title') }];
  });
  const selectedReferenceImage = inputReferencePicker?.sourceBlockId
    ? referenceImageOptions.find((option) => option.blockId === inputReferencePicker.sourceBlockId)
    : undefined;
  const mentionOperation = inputReferencePicker
    ? snapshot.blocks.find((block) => block.blockId === inputReferencePicker.operationBlockId && block.type === 'operation')
    : undefined;
  const mentionSourceBlock = selectedReferenceImage
    ? snapshot.blocks.find((block) => block.blockId === selectedReferenceImage.blockId)
    : undefined;
  const mentionCompatibleSlotIds = mentionOperation && mentionSourceBlock
    ? compatibleInputSlotIdsFor(mentionSourceBlock, mentionOperation)
    : [];
  const mentionExistingEdge = mentionOperation && mentionSourceBlock
    ? snapshot.edges.find((edge) => edge.sourceBlockId === mentionSourceBlock.blockId && edge.targetBlockId === mentionOperation.blockId && edge.kind === 'execution_input')
    : undefined;
  const mentionDisabledSlotIds = mentionOperation && mentionSourceBlock
    ? disabledInputSlotIdsFor(snapshot, mentionSourceBlock, mentionOperation, mentionExistingEdge?.edgeId)
    : [];
  const mentionAllowedModes = referenceModesForSlots(
    mentionOperation,
    inputReferencePicker?.inputSlotId
      ? [inputReferencePicker.inputSlotId]
      : mentionCompatibleSlotIds.filter(
        (slotId) => !mentionDisabledSlotIds.includes(slotId),
      ),
  );
  const mentionSlotOptions = referenceSlotOptions(
    mentionOperation,
    mentionCompatibleSlotIds.filter(
      (slotId) => !mentionDisabledSlotIds.includes(slotId),
    ),
    t,
  );

  return {
    addOperationInputBlock,
    completeInputReferenceMention,
    inputReferencePicker,
    mentionAllowedModes,
    mentionSlotOptions,
    referenceImageOptions,
    selectedReferenceImage,
    setInputReferencePicker,
    runOperation,
  };
}

function referenceModesForSlots(
  operationBlock: BlockRecord | undefined,
  slotIds: readonly string[],
): ComposerImageReferenceMode[] {
  if (!operationBlock || slotIds.length === 0) return [];
  const semantics = inputSlotSemantics(operationBlock, slotIds);
  const modes: ComposerImageReferenceMode[] = [];
  if (semantics.some(({ semanticRole }) => semanticRole === 'source')) {
    modes.push('source');
  }
  if (semantics.some(({ semanticRole }) => semanticRole !== 'source')) {
    modes.push('auto', 'reference');
  }
  return [...new Set(modes)];
}

function referenceSlotOptions(
  operationBlock: BlockRecord | undefined,
  slotIds: readonly string[],
  t: ReturnType<typeof useI18n>['t'],
): ReferenceInputSlotOption[] {
  if (!operationBlock) return [];
  return inputSlotSemantics(operationBlock, slotIds).map((slot) => ({
    label: referenceInputSlotLabel({
      inputSlotId: slot.slotId,
      semanticRole: slot.semanticRole,
    }, t),
    mode: slot.semanticRole === 'source' ? 'source' : 'reference',
    slotId: slot.slotId,
  }));
}

function referenceSettingForEdge(
  operationBlock: BlockRecord,
  edge: BoardEdgeRecord,
): ComposerImageReferenceSetting {
  const semanticRole = edge.inputSlotId
    ? inputSlotSemantics(operationBlock, [edge.inputSlotId])[0]?.semanticRole
    : undefined;
  if (semanticRole === 'source') {
    return { instruction: '', mode: 'source' };
  }
  return {
    instruction: edge.referenceIntent?.instruction ?? '',
    mode: edge.referenceIntent ? 'reference' : 'auto',
  };
}

function inputSlotSemantics(
  operationBlock: BlockRecord,
  slotIds: readonly string[],
): Array<{ semanticRole: string; slotId: string }> {
  const capabilityId = typeof operationBlock.data.capabilityId === 'string'
    ? operationBlock.data.capabilityId
    : 'image.generate';
  try {
    const definition = capabilityDefinitionFor(capabilityId);
    return slotIds.map((slotId) => ({
      semanticRole: definition.inputSlots.find(
        (slot) => slot.slotId === slotId,
      )?.semanticRole ?? slotId,
      slotId,
    }));
  } catch {
    return slotIds.map((slotId) => ({ semanticRole: slotId, slotId }));
  }
}

function requireHostCommands(
  runHostCommand: OperationInputControllerOptions['runHostCommand'],
): NonNullable<OperationInputControllerOptions['runHostCommand']> {
  if (!runHostCommand) throw new Error('Canvas Host command facade is unavailable.');
  return runHostCommand;
}

function requireProductCommands(
  runProductCommand: OperationInputControllerOptions['runProductCommand'],
): NonNullable<OperationInputControllerOptions['runProductCommand']> {
  if (!runProductCommand) throw new Error('Whiteboard product command facade is unavailable.');
  return runProductCommand;
}

function scopeFor(snapshot: BoardSnapshot) {
  return {
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
  };
}
