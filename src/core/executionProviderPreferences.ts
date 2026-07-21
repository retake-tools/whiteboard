import type {
  ExecutionCapabilityClass,
  ExecutionProviderSettingsSnapshot,
} from './executionProviders';

const snapshotsByProject = new Map<string, ExecutionProviderSettingsSnapshot>();

export function cacheExecutionProviderSettings(
  projectId: string | undefined,
  snapshot: ExecutionProviderSettingsSnapshot,
): void {
  snapshotsByProject.set(projectId ?? '', snapshot);
}

export function executionDefaultConnection(
  capabilityClass: ExecutionCapabilityClass,
  projectId: string,
): string | undefined {
  const snapshot = snapshotsByProject.get(projectId) ?? snapshotsByProject.get('');
  return snapshot?.projectDefaults.find((selection) => selection.capabilityClass === capabilityClass)?.connectionId
    ?? snapshot?.workspaceDefaults.find((selection) => selection.capabilityClass === capabilityClass)?.connectionId;
}
