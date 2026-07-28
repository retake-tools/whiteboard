import type {
  PluginProfileOverrideStateV1,
  PluginProfileStateV1,
  PluginRuntimeProfileProjectionV1,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import {
  projectPluginRuntimeForProfileV1,
} from '@retake-tools/plugin-runtime';
import {
  updatePluginProfile,
} from './pluginFoundationConfigClient';

export type PluginRuntimeManagementActionV1 =
  | 'disable'
  | 'enable'
  | 'grant'
  | 'trust';

export interface PluginRuntimeControllerV1 {
  getProfileProjection(): PluginRuntimeProfileProjectionV1;
  getProfileState(): PluginProfileStateV1;
  getScope(): { boardId: string | null; projectId: string | null };
  getSnapshot(): PluginRuntimeSnapshotV1;
  manageModule(
    pluginModuleId: string,
    action: PluginRuntimeManagementActionV1,
  ): Promise<PluginRuntimeSnapshotV1>;
  refresh(): Promise<PluginRuntimeSnapshotV1>;
  replace(
    snapshot: PluginRuntimeSnapshotV1,
  ): Promise<PluginRuntimeSnapshotV1>;
  setSafeMode(enabled: boolean): Promise<PluginRuntimeSnapshotV1>;
  setScope(input: {
    boardId: string;
    projectId: string;
  }): Promise<PluginRuntimeSnapshotV1>;
  subscribe(listener: () => void): () => void;
  updateProfile(input: {
    boardId: string | null;
    pluginModuleId: string;
    projectId: string;
    scope: 'board' | 'project';
    state: PluginProfileOverrideStateV1;
  }): Promise<PluginRuntimeSnapshotV1>;
}

export function createPluginRuntimeController(input: {
  applySnapshot: (
    baseSnapshot: PluginRuntimeSnapshotV1,
    effectiveSnapshot: PluginRuntimeSnapshotV1,
  ) => Promise<PluginRuntimeSnapshotV1 | void>;
  initialProfileState: PluginProfileStateV1;
  initialSnapshot: PluginRuntimeSnapshotV1;
  initialScope?: { boardId: string | null; projectId: string | null };
}): PluginRuntimeControllerV1 {
  let currentSnapshot = structuredClone(input.initialSnapshot);
  let currentProfile = structuredClone(input.initialProfileState);
  let currentScope = structuredClone(input.initialScope ?? {
    boardId: null,
    projectId: null,
  });
  let currentProjection = project();
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const commit = async (
    snapshot: PluginRuntimeSnapshotV1,
  ): Promise<PluginRuntimeSnapshotV1> => {
    const effective = project(snapshot);
    const appliedSnapshot = await input.applySnapshot(
      snapshot,
      effective.runtime,
    );
    currentSnapshot = structuredClone(appliedSnapshot ?? snapshot);
    currentProjection = project();
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
    getProfileProjection: () => currentProjection,
    getProfileState: () => currentProfile,
    getScope: () => currentScope,
    getSnapshot: () => currentSnapshot,
    manageModule: (pluginModuleId, action) => enqueue(() => requestSnapshot(
      `/api/local/plugin-runtime/modules/${
        encodeURIComponent(pluginModuleId)
      }/${action}`,
      { method: 'POST' },
    )),
    refresh: () => enqueue(() => requestSnapshot('/api/local/plugin-runtime')),
    replace: (snapshot) => enqueue(async () => structuredClone(snapshot)),
    setSafeMode: (enabled) => enqueue(() => requestSnapshot(
      '/api/local/plugin-runtime/safe-mode',
      {
        body: JSON.stringify({ enabled }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      },
    )),
    setScope: (scope) => enqueue(async () => {
      currentScope = structuredClone(scope);
      return structuredClone(currentSnapshot);
    }),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateProfile: (profileInput) => enqueue(async () => {
      currentProfile = await updatePluginProfile(profileInput);
      return structuredClone(currentSnapshot);
    }),
  };

  function project(
    snapshot = currentSnapshot,
  ): PluginRuntimeProfileProjectionV1 {
    return projectPluginRuntimeForProfileV1({
      boardId: currentScope.boardId,
      profile: currentProfile,
      projectId: currentScope.projectId,
      runtime: snapshot,
    });
  }
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
