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
      capabilityId: 'image.generate',
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
  const resultBlockId = createId('block');
  const source = snapshot.blocks.find((block) => block.blockId === inputBlockIds[0]);
  const rightEdge = snapshot.blocks.reduce((max, block) => Math.max(max, block.position.x + block.size.width), 0);
  const position = {
    x: rightEdge + 120,
    y: source ? source.position.y + 40 : 160,
  };

  const resultBlock: BlockRecord = {
    blockId: resultBlockId,
    boardId: snapshot.board.boardId,
    type: 'image',
    layerId: 'layer_default',
    position,
    size: { width: 300, height: 230 },
    zIndex: maxZIndex(snapshot.blocks) + 1,
    data: {
      title: 'Generated image result',
      body: 'Imported into AssetStore before creating this result block.',
      assetId: asset.assetId,
      sourceExecutionId: executionId,
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  snapshot.assets.unshift(asset);
  snapshot.blocks.push(resultBlock);
  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId: inputBlockIds[0],
    targetBlockId: resultBlockId,
    kind: 'derived_from',
  });

  const existingExecution = snapshot.executions.find((item) => item.executionId === executionId);
  if (existingExecution) {
    existingExecution.status = 'succeeded';
    existingExecution.outputAssetIds = [asset.assetId];
    existingExecution.outputBlockIds = [resultBlockId];
    existingExecution.completedAt = nowIso();
  }

  return touchBoard(snapshot);
}
