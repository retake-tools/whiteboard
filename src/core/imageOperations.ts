import { createId, nowIso } from './id';
import { advanceExecutionRecordVersion } from './executionRecordVersion';
import type { AnnotationManifest } from './imageAnnotations';
import { annotationEditControlsFromManifest } from './annotationEditControls';
import type {
  AssetRecord,
  BlockRecord,
  BoardHistoryEvent,
  BoardSnapshot,
  ExecutionRecord,
  GenerationProfileSnapshot,
} from './types';
import type { ExecutionConnectionSummary } from './executionProviders';
import { maxZIndex, touchBoard } from './blockFactory';
import { fitImageBlockSize, fitMediaBlockSize, imageResultColumnGap } from './blockSizing';
import { createExecutionResultGroup, expandGroupToContents } from './grouping';
import { syncExecutionOutputContractSnapshot } from './executionContractSnapshot';
import { createImageOperationPrompt } from './prompts';
import {
  latestStartedExecutionForOperation,
  recordExecutionConfiguration,
} from './executionConfiguration';
import {
  codexAppServerImageAdapterDefinition,
  volcengineArkSeedreamImageAdapterDefinition,
} from './capabilityRegistry';
import { imageBlockAspectRatio } from './operationAspectRatio';
import { refreshWorkflowGroupLayoutForBlock } from './workflowGroupLayout';
import {
  annotationOperationBranchLayout,
  imageBranchDraftLayout,
  imageOperationResultRowLayout,
  pluginImageOperationBranchLayout,
} from './imageOperationLayout';
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
import { skillsForCapability, snapshotSkill } from './skillRegistry';
import { retiredSkillExecutionError } from './retiredDefinitions';
import { outpaintCapabilityId } from './outpaintContracts';
import { imageGenerateCapabilityId } from './imageGenerateContracts';
import { resolveExecutionAdapterInputProfile } from './adapterInputProfiles';
import { attachWorkflowExecution } from './workflowRuntime';
import { resolveWorkflowInputBlock } from './workflowInputResolution';

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
  additionalInputAssets?: Array<{
    asset: AssetRecord;
    inputSlotId: string;
    referenceIntent?: BoardSnapshot['edges'][number]['referenceIntent'];
  }>;
  additionalInputBlocks?: Array<{
    blockId: string;
    inputSlotId: string;
    referenceIntent?: BoardSnapshot['edges'][number]['referenceIntent'];
  }>;
  capabilityId?: string;
  connection?: ExecutionConnectionSummary;
  operation: ImageCodexOperation;
  params?: Record<string, unknown>;
  sourceBlockId: string;
  instruction?: string;
  taskTitle?: string;
  waitingBody?: string;
  defaultPrompt?: string;
  annotatedCompositeAsset?: AssetRecord;
  annotationManifest?: AnnotationManifest;
  generationParams?: ImageGenerationParams;
  generationProfileId?: string;
  referenceAssets?: AssetRecord[];
}

interface ExistingOperationBlockInput {
  capabilityId?: string;
  connection?: ExecutionConnectionSummary;
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
  capabilityId?: string;
  generationParams?: ImageGenerationParams;
  operation: Exclude<ImageCodexOperation, 'annotation_edit' | 'generate_image'>;
  sourceBlockId: string;
  textBlockTitle: string;
  textBlockBody: string;
  textBlockPlaceholder?: string;
  operationTitle: string;
}

interface DraftTextToImageOperationInput {
  capabilityId?: string;
  generationParams?: ImageGenerationParams;
  operationTitle: string;
  slotBlockId?: string;
  textBlockBody: string;
  textBlockPlaceholder?: string;
  textBlockTitle: string;
}

export interface DraftImageGenerateOperationInput {
  capabilityId?: string;
  generationParams?: ImageGenerationParams;
  operationTitle: string;
  operationVariant?: Exclude<ImageCodexOperation, 'annotation_edit' | 'generate_image'>;
  slotBlockId?: string;
  sourceBlockId?: string;
  textBlockBody: string;
  textBlockPlaceholder?: string;
  textBlockTitle: string;
}

export function addImageCodexOperation(
  snapshot: BoardSnapshot,
  input: ImageCodexOperationInput,
): ImageCodexOperationResult {
  const sourceBlock = snapshot.blocks.find((block) => block.blockId === input.sourceBlockId);
  if (!sourceBlock || sourceBlock.type !== 'image') {
    throw new Error('Image operation requires a selected image block.');
  }
  const additionalInputBlocks = (input.additionalInputBlocks ?? []).map(
    (binding) => {
      const block = snapshot.blocks.find(
        (candidate) => candidate.blockId === binding.blockId,
      );
      if (
        !block
        || block.type !== 'image'
        || typeof block.data.assetId !== 'string'
        || block.blockId === sourceBlock.blockId
      ) {
        throw new Error(
          'Additional image operation inputs require distinct Image Blocks with Assets.',
        );
      }
      return {
        block,
        inputSlotId: binding.inputSlotId,
        referenceIntent: binding.referenceIntent,
      };
    },
  );
  const additionalInputAssets = (input.additionalInputAssets ?? []).map(
    ({ asset, inputSlotId, referenceIntent }) => ({
      asset: structuredClone(asset),
      inputSlotId,
      referenceIntent,
    }),
  );

  const executionId = createId('exec');
  const createdAt = nowIso();
  const capabilityId = input.capabilityId
    ?? capabilityForOperation(input.operation);
  const directApi = input.connection?.connectorId === 'volcengine-ark';
  const codexAppServer = input.connection?.connectorId === 'codex-app-server';
  const automated = directApi || codexAppServer;
  const adapter = directApi ? 'direct_api' : codexAppServer ? 'codex_app_server' : 'mcp_agent';
  const connectionId = input.connection?.connectionId ?? 'codex-managed';
  const title = capabilityId === imageGenerateCapabilityId
    ? titleForOperation('generate_image')
    : input.taskTitle ?? titleForOperation(input.operation);
  const instruction = input.instruction?.trim();
  const sourceInputSlotId =
    input.operation === 'generate_image' ? undefined : 'source_image';
  const generationProfileId = input.generationProfileId ?? defaultGenerationProfileId;
  const requestedGenerationParams = generationParamsForSourceImage(
    snapshot,
    sourceBlock,
    generationParamsForTextToImage(
      input.generationParams,
      input.operation === 'generate_image',
    ),
    input.operation !== 'generate_image',
  );
  const effectiveParams = effectiveGenerationParams(
    requestedGenerationParams,
    generationProfileId,
    capabilityId,
    input.connection,
  );
  const generationParams = capabilityId === outpaintCapabilityId
    ? {
        ...effectiveParams,
        targetHeight: requestedGenerationParams?.targetHeight,
        targetWidth: requestedGenerationParams?.targetWidth,
      }
    : effectiveParams;
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
  for (const { asset } of additionalInputAssets) {
    if (!snapshot.assets.some(
      (candidate) => candidate.assetId === asset.assetId,
    )) {
      snapshot.assets.unshift(asset);
    }
  }
  const referenceAssetIds = input.referenceAssets?.map((asset) => asset.assetId) ?? [];
  const inputBindings = [
    ...(sourceInputSlotId && sourceBlock.data.assetId
      ? [{
          assetId: sourceBlock.data.assetId,
          blockId: sourceBlock.blockId,
          inputSlotId: sourceInputSlotId,
        }]
      : []),
    ...referenceAssetIds.map((assetId) => ({
      assetId,
      inputSlotId: 'references',
    })),
    ...(input.annotatedCompositeAsset
      ? [{
          assetId: input.annotatedCompositeAsset.assetId,
          inputSlotId: 'annotated_composite',
        }]
      : []),
    ...additionalInputBlocks.map(({ block, inputSlotId, referenceIntent }) => ({
      assetId: block.data.assetId!,
      blockId: block.blockId,
      inputSlotId,
      ...(referenceIntent
        ? { referenceIntent: structuredClone(referenceIntent) }
        : {}),
    })),
    ...additionalInputAssets.map(({ asset, inputSlotId, referenceIntent }) => ({
      assetId: asset.assetId,
      inputSlotId,
      ...(referenceIntent
        ? { referenceIntent: structuredClone(referenceIntent) }
        : {}),
    })),
  ];
  const annotationEditControls = input.operation === 'annotation_edit' && input.annotationManifest
    ? annotationEditControlsFromManifest(input.annotationManifest)
    : undefined;
  const resultCount = variationCount(generationParams);
  const resultSize = displaySlotSizeForGenerationParams(generationParams, sourceBlock.size);
  const operationSize = { width: 320, height: 190 };
  const annotationLayout = input.operation === 'annotation_edit'
    ? annotationOperationBranchLayout(snapshot, sourceBlock, operationSize, resultSize, resultCount)
    : undefined;

  const operationBlock: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'operation',
    layerId: 'layer_default',
    parentGroupId: annotationLayout ? annotationLayout.parentGroupId : sourceBlock.parentGroupId,
    position: annotationLayout?.operationPosition ?? {
      x: sourceBlock.position.x + sourceBlock.size.width + 80,
      y: sourceBlock.position.y,
    },
    size: operationSize,
    zIndex: maxZIndex(snapshot.blocks) + 1,
    data: {
      title,
      body: instruction || input.defaultPrompt || title,
      status: 'queued',
      adapter,
      agentHost: directApi ? undefined : 'codex',
      triggerMode: directApi ? 'server_worker' : codexAppServer ? 'agent_bridge' : 'manual_agent_session',
      capabilityId,
      ...(capabilityId === imageGenerateCapabilityId
        ? {}
        : { operationMode: operationModeForImageOperation(input.operation) }),
      operationVariant:
        input.operation !== 'generate_image' && input.operation !== 'annotation_edit' ? input.operation : undefined,
      ...(sourceInputSlotId
        ? {
            sourceBlockId: sourceBlock.blockId,
            sourceAssetId: sourceBlock.data.assetId,
          }
        : {}),
      annotationMode: input.operation === 'annotation_edit' ? 'composite_image' : undefined,
      annotationText: input.operation === 'annotation_edit' ? instruction : undefined,
      annotatedCompositeAssetId:
        input.operation === 'annotation_edit' ? input.annotatedCompositeAsset?.assetId : undefined,
      annotationManifest:
        input.operation === 'annotation_edit' ? input.annotationManifest : undefined,
      pluginParameters: input.params
        ? structuredClone(input.params)
        : undefined,
      connectionId,
      generationParams,
      generationProfileId,
      referenceAssetIds: referenceAssetIds.length ? referenceAssetIds : undefined,
      sourceExecutionId: executionId,
    },
    createdAt,
    updatedAt: createdAt,
  };

  const resultLayout = annotationLayout?.resultPosition
    ?? imageOperationResultRowLayout(snapshot, operationBlock, resultSize, resultCount);
  const resultBlocks = Array.from({ length: resultCount }, (_, index): BlockRecord => ({
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'image',
    layerId: 'layer_default',
    parentGroupId: operationBlock.parentGroupId,
    position: {
      x: resultLayout.x + index * (resultSize.width + imageResultColumnGap),
      y: resultLayout.y,
    },
    size: { ...resultSize },
    zIndex: operationBlock.zIndex + index + 1,
    data: {
      title: variantTitle(title, index, resultCount),
      body: input.waitingBody || 'Waiting for Codex to generate an image result.',
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
    recordVersion: 1,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId,
    adapter,
    status: 'queued',
    inputBlockIds: [
      sourceInputSlotId ? sourceBlock.blockId : undefined,
      ...additionalInputBlocks.map(({ block }) => block.blockId),
    ].filter((blockId): blockId is string => Boolean(blockId)),
    inputAssetIds: [
      sourceInputSlotId ? sourceBlock.data.assetId : undefined,
      input.annotatedCompositeAsset?.assetId,
      ...referenceAssetIds,
      ...additionalInputBlocks.map(({ block }) => block.data.assetId),
      ...additionalInputAssets.map(({ asset }) => asset.assetId),
    ].filter((assetId): assetId is string => typeof assetId === 'string'),
    outputBlockIds: resultBlocks.map((block) => block.blockId),
    outputAssetIds: [],
    agentHost: directApi ? undefined : 'codex',
    triggerMode: directApi ? 'server_worker' : codexAppServer ? 'agent_bridge' : 'manual_agent_session',
    provider: automated ? input.connection?.providerLabel : undefined,
    model: automated ? input.connection?.modelId : undefined,
    connectionId,
    skillId: input.capabilityId
      ? undefined
      : skillForOperation(input.operation),
    generationProfile: {
      ...snapshotGenerationProfile(operationBlock.data.generationProfileId),
      connectionId,
    },
    prompt: instruction || input.defaultPrompt || title,
    params: {
      operationBlockId: operationBlock.blockId,
      ...(generationParams ? { generation: generationParams } : {}),
      ...(referenceAssetIds.length ? { referenceAssetIds } : {}),
      ...(input.operation === 'annotation_edit' && input.annotationManifest
        ? { annotationManifest: input.annotationManifest }
        : {}),
      ...(input.operation === 'annotation_edit' && input.annotatedCompositeAsset?.assetId
        ? { annotatedCompositeAssetId: input.annotatedCompositeAsset.assetId }
        : {}),
      ...(annotationEditControls ? { annotationEditControls } : {}),
      ...(inputBindings.length ? { inputBindings } : {}),
      ...(input.params ? { pluginParameters: input.params } : {}),
    },
    startedAt: createdAt,
  };

  snapshot.blocks.push(operationBlock, ...resultBlocks);
  createImageExecutionResultGroup(snapshot, { executionId, operationBlock, resultBlocks });
  if (operationBlock.parentGroupId) expandGroupToContents(snapshot, operationBlock.parentGroupId);
  if (sourceInputSlotId) {
    snapshot.edges.push({
      edgeId: createId('edge'),
      sourceBlockId: sourceBlock.blockId,
      targetBlockId: operationBlock.blockId,
      kind: 'execution_input',
      inputSlotId: sourceInputSlotId,
    });
  }
  for (const { block, inputSlotId, referenceIntent } of additionalInputBlocks) {
    snapshot.edges.push({
      edgeId: createId('edge'),
      sourceBlockId: block.blockId,
      targetBlockId: operationBlock.blockId,
      kind: 'execution_input',
      inputSlotId,
      ...(referenceIntent
        ? { referenceIntent: structuredClone(referenceIntent) }
        : {}),
    });
  }
  for (const outputBlock of resultBlocks) {
    snapshot.edges.push({
      edgeId: createId('edge'),
      sourceBlockId: operationBlock.blockId,
      targetBlockId: outputBlock.blockId,
      kind: 'execution_output',
    });
  }
  recordExecutionConfiguration(snapshot, execution, operationBlock);
  if (directApi) {
    const inputProfile = capabilityId === imageGenerateCapabilityId
      ? resolveExecutionAdapterInputProfile(volcengineArkSeedreamImageAdapterDefinition, execution)
      : undefined;
    execution.adapterSnapshot = {
      adapterId: volcengineArkSeedreamImageAdapterDefinition.adapterId,
      version: volcengineArkSeedreamImageAdapterDefinition.version,
      definitionHash: volcengineArkSeedreamImageAdapterDefinition.definitionHash,
      adapterClass: 'image.generate',
      routeKind: volcengineArkSeedreamImageAdapterDefinition.routeKind,
      provider: volcengineArkSeedreamImageAdapterDefinition.provider,
      model: input.connection?.modelId ?? volcengineArkSeedreamImageAdapterDefinition.model,
      ...(inputProfile ? { inputProfileId: inputProfile.profileId } : {}),
    };
  } else if (codexAppServer) {
    const inputProfile = capabilityId === imageGenerateCapabilityId
      ? resolveExecutionAdapterInputProfile(codexAppServerImageAdapterDefinition, execution)
      : undefined;
    execution.adapterSnapshot = {
      adapterId: codexAppServerImageAdapterDefinition.adapterId,
      version: codexAppServerImageAdapterDefinition.version,
      definitionHash: codexAppServerImageAdapterDefinition.definitionHash,
      adapterClass: codexAppServerImageAdapterDefinition.adapterClass,
      routeKind: codexAppServerImageAdapterDefinition.routeKind,
      provider: codexAppServerImageAdapterDefinition.provider,
      model: input.connection?.modelId ?? codexAppServerImageAdapterDefinition.model,
      ...(inputProfile ? { inputProfileId: inputProfile.profileId } : {}),
    };
  }
  snapshot.executions.unshift(execution);
  const promptFrameBlock = input.operation === 'generate_image' ? resultBlock : sourceBlock;
  const prompt = automated
    ? instruction || input.defaultPrompt || title
    : createImageOperationPrompt(snapshot, promptFrameBlock, operationBlock, resultBlocks, execution);
  if (!automated) {
    execution.agentPrompt = prompt;
    operationBlock.data.agentPrompt = prompt;
    for (const outputBlock of resultBlocks) outputBlock.data.agentPrompt = prompt;
  } else {
    delete operationBlock.data.agentPrompt;
    for (const outputBlock of resultBlocks) delete outputBlock.data.agentPrompt;
  }
  const historyEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'operation_created',
    createdAt,
    actor: 'user',
    executionId,
    blockIds: [
      sourceBlock.blockId,
      ...additionalInputBlocks.map(({ block }) => block.blockId),
      operationBlock.blockId,
      ...resultBlocks.map((block) => block.blockId),
    ],
    assetIds: [
      sourceBlock.data.assetId,
      input.annotatedCompositeAsset?.assetId,
      ...referenceAssetIds,
      ...additionalInputBlocks.map(({ block }) => block.data.assetId),
      ...additionalInputAssets.map(({ asset }) => asset.assetId),
    ].filter((assetId): assetId is string => typeof assetId === 'string'),
    summary: title,
    detail: {
      capabilityId,
      instruction,
      annotationManifest: input.operation === 'annotation_edit' ? input.annotationManifest : undefined,
      annotationEditControls,
      prompt,
      generationParams,
      operationBlockId: operationBlock.blockId,
      pluginParameters: input.params,
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
  return createDraftImageGenerateOperation(snapshot, {
    capabilityId: input.capabilityId,
    generationParams: input.generationParams,
    operationTitle: input.operationTitle,
    operationVariant: input.operation,
    sourceBlockId: input.sourceBlockId,
    textBlockBody: input.textBlockBody,
    textBlockPlaceholder: input.textBlockPlaceholder,
    textBlockTitle: input.textBlockTitle,
  });
}

export function createDraftTextToImageOperation(
  snapshot: BoardSnapshot,
  input: DraftTextToImageOperationInput,
): { operationBlock: BlockRecord; textBlock: BlockRecord } {
  return createDraftImageGenerateOperation(snapshot, input);
}

export function createDraftImageGenerateOperation(
  snapshot: BoardSnapshot,
  input: DraftImageGenerateOperationInput,
): { operationBlock: BlockRecord; textBlock: BlockRecord } {
  if (input.sourceBlockId && input.slotBlockId) {
    throw new Error('Image generation cannot reuse an output slot when a source image is bound.');
  }
  const sourceBlock = input.sourceBlockId
    ? snapshot.blocks.find((block) => block.blockId === input.sourceBlockId)
    : undefined;
  if (input.sourceBlockId && sourceBlock?.type !== 'image') {
    throw new Error('Image operation requires a selected image block.');
  }
  const anchorBlock = input.slotBlockId
    ? snapshot.blocks.find((block) => block.blockId === input.slotBlockId)
    : undefined;
  if (input.slotBlockId && (!anchorBlock || anchorBlock.type !== 'image' || anchorBlock.data.assetId)) {
    throw new Error('Image generation output slot is invalid.');
  }

  const createdAt = nowIso();
  const nextZ = maxZIndex(snapshot.blocks) + 1;
  const textSize = { width: 280, height: 140 };
  const operationSize = { width: 320, height: 190 };
  const sourceLayout = sourceBlock
    ? imageBranchDraftLayout(snapshot, sourceBlock, textSize, operationSize)
    : undefined;
  const textPosition = sourceLayout?.textPosition ?? (anchorBlock
    ? {
        x: anchorBlock.position.x + anchorBlock.size.width + 80,
        y: anchorBlock.position.y,
      }
    : {
        x: rightEdge(snapshot.blocks) + 160,
        y: 220,
      });
  const textBlock: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'text',
    layerId: 'layer_default',
    parentGroupId: sourceLayout?.parentGroupId ?? anchorBlock?.parentGroupId,
    position: textPosition,
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
    parentGroupId: sourceLayout?.parentGroupId ?? anchorBlock?.parentGroupId,
    position: sourceLayout?.operationPosition ?? {
      x: textBlock.position.x + textBlock.size.width + 80,
      y: textBlock.position.y,
    },
    size: operationSize,
    zIndex: nextZ + 1,
    data: {
      title: input.operationTitle,
      body: input.textBlockBody,
      adapter: 'mcp_agent',
      agentHost: 'codex',
      triggerMode: 'manual_agent_session',
      capabilityId: input.capabilityId ?? imageGenerateCapabilityId,
      ...(sourceBlock && input.operationVariant ? { operationVariant: input.operationVariant } : {}),
      ...(sourceBlock ? { workflowLayout: 'branch_lanes' } : {}),
      connectionId: 'codex-managed',
      generationParams: sourceBlock
        ? generationParamsForSourceImage(snapshot, sourceBlock, input.generationParams, true)
        : generationParamsForTextToImage(input.generationParams, true),
      generationProfileId: defaultGenerationProfileId,
      promptSourceBlockId: textBlock.blockId,
      ...(sourceBlock
        ? {
            sourceBlockId: sourceBlock.blockId,
            sourceAssetId: sourceBlock.data.assetId,
          }
        : {}),
    },
    createdAt,
    updatedAt: createdAt,
  };
  snapshot.blocks.push(textBlock, operationBlock);
  if (operationBlock.parentGroupId) expandGroupToContents(snapshot, operationBlock.parentGroupId);
  if (sourceBlock) {
    ensureEdge(snapshot, sourceBlock.blockId, operationBlock.blockId, 'execution_input', 'source_image');
  }
  ensureEdge(snapshot, textBlock.blockId, operationBlock.blockId, 'execution_input', 'prompt');
  touchBoard(snapshot);

  return { operationBlock, textBlock };
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
  const isAnnotationRepeat = operationBlock.data.capabilityId === 'image.annotation_edit';
  const textBlock = firstTextInputBlock(inputBlocks);
  const promptBlock = inputBlocks.find(
    (block) => block.type === 'text' || block.type === 'document',
  );
  const connectedPromptText = promptTextFromInputs(inputBlocks);
  const previousExecution = latestStartedExecutionForOperation(
    snapshot,
    operationBlock.blockId,
  );
  const frozenPromptText = typeof previousExecution?.prompt === 'string'
    && previousExecution.prompt.trim()
    ? previousExecution.prompt.trim()
    : typeof operationBlock.data.body === 'string'
      && operationBlock.data.body.trim()
      ? operationBlock.data.body.trim()
      : undefined;
  const documentPrompt = promptBlock?.type === 'document'
    && typeof promptBlock.data.assetId === 'string'
    ? (typeof promptBlock.data.title === 'string' && promptBlock.data.title.trim()
        ? promptBlock.data.title.trim()
        : 'Connected document prompt')
    : undefined;
  const executionAdjustmentInstruction = typeof operationBlock.data.executionAdjustmentInstruction === 'string'
    && operationBlock.data.executionAdjustmentInstruction.trim()
    ? operationBlock.data.executionAdjustmentInstruction.trim()
    : undefined;
  const promptText = connectedPromptText ?? documentPrompt ?? frozenPromptText;
  if (!isAnnotationRepeat && !promptBlock && !promptText) {
    throw new Error(
      'Connect a Text or Document Block, or keep a previous execution prompt before running.',
    );
  }
  if (!isAnnotationRepeat && !promptText) {
    throw new Error('Enter a prompt before running this operation.');
  }
  const requestedCodexOperation: ImageCodexOperation = isAnnotationRepeat
    ? 'annotation_edit'
    : imageOperationForSwitchableMode(input.operation);
  const capabilityId = input.capabilityId
    ?? (typeof operationBlock.data.capabilityId === 'string'
      ? operationBlock.data.capabilityId
      : capabilityForOperation(requestedCodexOperation));
  const explicitSkillId = typeof operationBlock.data.skillId === 'string'
    && operationBlock.data.skillId.trim()
    ? operationBlock.data.skillId
    : undefined;
  const explicitSkill = explicitSkillId
    ? skillsForCapability(capabilityId).find(
        (candidate) => candidate.skillId === explicitSkillId,
      )
    : undefined;
  if (explicitSkillId && !explicitSkill) {
    const retiredError = retiredSkillExecutionError(explicitSkillId);
    if (retiredError) throw retiredError;
    throw new Error(`Image operation Skill is unavailable or incompatible: ${explicitSkillId}`);
  }
  const annotationManifest = isAnnotationRepeat && isAnnotationManifest(operationBlock.data.annotationManifest)
    ? structuredClone(operationBlock.data.annotationManifest)
    : undefined;
  const annotatedCompositeAssetId = isAnnotationRepeat && typeof operationBlock.data.annotatedCompositeAssetId === 'string'
    ? operationBlock.data.annotatedCompositeAssetId
    : undefined;
  const annotatedCompositeAsset = annotatedCompositeAssetId
    ? snapshot.assets.find((asset) => asset.assetId === annotatedCompositeAssetId)
    : undefined;
  if (isAnnotationRepeat && (!annotationManifest || !annotatedCompositeAsset)) {
    throw new Error('This annotation operation no longer has a complete annotation snapshot. Open it in Annotation Edit before running.');
  }
  const imageInputBindings = operationImageInputBindings(snapshot, operationBlock);
  const unresolvedImageInput = imageInputBindings.find(
    (binding) => binding.block.data.assetId && !binding.inputSlotId,
  );
  if (unresolvedImageInput) {
    throw new Error(`Choose an input binding for image block ${unresolvedImageInput.block.blockId} before running.`);
  }
  const inputState = operationInputStateForCapability(inputBlocks, capabilityId);
  if (inputState.missingRequiredTypes.includes('image')) {
    throw new Error('Connect an image block to this operation before running image edit.');
  }
  const sourceBlock = imageInputBindings.find(
    (binding) => binding.inputSlotId === 'source_image',
  )?.block;
  const codexOperation: ImageCodexOperation = isAnnotationRepeat
    ? 'annotation_edit'
    : capabilityId === imageGenerateCapabilityId
      ? sourceBlock ? 'quick_edit' : 'generate_image'
      : requestedCodexOperation;
  if (capabilityId !== imageGenerateCapabilityId && codexOperation !== 'generate_image' && (!sourceBlock || !sourceBlock.data.assetId)) {
    throw new Error('Image-to-image operations require a connected source Image Block with an asset.');
  }
  const promptFrameBlock = sourceBlock ?? reusableOutputSlot(snapshot, operationBlock);

  const executionId = createId('exec');
  const createdAt = nowIso();
  const title = input.capabilityId
    ? (typeof operationBlock.data.title === 'string'
        ? operationBlock.data.title
        : titleForOperation(codexOperation))
    : titleForOperation(codexOperation);
  const instruction = isAnnotationRepeat
    ? (typeof operationBlock.data.annotationText === 'string' ? operationBlock.data.annotationText.trim() : '')
    : executionAdjustmentInstruction ?? promptText ?? '';
  if (!instruction) throw new Error('Enter a prompt before running this operation.');
  const generationProfileId = operationBlock.data.generationProfileId ?? defaultGenerationProfileId;
  const connectionId = input.connection?.connectionId ?? (typeof operationBlock.data.connectionId === 'string'
    ? operationBlock.data.connectionId
    : 'codex-managed');
  const directApi = input.connection?.connectorId === 'volcengine-ark';
  const codexAppServer = input.connection?.connectorId === 'codex-app-server';
  const automated = directApi || codexAppServer;
  const adapter = directApi ? 'direct_api' : codexAppServer ? 'codex_app_server' : 'mcp_agent';
  const generationParams = effectiveGenerationParams(
    generationParamsForSourceImage(
      snapshot,
      sourceBlock,
      generationParamsForTextToImage(input.generationParams, codexOperation === 'generate_image'),
      codexOperation !== 'generate_image',
    ),
    generationProfileId,
    capabilityId,
    input.connection,
  );

  operationBlock.data = {
    ...operationBlock.data,
    title,
    body: instruction,
    status: 'queued',
    adapter,
    agentHost: directApi ? undefined : 'codex',
    triggerMode: directApi ? 'server_worker' : codexAppServer ? 'agent_bridge' : 'manual_agent_session',
    capabilityId,
    ...(capabilityId === imageGenerateCapabilityId
      ? { operationMode: undefined }
      : { operationMode: operationModeForImageOperation(codexOperation) }),
    operationVariant: operationBlock.data.operationVariant,
    sourceBlockId: sourceBlock?.blockId,
    sourceAssetId: sourceBlock?.data.assetId,
    promptSourceBlockId: isAnnotationRepeat ? undefined : promptBlock?.blockId,
    connectionId,
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
  createImageExecutionResultGroup(snapshot, { executionId, operationBlock, resultBlocks });
  if (operationBlock.parentGroupId) expandGroupToContents(snapshot, operationBlock.parentGroupId);
  const resultBlock = resultBlocks[0];

  const execution: ExecutionRecord = {
    executionId,
    recordVersion: 1,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId,
    adapter,
    status: 'queued',
    inputBlockIds: [isAnnotationRepeat ? undefined : promptBlock?.blockId, ...imageInputBindings.map((binding) => binding.block.blockId)].filter(
      (blockId): blockId is string => typeof blockId === 'string',
    ),
    inputAssetIds: [
      ...imageInputBindings.map((binding) => binding.block.data.assetId),
      annotatedCompositeAssetId,
    ].filter((assetId): assetId is string => typeof assetId === 'string'),
    outputBlockIds: resultBlocks.map((block) => block.blockId),
    outputAssetIds: [],
    agentHost: directApi ? undefined : 'codex',
    triggerMode: directApi ? 'server_worker' : codexAppServer ? 'agent_bridge' : 'manual_agent_session',
    provider: automated ? input.connection?.providerLabel : undefined,
    model: automated ? input.connection?.modelId : undefined,
    connectionId,
    skillId: explicitSkillId ?? skillForOperation(codexOperation),
    generationProfile: imageGenerationProfileSnapshot(input.connection, operationBlock.data.generationProfileId),
    prompt: instruction,
    params: {
      operationBlockId: operationBlock.blockId,
      ...(executionAdjustmentInstruction ? { executionAdjustmentInstruction } : {}),
      ...(generationParams ? { generation: generationParams } : {}),
      ...(annotationManifest ? { annotationManifest } : {}),
      ...(annotatedCompositeAssetId ? { annotatedCompositeAssetId } : {}),
      ...(annotationManifest ? { annotationEditControls: annotationEditControlsFromManifest(annotationManifest) } : {}),
      inputBindings: imageInputBindings
        .filter((binding): binding is typeof binding & { inputSlotId: string } => Boolean(binding.inputSlotId))
        .map((binding) => ({
          assetId: binding.block.data.assetId,
          blockId: binding.block.blockId,
          inputSlotId: binding.inputSlotId,
          ...(binding.referenceIntent
            ? { referenceIntent: structuredClone(binding.referenceIntent) }
            : {}),
        })),
    },
    startedAt: createdAt,
  };

  for (const outputBlock of resultBlocks) {
    ensureEdge(snapshot, operationBlock.blockId, outputBlock.blockId, 'execution_output');
  }
  if (resultBlocks[0]) refreshWorkflowGroupLayoutForBlock(snapshot, resultBlocks[0]);
  recordExecutionConfiguration(snapshot, execution, operationBlock);
  const skill = explicitSkill ?? (execution.skillId
    ? skillsForCapability(execution.capabilityId).find(
        (candidate) => candidate.skillId === execution.skillId,
      )
    : undefined);
  if (skill) {
    execution.skillSnapshot = snapshotSkill(
      skill,
      execution.inputBindingsSnapshot ?? [],
    );
  }
  if (directApi) {
    const inputProfile = capabilityId === imageGenerateCapabilityId
      ? resolveExecutionAdapterInputProfile(volcengineArkSeedreamImageAdapterDefinition, execution)
      : undefined;
    execution.adapterSnapshot = {
      adapterId: volcengineArkSeedreamImageAdapterDefinition.adapterId,
      version: volcengineArkSeedreamImageAdapterDefinition.version,
      definitionHash: volcengineArkSeedreamImageAdapterDefinition.definitionHash,
      adapterClass: 'image.generate',
      routeKind: volcengineArkSeedreamImageAdapterDefinition.routeKind,
      provider: volcengineArkSeedreamImageAdapterDefinition.provider,
      model: input.connection?.modelId ?? volcengineArkSeedreamImageAdapterDefinition.model,
      ...(inputProfile ? { inputProfileId: inputProfile.profileId } : {}),
    };
  } else if (codexAppServer) {
    const inputProfile = capabilityId === imageGenerateCapabilityId
      ? resolveExecutionAdapterInputProfile(codexAppServerImageAdapterDefinition, execution)
      : undefined;
    execution.adapterSnapshot = {
      adapterId: codexAppServerImageAdapterDefinition.adapterId,
      version: codexAppServerImageAdapterDefinition.version,
      definitionHash: codexAppServerImageAdapterDefinition.definitionHash,
      adapterClass: codexAppServerImageAdapterDefinition.adapterClass,
      routeKind: codexAppServerImageAdapterDefinition.routeKind,
      provider: codexAppServerImageAdapterDefinition.provider,
      model: input.connection?.modelId ?? codexAppServerImageAdapterDefinition.model,
      ...(inputProfile ? { inputProfileId: inputProfile.profileId } : {}),
    };
  }
  attachWorkflowExecution(snapshot, operationBlock, execution);
  snapshot.executions.unshift(execution);
  const prompt = automated
    ? instruction
    : createImageOperationPrompt(
      snapshot,
      promptFrameBlock ?? resultBlock,
      operationBlock,
      resultBlocks,
      execution,
    );
  if (!automated) {
    execution.agentPrompt = prompt;
    operationBlock.data.agentPrompt = prompt;
    for (const outputBlock of resultBlocks) outputBlock.data.agentPrompt = prompt;
  } else {
    delete operationBlock.data.agentPrompt;
    for (const outputBlock of resultBlocks) delete outputBlock.data.agentPrompt;
  }

  const historyEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'operation_created',
    createdAt,
    actor: 'user',
    executionId,
    blockIds: [
      isAnnotationRepeat ? undefined : promptBlock?.blockId,
      sourceBlock?.blockId,
      operationBlock.blockId,
      ...resultBlocks.map((block) => block.blockId),
    ].filter(
      (blockId): blockId is string => typeof blockId === 'string',
    ),
    assetIds: [sourceBlock?.data.assetId, annotatedCompositeAssetId].filter(
      (assetId): assetId is string => typeof assetId === 'string',
    ),
    summary: title,
    detail: {
      capabilityId,
      instruction,
      annotationManifest,
      annotationEditControls: annotationManifest ? annotationEditControlsFromManifest(annotationManifest) : undefined,
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
  if (operation === 'annotation_edit') return 'image.annotation_edit';
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
  connection?: ExecutionConnectionSummary,
): ImageGenerationParams | undefined {
  if (!generationParams) return undefined;

  const baseProfile = generationProfileById(generationProfileId);
  const profile = connection?.connectorId === 'volcengine-ark'
    ? {
      ...baseProfile,
      parameterSupport: {
        ...baseProfile.parameterSupport,
        aspectRatio: 'supported' as const,
        count: 'supported' as const,
        resolution: 'supported' as const,
      },
    }
    : baseProfile;
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
): Array<{
  block: BlockRecord;
  inputSlotId?: string;
  referenceIntent?: BoardSnapshot['edges'][number]['referenceIntent'];
}> {
  return snapshot.edges
    .filter((edge) => edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input')
    .flatMap((edge) => {
      const block = snapshot.blocks.find((candidate) => candidate.blockId === edge.sourceBlockId);
      return block?.type === 'image'
        ? [{
            block: resolveWorkflowInputBlock(
              snapshot,
              operationBlock.blockId,
              edge.inputSlotId,
              block,
            ),
            inputSlotId: edge.inputSlotId,
            ...(edge.referenceIntent
              ? { referenceIntent: structuredClone(edge.referenceIntent) }
              : {}),
          }]
        : [];
    });
}

function isAnnotationManifest(value: unknown): value is AnnotationManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<AnnotationManifest>;
  return candidate.schemaVersion === 1 && Array.isArray(candidate.marks);
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
  const resultBlocks: BlockRecord[] = [];
  const excludedBlockIds = availableOutputSlots.flatMap((block) => [
    block.blockId,
    ...(block.parentGroupId ? [block.parentGroupId] : []),
  ]);
  const resultLayout = imageOperationResultRowLayout(
    snapshot,
    input.operationBlock,
    input.resultSize,
    input.count,
    excludedBlockIds,
  );
  const baseX = resultLayout.x;
  const baseY = resultLayout.y;
  const workflowStepId = typeof input.operationBlock.data.workflowStepId === 'string'
    ? input.operationBlock.data.workflowStepId
    : undefined;
  const workflowFlowDirection = input.operationBlock.data.workflowFlowDirection;

  for (let index = 0; index < input.count; index += 1) {
    const outputSlot = availableOutputSlots[index];
    if (outputSlot) {
      outputSlot.data = {
        ...outputSlot.data,
        title: variantTitle(input.title, index, input.count),
        body: 'Waiting for image generation.',
        status: 'queued',
        operationBlockId: input.operationBlock.blockId,
        resultIndex: index,
        resultCount: input.count,
        sourceExecutionId: input.executionId,
        ...(workflowStepId ? { workflowStepId } : {}),
        ...(workflowFlowDirection ? { workflowFlowDirection } : {}),
      };
      outputSlot.parentGroupId = input.operationBlock.parentGroupId;
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
        body: 'Waiting for image generation.',
        status: 'queued',
        operationBlockId: input.operationBlock.blockId,
        resultIndex: index,
        resultCount: input.count,
        sourceExecutionId: input.executionId,
        ...(workflowStepId ? { workflowStepId } : {}),
        ...(workflowFlowDirection ? { workflowFlowDirection } : {}),
      },
      parentGroupId: input.operationBlock.parentGroupId,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    };
    snapshot.blocks.push(resultBlock);
    resultBlocks.push(resultBlock);
  }

  return resultBlocks;
}

function createImageExecutionResultGroup(
  snapshot: BoardSnapshot,
  input: {
    executionId: string;
    operationBlock: BlockRecord;
    resultBlocks: readonly BlockRecord[];
  },
): void {
  const parentGroup = input.operationBlock.parentGroupId
    ? snapshot.blocks.find(
        (block) => block.blockId === input.operationBlock.parentGroupId && block.type === 'group',
      )
    : undefined;
  if (parentGroup?.data.groupKind === 'workflow') {
    for (const block of input.resultBlocks) block.parentGroupId = parentGroup.blockId;
    return;
  }
  createExecutionResultGroup(snapshot, input);
}

function imageGenerationProfileSnapshot(
  connection: ExecutionConnectionSummary | undefined,
  generationProfileId: unknown,
): GenerationProfileSnapshot {
  if (!connection || connection.connectorId === 'codex-managed') {
    return {
      ...snapshotGenerationProfile(generationProfileId),
      connectionId: connection?.connectionId ?? 'codex-managed',
    };
  }
  return {
    generationProfileId: connection.connectionId,
    name: connection.displayName,
    version: 1,
    source: connection.deletable ? 'user' : 'builtin',
    adapter: connection.connectorId === 'codex-app-server' ? 'codex_app_server' : 'direct_api',
    ...(connection.connectorId === 'codex-app-server' ? { agentHost: 'codex' as const } : {}),
    provider: connection.providerLabel,
    model: connection.modelId,
    connectionId: connection.connectionId,
  };
}

function ensureEdge(
  snapshot: BoardSnapshot,
  sourceBlockId: string,
  targetBlockId: string,
  kind: 'execution_input' | 'execution_output',
  inputSlotId?: string,
): void {
  const existingEdge = snapshot.edges.find(
    (edge) =>
      edge.sourceBlockId === sourceBlockId &&
      edge.targetBlockId === targetBlockId &&
      edge.kind === kind,
  );
  if (existingEdge) {
    if (inputSlotId && !existingEdge.inputSlotId) {
      existingEdge.inputSlotId = inputSlotId;
    }
    return;
  }

  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId,
    targetBlockId,
    kind,
    inputSlotId,
  });
}
