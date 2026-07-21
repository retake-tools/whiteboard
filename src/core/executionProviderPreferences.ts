import type {
  ExecutionConnectionSummary,
  ExecutionDefaultSelection,
  ExecutionProviderSettingsSnapshot,
  ExecutionUseCase,
} from './executionProviders';

const snapshotsByProject = new Map<string, ExecutionProviderSettingsSnapshot>();
const listeners = new Set<() => void>();
let latestSnapshot: ExecutionProviderSettingsSnapshot | undefined;

export function cacheExecutionProviderSettings(
  projectId: string | undefined,
  snapshot: ExecutionProviderSettingsSnapshot,
): void {
  snapshotsByProject.set(projectId ?? '', snapshot);
  latestSnapshot = snapshot;
  listeners.forEach((listener) => listener());
}

export function subscribeExecutionProviderSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentExecutionProviderSettings(): ExecutionProviderSettingsSnapshot | undefined {
  return latestSnapshot;
}

export function executionDefaultConnection(
  useCase: ExecutionUseCase,
  projectId: string,
): string | undefined {
  return executionDefaultSelection(useCase, projectId)?.connectionId;
}

export function executionDefaultSelection(
  useCase: ExecutionUseCase,
  projectId: string,
): ExecutionDefaultSelection | undefined {
  const snapshot = snapshotsByProject.get(projectId) ?? snapshotsByProject.get('');
  const selection = snapshot?.projectDefaults.find((candidate) => candidate.useCase === useCase)
    ?? snapshot?.workspaceDefaults.find((candidate) => candidate.useCase === useCase);
  return selection ? { ...selection } : undefined;
}

export function executionConnection(
  connectionId: string | undefined,
  projectId: string,
): ExecutionConnectionSummary | undefined {
  if (!connectionId) return undefined;
  const snapshot = snapshotsByProject.get(projectId) ?? snapshotsByProject.get('');
  const connection = snapshot?.connections.find((candidate) => candidate.connectionId === connectionId);
  return connection ? { ...connection } : undefined;
}
