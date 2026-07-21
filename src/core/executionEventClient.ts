import type { BoardSnapshot } from './types';

export type ExecutionClientEvent =
  | { type: 'execution.started' }
  | { type: 'execution.progress'; message: string }
  | { type: 'text.delta'; delta: string; resultBlockId: string }
  | { type: 'execution.snapshot'; snapshot: BoardSnapshot }
  | { type: 'execution.failed'; errorMessage: string; snapshot?: BoardSnapshot };

export function subscribeExecutionEvents(input: {
  executionId: string;
  projectId: string;
  boardId: string;
  onEvent: (event: ExecutionClientEvent) => void;
  onError?: () => void;
}): () => void {
  const params = new URLSearchParams({ projectId: input.projectId, boardId: input.boardId });
  const source = new EventSource(
    `/api/local/executions/${encodeURIComponent(input.executionId)}/events?${params.toString()}`,
  );
  const listener = (rawEvent: Event) => {
    const event = rawEvent as MessageEvent<string>;
    try {
      const envelope = JSON.parse(event.data) as { payload?: ExecutionClientEvent };
      if (envelope.payload) input.onEvent(envelope.payload);
    } catch {
      // Ignore malformed transport frames. The persisted snapshot remains authoritative.
    }
  };
  source.addEventListener('execution', listener);
  source.onerror = () => input.onError?.();
  return () => {
    source.removeEventListener('execution', listener);
    source.close();
  };
}
