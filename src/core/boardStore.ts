import { defaultSnapshot } from './sampleBoard';
import { migrateBoardSnapshot } from './snapshotMigration';
import type { BoardSnapshot, WorkspaceSummary } from './types';

const storageKey = 'retake.whiteboard.spike.boardSnapshot';
const currentProjectKey = 'retake.whiteboard.currentProjectId';
const currentBoardKey = 'retake.whiteboard.currentBoardId';

export type SnapshotSaveResult = {
  persistedTo: 'local-api' | 'browser-storage';
};

export function createFallbackBoardSnapshot(): BoardSnapshot {
  return migrateBoardSnapshot(structuredClone(defaultSnapshot));
}

export async function loadBoardSnapshot(input?: { projectId?: string; boardId?: string }): Promise<BoardSnapshot> {
  try {
    const projectId = input?.projectId ?? localStorage.getItem(currentProjectKey) ?? undefined;
    const boardId = input?.boardId ?? localStorage.getItem(currentBoardKey) ?? undefined;
    const query = projectId && boardId ? `?projectId=${encodeURIComponent(projectId)}&boardId=${encodeURIComponent(boardId)}` : '';
    const response = await fetch(`/api/local/snapshot${query}`);
    if (response.ok) {
      const snapshot = migrateBoardSnapshot((await response.json()) as BoardSnapshot);
      rememberCurrentBoard(snapshot);
      return snapshot;
    }
  } catch {
    // Browser-only fallback for static preview builds.
  }

  const raw = localStorage.getItem(storageKey);
  if (!raw) return createFallbackBoardSnapshot();

  try {
    return migrateBoardSnapshot(JSON.parse(raw) as BoardSnapshot);
  } catch {
    return createFallbackBoardSnapshot();
  }
}

export async function saveBoardSnapshot(snapshot: BoardSnapshot): Promise<SnapshotSaveResult> {
  try {
    const response = await fetch('/api/local/snapshot', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    if (response.ok) return { persistedTo: 'local-api' };
  } catch {
    // Browser-only fallback for static preview builds.
  }

  localStorage.setItem(storageKey, JSON.stringify(snapshot));
  return { persistedTo: 'browser-storage' };
}

export async function clearBoardSnapshot(): Promise<BoardSnapshot> {
  try {
    const response = await fetch('/api/local/reset', { method: 'POST' });
    if (response.ok) {
      localStorage.removeItem(storageKey);
      const snapshot = migrateBoardSnapshot((await response.json()) as BoardSnapshot);
      rememberCurrentBoard(snapshot);
      return snapshot;
    }
  } catch {
    // Browser-only fallback for static preview builds.
  }

  localStorage.removeItem(storageKey);
  return createFallbackBoardSnapshot();
}

export async function loadWorkspaceSummary(): Promise<WorkspaceSummary> {
  const response = await fetch('/api/local/workspace');
  if (!response.ok) throw new Error('Failed to load workspace');
  return (await response.json()) as WorkspaceSummary;
}

export async function createWorkspaceProject(name?: string): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  return writeWorkspaceAction('/api/local/projects', 'POST', { name });
}

export async function renameWorkspaceProject(
  projectId: string,
  name: string,
): Promise<{ snapshot?: BoardSnapshot; workspace: WorkspaceSummary }> {
  return writeWorkspaceAction(`/api/local/projects/${encodeURIComponent(projectId)}`, 'PATCH', { name });
}

export async function deleteWorkspaceProject(projectId: string): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  return writeWorkspaceAction(`/api/local/projects/${encodeURIComponent(projectId)}`, 'DELETE');
}

export async function createWorkspaceBoard(
  projectId: string,
  name?: string,
): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  return writeWorkspaceAction(`/api/local/projects/${encodeURIComponent(projectId)}/boards`, 'POST', { name });
}

export async function renameWorkspaceBoard(
  projectId: string,
  boardId: string,
  name: string,
): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  return writeWorkspaceAction(
    `/api/local/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}`,
    'PATCH',
    { name },
  );
}

export async function duplicateWorkspaceBoard(
  projectId: string,
  boardId: string,
  name?: string,
): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  return writeWorkspaceAction(
    `/api/local/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}/duplicate`,
    'POST',
    { name },
  );
}

export async function deleteWorkspaceBoard(
  projectId: string,
  boardId: string,
): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  return writeWorkspaceAction(
    `/api/local/projects/${encodeURIComponent(projectId)}/boards/${encodeURIComponent(boardId)}`,
    'DELETE',
  );
}

export async function reorderWorkspaceProjects(projectIds: string[]): Promise<{ workspace: WorkspaceSummary }> {
  return writeWorkspaceAction('/api/local/projects/reorder', 'PATCH', { projectIds });
}

export async function reorderWorkspaceBoards(
  projectId: string,
  boardIds: string[],
): Promise<{ workspace: WorkspaceSummary }> {
  return writeWorkspaceAction(`/api/local/projects/${encodeURIComponent(projectId)}/boards/reorder`, 'PATCH', {
    boardIds,
  });
}

export function subscribeToBoardSnapshotChanges(input: {
  getCurrentSnapshot: () => BoardSnapshot;
  isPaused?: () => boolean;
  onSnapshot: (snapshot: BoardSnapshot) => void;
  intervalMs?: number;
}): () => void {
  let stopped = false;
  let inFlight = false;
  let observedSignature = createSnapshotSignature(input.getCurrentSnapshot());

  async function checkForChanges(): Promise<void> {
    if (stopped || inFlight || input.isPaused?.()) return;

    const currentSignature = createSnapshotSignature(input.getCurrentSnapshot());
    if (currentSignature !== observedSignature) {
      observedSignature = currentSignature;
    }

    inFlight = true;
    try {
      const current = input.getCurrentSnapshot();
      const loadedSnapshot = await loadBoardSnapshot({
        projectId: current.project.projectId,
        boardId: current.board.boardId,
      });
      if (stopped || input.isPaused?.()) return;
      const loadedSignature = createSnapshotSignature(loadedSnapshot);
      if (loadedSignature !== observedSignature) {
        observedSignature = loadedSignature;
        input.onSnapshot(loadedSnapshot);
      }
    } finally {
      inFlight = false;
    }
  }

  const timer = window.setInterval(() => {
    void checkForChanges();
  }, input.intervalMs ?? 1500);

  return () => {
    stopped = true;
    window.clearInterval(timer);
  };
}

export function rememberCurrentBoard(snapshot: BoardSnapshot): void {
  localStorage.setItem(currentProjectKey, snapshot.project.projectId);
  localStorage.setItem(currentBoardKey, snapshot.board.boardId);
}

async function writeWorkspaceAction<T>(
  url: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(error?.error ?? 'Workspace action failed');
  }
  const result = (await response.json()) as T;
  const snapshot = (result as { snapshot?: BoardSnapshot }).snapshot;
  if (snapshot) rememberCurrentBoard(snapshot);
  return result;
}

function createSnapshotSignature(snapshot: BoardSnapshot): string {
  return [
    snapshot.project.projectId,
    snapshot.project.updatedAt,
    snapshot.board.boardId,
    snapshot.board.updatedAt,
    snapshot.blocks.length,
    snapshot.edges.length,
    snapshot.assets.length,
    snapshot.executions.length,
    snapshot.historyEvents?.length ?? 0,
  ].join(':');
}
