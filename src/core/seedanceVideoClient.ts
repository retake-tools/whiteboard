import type { BoardSnapshot, ExecutionRecord } from './types';
import type { VideoGenerationInput } from './videoGeneration';

export interface SeedanceAvailability {
  available: boolean;
  adapterId: string;
  credentialRefType: string;
  model: string;
  reason?: string;
}

export async function loadSeedanceAvailability(): Promise<SeedanceAvailability> {
  return readJsonResponse(await fetch('/api/local/video/seedance-modelark/availability'));
}

export async function startSeedanceVideo(input: VideoGenerationInput & {
  projectId: string;
  boardId: string;
}): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  return readJsonResponse(await fetch('/api/local/video/seedance-modelark/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
}

export async function cancelSeedanceVideo(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  providerTaskIds?: string[];
}): Promise<{ snapshot?: BoardSnapshot; remoteQueuedTasksCanceled: number }> {
  return readJsonResponse(await fetch(
    `/api/local/video/seedance-modelark/executions/${encodeURIComponent(input.executionId)}/cancel`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId: input.projectId,
        boardId: input.boardId,
        providerTaskIds: input.providerTaskIds,
        remoteOnly: true,
      }),
    },
  ));
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => undefined) as T & { error?: string } | undefined;
  if (!response.ok) throw new Error(body?.error ?? `Seedance request failed (${response.status}).`);
  return body as T;
}
