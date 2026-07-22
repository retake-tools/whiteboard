import { useEffect, useState, type RefObject } from 'react';
import type { ReferenceImageOption } from '../components/InputReferencePicker';
import { getAssetPreviewUrl } from '../core/assetStore';
import { localizedBlockData } from '../core/blockLocalization';
import { createBlockRecord, touchBoard } from '../core/blockFactory';
import {
  disabledExecutionInputRolesFor,
  executionInputRoleOptionsFor,
  nextRequiredInputSlotId,
  operationReadinessFor,
  operationReadinessMessageKey,
} from '../core/capabilities';
import { blockLockedByGroup, expandGroupToContents } from '../core/grouping';
import { imageOperationDefaultPrompt } from '../core/imageOperationText';
import type {
  ImageGenerationParams,
  SwitchableOperationMode,
} from '../core/imageOperations';
import { createId, nowIso } from '../core/id';
import { executionConnection } from '../core/executionProviderPreferences';
import { skillUiDefinitionFor, skillsForCapability } from '../core/skillRegistry';
import type {
  BlockRecord,
  BlockType,
  BoardSnapshot,
  ExecutionInputRole,
} from '../core/types';
import type { OperationToast } from '../components/OperationFeedback';
import type { useI18n } from '../i18n';
import {
  operationAllowsInputType,
  operationModeFromBlock,
} from './appHelpers';

interface InputReferencePickerState {
  anchor: { x: number; y: number };
  body: string;
  cursorIndex: number;
  operationBlockId: string;
  sourceBlockId?: string;
  textBlockId: string;
}

interface OperationInputControllerOptions {
  copyQueuedOperationPrompt: (block: BlockRecord) => Promise<void>;
  refreshQueuedOperationPrompt: (block: BlockRecord) => Promise<void>;
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  startExistingOperationBlock: (input: {
    block: BlockRecord;
    operation: SwitchableOperationMode;
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
      const ui = skillUiDefinitionFor(operationBlock.data.skillId);
      const slotId = nextRequiredInputSlotId(snapshotRef.current, operationBlock);
      const slot = ui.inputSlots?.find((candidate) => candidate.slotId === slotId);
      return t(slot?.placeholderKey ?? ui.placeholderKey);
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
          ? skillUiDefinitionFor(operationBlock.data.skillId)
          : undefined;
        const slotUi = skillUi?.inputSlots?.find((candidate) => candidate.slotId === slotId);
        block.data.title = slotUi ? t(slotUi.inputKey) : t('operationToolbar.prompt');
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

  function updateOperationInputRole(edgeId: string, inputRole: ExecutionInputRole): void {
    let operationBlockId = '';
    const nextSnapshot = updateSnapshot((current) => {
      const edge = current.edges.find(
        (candidate) => candidate.edgeId === edgeId && candidate.kind === 'execution_input',
      );
      if (!edge) return current;
      const sourceBlock = current.blocks.find((block) => block.blockId === edge.sourceBlockId);
      const operationBlock = current.blocks.find(
        (block) =>
          block.blockId === edge.targetBlockId &&
          (block.type === 'operation' || block.type === 'video'),
      );
      if (!sourceBlock || !operationBlock || blockLockedByGroup(current, sourceBlock.blockId) || blockLockedByGroup(current, operationBlock.blockId)) return current;
      const supportedRoles = executionInputRoleOptionsFor(sourceBlock, operationBlock);
      if (!supportedRoles.includes(inputRole)) return current;
      const disabledRoles = disabledExecutionInputRolesFor(current, sourceBlock, operationBlock, edge.edgeId);
      if (disabledRoles.includes(inputRole) && edge.inputRole !== inputRole) return current;
      operationBlockId = operationBlock.blockId;
      edge.inputRole = inputRole;
      return touchBoard(current);
    }, { persist: true, history: true });
    if (operationBlockId) setSelectedBlock(nextSnapshot, operationBlockId);
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

  function completeInputReferenceMention(inputRole: ExecutionInputRole): void {
    const picker = inputReferencePicker;
    if (!picker?.sourceBlockId) return;
    let selectedOperationId = '';
    const nextSnapshot = updateSnapshot((current) => {
      const sourceBlock = current.blocks.find((block) => block.blockId === picker.sourceBlockId && block.type === 'image' && block.data.assetId);
      const textBlock = current.blocks.find((block) => block.blockId === picker.textBlockId && block.type === 'text');
      const operationBlock = current.blocks.find((block) => block.blockId === picker.operationBlockId && block.type === 'operation');
      if (!sourceBlock || !textBlock || !operationBlock || blockLockedByGroup(current, textBlock.blockId) || blockLockedByGroup(current, operationBlock.blockId)) return current;
      const supportedRoles = executionInputRoleOptionsFor(sourceBlock, operationBlock);
      if (!supportedRoles.includes(inputRole)) return current;
      let inputEdge = current.edges.find((edge) => edge.sourceBlockId === sourceBlock.blockId && edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input');
      const disabledRoles = disabledExecutionInputRolesFor(current, sourceBlock, operationBlock, inputEdge?.edgeId);
      if (disabledRoles.includes(inputRole) && inputEdge?.inputRole !== inputRole) return current;
      if (inputEdge) inputEdge.inputRole = inputRole;
      else {
        inputEdge = { edgeId: createId('edge'), sourceBlockId: sourceBlock.blockId, targetBlockId: operationBlock.blockId, kind: 'execution_input', inputRole };
        current.edges.push(inputEdge);
      }
      const imageTitle = sourceBlock.data.title.trim() || t('block.image.title');
      const mentionStart = Math.max(0, picker.cursorIndex - 1);
      const afterMention = picker.body.slice(picker.cursorIndex);
      const separator = afterMention.length > 0 && !/^\s/.test(afterMention) ? ' ' : '';
      textBlock.data.body = `${picker.body.slice(0, mentionStart)}@${imageTitle}${separator}${afterMention}`;
      textBlock.updatedAt = nowIso();
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
        textBlockId: detail.textBlockId,
      });
    }
    window.addEventListener('retake:request-image-mention', onRequestImageMention);
    return () => window.removeEventListener('retake:request-image-mention', onRequestImageMention);
  }, []);

  async function runOperation(blockId: string, queuedConfigurationStale = false): Promise<void> {
    const block = snapshotRef.current.blocks.find((candidate) => candidate.blockId === blockId && candidate.type === 'operation');
    if (!block || blockLockedByGroup(snapshotRef.current, block.blockId) || block.data.status === 'running') return;
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
      await startExistingOperationBlock({ block, operation: operationModeFromBlock(block) });
    }
  }

  useEffect(() => {
    function onRunOperation(event: Event): void {
      const detail = (event as CustomEvent<{ blockId?: string; queuedConfigurationStale?: boolean }>).detail;
      if (!detail?.blockId) return;
      void runOperation(detail.blockId, detail.queuedConfigurationStale);
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
    function onUpdateRole(event: Event): void {
      const detail = (event as CustomEvent<{ edgeId?: string; inputRole?: ExecutionInputRole }>).detail;
      if (detail?.edgeId && detail.inputRole) updateOperationInputRole(detail.edgeId, detail.inputRole);
    }
    function onRemoveInput(event: Event): void {
      const detail = (event as CustomEvent<{ edgeId?: string }>).detail;
      if (detail?.edgeId) removeOperationInput(detail.edgeId);
    }
    window.addEventListener('retake:update-operation-generation-params', onUpdateParams);
    window.addEventListener('retake:update-operation-generation-profile', onUpdateProfile);
    window.addEventListener('retake:update-operation-connection', onUpdateConnection);
    window.addEventListener('retake:update-operation-skill', onUpdateSkill);
    window.addEventListener('retake:update-operation-capability', onUpdateCapability);
    window.addEventListener('retake:update-operation-input-role', onUpdateRole);
    window.addEventListener('retake:remove-operation-input', onRemoveInput);
    return () => {
      window.removeEventListener('retake:update-operation-generation-params', onUpdateParams);
      window.removeEventListener('retake:update-operation-generation-profile', onUpdateProfile);
      window.removeEventListener('retake:update-operation-connection', onUpdateConnection);
      window.removeEventListener('retake:update-operation-skill', onUpdateSkill);
      window.removeEventListener('retake:update-operation-capability', onUpdateCapability);
      window.removeEventListener('retake:update-operation-input-role', onUpdateRole);
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
  const mentionRoleOptions = mentionOperation && mentionSourceBlock
    ? executionInputRoleOptionsFor(mentionSourceBlock, mentionOperation)
    : [];
  const mentionExistingEdge = mentionOperation && mentionSourceBlock
    ? snapshot.edges.find((edge) => edge.sourceBlockId === mentionSourceBlock.blockId && edge.targetBlockId === mentionOperation.blockId && edge.kind === 'execution_input')
    : undefined;
  const mentionDisabledRoles = mentionOperation && mentionSourceBlock
    ? disabledExecutionInputRolesFor(snapshot, mentionSourceBlock, mentionOperation, mentionExistingEdge?.edgeId)
    : [];

  return {
    addOperationInputBlock,
    completeInputReferenceMention,
    inputReferencePicker,
    mentionDisabledRoles,
    mentionRoleOptions,
    referenceImageOptions,
    selectedReferenceImage,
    setInputReferencePicker,
    runOperation,
  };
}
