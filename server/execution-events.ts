import type { IncomingMessage, ServerResponse } from 'node:http';
import type { BoardSnapshot } from '../src/core/types';

export type ExecutionEventPayload =
  | { type: 'execution.started' }
  | { type: 'execution.progress'; message: string }
  | { type: 'text.delta'; delta: string; resultBlockId: string }
  | { type: 'execution.snapshot'; snapshot: BoardSnapshot }
  | { type: 'execution.failed'; errorMessage: string; snapshot?: BoardSnapshot };

export interface ExecutionEventEnvelope {
  sequence: number;
  executionId: string;
  createdAt: string;
  payload: ExecutionEventPayload;
}

type Listener = (event: ExecutionEventEnvelope) => void;

const listenersByExecution = new Map<string, Set<Listener>>();
const bufferedByExecution = new Map<string, ExecutionEventEnvelope[]>();
let nextSequence = 1;

export function publishExecutionEvent(executionId: string, payload: ExecutionEventPayload): ExecutionEventEnvelope {
  const event: ExecutionEventEnvelope = {
    sequence: nextSequence++,
    executionId,
    createdAt: new Date().toISOString(),
    payload,
  };
  const buffered = [...(bufferedByExecution.get(executionId) ?? []), event].slice(-200);
  bufferedByExecution.set(executionId, buffered);
  listenersByExecution.get(executionId)?.forEach((listener) => listener(event));
  return event;
}

export function installExecutionEventStream(
  req: IncomingMessage,
  res: ServerResponse,
  executionId: string,
): void {
  res.statusCode = 200;
  res.setHeader('content-type', 'text/event-stream; charset=utf-8');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders?.();

  const lastEventId = Number(req.headers['last-event-id'] ?? 0);
  const write = (event: ExecutionEventEnvelope) => {
    if (event.sequence <= lastEventId || res.writableEnded) return;
    res.write(`id: ${event.sequence}\n`);
    res.write(`event: execution\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  for (const event of bufferedByExecution.get(executionId) ?? []) write(event);

  const listeners = listenersByExecution.get(executionId) ?? new Set<Listener>();
  listeners.add(write);
  listenersByExecution.set(executionId, listeners);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': heartbeat\n\n');
  }, 15_000);
  req.on('close', () => {
    clearInterval(heartbeat);
    listeners.delete(write);
    if (listeners.size === 0) listenersByExecution.delete(executionId);
  });
}

export function resetExecutionEventsForTests(): void {
  listenersByExecution.clear();
  bufferedByExecution.clear();
  nextSequence = 1;
}
