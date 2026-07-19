import { useEffect, useRef, useState } from 'react';
import {
  createFallbackBoardSnapshot,
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

export function useBoardSession(t: ReturnType<typeof useI18n>['t']) {
  const initialSnapshotRef = useRef<BoardSnapshot | null>(null);
  if (initialSnapshotRef.current === null) initialSnapshotRef.current = createFallbackBoardSnapshot();

  const [snapshot, setSnapshot] = useState<BoardSnapshot>(() => initialSnapshotRef.current!);
  const snapshotRef = useRef<BoardSnapshot>(initialSnapshotRef.current);
  const historyRef = useRef<{ past: BoardSnapshot[]; future: BoardSnapshot[] }>({ past: [], future: [] });
  const pendingPersistCountRef = useRef(0);
  const initialSnapshotLoadedRef = useRef(false);
  const annotationDraftPersistTimerRef = useRef<number | undefined>(undefined);
  const portsRef = useRef<BoardSessionPorts>({
    onBoardLoaded: () => undefined,
    onRemoteSnapshot: () => undefined,
    syncFlow: () => undefined,
  });
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [, setHistoryRevision] = useState(0);
  snapshotRef.current = snapshot;

  useEffect(() => {
    let cancelled = false;
    void loadBoardSnapshot().then((loadedSnapshot) => {
      if (cancelled) return;
      initialSnapshotLoadedRef.current = true;
      snapshotRef.current = loadedSnapshot;
      setSnapshot(loadedSnapshot);
      historyRef.current = { past: [], future: [] };
      setHistoryRevision((revision) => revision + 1);
      portsRef.current.onBoardLoaded(loadedSnapshot);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => subscribeToBoardSnapshotChanges({
    getCurrentSnapshot: () => snapshotRef.current,
    isPaused: () => pendingPersistCountRef.current > 0,
    onSnapshot: (remoteSnapshot) => {
      if (pendingPersistCountRef.current > 0 || isOlderSnapshot(remoteSnapshot, snapshotRef.current)) return;
      snapshotRef.current = remoteSnapshot;
      setSnapshot(remoteSnapshot);
      portsRef.current.onRemoteSnapshot(remoteSnapshot);
      setAutosaveStatus('saved');
    },
  }), []);

  useEffect(() => () => {
    if (annotationDraftPersistTimerRef.current !== undefined) {
      window.clearTimeout(annotationDraftPersistTimerRef.current);
    }
  }, []);

  function connectPorts(ports: BoardSessionPorts): void {
    portsRef.current = ports;
  }

  function updateSnapshot(
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options: UpdateSnapshotOptions = {},
  ): BoardSnapshot {
    const currentSnapshot = snapshotRef.current;
    const nextSnapshot = updater(structuredClone(currentSnapshot));
    if (options.history) {
      historyRef.current.past.push(structuredClone(currentSnapshot));
      historyRef.current.future = [];
      setHistoryRevision((revision) => revision + 1);
    }
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    if (options.syncFlow ?? true) portsRef.current.syncFlow(nextSnapshot);
    if (options.persist) void persistSnapshot(nextSnapshot);
    return nextSnapshot;
  }

  function applyLoadedSnapshot(nextSnapshot: BoardSnapshot): void {
    rememberCurrentBoard(nextSnapshot);
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    historyRef.current = { past: [], future: [] };
    setHistoryRevision((revision) => revision + 1);
    setAutosaveStatus('idle');
    portsRef.current.onBoardLoaded(nextSnapshot);
  }

  async function persistSnapshot(
    nextSnapshot: BoardSnapshot,
    options: { requireLocalApi?: boolean } = {},
  ): Promise<void> {
    if (!initialSnapshotLoadedRef.current) return;
    pendingPersistCountRef.current += 1;
    setAutosaveStatus('saving');
    try {
      const result = await saveBoardSnapshot(nextSnapshot);
      if (options.requireLocalApi && result.persistedTo !== 'local-api') {
        throw new Error(t('feedback.localApiUnavailable'));
      }
      setAutosaveStatus('saved');
    } catch (error) {
      setAutosaveStatus('error');
      if (options.requireLocalApi) throw error;
    } finally {
      pendingPersistCountRef.current = Math.max(0, pendingPersistCountRef.current - 1);
    }
  }

  function scheduleAnnotationDraftPersist(): void {
    if (annotationDraftPersistTimerRef.current !== undefined) {
      window.clearTimeout(annotationDraftPersistTimerRef.current);
    }
    annotationDraftPersistTimerRef.current = window.setTimeout(() => {
      annotationDraftPersistTimerRef.current = undefined;
      void persistSnapshot(snapshotRef.current);
    }, 300);
  }

  function flushAnnotationDraftPersist(): void {
    if (annotationDraftPersistTimerRef.current === undefined) return;
    window.clearTimeout(annotationDraftPersistTimerRef.current);
    annotationDraftPersistTimerRef.current = undefined;
    void persistSnapshot(snapshotRef.current);
  }

  function undo(): void {
    const previous = historyRef.current.past.pop();
    if (!previous) return;
    historyRef.current.future.push(structuredClone(snapshotRef.current));
    snapshotRef.current = structuredClone(previous);
    setSnapshot(snapshotRef.current);
    portsRef.current.syncFlow(snapshotRef.current);
    void persistSnapshot(snapshotRef.current);
    setHistoryRevision((revision) => revision + 1);
  }

  function redo(): void {
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(structuredClone(snapshotRef.current));
    snapshotRef.current = structuredClone(next);
    setSnapshot(snapshotRef.current);
    portsRef.current.syncFlow(snapshotRef.current);
    void persistSnapshot(snapshotRef.current);
    setHistoryRevision((revision) => revision + 1);
  }

  return {
    applyLoadedSnapshot,
    autosaveStatus,
    canRedo: historyRef.current.future.length > 0,
    canUndo: historyRef.current.past.length > 0,
    connectPorts,
    flushAnnotationDraftPersist,
    persistSnapshot,
    redo,
    scheduleAnnotationDraftPersist,
    snapshot,
    snapshotRef,
    undo,
    updateSnapshot,
  };
}
