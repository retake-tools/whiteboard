import { executionVersionFor } from './executionConfiguration';
import type { BlockRecord, BoardSnapshot, ExecutionRecord } from './types';

export interface ExecutionSourceLineage {
  sourceBlock?: BlockRecord;
  sourceExecution?: ExecutionRecord;
  sourceExecutionVersion?: number;
}

export function executionSourceLineage(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
): ExecutionSourceLineage {
  const sourceBlockId = sourceBindingBlockId(execution) ?? execution.inputBlockIds.find(
    (blockId) => snapshot.blocks.some((block) => block.blockId === blockId && block.type === 'image'),
  );
  const sourceBlock = sourceBlockId
    ? snapshot.blocks.find((block) => block.blockId === sourceBlockId && block.type === 'image')
    : undefined;
  const sourceExecution = typeof sourceBlock?.data.sourceExecutionId === 'string'
    ? snapshot.executions.find((candidate) => candidate.executionId === sourceBlock.data.sourceExecutionId)
    : undefined;
  return {
    sourceBlock,
    sourceExecution,
    sourceExecutionVersion: sourceExecution ? executionVersionFor(snapshot, sourceExecution) : undefined,
  };
}

function sourceBindingBlockId(execution: ExecutionRecord): string | undefined {
  if (!Array.isArray(execution.params?.inputBindings)) return undefined;
  const sourceBinding = execution.params.inputBindings.find(
    (binding) =>
      binding &&
      typeof binding === 'object' &&
      (binding as Record<string, unknown>).inputRole === 'source',
  ) as Record<string, unknown> | undefined;
  return typeof sourceBinding?.blockId === 'string' ? sourceBinding.blockId : undefined;
}
