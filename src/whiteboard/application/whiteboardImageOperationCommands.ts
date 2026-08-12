import { createBlockRecord, touchBoard } from '../../core/blockFactory';
import { compatibleInputSlotIdsFor } from '../../core/capabilities';
import type { CompiledCreativeRequest } from '../../core/creativeRequestCompiler';
import {
  currentExecutionProviderSettings,
  resolveExecutionConnectionPreference,
} from '../../core/executionProviderPreferences';
import { blockLockedByGroup } from '../../core/grouping';
import { createId, nowIso } from '../../core/id';
import {
  createImageComposerDraft,
  type ImageComposerReference,
} from '../../core/imageComposer';
import { imageGenerateCapabilityId } from '../../core/imageGenerateContracts';
import { imageBranchDraftSelectionBlockIds } from '../../core/imageOperationLayout';
import {
  createDraftImageToImageOperation,
  createDraftTextToImageOperation,
  displaySlotSizeForGenerationParams,
  type ImageCodexOperation,
  type ImageGenerationParams,
  type SwitchableOperationMode,
} from '../../core/imageOperations';
import {
  normalizeStoryboardSheetGenerationParameters,
  storyboardSheetCapabilityId,
} from '../../core/storyboardSheetContracts';
import type { BlockRecord, BoardSnapshot } from '../../core/types';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';
import {
  applyWhiteboardImageComposerLayout,
  imageComposerWorkflowLayoutBlockIds,
} from './whiteboardImageComposerLayout';

export interface WhiteboardImageDraftPresentationV1 {
  operationTitle: string;
  placementCenter?: { x: number; y: number };
  promptBody?: string;
  promptPlaceholder?: string;
  promptTitle: string;
}

export interface WhiteboardImageDraftResultV1 {
  blockIds: string[];
  operationBlockId: string;
  referenceEdgeIds: string[];
}

export interface WhiteboardImageOperationCommandsV1 {
  createImageToImageDraft(input: {
    blankSource?: {
      data: BlockRecord['data'];
      placementCenter: { x: number; y: number };
    };
    operation: Exclude<ImageCodexOperation, 'annotation_edit' | 'generate_image'>;
    presentation: WhiteboardImageDraftPresentationV1;
    sourceBlockId?: string;
  }): Promise<WhiteboardImageDraftResultV1>;
  createTextToImageDraft(input: {
    capabilityId?: typeof imageGenerateCapabilityId;
    connectionId?: string;
    creativeRequest?: CompiledCreativeRequest;
    generationParams?: ImageGenerationParams;
    instruction?: string;
    presentation: WhiteboardImageDraftPresentationV1;
    referenceBlockIds?: string[];
    references?: ImageComposerReference[];
    slotBlockId?: string;
  }): Promise<WhiteboardImageDraftResultV1>;
  updateCapability(input: {
    blockId: string;
    operation: SwitchableOperationMode;
    title: string;
  }): Promise<{ committed: boolean; updated: boolean }>;
  updateConnection(input: {
    blockId: string;
    connectionId: string;
  }): Promise<{ committed: boolean; updated: boolean }>;
  updateGenerationParams(input: {
    blockId: string;
    generationParams: ImageGenerationParams;
  }): Promise<{ committed: boolean; updated: boolean }>;
  updateGenerationProfile(input: {
    blockId: string;
    generationProfileId: string;
  }): Promise<{ committed: boolean; updated: boolean }>;
}

export function createWhiteboardImageOperationCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardImageOperationCommandsV1 {
  return Object.freeze({
    async createImageToImageDraft(
      input: Parameters<WhiteboardImageOperationCommandsV1['createImageToImageDraft']>[0],
    ) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const sourceBlock = input.sourceBlockId
          ? requireImageBlock(snapshot, input.sourceBlockId)
          : createBlankSource(snapshot, input.blankSource);
        const result = createDraftImageToImageOperation(snapshot, {
          operation: input.operation,
          operationTitle: input.presentation.operationTitle,
          sourceBlockId: sourceBlock.blockId,
          textBlockBody: input.presentation.promptBody?.trim() ?? '',
          textBlockPlaceholder: input.presentation.promptPlaceholder,
          textBlockTitle: input.presentation.promptTitle,
        });
        result.operationBlock.data.connectionId = preferredImageConnection(snapshot);
        const layoutInput = {
          operationBlockId: result.operationBlock.blockId,
          referenceBlockIds: [sourceBlock.blockId],
          textBlockId: result.textBlock.blockId,
        };
        if (input.presentation.placementCenter) {
          applyWhiteboardImageComposerLayout(
            snapshot,
            layoutInput,
            input.presentation.placementCenter,
          );
        }
        touchBoard(snapshot);
        return {
          blockIds: input.presentation.placementCenter
            ? imageComposerWorkflowLayoutBlockIds(layoutInput)
            : imageBranchDraftSelectionBlockIds(
                sourceBlock,
                result.textBlock,
                result.operationBlock,
              ),
          operationBlockId: result.operationBlock.blockId,
          referenceEdgeIds: [],
        };
      });
      return transaction.result;
    },
    async createTextToImageDraft(
      input: Parameters<WhiteboardImageOperationCommandsV1['createTextToImageDraft']>[0],
    ) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const connectionId = input.connectionId ?? preferredImageConnection(snapshot);
        const result = input.instruction === undefined
          ? {
              ...createDraftTextToImageOperation(snapshot, {
                capabilityId: input.capabilityId,
                generationParams: input.generationParams,
                operationTitle: input.presentation.operationTitle,
                slotBlockId: input.slotBlockId,
                textBlockBody: input.presentation.promptBody ?? '',
                textBlockPlaceholder: input.presentation.promptPlaceholder,
                textBlockTitle: input.presentation.promptTitle,
              }),
              referenceBlockIds: [] as string[],
            }
          : createImageComposerDraft(snapshot, {
              capabilityId: input.capabilityId,
              connectionId,
              creativeRequest: input.creativeRequest,
              generationParams: input.generationParams,
              instruction: input.instruction,
              operationTitle: input.presentation.operationTitle,
              references: input.references ?? [],
              slotBlockId: input.slotBlockId,
              textBlockPlaceholder: input.presentation.promptPlaceholder,
              textBlockTitle: input.presentation.promptTitle,
            });
        result.operationBlock.data.connectionId = connectionId;
        if (input.slotBlockId) {
          ensureOutputSlotEdge(snapshot, result.operationBlock.blockId, input.slotBlockId);
        }
        const referenceEdgeIds = addReferenceBlockEdges(
          snapshot,
          result.operationBlock.blockId,
          input.referenceBlockIds ?? [],
        );
        const referenceBlockIds = uniqueIds([
          ...result.referenceBlockIds,
          ...(input.referenceBlockIds ?? []),
        ]);
        const layoutInput = {
          operationBlockId: result.operationBlock.blockId,
          outputSlotBlockId: input.slotBlockId,
          referenceBlockIds,
          textBlockId: result.textBlock.blockId,
        };
        if (!input.slotBlockId && input.presentation.placementCenter) {
          applyWhiteboardImageComposerLayout(
            snapshot,
            layoutInput,
            input.presentation.placementCenter,
          );
        }
        touchBoard(snapshot);
        return {
          blockIds: imageComposerWorkflowLayoutBlockIds(layoutInput),
          operationBlockId: result.operationBlock.blockId,
          referenceEdgeIds,
        };
      });
      return transaction.result;
    },
    updateCapability(input: Parameters<WhiteboardImageOperationCommandsV1['updateCapability']>[0]) {
      return updateOperation(transactions, input.blockId, (snapshot, operationBlock) => {
        operationBlock.data = {
          ...operationBlock.data,
          title: input.title,
          capabilityId: imageGenerateCapabilityId,
          operationMode: undefined,
          operationVariant: undefined,
        };
        for (const edge of snapshot.edges) {
          if (edge.targetBlockId !== operationBlock.blockId || edge.kind !== 'execution_input') continue;
          const sourceBlock = snapshot.blocks.find((block) => block.blockId === edge.sourceBlockId);
          if (!sourceBlock) continue;
          const supportedSlotIds = compatibleInputSlotIdsFor(sourceBlock, operationBlock);
          if (!edge.inputSlotId || !supportedSlotIds.includes(edge.inputSlotId)) {
            delete edge.inputSlotId;
            delete edge.referenceIntent;
          }
        }
      });
    },
    updateConnection(input: Parameters<WhiteboardImageOperationCommandsV1['updateConnection']>[0]) {
      return updateOperation(transactions, input.blockId, (_snapshot, operationBlock) => {
        operationBlock.data = { ...operationBlock.data, connectionId: input.connectionId };
      });
    },
    updateGenerationParams(
      input: Parameters<WhiteboardImageOperationCommandsV1['updateGenerationParams']>[0],
    ) {
      return updateOperation(transactions, input.blockId, (snapshot, operationBlock) => {
        if (operationBlock.data.capabilityId === storyboardSheetCapabilityId) {
          const currentParameters = operationBlock.data.storyboardSheetParameters;
          const parameters = normalizeStoryboardSheetGenerationParameters({
            ...(isRecord(currentParameters) ? currentParameters : {}),
            outputCount: input.generationParams.variationCount,
          });
          operationBlock.data = {
            ...operationBlock.data,
            storyboardSheetParameters: parameters,
            workflowParameters: parameters,
            generationParams: {
              aspectRatioPreset: '16:9',
              variationCount: parameters.outputCount,
              storyboardSheet: parameters,
            },
          };
        } else {
          operationBlock.data = {
            ...operationBlock.data,
            generationParams: structuredClone(input.generationParams),
          };
        }
        resizeEmptyOperationOutputSlots(
          snapshot,
          operationBlock,
          operationBlock.data.generationParams as ImageGenerationParams,
        );
      });
    },
    updateGenerationProfile(
      input: Parameters<WhiteboardImageOperationCommandsV1['updateGenerationProfile']>[0],
    ) {
      return updateOperation(transactions, input.blockId, (_snapshot, operationBlock) => {
        operationBlock.data = {
          ...operationBlock.data,
          generationProfileId: input.generationProfileId,
        };
      });
    },
  });
}

async function updateOperation(
  transactions: WhiteboardCanvasHostBridge,
  blockId: string,
  update: (snapshot: BoardSnapshot, operationBlock: BlockRecord) => void,
): Promise<{ committed: boolean; updated: boolean }> {
  const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
    const operationBlock = snapshot.blocks.find(
      (block) => block.blockId === blockId && block.type === 'operation',
    );
    if (!operationBlock || blockLockedByGroup(snapshot, blockId)) {
      return { changed: false, result: { updated: false } };
    }
    update(snapshot, operationBlock);
    operationBlock.updatedAt = nowIso();
    touchBoard(snapshot);
    return { changed: true, result: { updated: true } };
  });
  return { ...transaction.result, committed: transaction.committed };
}

function createBlankSource(
  snapshot: BoardSnapshot,
  input: Parameters<WhiteboardImageOperationCommandsV1['createImageToImageDraft']>[0]['blankSource'],
): BlockRecord {
  if (!input) throw new Error('Image operation requires a source Image Block.');
  const block = createBlockRecord(snapshot, 'image');
  block.position = {
    x: input.placementCenter.x - block.size.width / 2,
    y: input.placementCenter.y - block.size.height / 2,
  };
  block.data = { ...block.data, ...structuredClone(input.data) };
  snapshot.blocks.push(block);
  return block;
}

function requireImageBlock(snapshot: BoardSnapshot, blockId: string): BlockRecord {
  const block = snapshot.blocks.find(
    (candidate) => candidate.blockId === blockId && candidate.type === 'image',
  );
  if (!block) throw new Error(`Image operation source Block not found: ${blockId}`);
  if (blockLockedByGroup(snapshot, block.blockId)) {
    throw new Error(`Image operation source Block is locked by its Group: ${blockId}`);
  }
  return block;
}

function addReferenceBlockEdges(
  snapshot: BoardSnapshot,
  operationBlockId: string,
  referenceBlockIds: readonly string[],
): string[] {
  const edgeIds: string[] = [];
  for (const blockId of uniqueIds(referenceBlockIds)) {
    requireImageBlock(snapshot, blockId);
    const edgeId = createId('edge');
    snapshot.edges.push({
      edgeId,
      inputSlotId: 'references',
      kind: 'execution_input',
      sourceBlockId: blockId,
      targetBlockId: operationBlockId,
    });
    edgeIds.push(edgeId);
  }
  return edgeIds;
}

function ensureOutputSlotEdge(
  snapshot: BoardSnapshot,
  operationBlockId: string,
  outputSlotBlockId: string,
): void {
  const existing = snapshot.edges.some((edge) => (
    edge.kind === 'execution_output'
    && edge.sourceBlockId === operationBlockId
    && edge.targetBlockId === outputSlotBlockId
  ));
  if (existing) return;
  snapshot.edges.push({
    edgeId: createId('edge'),
    kind: 'execution_output',
    sourceBlockId: operationBlockId,
    targetBlockId: outputSlotBlockId,
  });
}

function preferredImageConnection(snapshot: BoardSnapshot): string {
  const settings = currentExecutionProviderSettings();
  const preference = resolveExecutionConnectionPreference({
    capabilityId: imageGenerateCapabilityId,
    initialConnectionId: 'codex-app-server',
    projectId: snapshot.project.projectId,
    settings,
    useCase: 'image',
  });
  if (preference.isUsable || !settings) {
    return preference.connectionId ?? 'codex-app-server';
  }
  return settings.connections.find((connection) => (
    connection.enabled
    && connection.status === 'ready'
    && connection.enabledUseCases.includes('image')
    && connection.supportedCapabilityIds.includes(imageGenerateCapabilityId)
  ))?.connectionId ?? 'codex-app-server';
}

function resizeEmptyOperationOutputSlots(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  generationParams: ImageGenerationParams,
): void {
  const outputBlockIds = new Set(snapshot.edges.flatMap((edge) => (
    edge.sourceBlockId === operationBlock.blockId && edge.kind === 'execution_output'
      ? [edge.targetBlockId]
      : []
  )));
  const updatedAt = nowIso();
  for (const outputBlock of snapshot.blocks) {
    if (
      !outputBlockIds.has(outputBlock.blockId)
      || outputBlock.type !== 'image'
      || outputBlock.data.assetId
    ) continue;
    outputBlock.size = displaySlotSizeForGenerationParams(generationParams, outputBlock.size);
    outputBlock.updatedAt = updatedAt;
  }
}

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids)];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
