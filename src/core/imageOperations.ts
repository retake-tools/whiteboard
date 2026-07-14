import { createId, nowIso } from './id';
import type {
  AssetRecord,
  BlockRecord,
  BoardHistoryEvent,
  BoardSnapshot,
  ExecutionInputRole,
  ExecutionRecord,
} from './types';
import { maxZIndex, touchBoard } from './blockFactory';
import { fitMediaBlockSize, imageResultColumnGap } from './blockSizing';
import { createExecutionResultGroup, expandGroupToContents } from './grouping';
import { createImageOperationPrompt } from './prompts';
import { recordExecutionConfiguration } from './executionConfiguration';
import { imageBlockAspectRatio } from './operationAspectRatio';
import { imageBranchDraftLayout } from './imageOperationLayout';
import {
  defaultGenerationProfileId,
  generationParameterVisible,
  generationProfileById,
  snapshotGenerationProfile,
} from './generationProfiles';
import {
  capabilityForImageOperation,
  connectedInputBlocks,
  firstTextInputBlock,
  operationInputStateForCapability,
  promptTextFromInputs,
  schemaForCapability,
} from './capabilities';

export type ImageCodexOperation = 'generate_image' | 'create_similar' | 'quick_edit' | 'annotation_edit';
export type SwitchableOperationMode = 'text_to_image' | 'image_to_image';

export interface ImageGenerationParams {
  aspectRatioPreset?: string;
  durationSeconds?: number;
  model?: string;
  motion?: string;
  strength?: number;
  targetAspectRatio?: number;
  targetResolution?: string;
  targetWidth?: number;
  targetHeight?: number;
  variationCount?: number;
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
  generationProfileId?: string;
  referenceAssets?: AssetRecord[];
}

interface ExistingOperationBlockInput {
  generationParams?: ImageGenerationParams;
  instruction: string;
  operation: SwitchableOperationMode;
  operationBlockId: string;
}

export interface ImageCodexOperationResult {
  execution: ExecutionRecord;
  operationBlock: BlockRecord;
  resultBlock: BlockRecord;
  resultBlocks: BlockRecord[];
  prompt: string;
}

interface DraftImageToImageOperationInput {
  operation: Exclude<ImageCodexOperation, 'annotation_edit' | 'generate_image'>;
  sourceBlockId: string;
  textBlockTitle: string;
  textBlockBody: string;
  textBlockPlaceholder?: string;
  operationTitle: string;
}

interface DraftTextToImageOperationInput {
  generationParams?: ImageGenerationParams;
  operationTitle: string;
  slotBlockId?: string;
  textBlockBody: string;
  textBlockPlaceholder?: string;
  textBlockTitle: string;
}

interface LocalImageOperationInput {
  body: string;
  capabilityId: 'image.local_adjust' | 'image.local_crop' | 'image.local_expand';
  params?: Record<string, unknown>;
  sourceBlockId: string;
  title: string;
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
  const sourceInputRole: ExecutionInputRole | undefined =
    input.operation === 'generate_image' ? undefined : 'source';
  const generationProfileId = input.generationProfileId ?? defaultGenerationProfileId;
  const generationParams = effectiveGenerationParams(
    generationParamsForSourceImage(
      snapshot,
      sourceBlock,
      generationParamsForTextToImage(input.generationParams, input.operation === 'generate_image'),
      input.operation !== 'generate_image',
    ),
    generationProfileId,
    capabilityId,
  );
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

  const operationBlock: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'operation',
    layerId: 'layer_default',
    parentGroupId: sourceBlock.parentGroupId,
    position: {
      x: sourceBlock.position.x + sourceBlock.size.width + 80,
      y: sourceBlock.position.y,
    },
    size: { width: 320, height: 190 },
    zIndex: maxZIndex(snapshot.blocks) + 1,
    data: {
      title,
      body: instruction || input.defaultPrompt || title,
      status: 'queued',
      adapter: 'mcp_agent',
      agentHost: 'codex',
      triggerMode: 'manual_agent_session',
      capabilityId,
      operationMode: operationModeForImageOperation(input.operation),
      operationVariant:
        input.operation !== 'generate_image' && input.operation !== 'annotation_edit' ? input.operation : undefined,
      sourceBlockId: sourceBlock.blockId,
      sourceAssetId: sourceBlock.data.assetId,
      annotationMode: input.operation === 'annotation_edit' ? 'composite_image' : undefined,
      annotationText: input.operation === 'annotation_edit' ? instruction : undefined,
      annotatedCompositeAssetId:
        input.operation === 'annotation_edit' ? input.annotatedCompositeAsset?.assetId : undefined,
      generationParams,
      generationProfileId,
      referenceAssetIds: referenceAssetIds.length ? referenceAssetIds : undefined,
      sourceExecutionId: executionId,
    },
    createdAt,
    updatedAt: createdAt,
  };

  const resultCount = variationCount(generationParams);
  const resultSize = displaySlotSizeForGenerationParams(generationParams, sourceBlock.size);
  const resultBlocks = Array.from({ length: resultCount }, (_, index): BlockRecord => ({
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'image',
    layerId: 'layer_default',
    parentGroupId: operationBlock.parentGroupId,
    position: {
      x: operationBlock.position.x + operationBlock.size.width + 80 + index * (resultSize.width + imageResultColumnGap),
      y: sourceBlock.position.y,
    },
    size: { ...resultSize },
    zIndex: operationBlock.zIndex + index + 1,
    data: {
      title: variantTitle(title, index, resultCount),
      body: instruction || input.waitingBody || 'Waiting for Codex to generate an image result.',
      status: 'queued',
      operationBlockId: operationBlock.blockId,
      resultIndex: index,
      resultCount,
      sourceExecutionId: executionId,
    },
    createdAt,
    updatedAt: createdAt,
  }));
  const resultBlock = resultBlocks[0];

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
    outputBlockIds: resultBlocks.map((block) => block.blockId),
    outputAssetIds: [],
    agentHost: 'codex',
    triggerMode: 'manual_agent_session',
    skillId: skillForOperation(input.operation),
    generationProfile: snapshotGenerationProfile(operationBlock.data.generationProfileId),
    prompt: instruction || input.defaultPrompt || title,
    params: {
      operationBlockId: operationBlock.blockId,
      ...(generationParams ? { generation: generationParams } : {}),
      ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
      ...(sourceInputRole
        ? {
            inputBindings: [
              {
                assetId: sourceBlock.data.assetId,
                blockId: sourceBlock.blockId,
                inputRole: sourceInputRole,
              },
            ],
          }
        : {}),
    },
    startedAt: createdAt,
  };

  snapshot.blocks.push(operationBlock, ...resultBlocks);
  createExecutionResultGroup(snapshot, { executionId, operationBlock, resultBlocks });
  if (operationBlock.parentGroupId) expandGroupToContents(snapshot, operationBlock.parentGroupId);
  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId: sourceBlock.blockId,
    targetBlockId: operationBlock.blockId,
    kind: 'execution_input',
    inputRole: sourceInputRole,
  });
  for (const outputBlock of resultBlocks) {
    snapshot.edges.push({
      edgeId: createId('edge'),
      sourceBlockId: operationBlock.blockId,
      targetBlockId: outputBlock.blockId,
      kind: 'execution_output',
    });
  }
  recordExecutionConfiguration(snapshot, execution, operationBlock);
  snapshot.executions.unshift(execution);
  const promptFrameBlock = input.operation === 'generate_image' ? resultBlock : sourceBlock;
  const prompt = createImageOperationPrompt(snapshot, promptFrameBlock, operationBlock, resultBlocks, execution);
  execution.agentPrompt = prompt;
  operationBlock.data.agentPrompt = prompt;
  for (const outputBlock of resultBlocks) outputBlock.data.agentPrompt = prompt;
  const historyEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'operation_created',
    createdAt,
    actor: 'user',
    executionId,
    blockIds: [sourceBlock.blockId, operationBlock.blockId, ...resultBlocks.map((block) => block.blockId)],
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
      generationParams,
      operationBlockId: operationBlock.blockId,
      referenceAssetIds,
      resultBlockIds: resultBlocks.map((block) => block.blockId),
      sourceBlockId: sourceBlock.blockId,
    },
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);

  return {
    execution,
    operationBlock,
    resultBlock,
    resultBlocks,
    prompt,
  };
}

export function createDraftImageToImageOperation(
  snapshot: BoardSnapshot,
  input: DraftImageToImageOperationInput,
): { operationBlock: BlockRecord; textBlock: BlockRecord } {
  const sourceBlock = snapshot.blocks.find((block) => block.blockId === input.sourceBlockId);
  if (!sourceBlock || sourceBlock.type !== 'image') {
    throw new Error('Image operation requires a selected image block.');
  }

  const createdAt = nowIso();
  const nextZ = maxZIndex(snapshot.blocks) + 1;
  const textSize = { width: 280, height: 140 };
  const operationSize = { width: 320, height: 190 };
  const layout = imageBranchDraftLayout(snapshot, sourceBlock, textSize, operationSize);
  const textBlock: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'text',
    layerId: 'layer_default',
    parentGroupId: layout.parentGroupId,
    position: layout.textPosition,
    size: textSize,
    zIndex: nextZ,
    data: {
      title: input.textBlockTitle,
      body: input.textBlockBody,
      placeholder: input.textBlockPlaceholder,
      promptRole: 'operation_prompt',
    },
    createdAt,
    updatedAt: createdAt,
  };
  const operationBlock: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'operation',
    layerId: 'layer_default',
    parentGroupId: layout.parentGroupId,
    position: layout.operationPosition,
    size: operationSize,
    zIndex: nextZ + 1,
    data: {
      title: input.operationTitle,
      body: input.textBlockBody,
      adapter: 'mcp_agent',
      agentHost: 'codex',
      triggerMode: 'manual_agent_session',
      capabilityId: capabilityForOperation(input.operation),
      operationMode: 'image_to_image',
      operationVariant: input.operation,
      workflowLayout: 'branch_lanes',
      sourceBlockId: sourceBlock.blockId,
      sourceAssetId: sourceBlock.data.assetId,
      promptSourceBlockId: textBlock.blockId,
      generationProfileId: defaultGenerationProfileId,
      generationParams: generationParamsForSourceImage(snapshot, sourceBlock, undefined, true),
    },
    createdAt,
    updatedAt: createdAt,
  };

  snapshot.blocks.push(textBlock, operationBlock);
  if (operationBlock.parentGroupId) expandGroupToContents(snapshot, operationBlock.parentGroupId);
  ensureEdge(snapshot, sourceBlock.blockId, operationBlock.blockId, 'execution_input', 'source');
  ensureEdge(snapshot, textBlock.blockId, operationBlock.blockId, 'execution_input');
  touchBoard(snapshot);

  return { operationBlock, textBlock };
}

export function createDraftTextToImageOperation(
  snapshot: BoardSnapshot,
  input: DraftTextToImageOperationInput,
): { operationBlock: BlockRecord; textBlock: BlockRecord } {
  const anchorBlock = input.slotBlockId
    ? snapshot.blocks.find((block) => block.blockId === input.slotBlockId)
    : undefined;

  const createdAt = nowIso();
  const nextZ = maxZIndex(snapshot.blocks) + 1;
  const textPosition = anchorBlock
    ? {
        x: anchorBlock.position.x + anchorBlock.size.width + 80,
        y: anchorBlock.position.y,
      }
    : {
        x: rightEdge(snapshot.blocks) + 160,
        y: 220,
      };
  const textBlock: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'text',
    layerId: 'layer_default',
    parentGroupId: anchorBlock?.parentGroupId,
    position: textPosition,
    size: { width: 280, height: 140 },
    zIndex: nextZ,
    data: {
      title: input.textBlockTitle,
      body: input.textBlockBody,
      placeholder: input.textBlockPlaceholder,
      promptRole: 'operation_prompt',
    },
    createdAt,
    updatedAt: createdAt,
  };
  const operationBlock: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'operation',
    layerId: 'layer_default',
    parentGroupId: anchorBlock?.parentGroupId,
    position: {
      x: textBlock.position.x + textBlock.size.width + 80,
      y: textBlock.position.y,
    },
    size: { width: 320, height: 190 },
    zIndex: nextZ + 1,
    data: {
      title: input.operationTitle,
      body: input.textBlockBody,
      adapter: 'mcp_agent',
      agentHost: 'codex',
      triggerMode: 'manual_agent_session',
      capabilityId: 'image.text_to_image',
      operationMode: 'text_to_image',
      generationParams: generationParamsForTextToImage(input.generationParams, true),
      generationProfileId: defaultGenerationProfileId,
      promptSourceBlockId: textBlock.blockId,
    },
    createdAt,
    updatedAt: createdAt,
  };
  snapshot.blocks.push(textBlock, operationBlock);
  if (operationBlock.parentGroupId) expandGroupToContents(snapshot, operationBlock.parentGroupId);
  ensureEdge(snapshot, textBlock.blockId, operationBlock.blockId, 'execution_input');
  touchBoard(snapshot);

  return { operationBlock, textBlock };
}

export function addLocalImageOperation(
  snapshot: BoardSnapshot,
  input: LocalImageOperationInput,
): { execution: ExecutionRecord; operationBlock: BlockRecord; resultBlock: BlockRecord } {
  const sourceBlock = snapshot.blocks.find((block) => block.blockId === input.sourceBlockId);
  if (!sourceBlock || sourceBlock.type !== 'image') {
    throw new Error('Local image operation requires a selected image block.');
  }

  const createdAt = nowIso();
  const executionId = createId('exec');
  const nextZ = maxZIndex(snapshot.blocks) + 1;
  const operationBlock: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'operation',
    layerId: 'layer_default',
    parentGroupId: sourceBlock.parentGroupId,
    position: {
      x: sourceBlock.position.x + sourceBlock.size.width + 80,
      y: sourceBlock.position.y,
    },
    size: { width: 320, height: 190 },
    zIndex: nextZ,
    data: {
      title: input.title,
      body: input.body,
      status: 'queued',
      adapter: 'manual_import',
      triggerMode: 'manual_import',
      capabilityId: input.capabilityId,
      operationMode: input.capabilityId,
      localEditParams: input.params,
      sourceAssetId: sourceBlock.data.assetId,
      sourceBlockId: sourceBlock.blockId,
      sourceExecutionId: executionId,
    },
    createdAt,
    updatedAt: createdAt,
  };
  const resultBlock: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'image',
    layerId: 'layer_default',
    parentGroupId: sourceBlock.parentGroupId,
    position: {
      x: operationBlock.position.x + operationBlock.size.width + 80,
      y: sourceBlock.position.y,
    },
    size: { ...sourceBlock.size },
    zIndex: nextZ + 1,
    data: {
      title: input.title,
      body: input.body,
      status: 'queued',
      operationBlockId: operationBlock.blockId,
      sourceExecutionId: executionId,
    },
    createdAt,
    updatedAt: createdAt,
  };
  const execution: ExecutionRecord = {
    executionId,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId: input.capabilityId,
    adapter: 'manual_import',
    status: 'queued',
    inputBlockIds: [sourceBlock.blockId],
    inputAssetIds: [sourceBlock.data.assetId].filter((assetId): assetId is string => typeof assetId === 'string'),
    outputBlockIds: [resultBlock.blockId],
    outputAssetIds: [],
    triggerMode: 'manual_import',
    prompt: input.body,
    params: {
      localEdit: input.params,
      operationBlockId: operationBlock.blockId,
    },
    startedAt: createdAt,
  };

  snapshot.blocks.push(operationBlock, resultBlock);
  if (operationBlock.parentGroupId) expandGroupToContents(snapshot, operationBlock.parentGroupId);
  ensureEdge(snapshot, sourceBlock.blockId, operationBlock.blockId, 'execution_input', 'source');
  ensureEdge(snapshot, operationBlock.blockId, resultBlock.blockId, 'execution_output');
  recordExecutionConfiguration(snapshot, execution, operationBlock);
  snapshot.executions.unshift(execution);
  const historyEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'operation_created',
    createdAt,
    actor: 'user',
    executionId,
    blockIds: [sourceBlock.blockId, operationBlock.blockId, resultBlock.blockId],
    assetIds: [sourceBlock.data.assetId].filter((assetId): assetId is string => typeof assetId === 'string'),
    summary: input.title,
    detail: {
      capabilityId: input.capabilityId,
      localEdit: input.params,
      operationBlockId: operationBlock.blockId,
      resultBlockId: resultBlock.blockId,
      sourceBlockId: sourceBlock.blockId,
    },
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);

  return { execution, operationBlock, resultBlock };
}

function rightEdge(blocks: BlockRecord[]): number {
  return blocks.reduce((max, block) => Math.max(max, block.position.x + block.size.width), 0);
}

export function executeExistingImageOperationBlock(
  snapshot: BoardSnapshot,
  input: ExistingOperationBlockInput,
): ImageCodexOperationResult {
  const operationBlock = snapshot.blocks.find((block) => block.blockId === input.operationBlockId);
  if (!operationBlock || operationBlock.type !== 'operation') {
    throw new Error('Image operation requires a selected operation block.');
  }

  const inputBlocks = connectedInputBlocks(snapshot, operationBlock.blockId);
  const textBlock = firstTextInputBlock(inputBlocks);
  if (!textBlock) {
    throw new Error('Connect a Text Block to this Operation before running.');
  }
  const promptText = promptTextFromInputs(inputBlocks);
  if (!promptText) {
    throw new Error('Enter a prompt before running this operation.');
  }
  const codexOperation = imageOperationForSwitchableMode(input.operation);
  const capabilityId = capabilityForOperation(codexOperation);
  const imageInputBindings = operationImageInputBindings(snapshot, operationBlock);
  const unresolvedImageInput = imageInputBindings.find(
    (binding) => binding.block.data.assetId && !binding.inputRole,
  );
  if (unresolvedImageInput) {
    throw new Error(`Choose an input role for image block ${unresolvedImageInput.block.blockId} before running.`);
  }
  const inputState = operationInputStateForCapability(inputBlocks, capabilityId);
  if (inputState.missingRequiredTypes.includes('image')) {
    throw new Error('Connect an image block to this operation before running image edit.');
  }
  const sourceBlock = imageInputBindings.find((binding) => binding.inputRole === 'source')?.block;
  if (input.operation !== 'text_to_image' && (!sourceBlock || !sourceBlock.data.assetId)) {
    throw new Error('Image-to-image operations require a connected source Image Block with an asset.');
  }
  const promptFrameBlock = sourceBlock ?? reusableOutputSlot(snapshot, operationBlock);

  const executionId = createId('exec');
  const createdAt = nowIso();
  const title = titleForOperation(codexOperation);
  const instruction = promptText;
  const generationProfileId = operationBlock.data.generationProfileId ?? defaultGenerationProfileId;
  const generationParams = effectiveGenerationParams(
    generationParamsForSourceImage(
      snapshot,
      sourceBlock,
      generationParamsForTextToImage(input.generationParams, input.operation === 'text_to_image'),
      input.operation === 'image_to_image',
    ),
    generationProfileId,
    capabilityId,
  );

  operationBlock.data = {
    ...operationBlock.data,
    title,
    body: instruction,
    status: 'queued',
    adapter: 'mcp_agent',
    agentHost: 'codex',
    triggerMode: 'manual_agent_session',
    capabilityId,
    operationMode: input.operation,
    operationVariant: undefined,
    sourceBlockId: sourceBlock?.blockId,
    sourceAssetId: sourceBlock?.data.assetId,
    promptSourceBlockId: textBlock?.blockId,
    generationParams,
    generationProfileId,
    sourceExecutionId: executionId,
  };
  operationBlock.updatedAt = createdAt;

  if (sourceBlock) {
    ensureEdge(snapshot, sourceBlock.blockId, operationBlock.blockId, 'execution_input');
  }

  const resultBlocks = findOrCreateOperationResultBlocks(snapshot, {
    createdAt,
    count: variationCount(generationParams),
    operationBlock,
    resultSize: displaySlotSizeForGenerationParams(generationParams, promptFrameBlock?.size),
    title,
    executionId,
  });
  createExecutionResultGroup(snapshot, { executionId, operationBlock, resultBlocks });
  if (operationBlock.parentGroupId) expandGroupToContents(snapshot, operationBlock.parentGroupId);
  const resultBlock = resultBlocks[0];

  const execution: ExecutionRecord = {
    executionId,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId,
    adapter: 'mcp_agent',
    status: 'queued',
    inputBlockIds: [textBlock?.blockId, ...imageInputBindings.map((binding) => binding.block.blockId)].filter(
      (blockId): blockId is string => typeof blockId === 'string',
    ),
    inputAssetIds: imageInputBindings
      .map((binding) => binding.block.data.assetId)
      .filter((assetId): assetId is string => typeof assetId === 'string'),
    outputBlockIds: resultBlocks.map((block) => block.blockId),
    outputAssetIds: [],
    agentHost: 'codex',
    triggerMode: 'manual_agent_session',
    skillId: skillForOperation(codexOperation),
    generationProfile: snapshotGenerationProfile(operationBlock.data.generationProfileId),
    prompt: instruction,
    params: {
      operationBlockId: operationBlock.blockId,
      ...(generationParams ? { generation: generationParams } : {}),
      inputBindings: imageInputBindings
        .filter((binding): binding is typeof binding & { inputRole: ExecutionInputRole } => Boolean(binding.inputRole))
        .map((binding) => ({
          assetId: binding.block.data.assetId,
          blockId: binding.block.blockId,
          inputRole: binding.inputRole,
        })),
    },
    startedAt: createdAt,
  };

  for (const outputBlock of resultBlocks) {
    ensureEdge(snapshot, operationBlock.blockId, outputBlock.blockId, 'execution_output');
  }
  recordExecutionConfiguration(snapshot, execution, operationBlock);
  snapshot.executions.unshift(execution);
  const prompt = createImageOperationPrompt(
    snapshot,
    promptFrameBlock ?? resultBlock,
    operationBlock,
    resultBlocks,
    execution,
  );
  execution.agentPrompt = prompt;
  operationBlock.data.agentPrompt = prompt;
  for (const outputBlock of resultBlocks) outputBlock.data.agentPrompt = prompt;

  const historyEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'operation_created',
    createdAt,
    actor: 'user',
    executionId,
    blockIds: [
      textBlock?.blockId,
      sourceBlock?.blockId,
      operationBlock.blockId,
      ...resultBlocks.map((block) => block.blockId),
    ].filter(
      (blockId): blockId is string => typeof blockId === 'string',
    ),
    assetIds: [sourceBlock?.data.assetId].filter((assetId): assetId is string => typeof assetId === 'string'),
    summary: title,
    detail: {
      capabilityId,
      instruction,
      operationBlockId: operationBlock.blockId,
      prompt,
      resultBlockIds: resultBlocks.map((block) => block.blockId),
      sourceBlockId: sourceBlock?.blockId,
    },
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);

  return {
    execution,
    operationBlock,
    resultBlock,
    resultBlocks,
    prompt,
  };
}

function capabilityForOperation(operation: ImageCodexOperation): string {
  if (operation === 'generate_image') return capabilityForImageOperation(operation);
  if (operation === 'annotation_edit') return 'image.annotation_edit';
  if (operation === 'quick_edit') return capabilityForImageOperation(operation);
  return capabilityForImageOperation(operation);
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
  if (operation === 'quick_edit') return 'Image to image';
  return 'Create similar image';
}

function operationModeForImageOperation(operation: ImageCodexOperation): SwitchableOperationMode | 'annotation_edit' {
  if (operation === 'generate_image') return 'text_to_image';
  if (operation === 'annotation_edit') return 'annotation_edit';
  return 'image_to_image';
}

function imageOperationForSwitchableMode(operation: SwitchableOperationMode): Exclude<ImageCodexOperation, 'annotation_edit'> {
  if (operation === 'text_to_image') return 'generate_image';
  return 'quick_edit';
}

function variationCount(generationParams: ImageGenerationParams | undefined): number {
  const requested = generationParams?.variationCount;
  if (typeof requested !== 'number' || !Number.isFinite(requested)) return 1;
  return Math.min(4, Math.max(1, Math.round(requested)));
}

export function displaySlotSizeForGenerationParams(
  generationParams: ImageGenerationParams | undefined,
  fallback: { height: number; width: number } = { width: 380, height: 380 },
): { height: number; width: number } {
  const ratio =
    generationParams?.targetAspectRatio ??
    dimensionRatio(generationParams?.targetWidth, generationParams?.targetHeight);
  return fitMediaBlockSize(ratio, fallback);
}

function dimensionRatio(width?: number, height?: number): number | undefined {
  if (!width || !height || width <= 0 || height <= 0) return undefined;
  return width / height;
}

function effectiveGenerationParams(
  generationParams: ImageGenerationParams | undefined,
  generationProfileId: string,
  capabilityId: string,
): ImageGenerationParams | undefined {
  if (!generationParams) return undefined;

  const profile = generationProfileById(generationProfileId);
  const paramsSchema = schemaForCapability(capabilityId).paramsSchema;
  const effective = { ...generationParams };
  delete effective.model;

  if (!paramsSchema.resolution || !generationParameterVisible(profile, 'resolution')) {
    delete effective.targetResolution;
    delete effective.targetWidth;
    delete effective.targetHeight;
  }
  if (!paramsSchema.aspectRatio || !generationParameterVisible(profile, 'aspectRatio')) {
    delete effective.aspectRatioPreset;
    delete effective.targetAspectRatio;
  }
  if (!paramsSchema.count || !generationParameterVisible(profile, 'count')) delete effective.variationCount;
  if (!paramsSchema.duration || !generationParameterVisible(profile, 'duration')) delete effective.durationSeconds;
  if (!paramsSchema.motion || !generationParameterVisible(profile, 'motion')) delete effective.motion;
  if (!paramsSchema.strength || !generationParameterVisible(profile, 'strength')) delete effective.strength;

  return effective;
}

function generationParamsForSourceImage(
  snapshot: BoardSnapshot,
  sourceBlock: BlockRecord | undefined,
  generationParams: ImageGenerationParams | undefined,
  useSourceAspectRatio: boolean,
): ImageGenerationParams | undefined {
  if (!useSourceAspectRatio || !sourceBlock) return generationParams;
  if (
    (generationParams?.aspectRatioPreset && generationParams.aspectRatioPreset !== 'source') ||
    (!generationParams?.aspectRatioPreset && (
      typeof generationParams?.targetAspectRatio === 'number' ||
      (typeof generationParams?.targetWidth === 'number' && typeof generationParams?.targetHeight === 'number')
    ))
  ) {
    return generationParams;
  }
  const sourceAspectRatio = imageBlockAspectRatio(snapshot, sourceBlock);
  if (!sourceAspectRatio) return generationParams;
  return {
    ...generationParams,
    aspectRatioPreset: 'source',
    targetAspectRatio: sourceAspectRatio,
  };
}

function generationParamsForTextToImage(
  generationParams: ImageGenerationParams | undefined,
  useTextToImageDefault: boolean,
): ImageGenerationParams | undefined {
  if (!useTextToImageDefault) return generationParams;
  if (
    generationParams?.aspectRatioPreset ||
    typeof generationParams?.targetAspectRatio === 'number' ||
    (typeof generationParams?.targetWidth === 'number' && typeof generationParams?.targetHeight === 'number')
  ) return generationParams;
  return {
    ...generationParams,
    aspectRatioPreset: '9:16',
    targetAspectRatio: 9 / 16,
  };
}

function variantTitle(title: string, index: number, count: number): string {
  return count > 1 ? `${title} ${index + 1}` : title;
}

function operationImageInputBindings(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
): Array<{ block: BlockRecord; inputRole?: ExecutionInputRole }> {
  return snapshot.edges
    .filter((edge) => edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input')
    .flatMap((edge) => {
      const block = snapshot.blocks.find((candidate) => candidate.blockId === edge.sourceBlockId);
      return block?.type === 'image' ? [{ block, inputRole: edge.inputRole }] : [];
    });
}

function reusableOutputSlot(snapshot: BoardSnapshot, operationBlock: BlockRecord): BlockRecord | undefined {
  const outputSlotId = snapshot.edges.find(
    (edge) => edge.sourceBlockId === operationBlock.blockId && edge.kind === 'execution_output',
  )?.targetBlockId;
  return snapshot.blocks.find(
    (block) => block.blockId === outputSlotId && block.type === 'image' && !block.data.assetId,
  );
}

function findOrCreateOperationResultBlocks(
  snapshot: BoardSnapshot,
  input: {
    count: number;
    createdAt: string;
    executionId: string;
    operationBlock: BlockRecord;
    resultSize: { height: number; width: number };
    title: string;
  },
): BlockRecord[] {
  const outputSlotIds = snapshot.edges
    .filter((edge) => edge.sourceBlockId === input.operationBlock.blockId && edge.kind === 'execution_output')
    .map((edge) => edge.targetBlockId);
  const outputBlocks = outputSlotIds
    .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
    .filter((block): block is BlockRecord => block?.type === 'image');
  const availableOutputSlots = outputBlocks.filter(
    (block) => !block.data.assetId && !block.data.sourceExecutionId,
  );
  const priorOutputBlocks = outputBlocks.filter((block) => !availableOutputSlots.includes(block));
  const resultBlocks: BlockRecord[] = [];
  const baseX = input.operationBlock.position.x + input.operationBlock.size.width + 80;
  const baseY = priorOutputBlocks.length
    ? Math.max(...priorOutputBlocks.map((block) => block.position.y + block.size.height)) + 72
    : availableOutputSlots[0]?.position.y ?? input.operationBlock.position.y;

  for (let index = 0; index < input.count; index += 1) {
    const outputSlot = availableOutputSlots[index];
    if (outputSlot) {
      outputSlot.data = {
        ...outputSlot.data,
        title: variantTitle(input.title, index, input.count),
        body: 'Waiting for Codex to generate an image result.',
        status: 'queued',
        operationBlockId: input.operationBlock.blockId,
        resultIndex: index,
        resultCount: input.count,
        sourceExecutionId: input.executionId,
      };
      outputSlot.position = {
        x: baseX + index * (input.resultSize.width + imageResultColumnGap),
        y: baseY,
      };
      outputSlot.size = { ...input.resultSize };
      outputSlot.updatedAt = input.createdAt;
      resultBlocks.push(outputSlot);
      continue;
    }

    const resultBlock: BlockRecord = {
      blockId: createId('block'),
      boardId: snapshot.board.boardId,
      type: 'image',
      layerId: 'layer_default',
      position: {
        x: baseX + index * (input.resultSize.width + imageResultColumnGap),
        y: baseY,
      },
      size: { ...input.resultSize },
      zIndex: maxZIndex(snapshot.blocks) + index + 1,
      data: {
        title: variantTitle(input.title, index, input.count),
        body: 'Waiting for Codex to generate an image result.',
        status: 'queued',
        operationBlockId: input.operationBlock.blockId,
        resultIndex: index,
        resultCount: input.count,
        sourceExecutionId: input.executionId,
      },
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    snapshot.blocks.push(resultBlock);
    resultBlocks.push(resultBlock);
  }

  return resultBlocks;
}

function ensureEdge(
  snapshot: BoardSnapshot,
  sourceBlockId: string,
  targetBlockId: string,
  kind: 'execution_input' | 'execution_output',
  inputRole?: ExecutionInputRole,
): void {
  const existingEdge = snapshot.edges.find(
    (edge) =>
      edge.sourceBlockId === sourceBlockId &&
      edge.targetBlockId === targetBlockId &&
      edge.kind === kind,
  );
  if (existingEdge) {
    if (inputRole && !existingEdge.inputRole) existingEdge.inputRole = inputRole;
    return;
  }

  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId,
    targetBlockId,
    kind,
    inputRole,
  });
}
