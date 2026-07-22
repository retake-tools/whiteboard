import type { AgentRuntimeTurnResult } from './agentSessionContracts';

export async function requestAgentRuntimeTurn(input: {
  agentSessionId: string;
  boardId: string;
  projectId: string;
  sourceMessageId: string;
}): Promise<AgentRuntimeTurnResult> {
  const response = await fetch('/api/local/agent/runtime/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await response.json().catch(() => undefined) as AgentRuntimeTurnResult & { error?: string } | undefined;
  if (!response.ok) throw new Error(body?.error || `Agent Runtime request failed (${response.status}).`);
  return body as AgentRuntimeTurnResult;
}
