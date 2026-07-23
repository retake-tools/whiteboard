import type { DomainVideoLaunchReviewV1 } from './domainVideoGenerationContracts';

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
