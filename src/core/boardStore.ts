import { migrateBoardSnapshot } from './snapshotMigration';
import type { BoardSnapshot, WorkspaceSummary } from './types';

const currentProjectKey = 'retake.whiteboard.currentProjectId';
const currentBoardKey = 'retake.whiteboard.currentBoardId';

export async function loadBoardSnapshot(input?: { projectId?: string; boardId?: string }): Promise<BoardSnapshot> {
  const remembered = input ?? loadRememberedBoard();
  const projectId = input?.projectId ?? remembered.projectId;
  const boardId = input?.boardId ?? remembered.boardId;
  const query = projectId && boardId ? `?projectId=${encodeURIComponent(projectId)}&boardId=${encodeURIComponent(boardId)}` : '';
  let response = await fetch(`/api/local/snapshot${query}`);
  if (!input && query && response.status === 404) {
    response = await fetch('/api/local/snapshot');
  }
  if (!response.ok) throw await localApiError(response, 'Failed to load board snapshot');

  const snapshot = migrateBoardSnapshot((await response.json()) as BoardSnapshot);
  rememberCurrentBoard(snapshot);
  return snapshot;
}

export async function saveBoardSnapshot(snapshot: BoardSnapshot): Promise<void> {
  const response = await fetch('/api/local/snapshot', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  });
  if (!response.ok) throw await localApiError(response, 'Failed to save board snapshot');
}

export async function clearBoardSnapshot(): Promise<BoardSnapshot> {
  const response = await fetch('/api/local/reset', { method: 'POST' });
  if (!response.ok) throw await localApiError(response, 'Failed to reset workspace');
  const snapshot = migrateBoardSnapshot((await response.json()) as BoardSnapshot);
  rememberCurrentBoard(snapshot);
  return snapshot;
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
    } catch {
      // A transient read failure must not replace the in-memory board or create an unhandled rejection.
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
  try {
    localStorage.setItem(currentProjectKey, snapshot.project.projectId);
    localStorage.setItem(currentBoardKey, snapshot.board.boardId);
  } catch {
    // Board selection is a convenience preference, not authoritative data.
  }
}

function loadRememberedBoard(): { projectId?: string; boardId?: string } {
  try {
    return {
      projectId: localStorage.getItem(currentProjectKey) ?? undefined,
      boardId: localStorage.getItem(currentBoardKey) ?? undefined,
    };
  } catch {
    return {};
  }
}

async function localApiError(response: Response, fallbackMessage: string): Promise<Error> {
  const result = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
  return new Error(result?.error ?? `${fallbackMessage} (${response.status}).`);
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
