import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  loadBoardSnapshot,
  rememberCurrentBoard,
  saveBoardSnapshot,
  subscribeToBoardSnapshotChanges,
} from '../core/boardStore';
import type { BoardSnapshot } from '../core/types';
import type { AutosaveStatus } from '../components/TopBar';
import type { useI18n } from '../i18n';
import { isOlderSnapshot } from './appHelpers';

export interface BoardSessionPorts {
  onBoardLoaded: (snapshot: BoardSnapshot) => void;
  onRemoteSnapshot: (snapshot: BoardSnapshot) => void;
  syncFlow: (snapshot: BoardSnapshot) => void;
}

interface UpdateSnapshotOptions {
  history?: boolean;
  persist?: boolean;
  syncFlow?: boolean;
}

interface PersistSnapshotOptions {
  requireLocalApi?: boolean;
}

export interface ReadyBoardSession {
  status: 'ready';
  applyLoadedSnapshot: (snapshot: BoardSnapshot) => void;
  autosaveStatus: AutosaveStatus;
  canRedo: boolean;
  canUndo: boolean;
  connectPorts: (ports: BoardSessionPorts) => void;
  flushAnnotationDraftPersist: () => void;
  persistSnapshot: (snapshot: BoardSnapshot, options?: PersistSnapshotOptions) => Promise<void>;
  redo: () => void;
  retrySave: () => Promise<void>;
  scheduleAnnotationDraftPersist: () => void;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  undo: () => void;
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: UpdateSnapshotOptions,
  ) => BoardSnapshot;
}

export type BoardSessionResult =
  | { status: 'loading' }
  | { status: 'error'; errorMessage: string; retryLoad: () => void }
  | ReadyBoardSession;

type BoardLoadState =
  | { status: 'loading' }
  | { status: 'error'; errorMessage: string }
  | { status: 'ready'; snapshot: BoardSnapshot };

export function useBoardSession(t: ReturnType<typeof useI18n>['t']): BoardSessionResult {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<BoardLoadState>({ status: 'loading' });
  const tRef = useRef(t);
  const snapshotRef = useRef<BoardSnapshot | undefined>(undefined);
  const historyRef = useRef<{ past: BoardSnapshot[]; future: BoardSnapshot[] }>({ past: [], future: [] });
  const pendingPersistCountRef = useRef(0);
  const hasUnsavedChangesRef = useRef(false);
  const annotationDraftPersistTimerRef = useRef<number | undefined>(undefined);
  const portsRef = useRef<BoardSessionPorts>({
    onBoardLoaded: () => undefined,
    onRemoteSnapshot: () => undefined,
    syncFlow: () => undefined,
  });
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [, setHistoryRevision] = useState(0);
  tRef.current = t;

  useEffect(() => {
    let cancelled = false;
    snapshotRef.current = undefined;
    hasUnsavedChangesRef.current = false;
    setLoadState({ status: 'loading' });
    setAutosaveStatus('idle');
    void loadBoardSnapshot()
      .then((loadedSnapshot) => {
        if (cancelled) return;
        snapshotRef.current = loadedSnapshot;
        historyRef.current = { past: [], future: [] };
        setHistoryRevision((revision) => revision + 1);
        setLoadState({ status: 'ready', snapshot: loadedSnapshot });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        snapshotRef.current = undefined;
        setLoadState({
          status: 'error',
          errorMessage: error instanceof Error ? error.message : tRef.current('feedback.localApiUnavailable'),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  const isReady = loadState.status === 'ready';
  useEffect(() => {
    if (!isReady) return undefined;
    return subscribeToBoardSnapshotChanges({
      getCurrentSnapshot: requireCurrentSnapshot,
      isPaused: () => pendingPersistCountRef.current > 0 || hasUnsavedChangesRef.current,
      onSnapshot: (remoteSnapshot) => {
        const currentSnapshot = requireCurrentSnapshot();
        if (pendingPersistCountRef.current > 0 || isOlderSnapshot(remoteSnapshot, currentSnapshot)) return;
        snapshotRef.current = remoteSnapshot;
        hasUnsavedChangesRef.current = false;
        setLoadState({ status: 'ready', snapshot: remoteSnapshot });
        portsRef.current.onRemoteSnapshot(remoteSnapshot);
        setAutosaveStatus('saved');
      },
    });
  }, [isReady]);

  useEffect(() => () => {
    if (annotationDraftPersistTimerRef.current !== undefined) {
      window.clearTimeout(annotationDraftPersistTimerRef.current);
    }
  }, []);

  function requireCurrentSnapshot(): BoardSnapshot {
    const current = snapshotRef.current;
    if (!current) throw new Error('Board snapshot is not ready.');
    return current;
  }

  function connectPorts(ports: BoardSessionPorts): void {
    portsRef.current = ports;
  }

  function setReadySnapshot(nextSnapshot: BoardSnapshot): void {
    snapshotRef.current = nextSnapshot;
    setLoadState({ status: 'ready', snapshot: nextSnapshot });
  }

  function updateSnapshot(
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options: UpdateSnapshotOptions = {},
  ): BoardSnapshot {
    const currentSnapshot = requireCurrentSnapshot();
    const nextSnapshot = updater(structuredClone(currentSnapshot));
    if (options.history) {
      historyRef.current.past.push(structuredClone(currentSnapshot));
      historyRef.current.future = [];
      setHistoryRevision((revision) => revision + 1);
    }
    setReadySnapshot(nextSnapshot);
    if (options.syncFlow ?? true) portsRef.current.syncFlow(nextSnapshot);
    if (options.persist) void persistSnapshot(nextSnapshot);
    return nextSnapshot;
  }

  function applyLoadedSnapshot(nextSnapshot: BoardSnapshot): void {
    rememberCurrentBoard(nextSnapshot);
    setReadySnapshot(nextSnapshot);
    historyRef.current = { past: [], future: [] };
    hasUnsavedChangesRef.current = false;
    setHistoryRevision((revision) => revision + 1);
    setAutosaveStatus('idle');
    portsRef.current.onBoardLoaded(nextSnapshot);
  }

  async function persistSnapshot(
    nextSnapshot: BoardSnapshot,
    options: PersistSnapshotOptions = {},
  ): Promise<void> {
    hasUnsavedChangesRef.current = true;
    pendingPersistCountRef.current += 1;
    setAutosaveStatus('saving');
    try {
      await saveBoardSnapshot(nextSnapshot);
      hasUnsavedChangesRef.current = false;
      setAutosaveStatus('saved');
    } catch (error) {
      setAutosaveStatus('error');
      if (options.requireLocalApi) throw error;
    } finally {
      pendingPersistCountRef.current = Math.max(0, pendingPersistCountRef.current - 1);
    }
  }

  async function retrySave(): Promise<void> {
    await persistSnapshot(requireCurrentSnapshot());
  }

  function scheduleAnnotationDraftPersist(): void {
    if (annotationDraftPersistTimerRef.current !== undefined) {
      window.clearTimeout(annotationDraftPersistTimerRef.current);
    }
    annotationDraftPersistTimerRef.current = window.setTimeout(() => {
      annotationDraftPersistTimerRef.current = undefined;
      const currentSnapshot = snapshotRef.current;
      if (currentSnapshot) void persistSnapshot(currentSnapshot);
    }, 300);
  }

  function flushAnnotationDraftPersist(): void {
    if (annotationDraftPersistTimerRef.current === undefined) return;
    window.clearTimeout(annotationDraftPersistTimerRef.current);
    annotationDraftPersistTimerRef.current = undefined;
    const currentSnapshot = snapshotRef.current;
    if (currentSnapshot) void persistSnapshot(currentSnapshot);
  }

  function undo(): void {
    const previous = historyRef.current.past.pop();
    if (!previous) return;
    historyRef.current.future.push(structuredClone(requireCurrentSnapshot()));
    setReadySnapshot(structuredClone(previous));
    portsRef.current.syncFlow(previous);
    void persistSnapshot(previous);
    setHistoryRevision((revision) => revision + 1);
  }

  function redo(): void {
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(structuredClone(requireCurrentSnapshot()));
    setReadySnapshot(structuredClone(next));
    portsRef.current.syncFlow(next);
    void persistSnapshot(next);
    setHistoryRevision((revision) => revision + 1);
  }

  if (loadState.status === 'loading') return { status: 'loading' };
  if (loadState.status === 'error') {
    return {
      status: 'error',
      errorMessage: loadState.errorMessage,
      retryLoad: () => setLoadAttempt((attempt) => attempt + 1),
    };
  }

  return {
    status: 'ready',
    applyLoadedSnapshot,
    autosaveStatus,
    canRedo: historyRef.current.future.length > 0,
    canUndo: historyRef.current.past.length > 0,
    connectPorts,
    flushAnnotationDraftPersist,
    persistSnapshot,
    redo,
    retrySave,
    scheduleAnnotationDraftPersist,
    snapshot: loadState.snapshot,
    snapshotRef: snapshotRef as RefObject<BoardSnapshot>,
    undo,
    updateSnapshot,
  };
}
