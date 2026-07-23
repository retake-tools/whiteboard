import type { BoardSnapshot } from './types';

export async function reconcileAgentArtifactTarget(input: {
  agentRunId?: string;
  boardId: string;
  projectId: string;
  workflowRunId?: string;
}): Promise<BoardSnapshot> {
  const response = await fetch('/api/local/agent/artifact-targets/reconcile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(payload?.error ?? 'Failed to reconcile Agent Artifact target.');
  }
  return ((await response.json()) as { snapshot: BoardSnapshot }).snapshot;
}
