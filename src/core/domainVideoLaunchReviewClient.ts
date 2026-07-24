import type { DomainVideoLaunchReviewV1 } from './domainVideoGenerationContracts';
import type { BoardSnapshot, ExecutionRecord } from './types';

export async function loadDomainVideoLaunchReview(input: {
  blockId: string;
  boardId: string;
  projectId: string;
}): Promise<DomainVideoLaunchReviewV1> {
  const response = await fetch('/api/local/domain-video/launch-review', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(body?.error || 'Domain Video Launch Review failed.');
  }
  return (await response.json()) as DomainVideoLaunchReviewV1;
}

export async function startAuthorizedDomainVideoGeneration(input: {
  blockId: string;
  boardId: string;
  projectId: string;
  requestFingerprint: string;
}): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  const response = await fetch('/api/local/domain-video/execute', {
    body: JSON.stringify(input),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(body?.error || 'Domain Video execution failed.');
  }
  return (await response.json()) as { snapshot: BoardSnapshot; execution: ExecutionRecord };
}
