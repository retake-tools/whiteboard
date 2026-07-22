import { useSyncExternalStore } from 'react';

const contentByBlockId = new Map<string, string>();
const listenersByBlockId = new Map<string, Set<() => void>>();

export function beginDocumentStream(blockId: string): void {
  contentByBlockId.set(blockId, '');
  emit(blockId);
}

export function appendDocumentStream(blockId: string, delta: string): void {
  if (!delta) return;
  contentByBlockId.set(blockId, `${contentByBlockId.get(blockId) ?? ''}${delta}`);
  emit(blockId);
}

export function documentStreamContent(blockId: string): string {
  return contentByBlockId.get(blockId) ?? '';
}

export function useDocumentStream(blockId: string): string {
  return useSyncExternalStore(
    (listener) => subscribe(blockId, listener),
    () => documentStreamContent(blockId),
    () => '',
  );
}

function subscribe(blockId: string, listener: () => void): () => void {
  const listeners = listenersByBlockId.get(blockId) ?? new Set<() => void>();
  listeners.add(listener);
  listenersByBlockId.set(blockId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) listenersByBlockId.delete(blockId);
  };
}

function emit(blockId: string): void {
  for (const listener of listenersByBlockId.get(blockId) ?? []) listener();
}
