import { maxZIndex, touchBoard } from './blockFactory';
import { fitImageBlockSize } from './blockSizing';
import { advanceExecutionRecordVersion } from './executionRecordVersion';
import { recordExecutionConfiguration } from './executionConfiguration';
import { syncExecutionOutputContractSnapshot } from './executionContractSnapshot';
import { expandGroupToContents } from './grouping';
import { createId, nowIso } from './id';
import { pluginImageOperationBranchLayout } from './imageOperationLayout';
import type {
  AssetRecord,
  BlockRecord,
  BoardHistoryEvent,
  BoardSnapshot,
  ExecutionRecord,
} from './types';
import { refreshWorkflowGroupLayoutForBlock } from './workflowGroupLayout';
import type { CapabilityDefinition } from './capabilityContracts';

interface PluginImageOperationInput {
  body: string;
  capabilityDefinition: CapabilityDefinition;
  capabilityId: string;
  params?: Record<string, unknown>;
  sourceBlockId: string;
  title: string;
}

interface PluginImageOperationCompletionInput {
  asset: AssetRecord;
  executionId: string;
}

interface PluginImageOperationFailureInput {
  errorMessage: string;
  executionId: string;
}

export function addPluginImageOperation(
  snapshot: BoardSnapshot,
  input: PluginImageOperationInput,
): { execution: ExecutionRecord; operationBlock: BlockRecord; resultBlock: BlockRecord } {
  const sourceBlock = snapshot.blocks.find((block) => block.blockId === input.sourceBlockId);
  if (!sourceBlock || sourceBlock.type !== 'image') {
    throw new Error('Plugin image operation requires a selected image block.');
  }
  if (input.capabilityDefinition.capabilityId !== input.capabilityId) {
    throw new Error('Plugin image operation Capability definition does not match capabilityId.');
  }

  const createdAt = nowIso();
  const executionId = createId('exec');
  const nextZ = maxZIndex(snapshot.blocks) + 1;
  const operationSize = { width: 320, height: 190 };
  const resultSize = { ...sourceBlock.size };
  const branchLayout = pluginImageOperationBranchLayout(
    snapshot,
    sourceBlock,
    operationSize,
    resultSize,
  );
  const operationBlock: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'operation',
    layerId: 'layer_default',
    parentGroupId: branchLayout.parentGroupId,
    position: branchLayout.operationPosition,
    size: operationSize,
    zIndex: nextZ,
    data: {
      title: input.title,
      body: input.body,
      status: 'running',
      adapter: 'local_canvas',
      triggerMode: 'local_canvas',
      capabilityId: input.capabilityId,
      operationMode: input.capabilityId,
      pluginParameters: input.params,
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
    parentGroupId: branchLayout.parentGroupId,
    position: branchLayout.resultPosition,
    size: resultSize,
    zIndex: nextZ + 1,
    data: {
      title: input.title,
      body: input.body,
      status: 'running',
      operationBlockId: operationBlock.blockId,
      sourceExecutionId: executionId,
    },
    createdAt,
    updatedAt: createdAt,
  };
  const execution: ExecutionRecord = {
    executionId,
    recordVersion: 1,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId: input.capabilityId,
    adapter: 'local_canvas',
    status: 'running',
    inputBlockIds: [sourceBlock.blockId],
    inputAssetIds: [sourceBlock.data.assetId].filter(
      (assetId): assetId is string => typeof assetId === 'string',
    ),
    outputBlockIds: [resultBlock.blockId],
    outputAssetIds: [],
    triggerMode: 'local_canvas',
    params: {
      pluginParameters: input.params,
      inputBindings: [{
        assetId: sourceBlock.data.assetId,
        blockId: sourceBlock.blockId,
        inputSlotId: 'source_image',
      }],
      operationBlockId: operationBlock.blockId,
    },
    startedAt: createdAt,
  };

  snapshot.blocks.push(operationBlock, resultBlock);
  if (operationBlock.parentGroupId) {
    expandGroupToContents(snapshot, operationBlock.parentGroupId);
  }
  ensureEdge(snapshot, sourceBlock.blockId, operationBlock.blockId, 'execution_input', 'source_image');
  ensureEdge(snapshot, operationBlock.blockId, resultBlock.blockId, 'execution_output');
  recordExecutionConfiguration(
    snapshot,
    execution,
    operationBlock,
    input.capabilityDefinition,
  );
  snapshot.executions.unshift(execution);
  const historyEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'operation_created',
    createdAt,
    actor: 'user',
    executionId,
    blockIds: [sourceBlock.blockId, operationBlock.blockId, resultBlock.blockId],
    assetIds: [sourceBlock.data.assetId].filter(
      (assetId): assetId is string => typeof assetId === 'string',
    ),
    summary: input.title,
    detail: {
      capabilityId: input.capabilityId,
      parameters: input.params,
      operationBlockId: operationBlock.blockId,
      resultBlockId: resultBlock.blockId,
      sourceBlockId: sourceBlock.blockId,
    },
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);

  return { execution, operationBlock, resultBlock };
}

export function completePluginImageOperation(
  snapshot: BoardSnapshot,
  input: PluginImageOperationCompletionInput,
): { execution: ExecutionRecord; operationBlock: BlockRecord; resultBlock: BlockRecord } {
  const execution = snapshot.executions.find(
    (candidate) => candidate.executionId === input.executionId,
  );
  if (!execution || execution.adapter !== 'local_canvas' || execution.status !== 'running') {
    throw new Error(`Plugin image execution is not running: ${input.executionId}`);
  }
  const operationBlockId = typeof execution.params?.operationBlockId === 'string'
    ? execution.params.operationBlockId
    : undefined;
  const operationBlock = snapshot.blocks.find(
    (block) => block.blockId === operationBlockId && block.type === 'operation',
  );
  const resultBlock = snapshot.blocks.find(
    (block) => block.blockId === execution.outputBlockIds[0] && block.type === 'image',
  );
  if (!operationBlock || !resultBlock) {
    throw new Error(
      `Plugin image execution is missing its operation or result block: ${input.executionId}`,
    );
  }

  const completedAt = nowIso();
  const asset = { ...input.asset, sourceExecutionId: execution.executionId };
  if (!snapshot.assets.some((candidate) => candidate.assetId === asset.assetId)) {
    snapshot.assets.unshift(asset);
  }
  execution.status = 'succeeded';
  advanceExecutionRecordVersion(execution);
  execution.completedAt = completedAt;
  execution.outputAssetIds = [asset.assetId];
  syncExecutionOutputContractSnapshot(execution);
  delete execution.errorMessage;
  operationBlock.data.status = 'succeeded';
  operationBlock.updatedAt = completedAt;
  resultBlock.data.assetId = asset.assetId;
  resultBlock.data.status = 'succeeded';
  resultBlock.size = fitImageBlockSize(asset.width, asset.height);
  refreshWorkflowGroupLayoutForBlock(snapshot, resultBlock);
  resultBlock.updatedAt = completedAt;

  const resultUpdatedEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'result_block_updated',
    createdAt: completedAt,
    actor: 'system',
    executionId: execution.executionId,
    blockIds: [resultBlock.blockId],
    assetIds: [asset.assetId],
    summary: `Result updated: ${execution.capabilityId}`,
  };
  const succeededEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'execution_succeeded',
    createdAt: completedAt,
    actor: 'system',
    executionId: execution.executionId,
    blockIds: [operationBlock.blockId, resultBlock.blockId],
    assetIds: [asset.assetId],
    summary: `Execution succeeded: ${execution.capabilityId}`,
  };
  snapshot.historyEvents = [
    succeededEvent,
    resultUpdatedEvent,
    ...(snapshot.historyEvents ?? []),
  ].slice(0, 200);
  touchBoard(snapshot);
  return { execution, operationBlock, resultBlock };
}

export function failPluginImageOperation(
  snapshot: BoardSnapshot,
  input: PluginImageOperationFailureInput,
): ExecutionRecord | undefined {
  const execution = snapshot.executions.find(
    (candidate) => candidate.executionId === input.executionId,
  );
  if (!execution || execution.adapter !== 'local_canvas' || execution.status !== 'running') {
    return execution;
  }

  const completedAt = nowIso();
  execution.status = 'failed';
  advanceExecutionRecordVersion(execution);
  execution.completedAt = completedAt;
  syncExecutionOutputContractSnapshot(execution);
  execution.errorMessage = input.errorMessage;
  const blockIds = [
    typeof execution.params?.operationBlockId === 'string'
      ? execution.params.operationBlockId
      : undefined,
    ...execution.outputBlockIds,
  ].filter((blockId): blockId is string => typeof blockId === 'string');
  for (const block of snapshot.blocks) {
    if (!blockIds.includes(block.blockId)) continue;
    block.data.status = 'failed';
    block.updatedAt = completedAt;
  }
  const historyEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'execution_failed',
    createdAt: completedAt,
    actor: 'system',
    executionId: execution.executionId,
    blockIds,
    summary: `Execution failed: ${execution.capabilityId}`,
    detail: { errorMessage: input.errorMessage },
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);
  return execution;
}

function ensureEdge(
  snapshot: BoardSnapshot,
  sourceBlockId: string,
  targetBlockId: string,
  kind: 'execution_input' | 'execution_output',
  inputSlotId?: string,
): void {
  const existingEdge = snapshot.edges.find(
    (edge) => edge.sourceBlockId === sourceBlockId
      && edge.targetBlockId === targetBlockId
      && edge.kind === kind,
  );
  if (existingEdge) {
    if (inputSlotId && !existingEdge.inputSlotId) existingEdge.inputSlotId = inputSlotId;
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
