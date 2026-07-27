import type { PluginRuntimeSnapshotV1 } from '@retake-tools/package-sdk';

export type PluginRuntimeManagementActionV1 =
  | 'disable'
  | 'enable'
  | 'grant'
  | 'trust';

export interface PluginRuntimeControllerV1 {
  getSnapshot(): PluginRuntimeSnapshotV1;
  manageModule(
    pluginModuleId: string,
    action: PluginRuntimeManagementActionV1,
  ): Promise<PluginRuntimeSnapshotV1>;
  refresh(): Promise<PluginRuntimeSnapshotV1>;
  setSafeMode(enabled: boolean): Promise<PluginRuntimeSnapshotV1>;
  subscribe(listener: () => void): () => void;
}

export function createPluginRuntimeController(input: {
  applySnapshot: (
    snapshot: PluginRuntimeSnapshotV1,
  ) => Promise<PluginRuntimeSnapshotV1 | void>;
  initialSnapshot: PluginRuntimeSnapshotV1;
}): PluginRuntimeControllerV1 {
  let currentSnapshot = structuredClone(input.initialSnapshot);
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const commit = async (
    snapshot: PluginRuntimeSnapshotV1,
  ): Promise<PluginRuntimeSnapshotV1> => {
    const appliedSnapshot = await input.applySnapshot(snapshot);
    currentSnapshot = structuredClone(appliedSnapshot ?? snapshot);
    for (const listener of listeners) listener();
    return currentSnapshot;
  };

  const enqueue = (
    operation: () => Promise<PluginRuntimeSnapshotV1>,
  ): Promise<PluginRuntimeSnapshotV1> => {
    const result = queue.then(operation, operation).then(commit);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    getSnapshot: () => currentSnapshot,
    manageModule: (pluginModuleId, action) => enqueue(() => requestSnapshot(
      `/api/local/plugin-runtime/modules/${
        encodeURIComponent(pluginModuleId)
      }/${action}`,
      { method: 'POST' },
    )),
    refresh: () => enqueue(() => requestSnapshot('/api/local/plugin-runtime')),
    setSafeMode: (enabled) => enqueue(() => requestSnapshot(
      '/api/local/plugin-runtime/safe-mode',
      {
        body: JSON.stringify({ enabled }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    )),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export async function loadPluginRuntimeSnapshot(): Promise<
  PluginRuntimeSnapshotV1
> {
  return requestSnapshot('/api/local/plugin-runtime');
}

async function requestSnapshot(
  url: string,
  init?: RequestInit,
): Promise<PluginRuntimeSnapshotV1> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new Error(
      typeof body.error === 'string' && body.error.length > 0
        ? body.error
        : `Plugin Runtime request failed with HTTP ${response.status}.`,
    );
  }
  const { parsePluginRuntimeSnapshot } = await import(
    '@retake-tools/plugin-runtime'
  );
  return parsePluginRuntimeSnapshot(await response.json());
}
