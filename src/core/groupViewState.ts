interface GroupBoardViewState {
  collapsedGroupIds: string[];
}

const groupViewStatePrefix = 'retake.whiteboard.groupViewState';

export function loadCollapsedGroupIds(projectId: string, boardId: string): string[] {
  try {
    const raw = localStorage.getItem(groupViewStateKey(projectId, boardId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<GroupBoardViewState>;
    return Array.isArray(parsed.collapsedGroupIds)
      ? parsed.collapsedGroupIds.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
}

export function saveCollapsedGroupIds(projectId: string, boardId: string, collapsedGroupIds: string[]): void {
  try {
    localStorage.setItem(
      groupViewStateKey(projectId, boardId),
      JSON.stringify({ collapsedGroupIds: [...new Set(collapsedGroupIds)] } satisfies GroupBoardViewState),
    );
  } catch {
    // Restricted previews can run without persisted view state.
  }
}

function groupViewStateKey(projectId: string, boardId: string): string {
  return `${groupViewStatePrefix}:${projectId}:${boardId}`;
}
