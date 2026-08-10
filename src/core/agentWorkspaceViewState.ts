interface AgentWorkspaceViewStateStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

interface AgentWorkspaceBoardViewState {
  schemaVersion: 1;
  selectedAgentSessionId: string;
}

const agentWorkspaceViewStatePrefix = 'retake.whiteboard.agentWorkspaceViewState.v1';

export function resolveSelectedAgentSessionId(
  availableAgentSessionIds: readonly string[],
  currentAgentSessionId?: string,
  savedAgentSessionId?: string,
): string | undefined {
  if (currentAgentSessionId && availableAgentSessionIds.includes(currentAgentSessionId)) {
    return currentAgentSessionId;
  }
  if (savedAgentSessionId && availableAgentSessionIds.includes(savedAgentSessionId)) {
    return savedAgentSessionId;
  }
  return availableAgentSessionIds[0];
}

export function loadSelectedAgentSessionId(
  projectId: string,
  boardId: string,
  storage = browserStorage(),
): string | undefined {
  if (!storage) return undefined;
  try {
    const raw = storage.getItem(agentWorkspaceViewStateKey(projectId, boardId));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<AgentWorkspaceBoardViewState>;
    return parsed.schemaVersion === 1
      && typeof parsed.selectedAgentSessionId === 'string'
      && parsed.selectedAgentSessionId.length > 0
      ? parsed.selectedAgentSessionId
      : undefined;
  } catch {
    return undefined;
  }
}

export function saveSelectedAgentSessionId(
  projectId: string,
  boardId: string,
  agentSessionId: string | undefined,
  storage = browserStorage(),
): void {
  if (!storage) return;
  try {
    const key = agentWorkspaceViewStateKey(projectId, boardId);
    if (!agentSessionId) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, JSON.stringify({
      schemaVersion: 1,
      selectedAgentSessionId: agentSessionId,
    } satisfies AgentWorkspaceBoardViewState));
  } catch {
    // Restricted previews can run without persisted Agent Workspace view state.
  }
}

function agentWorkspaceViewStateKey(projectId: string, boardId: string): string {
  return `${agentWorkspaceViewStatePrefix}:${encodeURIComponent(projectId)}:${encodeURIComponent(boardId)}`;
}

function browserStorage(): AgentWorkspaceViewStateStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
