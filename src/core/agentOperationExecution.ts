import { operationReadinessFor } from './capabilities';
import { nowIso } from './id';
import type { BoardSnapshot } from './types';

export interface AgentOperationExecutionRequest {
  operationBlockId: string;
  operationPrompt?: string;
}

export function applyAgentOperationExecutionRequest(
  snapshot: BoardSnapshot,
  request: AgentOperationExecutionRequest,
): { promptBlockId?: string } {
  const operation = snapshot.blocks.find(
    (block) =>
      block.blockId === request.operationBlockId
      && block.type === 'operation',
  );
  if (!operation) {
    throw new Error('Agent-selected Operation is no longer available.');
  }
  const prompt = request.operationPrompt?.trim();
  const validationSnapshot = structuredClone(snapshot);
  const validationOperation = validationSnapshot.blocks.find(
    (block) => block.blockId === operation.blockId,
  );
  if (!validationOperation) {
    throw new Error('Agent-selected Operation is no longer available.');
  }
  let promptBlockId: string | undefined;
  if (prompt) {
    const promptEdge = validationSnapshot.edges.find(
      (edge) =>
        edge.kind === 'execution_input'
        && edge.targetBlockId === validationOperation.blockId
        && validationSnapshot.blocks.some(
          (block) =>
            block.blockId === edge.sourceBlockId
            && block.type === 'text',
        ),
    );
    const promptBlock = promptEdge
      ? validationSnapshot.blocks.find((block) => block.blockId === promptEdge.sourceBlockId)
      : undefined;
    if (!promptBlock || promptBlock.type !== 'text') {
      throw new Error('Agent-selected Operation has no editable text prompt input.');
    }
    promptBlock.data = { ...promptBlock.data, body: prompt };
    promptBlockId = promptBlock.blockId;
  }
  const readiness = operationReadinessFor(validationSnapshot, validationOperation);
  if (!readiness.canRun) {
    throw new Error(
      `Agent-selected Operation is no longer ready: ${readiness.issues.join(', ') || 'unknown'}.`,
    );
  }
  if (promptBlockId) {
    const promptBlock = snapshot.blocks.find((block) => block.blockId === promptBlockId);
    if (!promptBlock || promptBlock.type !== 'text') {
      throw new Error('Agent-selected Operation has no editable text prompt input.');
    }
    const updatedAt = nowIso();
    promptBlock.data = { ...promptBlock.data, body: prompt };
    promptBlock.updatedAt = updatedAt;
    snapshot.board.updatedAt = updatedAt;
    snapshot.project.updatedAt = updatedAt;
  }
  return { ...(promptBlockId ? { promptBlockId } : {}) };
}
