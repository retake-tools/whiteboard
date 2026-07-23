import type { BoardSnapshot } from './types';

export async function materializeAcceptedWorkflowOutput(input: {
  boardId: string;
  projectId: string;
  stepRunId: string;
}): Promise<BoardSnapshot> {
  const response = await fetch('/api/local/workflow/output-artifacts/materialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(payload?.error ?? 'Failed to materialize Workflow output Artifact.');
  }
  return ((await response.json()) as { snapshot: BoardSnapshot }).snapshot;
}
