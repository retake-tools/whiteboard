import { touchBoard } from '../../core/blockFactory';
import { createBlockRecord } from '../../core/blockFactory';
import {
  compatibleInputSlotIdsFor,
  disabledInputSlotIdsFor,
  nextRequiredInputSlotId,
  schemaForCapability,
} from '../../core/capabilities';
import { capabilityDefinitionFor } from '../../core/capabilityRegistry';
import {
  domainVideoGenerationCapabilityId,
  normalizeDomainVideoGenerationParameters,
} from '../../core/domainVideoGenerationContracts';
import { blockLockedByGroup, expandGroupToContents } from '../../core/grouping';
import { createId, nowIso } from '../../core/id';
import { suggestedExecutionInputSlotId } from '../../core/operationInputSlots';
import {
  createReferenceIntent,
  type ComposerImageReferenceSetting,
} from '../../core/referenceIntent';
import { skillsForCapability } from '../../core/skillRegistry';
import type {
  BlockData,
  BlockRecord,
  BlockType,
  BoardSnapshot,
} from '../../core/types';
import type { CanvasHostScopeV1 } from '../../host-kit';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

type InputBlockType = Extract<BlockType, 'image' | 'text' | 'video'>;

export interface WhiteboardOperationInputCommandsV1 {
  addBlock(input: {
    blockData: BlockData;
    expectedScope: CanvasHostScopeV1;
    operationBlockId: string;
    type: InputBlockType;
  }): Promise<{ blockId?: string; committed: boolean }>;
  bindImageReference(input: {
    body?: string;
    cursorIndex?: number;
    edgeId?: string;
    expectedScope: CanvasHostScopeV1;
    fallbackImageTitle: string;
    inputSlotId?: string;
    operationBlockId: string;
    setting: ComposerImageReferenceSetting;
    sourceBlockId: string;
    textBlockId?: string;
  }): Promise<{ committed: boolean; operationBlockId?: string }>;
  updateDomainVideoParameters(input: {
    blockId: string;
    expectedScope: CanvasHostScopeV1;
    parameters: Record<string, unknown>;
  }): Promise<{ committed: boolean; updated: boolean }>;
  updateSkill(input: {
    blockId: string;
    expectedScope: CanvasHostScopeV1;
    skillId: string;
  }): Promise<{ committed: boolean; updated: boolean }>;
}

export function createWhiteboardOperationInputCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardOperationInputCommandsV1 {
  return Object.freeze({
    async addBlock(input: Parameters<WhiteboardOperationInputCommandsV1['addBlock']>[0]) {
      const transaction = await transactions.executeConditionalProductTransaction<{
        blockId?: string;
      }>((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        const operationBlock = snapshot.blocks.find(
          (block) => block.blockId === input.operationBlockId && block.type === 'operation',
        );
        if (
          !operationBlock
          || blockLockedByGroup(snapshot, operationBlock.blockId)
          || !operationAllowsInputType(operationBlock, input.type)
        ) return { changed: false, result: {} };
        const block = createBlockRecord(snapshot, input.type);
        block.position = operationInputBlockPosition(snapshot, operationBlock, block.size);
        block.parentGroupId = operationBlock.parentGroupId;
        block.data = { ...block.data, ...structuredClone(input.blockData) };
        const inputSlotId = input.type === 'text'
          ? nextRequiredInputSlotId(snapshot, operationBlock)
            ?? suggestedExecutionInputSlotId(snapshot, block, operationBlock)
          : undefined;
        snapshot.blocks.push(block);
        if (operationBlock.parentGroupId) {
          expandGroupToContents(snapshot, operationBlock.parentGroupId);
        }
        snapshot.edges.push({
          edgeId: createId('edge'),
          inputSlotId,
          kind: 'execution_input',
          sourceBlockId: block.blockId,
          targetBlockId: operationBlock.blockId,
        });
        touchBoard(snapshot);
        return { changed: true, result: { blockId: block.blockId } };
      });
      return { ...transaction.result, committed: transaction.committed };
    },

    async bindImageReference(
      input: Parameters<WhiteboardOperationInputCommandsV1['bindImageReference']>[0],
    ) {
      const transaction = await transactions.executeConditionalProductTransaction<{
        operationBlockId?: string;
      }>((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        const sourceBlock = snapshot.blocks.find(
          (block) => block.blockId === input.sourceBlockId
            && block.type === 'image'
            && block.data.assetId,
        );
        const operationBlock = snapshot.blocks.find(
          (block) => block.blockId === input.operationBlockId && block.type === 'operation',
        );
        const textBlock = input.textBlockId
          ? snapshot.blocks.find(
              (block) => block.blockId === input.textBlockId && block.type === 'text',
            )
          : undefined;
        if (
          !sourceBlock
          || !operationBlock
          || (textBlock && blockLockedByGroup(snapshot, textBlock.blockId))
          || blockLockedByGroup(snapshot, operationBlock.blockId)
        ) return { changed: false, result: {} };
        let inputEdge = input.edgeId
          ? snapshot.edges.find((edge) => (
              edge.edgeId === input.edgeId
              && edge.kind === 'execution_input'
              && edge.sourceBlockId === sourceBlock.blockId
              && edge.targetBlockId === operationBlock.blockId
            ))
          : snapshot.edges.find((edge) => (
              edge.sourceBlockId === sourceBlock.blockId
              && edge.targetBlockId === operationBlock.blockId
              && edge.kind === 'execution_input'
            ));
        const compatibleSlots = compatibleInputSlotIdsFor(sourceBlock, operationBlock);
        const disabledSlots = disabledInputSlotIdsFor(
          snapshot,
          sourceBlock,
          operationBlock,
          inputEdge?.edgeId,
        );
        const inputSlotId = inputSlotIdForReferenceSetting(
          operationBlock,
          compatibleSlots.filter((slotId) => !disabledSlots.includes(slotId)),
          input.setting,
          input.inputSlotId,
        );
        if (!inputSlotId) return { changed: false, result: {} };
        if (inputEdge) {
          inputEdge.inputSlotId = inputSlotId;
        } else {
          inputEdge = {
            edgeId: createId('edge'),
            inputSlotId,
            kind: 'execution_input',
            sourceBlockId: sourceBlock.blockId,
            targetBlockId: operationBlock.blockId,
          };
          snapshot.edges.push(inputEdge);
        }
        const referenceIntent = input.setting.mode === 'source'
          ? undefined
          : createReferenceIntent(input.setting.instruction, 'user');
        if (referenceIntent) inputEdge.referenceIntent = referenceIntent;
        else delete inputEdge.referenceIntent;
        if (
          textBlock
          && typeof input.body === 'string'
          && typeof input.cursorIndex === 'number'
        ) {
          const imageTitle = sourceBlock.data.title.trim() || input.fallbackImageTitle;
          const mentionStart = Math.max(0, input.cursorIndex - 1);
          const afterMention = input.body.slice(input.cursorIndex);
          const separator = afterMention.length > 0 && !/^\s/.test(afterMention) ? ' ' : '';
          textBlock.data.body = `${input.body.slice(0, mentionStart)}@${imageTitle}${separator}${afterMention}`;
          textBlock.updatedAt = nowIso();
        }
        touchBoard(snapshot);
        return { changed: true, result: { operationBlockId: operationBlock.blockId } };
      });
      return { ...transaction.result, committed: transaction.committed };
    },

    async updateDomainVideoParameters(
      input: Parameters<WhiteboardOperationInputCommandsV1['updateDomainVideoParameters']>[0],
    ) {
      return updateOperation(transactions, input.expectedScope, input.blockId, (operation) => {
        if (operation.data.capabilityId !== domainVideoGenerationCapabilityId) return false;
        const parameters = normalizeDomainVideoGenerationParameters(input.parameters);
        operation.data.domainVideoGenerationParameters = parameters;
        operation.data.workflowParameters = parameters;
        return true;
      });
    },

    async updateSkill(input: Parameters<WhiteboardOperationInputCommandsV1['updateSkill']>[0]) {
      return updateOperation(transactions, input.expectedScope, input.blockId, (operation) => {
        const capabilityId = typeof operation.data.capabilityId === 'string'
          ? operation.data.capabilityId
          : '';
        if (!skillsForCapability(capabilityId).some((skill) => skill.skillId === input.skillId)) {
          return false;
        }
        operation.data.skillId = input.skillId;
        return true;
      });
    },
  });
}

async function updateOperation(
  transactions: WhiteboardCanvasHostBridge,
  expectedScope: CanvasHostScopeV1,
  blockId: string,
  update: (operation: BlockRecord) => boolean,
): Promise<{ committed: boolean; updated: boolean }> {
  const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
    assertScope(snapshot, expectedScope);
    const operation = snapshot.blocks.find(
      (block) => block.blockId === blockId && block.type === 'operation',
    );
    if (!operation || blockLockedByGroup(snapshot, operation.blockId) || !update(operation)) {
      return { changed: false, result: { updated: false } };
    }
    operation.updatedAt = nowIso();
    touchBoard(snapshot);
    return { changed: true, result: { updated: true } };
  });
  return { ...transaction.result, committed: transaction.committed };
}

function operationInputBlockPosition(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  size: { height: number; width: number },
): { x: number; y: number } {
  const inputCount = snapshot.edges.filter(
    (edge) => edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input',
  ).length;
  return {
    x: operationBlock.position.x - size.width - 90,
    y: operationBlock.position.y + (inputCount === 0 ? 0 : inputCount * 54),
  };
}

function operationAllowsInputType(
  operationBlock: BlockRecord,
  type: InputBlockType,
): boolean {
  const capabilityId = typeof operationBlock.data.capabilityId === 'string'
    ? operationBlock.data.capabilityId
    : 'image.generate';
  try {
    const definition = capabilityDefinitionFor(capabilityId);
    const dataType = type === 'text' ? 'text' : type;
    return definition.inputSlots.some(
      (slot) => slot.bindingKinds.includes('block') && slot.dataTypes.includes(dataType),
    );
  } catch {
    return schemaForCapability(capabilityId).inputContracts.some(
      (contract) => contract.source === 'block' && contract.type === type,
    );
  }
}

export function inputSlotIdForReferenceSetting(
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
    semanticRole === 'reference' || semanticRole === 'general_reference'
  ))?.slotId ?? semantics.find(({ semanticRole }) => semanticRole !== 'source')?.slotId;
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
      semanticRole: definition.inputSlots.find((slot) => slot.slotId === slotId)?.semanticRole
        ?? slotId,
      slotId,
    }));
  } catch {
    return slotIds.map((slotId) => ({ semanticRole: slotId, slotId }));
  }
}

function assertScope(snapshot: BoardSnapshot, expected: CanvasHostScopeV1): void {
  if (
    snapshot.project.projectId !== expected.projectId
    || snapshot.board.boardId !== expected.boardId
  ) {
    throw new Error('Operation Input command scope changed before commit.');
  }
}
