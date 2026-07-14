import { descendantBlockIds } from './grouping';
import type { BlockRecord, BoardSnapshot } from './types';

export function connectedWorkflowBlockIds(snapshot: BoardSnapshot, startBlockId: string): string[] {
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  if (!blockById.has(startBlockId)) return [];

  const visited = new Set<string>();
  const queue = [startBlockId];
  while (queue.length > 0) {
    const blockId = queue.shift();
    if (!blockId || visited.has(blockId) || !blockById.has(blockId)) continue;
    visited.add(blockId);

    for (const edge of snapshot.edges) {
      if (edge.sourceBlockId === blockId) queue.push(edge.targetBlockId);
      if (edge.targetBlockId === blockId) queue.push(edge.sourceBlockId);
    }

    const block = blockById.get(blockId);
    if (!block) continue;
    addOperationRelations(snapshot, block, queue);
    addExecutionRelations(snapshot, block, queue);

    const resultGroup = block.parentGroupId ? blockById.get(block.parentGroupId) : undefined;
    if (resultGroup?.type === 'group' && resultGroup.data.groupKind === 'execution_results') {
      queue.push(resultGroup.blockId, ...descendantBlockIds(snapshot, [resultGroup.blockId]));
    }
    if (block.type === 'group' && block.data.groupKind === 'execution_results') {
      queue.push(...descendantBlockIds(snapshot, [block.blockId]));
    }
  }

  return snapshot.blocks
    .filter((block) => visited.has(block.blockId))
    .sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y)
    .map((block) => block.blockId);
}

function addOperationRelations(snapshot: BoardSnapshot, block: BlockRecord, queue: string[]): void {
  if (block.type !== 'operation') return;
  if (typeof block.data.promptSourceBlockId === 'string') queue.push(block.data.promptSourceBlockId);
  for (const candidate of snapshot.blocks) {
    if (candidate.data.operationBlockId === block.blockId) queue.push(candidate.blockId);
  }
  for (const execution of snapshot.executions) {
    if (execution.params?.operationBlockId !== block.blockId) continue;
    queue.push(...execution.inputBlockIds, ...execution.outputBlockIds);
  }
}

function addExecutionRelations(snapshot: BoardSnapshot, block: BlockRecord, queue: string[]): void {
  const executionId = typeof block.data.sourceExecutionId === 'string' ? block.data.sourceExecutionId : undefined;
  if (!executionId) return;
  const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
  if (!execution) return;
  queue.push(...execution.inputBlockIds, ...execution.outputBlockIds);
  if (typeof execution.params?.operationBlockId === 'string') queue.push(execution.params.operationBlockId);
}
