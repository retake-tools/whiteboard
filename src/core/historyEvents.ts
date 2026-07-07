import { createId, nowIso } from './id';
import type { BoardHistoryEvent, BoardSnapshot } from './types';

export function appendPromptCopiedEvent(
  snapshot: BoardSnapshot,
  input: {
    blockIds?: string[];
    executionId?: string;
    prompt: string;
    source: string;
  },
): BoardSnapshot {
  const event: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'prompt_copied',
    createdAt: nowIso(),
    actor: 'user',
    executionId: input.executionId,
    blockIds: input.blockIds,
    summary: 'Prompt copied',
    detail: {
      prompt: input.prompt,
      source: input.source,
    },
  };
  snapshot.historyEvents = [event, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  return snapshot;
}
