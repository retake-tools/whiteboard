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
import { touchBoard } from '../core/blockFactory';
import type { CanvasHostCommandsV1, CanvasHostV1 } from '../host-kit';
import { whiteboardCanvasHostBridge } from '../host-kit/internal/whiteboardCompatibility';
import {
  createWhiteboardProductCommands,
  type WhiteboardProductCommandsV1,
} from '../whiteboard/application/whiteboardProductCommands';
import { createBoardMutationQueue } from './boardMutationQueue';

export interface BoardSessionPorts {
  onBoardLoaded: (snapshot: BoardSnapshot) => void;
  onRemoteSnapshot: (snapshot: BoardSnapshot) => void;
  syncFlow: (snapshot: BoardSnapshot) => void;
}

interface PersistSnapshotOptions {
  requireLocalApi?: boolean;
}

export interface RunProductCommandOptions<Result> {
  afterCommit?: (input: {
    result: Result;
    snapshot: BoardSnapshot;
  }) => Promise<BoardSnapshot>;
  history?: boolean;
  shouldKeepHistory?: (result: Result) => boolean;
  syncFlow?: boolean;
}

export type RunProductCommand = <Result>(
  operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
  options?: RunProductCommandOptions<Result>,
) => Promise<Result>;

export interface ReadyBoardSession {
  status: 'ready';
  adoptDurableSnapshot: (snapshot: BoardSnapshot) => void;
  applyLoadedSnapshot: (snapshot: BoardSnapshot) => Promise<void>;
  autosaveStatus: AutosaveStatus;
  canRedo: boolean;
  canUndo: boolean;
  connectPorts: (ports: BoardSessionPorts) => void;
  persistSnapshot: (snapshot: BoardSnapshot, options?: PersistSnapshotOptions) => Promise<void>;
  redo: () => void;
  runHostCommand?: <Result>(
    operation: (commands: CanvasHostCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  runProductCommand?: RunProductCommand;
  retrySave: () => Promise<void>;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  undo: () => void;
}

export type BoardSessionResult =
  | { status: 'loading' }
  | { status: 'error'; errorMessage: string; retryLoad: () => void }
  | ReadyBoardSession;

type BoardLoadState =
  | { status: 'loading' }
  | { status: 'error'; errorMessage: string }
  | { status: 'ready'; snapshot: BoardSnapshot };

export function useBoardSession(
  t: ReturnType<typeof useI18n>['t'],
  canvasHost?: CanvasHostV1,
): BoardSessionResult {
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [loadState, setLoadState] = useState<BoardLoadState>(() => canvasHost
    ? {
        status: 'ready',
        snapshot: structuredClone(canvasHost.readModel.getSnapshot()) as BoardSnapshot,
      }
    : { status: 'loading' });
  const tRef = useRef(t);
  const snapshotRef = useRef<BoardSnapshot | undefined>(canvasHost
    ? structuredClone(canvasHost.readModel.getSnapshot()) as BoardSnapshot
    : undefined);
  const historyRef = useRef<{ past: BoardSnapshot[]; future: BoardSnapshot[] }>({ past: [], future: [] });
  const pendingPersistCountRef = useRef(0);
  const hasUnsavedChangesRef = useRef(false);
  const boardMutationQueueRef = useRef<ReturnType<typeof createBoardMutationQueue> | undefined>(undefined);
  const portsRef = useRef<BoardSessionPorts>({
    onBoardLoaded: () => undefined,
    onRemoteSnapshot: () => undefined,
    syncFlow: () => undefined,
  });
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const [, setHistoryRevision] = useState(0);
  if (!boardMutationQueueRef.current) {
    boardMutationQueueRef.current = createBoardMutationQueue();
  }
  tRef.current = t;

  useEffect(() => {
    if (canvasHost) {
      const initial = structuredClone(canvasHost.readModel.getSnapshot()) as BoardSnapshot;
      snapshotRef.current = initial;
      setLoadState({ status: 'ready', snapshot: initial });
      return canvasHost.readModel.subscribe((snapshot) => {
        const next = structuredClone(snapshot) as BoardSnapshot;
        snapshotRef.current = next;
        setLoadState({ status: 'ready', snapshot: next });
      });
    }
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
  }, [canvasHost, loadAttempt]);

  const isReady = loadState.status === 'ready';
  useEffect(() => {
    if (!isReady) return undefined;
    return subscribeToBoardSnapshotChanges({
      getCurrentSnapshot: requireCurrentSnapshot,
      isPaused: () => boardMutationQueueRef.current?.isPending() === true
        || pendingPersistCountRef.current > 0
        || hasUnsavedChangesRef.current,
      onSnapshot: (remoteSnapshot) => {
        const currentSnapshot = requireCurrentSnapshot();
        if (pendingPersistCountRef.current > 0 || isOlderSnapshot(remoteSnapshot, currentSnapshot)) return;
        snapshotRef.current = remoteSnapshot;
        if (canvasHost) {
          whiteboardCanvasHostBridge(canvasHost).replaceSnapshot(
            remoteSnapshot,
            { durable: true },
          );
        }
        hasUnsavedChangesRef.current = false;
        setLoadState({ status: 'ready', snapshot: remoteSnapshot });
        portsRef.current.onRemoteSnapshot(remoteSnapshot);
        setAutosaveStatus('saved');
      },
    });
  }, [canvasHost, isReady]);

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

  async function applyLoadedSnapshot(nextSnapshot: BoardSnapshot): Promise<void> {
    let appliedSnapshot = nextSnapshot;
    if (canvasHost) {
      await canvasHost.setScope({
        boardId: nextSnapshot.board.boardId,
        projectId: nextSnapshot.project.projectId,
      });
      appliedSnapshot = structuredClone(
        canvasHost.readModel.getSnapshot(),
      ) as BoardSnapshot;
    }
    rememberCurrentBoard(appliedSnapshot);
    setReadySnapshot(appliedSnapshot);
    historyRef.current = { past: [], future: [] };
    hasUnsavedChangesRef.current = false;
    setHistoryRevision((revision) => revision + 1);
    setAutosaveStatus('idle');
    portsRef.current.onBoardLoaded(appliedSnapshot);
  }

  function adoptDurableSnapshot(nextSnapshot: BoardSnapshot): void {
    replaceDurableSnapshot(nextSnapshot);
    portsRef.current.syncFlow(nextSnapshot);
    setAutosaveStatus('saved');
  }

  function replaceDurableSnapshot(nextSnapshot: BoardSnapshot): void {
    if (canvasHost) {
      whiteboardCanvasHostBridge(canvasHost).replaceSnapshot(
        nextSnapshot,
        { durable: true },
      );
    }
    setReadySnapshot(nextSnapshot);
    hasUnsavedChangesRef.current = false;
  }

  async function persistSnapshot(
    nextSnapshot: BoardSnapshot,
    options: PersistSnapshotOptions = {},
  ): Promise<void> {
    return requireBoardMutationQueue().run(async () => {
      hasUnsavedChangesRef.current = true;
      pendingPersistCountRef.current += 1;
      setAutosaveStatus('saving');
      try {
        if (canvasHost) {
          await whiteboardCanvasHostBridge(canvasHost).persistSnapshot(nextSnapshot);
        } else {
          await saveBoardSnapshot(nextSnapshot);
        }
        hasUnsavedChangesRef.current = false;
        setAutosaveStatus('saved');
      } catch (error) {
        setAutosaveStatus('error');
        if (options.requireLocalApi) throw error;
      } finally {
        pendingPersistCountRef.current = Math.max(0, pendingPersistCountRef.current - 1);
      }
    });
  }

  async function retrySave(): Promise<void> {
    await persistSnapshot(requireCurrentSnapshot());
  }

  async function runHostCommand<Result>(
    operation: (commands: CanvasHostCommandsV1) => Promise<Result>,
    options: { history?: boolean; syncFlow?: boolean } = {},
  ): Promise<Result> {
    return requireBoardMutationQueue().run(async () => {
      if (!canvasHost) throw new Error('Canvas Host command facade is unavailable.');
      const previous = structuredClone(requireCurrentSnapshot());
      if (options.history) {
        historyRef.current.past.push(previous);
        historyRef.current.future = [];
        setHistoryRevision((revision) => revision + 1);
      }
      setAutosaveStatus('saving');
      try {
        const result = await operation(canvasHost.commands);
        const next = structuredClone(canvasHost.readModel.getSnapshot()) as BoardSnapshot;
        setReadySnapshot(next);
        if (options.syncFlow ?? true) portsRef.current.syncFlow(next);
        setAutosaveStatus('saved');
        return result;
      } catch (error) {
        if (options.history) {
          historyRef.current.past.pop();
          setHistoryRevision((revision) => revision + 1);
        }
        setAutosaveStatus('error');
        throw error;
      }
    });
  }

  async function runProductCommand<Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options: RunProductCommandOptions<Result> = {},
  ): Promise<Result> {
    return requireBoardMutationQueue().run(async () => {
      if (!canvasHost) throw new Error('Whiteboard product command facade is unavailable.');
      const previous = structuredClone(requireCurrentSnapshot());
      let commandCommitted = false;
      if (options.history) {
        historyRef.current.past.push(previous);
        historyRef.current.future = [];
        setHistoryRevision((revision) => revision + 1);
      }
      setAutosaveStatus('saving');
      try {
        const result = await operation(createWhiteboardProductCommands(canvasHost));
        commandCommitted = true;
        let next = structuredClone(canvasHost.readModel.getSnapshot()) as BoardSnapshot;
        if (options.history && options.shouldKeepHistory?.(result) === false) {
          historyRef.current.past.pop();
          setHistoryRevision((revision) => revision + 1);
        }
        if (options.afterCommit) {
          next = await options.afterCommit({ result, snapshot: next });
          replaceDurableSnapshot(next);
        } else {
          setReadySnapshot(next);
        }
        if (options.syncFlow ?? true) portsRef.current.syncFlow(next);
        setAutosaveStatus('saved');
        return result;
      } catch (error) {
        if (options.history && !commandCommitted) {
          historyRef.current.past.pop();
          setHistoryRevision((revision) => revision + 1);
        }
        if (commandCommitted) await recoverCurrentDurableSnapshot();
        setAutosaveStatus('error');
        throw error;
      }
    });
  }

  function requireBoardMutationQueue() {
    const queue = boardMutationQueueRef.current;
    if (!queue) throw new Error('Board mutation queue is unavailable.');
    return queue;
  }

  async function recoverCurrentDurableSnapshot(): Promise<void> {
    try {
      const current = requireCurrentSnapshot();
      const durable = await loadBoardSnapshot({
        boardId: current.board.boardId,
        projectId: current.project.projectId,
      });
      replaceDurableSnapshot(durable);
      portsRef.current.syncFlow(durable);
    } catch {
      // Preserve the original command error when recovery cannot reach storage.
    }
  }

  function undo(): void {
    const previous = historyRef.current.past.pop();
    if (!previous) return;
    historyRef.current.future.push(structuredClone(requireCurrentSnapshot()));
    const restored = touchBoard(structuredClone(previous));
    if (canvasHost) whiteboardCanvasHostBridge(canvasHost).replaceSnapshot(restored);
    setReadySnapshot(restored);
    portsRef.current.syncFlow(restored);
    void persistSnapshot(restored);
    setHistoryRevision((revision) => revision + 1);
  }

  function redo(): void {
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(structuredClone(requireCurrentSnapshot()));
    const restored = touchBoard(structuredClone(next));
    if (canvasHost) whiteboardCanvasHostBridge(canvasHost).replaceSnapshot(restored);
    setReadySnapshot(restored);
    portsRef.current.syncFlow(restored);
    void persistSnapshot(restored);
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
    adoptDurableSnapshot,
    applyLoadedSnapshot,
    autosaveStatus,
    canRedo: historyRef.current.future.length > 0,
    canUndo: historyRef.current.past.length > 0,
    connectPorts,
    persistSnapshot,
    redo,
    retrySave,
    runHostCommand: canvasHost ? runHostCommand : undefined,
    runProductCommand: canvasHost ? runProductCommand : undefined,
    snapshot: loadState.snapshot,
    snapshotRef: snapshotRef as RefObject<BoardSnapshot>,
    undo,
  };
}
