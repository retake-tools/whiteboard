import type { BoardSnapshot } from './types';

export async function reconcileWorkflowArtifactGates(input: {
  boardId: string;
  projectId: string;
  workflowRunId?: string;
}): Promise<BoardSnapshot> {
  const response = await fetch('/api/local/workflow/artifact-gates/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(payload?.error ?? 'Failed to reconcile Workflow Artifact Gates.');
  }
  return ((await response.json()) as { snapshot: BoardSnapshot }).snapshot;
}
