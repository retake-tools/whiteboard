import { createGeneratedImageAsset } from './assetStore';
import { maxZIndex, touchBoard } from './blockFactory';
import { createId, nowIso } from './id';
import type { AssetRecord, BlockRecord, BoardSnapshot, ExecutionRecord } from './types';

export function createMockExecution(
  snapshot: BoardSnapshot,
  selectedBlockIds: string[],
): { execution: ExecutionRecord; inputBlockIds: string[] } {
  const inputBlockIds = selectedBlockIds.length > 0 ? selectedBlockIds : ['block_brief'];
  const sourceBlock = snapshot.blocks.find((block) => block.blockId === inputBlockIds[0]);
  const executionId = createId('exec');

  return {
    inputBlockIds,
    execution: {
      executionId,
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
      capabilityId: 'image.text_to_image',
      adapter: 'mock',
      status: 'running',
      inputBlockIds,
      outputBlockIds: [],
      outputAssetIds: [],
      agentHost: 'codex',
      triggerMode: 'manual_agent_session',
      skillId: 'image.general_concept',
      prompt: sourceBlock?.data.body ?? sourceBlock?.data.title ?? 'Generate image',
      startedAt: nowIso(),
    },
  };
}

export async function createMockExecutionAsset(
  projectId: string,
  executionId: string,
): Promise<AssetRecord> {
  return createGeneratedImageAsset(projectId, executionId);
}

export function addMockExecutionResult(
  snapshot: BoardSnapshot,
  executionId: string,
  inputBlockIds: string[],
  asset: AssetRecord,
): BoardSnapshot {
  const operationBlockId = createId('block');
  const resultBlockId = createId('block');
  const source = snapshot.blocks.find((block) => block.blockId === inputBlockIds[0]);
  const rightEdge = snapshot.blocks.reduce((max, block) => Math.max(max, block.position.x + block.size.width), 0);
  const position = {
    x: rightEdge + 120,
    y: source ? source.position.y + 40 : 160,
  };
  const createdAt = nowIso();

  const operationBlock: BlockRecord = {
    blockId: operationBlockId,
    boardId: snapshot.board.boardId,
    type: 'operation',
    layerId: 'layer_default',
    position,
    size: { width: 320, height: 190 },
    zIndex: maxZIndex(snapshot.blocks) + 1,
    data: {
      title: 'Mock image operation',
      body: 'Local mock execution for development.',
      capabilityId: 'image.text_to_image',
      status: 'succeeded',
      sourceExecutionId: executionId,
    },
    createdAt,
    updatedAt: createdAt,
  };

  const resultBlock: BlockRecord = {
    blockId: resultBlockId,
    boardId: snapshot.board.boardId,
    type: 'image',
    layerId: 'layer_default',
    position: {
      x: operationBlock.position.x + operationBlock.size.width + 80,
      y: operationBlock.position.y,
    },
    size: { width: 300, height: 230 },
    zIndex: operationBlock.zIndex + 1,
    data: {
      title: 'Generated image result',
      body: 'Imported into AssetStore before creating this result block.',
      assetId: asset.assetId,
      operationBlockId,
      sourceExecutionId: executionId,
      status: 'succeeded',
    },
    createdAt,
    updatedAt: createdAt,
  };

  snapshot.assets.unshift(asset);
  snapshot.blocks.push(operationBlock, resultBlock);
  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId: inputBlockIds[0],
    targetBlockId: operationBlockId,
    kind: 'execution_input',
  });
  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId: operationBlockId,
    targetBlockId: resultBlockId,
    kind: 'execution_output',
  });

  const existingExecution = snapshot.executions.find((item) => item.executionId === executionId);
  if (existingExecution) {
    existingExecution.status = 'succeeded';
    existingExecution.outputAssetIds = [asset.assetId];
    existingExecution.outputBlockIds = [resultBlockId];
    existingExecution.params = {
      ...(existingExecution.params ?? {}),
      operationBlockId,
    };
    existingExecution.completedAt = nowIso();
  }

  return touchBoard(snapshot);
}
