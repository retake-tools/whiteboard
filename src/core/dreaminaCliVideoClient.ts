import type { BoardSnapshot, ExecutionRecord } from './types';
import type { VideoGenerationInput } from './videoGeneration';

export async function startDreaminaCliVideo(input: VideoGenerationInput & {
  projectId: string;
  boardId: string;
}): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  return readJsonResponse(await fetch('/api/local/video/dreamina-cli/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}

export async function cancelDreaminaCliVideo(input: {
  projectId: string;
  boardId: string;
  executionId: string;
}): Promise<{ providerTaskCancelable: false }> {
  return readJsonResponse(await fetch(
    `/api/local/video/dreamina-cli/executions/${encodeURIComponent(input.executionId)}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId: input.projectId, boardId: input.boardId, remoteOnly: true }),
    },
  ));
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => undefined) as T & { error?: string } | undefined;
  if (!response.ok) throw new Error(body?.error ?? `Dreamina CLI request failed (${response.status}).`);
  return body as T;
}
