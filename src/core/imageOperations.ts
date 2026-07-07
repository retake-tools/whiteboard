import { createId, nowIso } from './id';
import type { AssetRecord, BlockRecord, BoardHistoryEvent, BoardSnapshot, ExecutionRecord } from './types';
import { maxZIndex, touchBoard } from './blockFactory';
import { createImageOperationPrompt } from './prompts';

export type ImageCodexOperation = 'generate_image' | 'create_similar' | 'quick_edit' | 'annotation_edit';

export interface ImageGenerationParams {
  aspectRatioPreset?: string;
  targetAspectRatio?: number;
  targetResolution?: string;
  targetWidth?: number;
  targetHeight?: number;
}

interface ImageCodexOperationInput {
  operation: ImageCodexOperation;
  sourceBlockId: string;
  instruction?: string;
  taskTitle?: string;
  waitingBody?: string;
  defaultPrompt?: string;
  annotatedCompositeAsset?: AssetRecord;
  generationParams?: ImageGenerationParams;
  referenceAssets?: AssetRecord[];
}

export interface ImageCodexOperationResult {
  execution: ExecutionRecord;
  resultBlock: BlockRecord;
  prompt: string;
}

export function addImageCodexOperation(
  snapshot: BoardSnapshot,
  input: ImageCodexOperationInput,
): ImageCodexOperationResult {
  const sourceBlock = snapshot.blocks.find((block) => block.blockId === input.sourceBlockId);
  if (!sourceBlock || sourceBlock.type !== 'image') {
    throw new Error('Image operation requires a selected image block.');
  }

  const executionId = createId('exec');
  const createdAt = nowIso();
  const capabilityId = capabilityForOperation(input.operation);
  const title = input.taskTitle ?? titleForOperation(input.operation);
  const instruction = input.instruction?.trim();
  if (
    input.annotatedCompositeAsset &&
    !snapshot.assets.some((asset) => asset.assetId === input.annotatedCompositeAsset?.assetId)
  ) {
    snapshot.assets.unshift(input.annotatedCompositeAsset);
  }
  for (const referenceAsset of input.referenceAssets ?? []) {
    if (!snapshot.assets.some((asset) => asset.assetId === referenceAsset.assetId)) {
      snapshot.assets.unshift(referenceAsset);
    }
  }
  const referenceAssetIds = input.referenceAssets?.map((asset) => asset.assetId) ?? [];

  const resultBlock: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'image',
    layerId: 'layer_default',
    position: {
      x: sourceBlock.position.x + sourceBlock.size.width + 90,
      y: sourceBlock.position.y,
    },
    size: { ...sourceBlock.size },
    zIndex: maxZIndex(snapshot.blocks) + 1,
    data: {
      title,
      body: instruction || input.waitingBody || 'Waiting for Codex to generate an image result.',
      status: 'queued',
      capabilityId,
      sourceBlockId: sourceBlock.blockId,
      sourceAssetId: sourceBlock.data.assetId,
      annotationMode: input.operation === 'annotation_edit' ? 'composite_image' : undefined,
      annotationText: input.operation === 'annotation_edit' ? instruction : undefined,
      annotatedCompositeAssetId:
        input.operation === 'annotation_edit' ? input.annotatedCompositeAsset?.assetId : undefined,
      generationParams: input.operation === 'generate_image' ? input.generationParams : undefined,
      referenceAssetIds: referenceAssetIds.length ? referenceAssetIds : undefined,
      sourceExecutionId: executionId,
    },
    createdAt,
    updatedAt: createdAt,
  };

  const execution: ExecutionRecord = {
    executionId,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId,
    adapter: 'mcp_agent',
    status: 'queued',
    inputBlockIds: [sourceBlock.blockId],
    inputAssetIds: [
      sourceBlock.data.assetId,
      input.annotatedCompositeAsset?.assetId,
      ...referenceAssetIds,
    ].filter((assetId): assetId is string => typeof assetId === 'string'),
    outputBlockIds: [resultBlock.blockId],
    outputAssetIds: [],
    agentHost: 'codex',
    triggerMode: 'manual_agent_session',
    skillId: skillForOperation(input.operation),
    prompt: instruction || input.defaultPrompt || title,
    params: {
      ...(input.generationParams ? { generation: input.generationParams } : {}),
      ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
    },
    startedAt: createdAt,
  };

  snapshot.blocks.push(resultBlock);
  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId: sourceBlock.blockId,
    targetBlockId: resultBlock.blockId,
    kind: 'derived_from',
  });
  snapshot.executions.unshift(execution);
  const prompt = createImageOperationPrompt(snapshot, sourceBlock, resultBlock, execution);
  execution.agentPrompt = prompt;
  resultBlock.data.agentPrompt = prompt;
  const historyEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'operation_created',
    createdAt,
    actor: 'user',
    executionId,
    blockIds: [sourceBlock.blockId, resultBlock.blockId],
    assetIds: [
      sourceBlock.data.assetId,
      input.annotatedCompositeAsset?.assetId,
      ...referenceAssetIds,
    ].filter((assetId): assetId is string => typeof assetId === 'string'),
    summary: title,
    detail: {
      capabilityId,
      instruction,
      prompt,
      generationParams: input.generationParams,
      referenceAssetIds,
      resultBlockId: resultBlock.blockId,
      sourceBlockId: sourceBlock.blockId,
    },
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);

  return {
    execution,
    resultBlock,
    prompt,
  };
}

function capabilityForOperation(operation: ImageCodexOperation): string {
  if (operation === 'generate_image') return 'image.generate';
  if (operation === 'annotation_edit') return 'image.annotation_edit';
  if (operation === 'quick_edit') return 'image.edit';
  return 'image.generate.similar';
}

function skillForOperation(operation: ImageCodexOperation): string {
  if (operation === 'generate_image') return 'image.general_concept';
  if (operation === 'annotation_edit') return 'image.annotation_edit';
  if (operation === 'quick_edit') return 'image.quick_edit';
  return 'image.create_similar';
}

function titleForOperation(operation: ImageCodexOperation): string {
  if (operation === 'generate_image') return 'Generate image';
  if (operation === 'annotation_edit') return 'Annotation Edit';
  if (operation === 'quick_edit') return 'Quick edit image';
  return 'Create similar image';
}
