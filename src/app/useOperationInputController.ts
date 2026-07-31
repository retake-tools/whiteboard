import { useEffect, useRef, useState, type RefObject } from 'react';
import type {
  ReferenceImageOption,
  ReferenceInputSlotOption,
} from '../components/InputReferencePicker';
import { referenceInputSlotLabel } from '../components/referenceInputLabels';
import { getAssetPreviewUrl } from '../core/assetStore';
import { localizedBlockData } from '../core/blockLocalization';
import { createBlockRecord, touchBoard } from '../core/blockFactory';
import {
  compatibleInputSlotIdsFor,
  disabledInputSlotIdsFor,
  nextRequiredInputSlotId,
  operationReadinessFor,
  operationReadinessMessageKey,
} from '../core/capabilities';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';
import { blockLockedByGroup, expandGroupToContents } from '../core/grouping';
import { imageOperationDefaultPrompt } from '../core/imageOperationText';
import type {
  ImageGenerationParams,
  SwitchableOperationMode,
} from '../core/imageOperations';
import { createId, nowIso } from '../core/id';
import { executionConnection } from '../core/executionProviderPreferences';
import {
  domainVideoGenerationCapabilityId,
  normalizeDomainVideoGenerationParameters,
} from '../core/domainVideoGenerationContracts';
import { resolvedSkillUiDefinitionFor, skillsForCapability } from '../core/skillRegistry';
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
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useOperationInputController(options: OperationInputControllerOptions) {
  const {
    copyQueuedOperationPrompt,
    locale,
    refreshQueuedOperationPrompt,
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
    updateSnapshot,
  } = options;
  const [inputReferencePicker, setInputReferencePicker] = useState<InputReferencePickerState>();

  function operationInputBlockPosition(
    current: BoardSnapshot,
    operationBlock: BlockRecord,
    size: { width: number; height: number },
  ): { x: number; y: number } {
    const inputCount = current.edges.filter(
      (edge) => edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input',
    ).length;
    const slotOffset = inputCount === 0 ? 0 : inputCount * 54;
    return {
      x: operationBlock.position.x - size.width - 90,
      y: operationBlock.position.y + slotOffset,
    };
  }

  function operationPlaceholderForBlock(operationBlock: BlockRecord): string {
    if (operationBlock.data.capabilityId === 'text.generate') return t('operationToolbar.promptPlaceholder');
    if (typeof operationBlock.data.skillId === 'string') {
      const ui = resolvedSkillUiDefinitionFor(operationBlock.data.skillId, locale);
      const slotId = nextRequiredInputSlotId(snapshotRef.current, operationBlock);
      const slot = ui.inputSlots?.find((candidate) => candidate.slotId === slotId);
      return slot?.placeholder ?? ui.placeholder;
    }
    const mode = operationBlock.data.operationMode;
    if (operationBlock.data.operationVariant === 'create_similar') {
      return imageOperationDefaultPrompt('create_similar', t);
    }
    if (mode === 'image_to_image' || mode === 'quick_edit' || mode === 'create_similar') {
      return imageOperationDefaultPrompt('quick_edit', t);
    }
    return imageOperationDefaultPrompt('generate_image', t);
  }

  function addOperationInputBlock(
    operationBlockId: string,
    type: Extract<BlockType, 'image' | 'text' | 'video'>,
  ): void {
    let newBlockId = '';
    const nextSnapshot = updateSnapshot((current) => {
      const operationBlock = current.blocks.find(
        (block) => block.blockId === operationBlockId && block.type === 'operation',
      );
      if (!operationBlock || blockLockedByGroup(current, operationBlockId)) return current;
      if (!operationAllowsInputType(operationBlock, type)) return current;
      const block = createBlockRecord(current, type);
      block.position = operationInputBlockPosition(current, operationBlock, block.size);
      block.parentGroupId = operationBlock.parentGroupId;
      block.data = { ...block.data, ...localizedBlockData(type, t) };
      if (type === 'text') {
        const slotId = nextRequiredInputSlotId(current, operationBlock);
        const skillUi = typeof operationBlock.data.skillId === 'string'
          ? resolvedSkillUiDefinitionFor(operationBlock.data.skillId, locale)
          : undefined;
        const slotUi = skillUi?.inputSlots?.find((candidate) => candidate.slotId === slotId);
        block.data.title = slotUi?.label ?? t('operationToolbar.prompt');
        block.data.promptRole = 'operation_prompt';
        block.data.placeholder = operationPlaceholderForBlock(operationBlock);
      }
      current.blocks.push(block);
      if (operationBlock.parentGroupId) expandGroupToContents(current, operationBlock.parentGroupId);
      current.edges.push({
        edgeId: createId('edge'),
        sourceBlockId: block.blockId,
        targetBlockId: operationBlock.blockId,
        kind: 'execution_input',
        inputSlotId: type === 'text' ? nextRequiredInputSlotId(current, operationBlock) : undefined,
      });
      newBlockId = block.blockId;
      return touchBoard(current);
    }, { persist: true, history: true });
    if (newBlockId) setSelectedBlock(nextSnapshot, newBlockId);
  }

  function removeOperationInput(edgeId: string): void {
    updateSnapshot((current) => {
      const edge = current.edges.find((candidate) => candidate.edgeId === edgeId);
      if (edge && (blockLockedByGroup(current, edge.sourceBlockId) || blockLockedByGroup(current, edge.targetBlockId))) return current;
      const nextEdges = current.edges.filter((edge) => edge.edgeId !== edgeId);
      if (nextEdges.length === current.edges.length) return current;
      current.edges = nextEdges;
      return touchBoard(current);
    }, { persist: true, history: true });
  }

  function completeInputReferenceMention(): void {
    const picker = inputReferencePicker;
    if (!picker?.sourceBlockId) return;
    let selectedOperationId = '';
    const nextSnapshot = updateSnapshot((current) => {
      const sourceBlock = current.blocks.find((block) => block.blockId === picker.sourceBlockId && block.type === 'image' && block.data.assetId);
      const textBlock = picker.textBlockId
        ? current.blocks.find((block) => block.blockId === picker.textBlockId && block.type === 'text')
        : undefined;
      const operationBlock = current.blocks.find((block) => block.blockId === picker.operationBlockId && block.type === 'operation');
      if (
        !sourceBlock
        || !operationBlock
        || (textBlock && blockLockedByGroup(current, textBlock.blockId))
        || blockLockedByGroup(current, operationBlock.blockId)
      ) return current;
      let inputEdge = picker.edgeId
        ? current.edges.find((edge) => edge.edgeId === picker.edgeId)
        : current.edges.find((edge) => edge.sourceBlockId === sourceBlock.blockId && edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input');
      const compatibleSlots = compatibleInputSlotIdsFor(sourceBlock, operationBlock);
      const disabledSlots = disabledInputSlotIdsFor(
        current,
        sourceBlock,
        operationBlock,
        inputEdge?.edgeId,
      );
      const inputSlotId = inputSlotIdForReferenceSetting(
        operationBlock,
        compatibleSlots.filter((slotId) => !disabledSlots.includes(slotId)),
        picker.setting,
        picker.inputSlotId,
      );
      if (!inputSlotId) return current;
      if (inputEdge) {
        inputEdge.inputSlotId = inputSlotId;
      } else {
        inputEdge = {
          edgeId: createId('edge'),
          sourceBlockId: sourceBlock.blockId,
          targetBlockId: operationBlock.blockId,
          kind: 'execution_input',
          inputSlotId,
        };
        current.edges.push(inputEdge);
      }
      const referenceIntent = picker.setting.mode === 'source'
        ? undefined
        : createReferenceIntent(picker.setting.instruction, 'user');
      if (referenceIntent) {
        inputEdge.referenceIntent = referenceIntent;
      } else {
        delete inputEdge.referenceIntent;
      }
      if (
        textBlock
        && typeof picker.body === 'string'
        && typeof picker.cursorIndex === 'number'
      ) {
        const imageTitle = sourceBlock.data.title.trim() || t('block.image.title');
        const mentionStart = Math.max(0, picker.cursorIndex - 1);
        const afterMention = picker.body.slice(picker.cursorIndex);
        const separator = afterMention.length > 0 && !/^\s/.test(afterMention) ? ' ' : '';
        textBlock.data.body = `${picker.body.slice(0, mentionStart)}@${imageTitle}${separator}${afterMention}`;
        textBlock.updatedAt = nowIso();
      }
      selectedOperationId = operationBlock.blockId;
      return touchBoard(current);
    }, { persist: true, history: true });
    setInputReferencePicker(undefined);
    if (selectedOperationId) setSelectedBlock(nextSnapshot, selectedOperationId);
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
    const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'operation');
    if (!block || blockLockedByGroup(snapshotRef.current, block.blockId) || block.data.status === 'running') return;
    if (block.data.capabilityId === domainVideoGenerationCapabilityId) {
      window.dispatchEvent(new CustomEvent('retake:open-domain-video-launch-review', {
        detail: { blockId: block.blockId },
      }));
      return;
    }
    const isTextDocument = block.data.capabilityId === 'text.generate'
      || (typeof block.data.capabilityId === 'string' && block.data.capabilityId.startsWith('story.screenplay.'));
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
        operation: operationModeFromBlock(block),
        revealOnStart,
      });
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
      updateSnapshot((current) => {
        const operation = current.blocks.find((block) =>
          block.blockId === detail.blockId
          && block.type === 'operation'
          && block.data.capabilityId === domainVideoGenerationCapabilityId,
        );
        if (!operation || blockLockedByGroup(current, operation.blockId)) return current;
        const parameters = normalizeDomainVideoGenerationParameters(detail.parameters);
        operation.data.domainVideoGenerationParameters = parameters;
        operation.data.workflowParameters = parameters;
        operation.updatedAt = nowIso();
        return touchBoard(current);
      }, { persist: true, history: true });
    }
    function onUpdateSkill(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; skillId?: string }>).detail;
      if (!detail?.blockId || !detail.skillId) return;
      updateSnapshot((current) => {
        const operation = current.blocks.find((block) => block.blockId === detail.blockId && block.type === 'operation');
        if (!operation || blockLockedByGroup(current, operation.blockId)) return current;
        const capabilityId = typeof operation.data.capabilityId === 'string' ? operation.data.capabilityId : '';
        if (!skillsForCapability(capabilityId).some((skill) => skill.skillId === detail.skillId)) return current;
        operation.data.skillId = detail.skillId;
        operation.updatedAt = nowIso();
        return touchBoard(current);
      }, { persist: true, history: true });
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

function inputSlotIdForReferenceSetting(
  operationBlock: BlockRecord,
  slotIds: readonly string[],
  setting: ComposerImageReferenceSetting,
  selectedSlotId?: string,
): string | undefined {
  const semantics = inputSlotSemantics(operationBlock, slotIds);
  if (selectedSlotId && slotIds.includes(selectedSlotId)) return selectedSlotId;
  if (setting.mode === 'source') {
    return semantics.find(({ semanticRole }) => semanticRole === 'source')?.slotId;
  }
  return semantics.find(({ semanticRole }) => (
    semanticRole === 'reference'
    || semanticRole === 'general_reference'
  ))?.slotId ?? semantics.find(({ semanticRole }) => semanticRole !== 'source')?.slotId;
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
    : 'image.text_to_image';
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
