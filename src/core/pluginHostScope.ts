import type {
  BlockRecord,
  BoardSnapshot,
  ExecutionRecord,
} from './types';

export interface PluginHostBoundScope {
  boundAssetIds: string[];
  boundBlockIds: string[];
  boundGroupIds: string[];
}

export function pluginHostBoundScope(
  snapshot: BoardSnapshot,
  selectedBlockIds: readonly string[],
  inspectorBlockId?: string,
): PluginHostBoundScope {
  const boundBlockIds = new Set(selectedBlockIds);
  if (inspectorBlockId) boundBlockIds.add(inspectorBlockId);
  const boundAssetIds = new Set<string>();
  const visitedOperationIds = new Set<string>();

  for (const blockId of [...boundBlockIds]) {
    const block = snapshot.blocks.find(
      (candidate) => candidate.blockId === blockId,
    );
    if (!block) continue;
    const operation = operationForBlock(snapshot, block);
    if (!operation || visitedOperationIds.has(operation.blockId)) continue;
    visitedOperationIds.add(operation.blockId);
    boundBlockIds.add(operation.blockId);
    const execution = executionForOperation(snapshot, operation);
    for (const inputBlockId of execution?.inputBlockIds ?? []) {
      boundBlockIds.add(inputBlockId);
    }
    for (const inputAssetId of execution?.inputAssetIds ?? []) {
      boundAssetIds.add(inputAssetId);
    }
    for (const binding of execution?.inputBindingsSnapshot ?? []) {
      for (const value of binding.values) {
        if (value.kind === 'block') boundBlockIds.add(value.blockId);
        if (value.kind === 'asset') {
          boundAssetIds.add(value.assetId);
          if (value.blockId) boundBlockIds.add(value.blockId);
        }
      }
    }
    const compositeAssetId = operation.data.annotatedCompositeAssetId;
    if (typeof compositeAssetId === 'string') {
      boundAssetIds.add(compositeAssetId);
    }
  }

  const boundBlocks = snapshot.blocks.filter(
    (block) => boundBlockIds.has(block.blockId),
  );
  for (const block of boundBlocks) {
    if (typeof block.data.assetId === 'string') {
      boundAssetIds.add(block.data.assetId);
    }
  }

  return {
    boundAssetIds: [...boundAssetIds].sort(),
    boundBlockIds: boundBlocks
      .filter((block) => block.type !== 'group')
      .map((block) => block.blockId)
      .sort(),
    boundGroupIds: [...new Set(boundBlocks.flatMap((block) => [
      ...(block.type === 'group' ? [block.blockId] : []),
      ...(block.parentGroupId ? [block.parentGroupId] : []),
    ]))].sort(),
  };
}

function operationForBlock(
  snapshot: BoardSnapshot,
  block: BlockRecord,
): BlockRecord | undefined {
  if (block.type === 'operation') return block;
  const operationBlockId = typeof block.data.operationBlockId === 'string'
    ? block.data.operationBlockId
    : undefined;
  if (operationBlockId) {
    return snapshot.blocks.find(
      (candidate) => (
        candidate.blockId === operationBlockId
        && candidate.type === 'operation'
      ),
    );
  }
  const executionId = typeof block.data.sourceExecutionId === 'string'
    ? block.data.sourceExecutionId
    : undefined;
  const execution = executionId
    ? snapshot.executions.find(
        (candidate) => candidate.executionId === executionId,
      )
    : undefined;
  const executionOperationBlockId =
    typeof execution?.params?.operationBlockId === 'string'
      ? execution.params.operationBlockId
      : undefined;
  return executionOperationBlockId
    ? snapshot.blocks.find(
        (candidate) => (
          candidate.blockId === executionOperationBlockId
          && candidate.type === 'operation'
        ),
      )
    : undefined;
}

function executionForOperation(
  snapshot: BoardSnapshot,
  operation: BlockRecord,
): ExecutionRecord | undefined {
  const executionId = typeof operation.data.sourceExecutionId === 'string'
    ? operation.data.sourceExecutionId
    : undefined;
  return executionId
    ? snapshot.executions.find(
        (candidate) => candidate.executionId === executionId,
      )
    : snapshot.executions.find(
        (candidate) => (
          candidate.params?.operationBlockId === operation.blockId
        ),
      );
}
