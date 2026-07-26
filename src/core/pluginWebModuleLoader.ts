import type {
  ActivatedPluginWebModuleV1,
  PluginHostApiV1,
  PluginHostReadSnapshotV1,
  PluginModuleRuntimeRecordV1,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';

const activatedModules = new Map<
  string,
  Promise<ActivatedPluginWebModuleV1>
>();

export interface PluginWebModuleReconcileResult {
  activated: ActivatedPluginWebModuleV1[];
  failures: Array<{ error: string; pluginModuleId: string }>;
}

export async function reconcilePluginWebModules(input: {
  activate?: (
    record: PluginModuleRuntimeRecordV1,
    host: PluginHostApiV1,
  ) => Promise<ActivatedPluginWebModuleV1>;
  createHost(record: PluginModuleRuntimeRecordV1): PluginHostApiV1;
  snapshot: PluginRuntimeSnapshotV1;
}): Promise<PluginWebModuleReconcileResult> {
  const enabled = input.snapshot.safeMode
    ? []
    : input.snapshot.modules.filter((record) => (
      record.status === 'enabled'
      && record.manifest.runtime.kind === 'web_module'
      && record.grant !== null
      && record.trust !== null
      && record.negotiatedHostApiVersion !== null
    ));
  const enabledKeys = new Set(enabled.map(moduleCacheKey));
  const stale = [...activatedModules.entries()].filter(
    ([key]) => !enabledKeys.has(key),
  );
  await Promise.all(stale.map(async ([key, activation]) => {
    activatedModules.delete(key);
    try {
      await (await activation).dispose();
    } catch {
      // A stale module is already detached; fatal disposal is reported by Host telemetry later.
    }
  }));

  const settled = await Promise.all(enabled.map(async (record): Promise<
    | { activation: ActivatedPluginWebModuleV1; ok: true }
    | { error: string; ok: false; pluginModuleId: string }
  > => {
    const key = moduleCacheKey(record);
    let activation = activatedModules.get(key);
    if (!activation) {
      activation = (input.activate ?? activateRecord)(
        record,
        input.createHost(record),
      );
      activatedModules.set(key, activation);
    }
    try {
      return { activation: await activation, ok: true };
    } catch (error) {
      activatedModules.delete(key);
      return {
        error: error instanceof Error ? error.message : String(error),
        ok: false,
        pluginModuleId: record.pluginModuleId,
      };
    }
  }));
  return {
    activated: settled.flatMap((entry) => (
      entry.ok ? [entry.activation] : []
    )),
    failures: settled.flatMap((entry) => (
      !entry.ok
        ? [{ error: entry.error, pluginModuleId: entry.pluginModuleId }]
        : []
    )),
  };
}

export function createPluginHostReadStore(
  initial: PluginHostReadSnapshotV1,
): {
  host(version: number): PluginHostApiV1;
  update(snapshot: PluginHostReadSnapshotV1): void;
} {
  let current = structuredClone(initial);
  const listeners = new Set<(snapshot: PluginHostReadSnapshotV1) => void>();
  return {
    host: (version) => ({
      getReadSnapshot: () => structuredClone(current),
      subscribeReadSnapshot(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      version,
    }),
    update(snapshot) {
      if (sameReadSnapshot(current, snapshot)) return;
      current = structuredClone(snapshot);
      for (const listener of listeners) listener(structuredClone(current));
    },
  };
}

async function activateRecord(
  record: PluginModuleRuntimeRecordV1,
  host: PluginHostApiV1,
): Promise<ActivatedPluginWebModuleV1> {
  const [{ activatePluginWebModule }, namespace] = await Promise.all([
    import('@retake-tools/plugin-runtime'),
    import(/* @vite-ignore */ pluginModuleUrl(record)),
  ]);
  return activatePluginWebModule({
    host,
    manifest: record.manifest,
    module: namespace,
    packageDigest: record.packageLock.digest,
  });
}

function pluginModuleUrl(record: PluginModuleRuntimeRecordV1): string {
  return [
    '/api/local/plugin-runtime/modules',
    encodeURIComponent(record.pluginModuleId),
    encodeURIComponent(record.packageLock.digest),
    ...record.manifest.runtime.entrypoint.split('/').map(encodeURIComponent),
  ].join('/');
}

function moduleCacheKey(record: PluginModuleRuntimeRecordV1): string {
  return `${record.pluginModuleId}@${record.packageLock.digest}`;
}

function sameReadSnapshot(
  left: PluginHostReadSnapshotV1,
  right: PluginHostReadSnapshotV1,
): boolean {
  return left.revision === right.revision
    && left.projectId === right.projectId
    && left.boardId === right.boardId
    && sameTextArray(left.boundAssetIds, right.boundAssetIds)
    && sameTextArray(left.boundBlockIds, right.boundBlockIds)
    && sameTextArray(left.boundGroupIds, right.boundGroupIds)
    && sameTextArray(left.selectedBlockIds, right.selectedBlockIds);
}

function sameTextArray(left: string[], right: string[]): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}
