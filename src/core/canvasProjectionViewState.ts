export type CanvasProjectionMode = 'creative' | 'flow';

export function loadCanvasProjectionMode(
  projectId: string,
  boardId: string,
): CanvasProjectionMode {
  try {
    return localStorage.getItem(storageKey(projectId, boardId)) === 'flow'
      ? 'flow'
      : 'creative';
  } catch {
    return 'creative';
  }
}

export function saveCanvasProjectionMode(
  projectId: string,
  boardId: string,
  mode: CanvasProjectionMode,
): void {
  try {
    localStorage.setItem(storageKey(projectId, boardId), mode);
  } catch {
    // Projection preference is non-critical when browser storage is unavailable.
  }
}

function storageKey(projectId: string, boardId: string): string {
  return `retake:canvas-projection:${projectId}:${boardId}`;
}
