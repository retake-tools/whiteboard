import type { BoardSnapshot, ExecutionRecord } from './types';

export async function startCodexAppServerImage(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  connectionId: string;
}): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  const response = await fetch(`/api/local/image/codex-app-server/executions/${encodeURIComponent(input.executionId)}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  const payload = await response.json() as {
    error?: string;
    snapshot?: BoardSnapshot;
    execution?: ExecutionRecord;
  };
  if (!response.ok || !payload.snapshot || !payload.execution) {
    throw new Error(payload.error || `Codex App Server image generation failed (${response.status}).`);
  }
  return { snapshot: payload.snapshot, execution: payload.execution };
}
