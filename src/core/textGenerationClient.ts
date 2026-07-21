import type { BoardSnapshot, ExecutionRecord } from './types';

export async function startTextGeneration(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  connectionId: string;
}): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  return readJsonResponse(await fetch(
    `/api/local/text/generate/executions/${encodeURIComponent(input.executionId)}/run`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  ));
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => undefined) as T & { error?: string } | undefined;
  if (!response.ok) throw new Error(body?.error ?? `Text generation request failed (${response.status}).`);
  return body as T;
}
