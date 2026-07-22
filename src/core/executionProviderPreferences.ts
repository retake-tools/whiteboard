import type {
  ExecutionConnectionSummary,
  ExecutionProviderSettingsSnapshot,
  ExecutionUseCase,
} from './executionProviders';

export type ExecutionConnectionPreferenceSource =
  | 'explicit'
  | 'project_default'
  | 'workspace_default'
  | 'initial'
  | 'none';

export interface ExecutionConnectionPreference {
  connection?: ExecutionConnectionSummary;
  connectionId?: string;
  isUsable: boolean;
  source: ExecutionConnectionPreferenceSource;
}

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

export function resolveExecutionConnectionPreference(input: {
  capabilityId: string;
  explicitConnectionId?: string;
  initialConnectionId?: string;
  projectId: string;
  settings?: ExecutionProviderSettingsSnapshot;
  useCase: ExecutionUseCase;
}): ExecutionConnectionPreference {
  const snapshot = input.settings ?? snapshotsByProject.get(input.projectId) ?? snapshotsByProject.get('');
  const projectDefault = snapshot?.projectDefaults.find((candidate) => candidate.useCase === input.useCase);
  const workspaceDefault = snapshot?.workspaceDefaults.find((candidate) => candidate.useCase === input.useCase);
  const candidate = input.explicitConnectionId
    ? { connectionId: input.explicitConnectionId, source: 'explicit' as const }
    : projectDefault
      ? { connectionId: projectDefault.connectionId, source: 'project_default' as const }
      : workspaceDefault
        ? { connectionId: workspaceDefault.connectionId, source: 'workspace_default' as const }
        : input.initialConnectionId
          ? { connectionId: input.initialConnectionId, source: 'initial' as const }
          : undefined;
  if (!candidate) return { isUsable: false, source: 'none' };
  const connection = snapshot?.connections.find(
    (current) => current.connectionId === candidate.connectionId,
  );
  const isUsable = Boolean(
    connection?.enabled &&
    connection.status === 'ready' &&
    connection.enabledUseCases.includes(input.useCase) &&
    connection.supportedCapabilityIds.includes(input.capabilityId),
  );
  return {
    connection: connection ? { ...connection } : undefined,
    connectionId: candidate.connectionId,
    isUsable,
    source: candidate.source,
  };
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
