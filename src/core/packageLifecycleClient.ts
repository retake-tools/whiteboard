import {
  configureInstalledRuntimeRegistry,
} from './installedRuntimeRegistry';
import type {
  PackageDevelopmentMutationV1,
  PackageDevelopmentSnapshotV1,
  PackageLifecycleMutationV1,
  PackageLifecycleSnapshotV1,
} from './packageLifecycleContracts';
import type {
  PluginRuntimeControllerV1,
} from './pluginRuntimeManagementClient';

export interface PackageLifecycleControllerV1 {
  getDevelopmentSnapshot(): PackageDevelopmentSnapshotV1 | undefined;
  getSnapshot(): PackageLifecycleSnapshotV1 | undefined;
  mutate(
    mutation: PackageLifecycleMutationV1,
  ): Promise<PackageLifecycleSnapshotV1>;
  mutateDevelopment(
    mutation: PackageDevelopmentMutationV1,
  ): Promise<PackageDevelopmentSnapshotV1>;
  refresh(): Promise<PackageLifecycleSnapshotV1>;
  refreshDevelopment(): Promise<PackageDevelopmentSnapshotV1>;
  subscribe(listener: () => void): () => void;
}

export function createPackageLifecycleController(input: {
  pluginRuntimeController: PluginRuntimeControllerV1;
}): PackageLifecycleControllerV1 {
  let currentSnapshot: PackageLifecycleSnapshotV1 | undefined;
  let currentDevelopment: PackageDevelopmentSnapshotV1 | undefined;
  let queue: Promise<void> = Promise.resolve();
  const listeners = new Set<() => void>();

  const commit = async (
    snapshot: PackageLifecycleSnapshotV1,
  ): Promise<PackageLifecycleSnapshotV1> => {
    configureInstalledRuntimeRegistry(snapshot.runtimeRegistry);
    const pluginRuntime = await input.pluginRuntimeController.replace(
      snapshot.pluginRuntime,
    );
    currentSnapshot = structuredClone({
      ...snapshot,
      pluginRuntime,
    });
    for (const listener of listeners) listener();
    return currentSnapshot;
  };

  const enqueue = (
    operation: () => Promise<PackageLifecycleSnapshotV1>,
  ): Promise<PackageLifecycleSnapshotV1> => {
    const result = queue.then(operation, operation).then(commit);
    queue = result.then(() => undefined, () => undefined);
    return result;
  };

  return {
    getDevelopmentSnapshot: () => currentDevelopment,
    getSnapshot: () => currentSnapshot,
    mutate: (mutation) => enqueue(() => requestPackageLifecycleSnapshot({
      body: JSON.stringify(mutation),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })),
    mutateDevelopment: (mutation) => enqueueDevelopment(async () => (
      requestPackageDevelopmentSnapshot({
        body: JSON.stringify(mutation),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      })
    )),
    refresh: () => enqueue(() => requestPackageLifecycleSnapshot()),
    refreshDevelopment: () => enqueueDevelopment(
      requestPackageDevelopmentSnapshot,
      false,
    ),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };

  function enqueueDevelopment(
    operation: () => Promise<PackageDevelopmentSnapshotV1>,
    reconcile = true,
  ): Promise<PackageDevelopmentSnapshotV1> {
    let developmentResult!: PackageDevelopmentSnapshotV1;
    const result = queue.then(operation, operation).then(async (snapshot) => {
      const changed = snapshot.revision !== currentDevelopment?.revision
        || JSON.stringify(snapshot.links) !== JSON.stringify(
          currentDevelopment?.links ?? [],
        );
      currentDevelopment = structuredClone(snapshot);
      developmentResult = currentDevelopment;
      if (reconcile || changed) {
        await commit(await requestPackageLifecycleSnapshot());
        currentDevelopment = await requestPackageDevelopmentSnapshot();
        developmentResult = currentDevelopment;
      } else {
        for (const listener of listeners) listener();
      }
    });
    queue = result.then(() => undefined, () => undefined);
    return result.then(() => developmentResult);
  }
}

async function requestPackageLifecycleSnapshot(
  init?: RequestInit,
): Promise<PackageLifecycleSnapshotV1> {
  const response = await fetch('/api/local/package-lifecycle', init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new Error(
      typeof body.error === 'string' && body.error.length > 0
        ? body.error
        : `Package lifecycle request failed with HTTP ${response.status}.`,
    );
  }
  const body = await response.json() as Partial<PackageLifecycleSnapshotV1>;
  if (
    body.schemaVersion !== 1
    || !Number.isInteger(body.lockRevision)
    || !Array.isArray(body.packages)
    || !body.runtimeRegistry
    || !body.pluginRuntime
    || typeof body.updatedAt !== 'string'
  ) {
    throw new Error('Package lifecycle response is invalid.');
  }
  return structuredClone(body as PackageLifecycleSnapshotV1);
}

async function requestPackageDevelopmentSnapshot(
  init?: RequestInit,
): Promise<PackageDevelopmentSnapshotV1> {
  const response = await fetch('/api/local/package-development', init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new Error(
      typeof body.error === 'string' && body.error.length > 0
        ? body.error
        : `Package development request failed with HTTP ${response.status}.`,
    );
  }
  const body = await response.json() as Partial<PackageDevelopmentSnapshotV1>;
  if (
    body.schemaVersion !== 1
    || !Number.isInteger(body.revision)
    || !Array.isArray(body.links)
    || typeof body.updatedAt !== 'string'
  ) {
    throw new Error('Package development response is invalid.');
  }
  return structuredClone(body as PackageDevelopmentSnapshotV1);
}
