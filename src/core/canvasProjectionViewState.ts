export type CanvasProjectionMode = 'creative' | 'flow';

export function loadCanvasProjectionMode(
  projectId: string,
  boardId: string,
): CanvasProjectionMode {
  try {
    // The ordinary Board is always the progressive run projection. The full
    // DAG belongs to Workflow Workspace, so discard the legacy per-Board Flow
    // preference instead of letting future Steps leak back onto the canvas.
    localStorage.removeItem(storageKey(projectId, boardId));
  } catch {
    // Local projection state is non-critical.
  }
  return 'creative';
}

export function saveCanvasProjectionMode(
  projectId: string,
  boardId: string,
  mode: CanvasProjectionMode,
): void {
  try {
    if (mode === 'creative') localStorage.removeItem(storageKey(projectId, boardId));
  } catch {
    // Projection preference is non-critical when browser storage is unavailable.
  }
}

function storageKey(projectId: string, boardId: string): string {
  return `retake:canvas-projection:${projectId}:${boardId}`;
}
