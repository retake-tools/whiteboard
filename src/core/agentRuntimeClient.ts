import type { AgentRuntimeEvent, AgentRuntimeTurnResult } from './agentSessionContracts';

export async function requestAgentRuntimeTurn(input: {
  agentSessionId: string;
  boardId: string;
  projectId: string;
  sourceMessageId: string;
}, onEvent?: (event: AgentRuntimeEvent) => Promise<void> | void): Promise<AgentRuntimeTurnResult> {
  const response = await fetch('/api/local/agent/runtime/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => undefined) as { error?: string } | undefined;
    throw new Error(body?.error || `Agent Runtime request failed (${response.status}).`);
  }
  if (!response.body) throw new Error('Agent Runtime response stream is unavailable.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let result: AgentRuntimeTurnResult | undefined;
  let streamError: string | undefined;

  async function processLine(line: string): Promise<void> {
    if (!line.trim()) return;
    const message = JSON.parse(line) as {
      error?: string;
      event?: AgentRuntimeEvent;
      result?: AgentRuntimeTurnResult;
      type?: string;
    };
    if (message.type === 'event' && message.event) await onEvent?.(message.event);
    else if (message.type === 'result' && message.result) result = message.result;
    else if (message.type === 'error') streamError = message.error || 'Agent Runtime stream failed.';
  }

  while (true) {
    const { done, value } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) await processLine(line);
    if (done) break;
  }
  await processLine(pending);
  if (streamError) throw new Error(streamError);
  if (!result) throw new Error('Agent Runtime stream ended without a result.');
  return result;
}
