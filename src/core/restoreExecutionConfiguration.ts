import { createBlockRecord, touchBoard } from './blockFactory';
import { executionConfiguration, executionVersionFor } from './executionConfiguration';
import { fitImageBlockSize } from './imageFile';
import { createId, nowIso } from './id';
import { expandGroupToContents } from './grouping';
import type {
  BlockRecord,
  BoardHistoryEvent,
  BoardSnapshot,
  ExecutionConfigurationInputSnapshot,
} from './types';

export interface RestoreExecutionConfigurationResult {
  missingAssetIds: string[];
  operationBlockId?: string;
  restored: boolean;
  restoredBlockIds: string[];
}

export function restoreExecutionConfiguration(
  snapshot: BoardSnapshot,
  executionId: string,
): RestoreExecutionConfigurationResult {
  const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
  const operationBlockId = typeof execution?.params?.operationBlockId === 'string'
    ? execution.params.operationBlockId
    : undefined;
  const operationBlock = snapshot.blocks.find(
    (block) => block.blockId === operationBlockId && block.type === 'operation',
  );
  if (!execution || !operationBlock) {
    return { missingAssetIds: [], restored: false, restoredBlockIds: [] };
  }
  const operationVersion = executionVersionFor(snapshot, execution);
  if (typeof operationVersion !== 'number') {
    return { missingAssetIds: [], operationBlockId, restored: false, restoredBlockIds: [] };
  }
  if (operationBlock.data.status === 'queued' || operationBlock.data.status === 'running') {
    return { missingAssetIds: [], operationBlockId, restored: false, restoredBlockIds: [] };
  }

  const configuration = executionConfiguration(execution);
  const missingAssetIds = configuration.imageInputs
    .map((input) => input.assetId)
    .filter(
      (assetId): assetId is string =>
        typeof assetId === 'string' && !snapshot.assets.some((asset) => asset.assetId === assetId),
    );
  if (missingAssetIds.length) {
    return { missingAssetIds, operationBlockId, restored: false, restoredBlockIds: [] };
  }

  const updatedAt = nowIso();
  const restoredBlockIds: string[] = [];
  const promptBlock = restorePromptBlock(snapshot, operationBlock, configuration.prompt, updatedAt);
  restoredBlockIds.push(promptBlock.blockId);

  const currentImageInputEdges = snapshot.edges.filter((edge) => {
    if (edge.targetBlockId !== operationBlock.blockId || edge.kind !== 'execution_input') return false;
    return snapshot.blocks.some((block) => block.blockId === edge.sourceBlockId && block.type === 'image');
  });
  const currentImageInputEdgeIds = new Set(currentImageInputEdges.map((edge) => edge.edgeId));
  snapshot.edges = snapshot.edges.filter((edge) => !currentImageInputEdgeIds.has(edge.edgeId));

  const restoredImageBlocks = configuration.imageInputs.map((input, index) =>
    restoreImageInput(snapshot, operationBlock, input, index, updatedAt),
  );
  for (let index = 0; index < restoredImageBlocks.length; index += 1) {
    const block = restoredImageBlocks[index];
    const input = configuration.imageInputs[index];
    restoredBlockIds.push(block.blockId);
    snapshot.edges.push({
      edgeId: createId('edge'),
      sourceBlockId: block.blockId,
      targetBlockId: operationBlock.blockId,
      kind: 'execution_input',
      inputRole: input.inputRole,
    });
  }

  const sourceIndex = configuration.imageInputs.findIndex((input) => input.inputRole === 'source');
  const sourceBlock = sourceIndex >= 0 ? restoredImageBlocks[sourceIndex] : undefined;
  operationBlock.data = {
    ...operationBlock.data,
    body: configuration.prompt,
    capabilityId: configuration.capabilityId,
    generationParams: structuredClone(configuration.generationParams),
    generationProfileId: configuration.generationProfileId,
    operationMode: configuration.capabilityId === 'image.text_to_image' ? 'text_to_image' : 'image_to_image',
    promptSourceBlockId: promptBlock.blockId,
    sourceAssetId: sourceBlock?.data.assetId,
    sourceBlockId: sourceBlock?.blockId,
  };
  operationBlock.updatedAt = updatedAt;
  restoredBlockIds.push(operationBlock.blockId);
  if (operationBlock.parentGroupId) expandGroupToContents(snapshot, operationBlock.parentGroupId);

  const historyEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'configuration_restored',
    createdAt: updatedAt,
    actor: 'user',
    executionId,
    blockIds: restoredBlockIds,
    assetIds: configuration.imageInputs
      .map((input) => input.assetId)
      .filter((assetId): assetId is string => typeof assetId === 'string'),
    summary: `Restored V${operationVersion}`,
    detail: {
      configurationFingerprint: execution.configurationFingerprint,
      operationVersion,
    },
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);
  return { missingAssetIds: [], operationBlockId, restored: true, restoredBlockIds };
}

function restorePromptBlock(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  prompt: string,
  updatedAt: string,
): BlockRecord {
  const promptEdge = snapshot.edges.find((edge) => {
    if (edge.targetBlockId !== operationBlock.blockId || edge.kind !== 'execution_input') return false;
    return snapshot.blocks.some((block) => block.blockId === edge.sourceBlockId && block.type === 'text');
  });
  let promptBlock = snapshot.blocks.find(
    (block) => block.blockId === promptEdge?.sourceBlockId && block.type === 'text',
  );
  if (!promptBlock) {
    promptBlock = createBlockRecord(snapshot, 'text');
    promptBlock.parentGroupId = operationBlock.parentGroupId;
    promptBlock.position = {
      x: operationBlock.position.x - promptBlock.size.width - 80,
      y: operationBlock.position.y,
    };
    promptBlock.data.title = 'Prompt';
    promptBlock.data.promptRole = 'operation_prompt';
    snapshot.blocks.push(promptBlock);
    snapshot.edges.push({
      edgeId: createId('edge'),
      sourceBlockId: promptBlock.blockId,
      targetBlockId: operationBlock.blockId,
      kind: 'execution_input',
    });
  }
  promptBlock.data.body = prompt;
  promptBlock.updatedAt = updatedAt;
  return promptBlock;
}

function restoreImageInput(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  input: ExecutionConfigurationInputSnapshot,
  index: number,
  updatedAt: string,
): BlockRecord {
  const existing = snapshot.blocks.find((block) => block.blockId === input.blockId && block.type === 'image');
  const canReuse = existing && !existing.data.sourceExecutionId && !existing.data.operationBlockId;
  const block = canReuse ? existing : createBlockRecord(snapshot, 'image');
  if (!canReuse) {
    block.parentGroupId = operationBlock.parentGroupId;
    block.position = {
      x: operationBlock.position.x - block.size.width - 80,
      y: operationBlock.position.y + index * (block.size.height + 32),
    };
    snapshot.blocks.push(block);
  }
  const asset = snapshot.assets.find((candidate) => candidate.assetId === input.assetId);
  block.data = {
    ...block.data,
    title: input.title || block.data.title,
    assetId: asset?.assetId,
    previewUrl: asset?.previewUrl,
  };
  if (asset) block.size = fitImageBlockSize(asset.width, asset.height);
  block.updatedAt = updatedAt;
  return block;
}
