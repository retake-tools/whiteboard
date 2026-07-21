import type { BoardSnapshot, ExecutionRecord } from './types';

export async function startVolcengineArkImage(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  connectionId: string;
  resultBlockId?: string;
}): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  const response = await fetch(`/api/local/image/volcengine-ark/executions/${encodeURIComponent(input.executionId)}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      projectId: input.projectId,
      boardId: input.boardId,
      connectionId: input.connectionId,
      resultBlockId: input.resultBlockId,
    }),
  });
  const payload = await response.json() as {
    error?: string;
    snapshot?: BoardSnapshot;
    execution?: ExecutionRecord;
  };
  if (!response.ok || !payload.snapshot || !payload.execution) {
    throw new Error(payload.error || `Volcengine Ark image generation failed (${response.status}).`);
  }
  return { snapshot: payload.snapshot, execution: payload.execution };
}
