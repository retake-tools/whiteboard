import type {
  PluginProfileOverrideStateV1,
  PluginProfileStateV1,
  PluginRuntimeProfileProjectionV1,
  PluginRuntimeSnapshotV1,
  RetakePluginPermission,
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
  | 'revoke'
  | 'trust';

export interface PluginActivationDemandV1 {
  boardBound: boolean;
  hasBlocks: boolean;
  hasOperationBlocks: boolean;
  managerOpen: boolean;
  selectedBlockCount: number;
}

export interface PluginRuntimeControllerV1 {
  getDemand(): PluginActivationDemandV1;
  getProfileProjection(): PluginRuntimeProfileProjectionV1;
  getProfileState(): PluginProfileStateV1;
  getScope(): { boardId: string | null; projectId: string | null };
  getSnapshot(): PluginRuntimeSnapshotV1;
  manageModule(
    pluginModuleId: string,
    action: PluginRuntimeManagementActionV1,
  ): Promise<PluginRuntimeSnapshotV1>;
  setPermissions(
    pluginModuleId: string,
    permissions: RetakePluginPermission[],
  ): Promise<PluginRuntimeSnapshotV1>;
  refresh(): Promise<PluginRuntimeSnapshotV1>;
  replace(
    snapshot: PluginRuntimeSnapshotV1,
  ): Promise<PluginRuntimeSnapshotV1>;
  setSafeMode(enabled: boolean): Promise<PluginRuntimeSnapshotV1>;
  setScope(input: {
    boardId: string;
    demand?: PluginActivationDemandV1;
    projectId: string;
  }): Promise<PluginRuntimeSnapshotV1>;
  setDemand(
    demand: PluginActivationDemandV1,
  ): Promise<PluginRuntimeSnapshotV1>;
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
  let currentDemand: PluginActivationDemandV1 = {
    boardBound: false,
    hasBlocks: false,
    hasOperationBlocks: false,
    managerOpen: false,
    selectedBlockCount: 0,
  };
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
    getDemand: () => currentDemand,
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
    setPermissions: (pluginModuleId, permissions) => enqueue(() => (
      requestSnapshot(
        `/api/local/plugin-runtime/modules/${
          encodeURIComponent(pluginModuleId)
        }/permissions`,
        {
          body: JSON.stringify({ permissions }),
          headers: { 'Content-Type': 'application/json' },
          method: 'POST',
        },
      )
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
      currentScope = {
        boardId: scope.boardId,
        projectId: scope.projectId,
      };
      if (scope.demand) currentDemand = structuredClone(scope.demand);
      return structuredClone(currentSnapshot);
    }),
    setDemand: (demand) => enqueue(async () => {
      currentDemand = structuredClone(demand);
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
    const projection = projectPluginRuntimeForProfileV1({
      boardId: currentScope.boardId,
      profile: currentProfile,
      projectId: currentScope.projectId,
      runtime: snapshot,
    });
    projection.runtime.modules = projection.runtime.modules.map((record) => (
      record.status === 'enabled' && !moduleHasDemand(record, currentDemand)
        ? { ...record, status: 'disabled' }
        : record
    ));
    return projection;
  }
}

function moduleHasDemand(
  record: PluginRuntimeSnapshotV1['modules'][number],
  demand: PluginActivationDemandV1,
): boolean {
  if (!demand.boardBound) return false;
  if (record.trust?.trustChannel === 'linked_source') return true;
  if (record.manifest.contributions.length === 0) return true;
  return record.manifest.contributions.some((contribution) => {
    if (contribution.kind === 'panel') return true;
    if (contribution.kind === 'renderer') return demand.hasBlocks;
    if (contribution.kind === 'settings') return demand.managerOpen;
    if (contribution.kind === 'command') {
      return demand.selectedBlockCount > 0 || demand.hasOperationBlocks;
    }
    return demand.hasOperationBlocks;
  });
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
