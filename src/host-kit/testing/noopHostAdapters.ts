import type { PluginRuntimeSnapshotV1 } from '@retake-tools/package-sdk';
import type {
  HostConnectionAdapterV1,
  HostPackageRuntimeAdapterV1,
  HostPackageRuntimeSnapshotV1,
} from '../contracts';

export function createNoopHostConnections(): HostConnectionAdapterV1 {
  return Object.freeze({
    adapterVersion: 1,
    async cancel() {},
    async execute() {
      throw new Error('No Host Connection Adapter is configured.');
    },
    async list() {
      return [];
    },
  });
}

export function createNoopHostPackageRuntime(): HostPackageRuntimeAdapterV1 {
  const listeners = new Set<(snapshot: HostPackageRuntimeSnapshotV1) => void>();
  let revision = 0;
  let disposed = false;

  function snapshot(): HostPackageRuntimeSnapshotV1 {
    const updatedAt = new Date(revision).toISOString();
    const pluginRuntime: PluginRuntimeSnapshotV1 = {
      modules: [],
      safeMode: false,
      schemaVersion: 1,
      updatedAt,
    };
    return Object.freeze({
      failures: [],
      pluginRuntime,
      revision: `noop:${revision}`,
      schemaVersion: 1,
    });
  }

  return Object.freeze({
    adapterVersion: 1,
    async bootstrap() {
      if (disposed) throw new Error('Noop Host Runtime has been disposed.');
      revision += 1;
      return snapshot();
    },
    async dispose() {
      disposed = true;
      listeners.clear();
    },
    async setScope() {
      if (disposed) throw new Error('Noop Host Runtime has been disposed.');
      revision += 1;
      const next = snapshot();
      for (const listener of listeners) listener(next);
      return next;
    },
    subscribe(listener: (snapshot: HostPackageRuntimeSnapshotV1) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
