import type {
  ActivatedPluginWebModuleV1,
  PluginHostApiV1,
  PluginHostReadSnapshotV1,
  PluginModuleRuntimeRecordV1,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';

const activatedModules = new Map<
  string,
  Promise<ActivatedPluginWebModuleSession>
>();

export interface ActivatedPluginWebModuleSession {
  activation: ActivatedPluginWebModuleV1;
  host: PluginHostApiV1;
  record: PluginModuleRuntimeRecordV1;
}

export interface PluginWebModuleReconcileResult {
  activated: ActivatedPluginWebModuleV1[];
  failures: Array<{ error: string; pluginModuleId: string }>;
  sessions: ActivatedPluginWebModuleSession[];
}

export async function reconcilePluginWebModules(input: {
  activate?: (
    record: PluginModuleRuntimeRecordV1,
    host: PluginHostApiV1,
  ) => Promise<ActivatedPluginWebModuleV1>;
  createHost(record: PluginModuleRuntimeRecordV1): PluginHostApiV1;
  onFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
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
      await (await activation).activation.dispose();
    } catch {
      // A stale module is already detached; fatal disposal is reported by Host telemetry later.
    }
  }));

  const settled = await Promise.all(enabled.map(async (record): Promise<
    | { ok: true; session: ActivatedPluginWebModuleSession }
    | { error: string; ok: false; pluginModuleId: string }
  > => {
    const key = moduleCacheKey(record);
    let session = activatedModules.get(key);
    if (!session) {
      const host = input.createHost(record);
      session = (input.activate ?? activateRecord)(record, host)
        .then((activation) => ({
          activation,
          host,
          record: structuredClone(record),
        }));
      activatedModules.set(key, session);
    }
    try {
      return { ok: true, session: await session };
    } catch (error) {
      activatedModules.delete(key);
      const message = error instanceof Error ? error.message : String(error);
      try {
        await input.onFatalFailure?.(record.pluginModuleId, message);
      } catch {
        // Activation is already detached; reporting failure is best effort.
      }
      return {
        error: message,
        ok: false,
        pluginModuleId: record.pluginModuleId,
      };
    }
  }));
  return {
    activated: settled.flatMap((entry) => (
      entry.ok ? [entry.session.activation] : []
    )),
    failures: settled.flatMap((entry) => (
      !entry.ok
        ? [{ error: entry.error, pluginModuleId: entry.pluginModuleId }]
        : []
    )),
    sessions: settled.flatMap((entry) => (
      entry.ok ? [entry.session] : []
    )),
  };
}

export function createPluginHostReadStore(
  initial: PluginHostReadSnapshotV1,
): PluginHostReadStore {
  let current = freezeReadSnapshot(initial);
  const listeners = new Set<(snapshot: PluginHostReadSnapshotV1) => void>();
  return {
    host: (version) => ({
      getReadSnapshot: () => current,
      subscribeReadSnapshot(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      version,
    }),
    update(snapshot) {
      if (sameReadSnapshot(current, snapshot)) return;
      current = freezeReadSnapshot(snapshot);
      for (const listener of listeners) listener(current);
    },
  };
}

export interface PluginHostReadStore {
  host(version: number): PluginHostApiV1;
  update(snapshot: PluginHostReadSnapshotV1): void;
}

export async function disposePluginWebModule(
  pluginModuleId: string,
): Promise<void> {
  await Promise.all([...activatedModules.entries()].map(
    async ([key, session]) => {
      if (!await session.then(
        (value) => value.record.pluginModuleId === pluginModuleId,
        () => false,
      )) return;
      activatedModules.delete(key);
      await (await session).activation.dispose();
    },
  ));
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

function sameTextArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function freezeReadSnapshot(
  snapshot: PluginHostReadSnapshotV1,
): PluginHostReadSnapshotV1 {
  return Object.freeze({
    boardId: snapshot.boardId,
    boundAssetIds: Object.freeze([...snapshot.boundAssetIds]),
    boundBlockIds: Object.freeze([...snapshot.boundBlockIds]),
    boundGroupIds: Object.freeze([...snapshot.boundGroupIds]),
    projectId: snapshot.projectId,
    revision: snapshot.revision,
    selectedBlockIds: Object.freeze([...snapshot.selectedBlockIds]),
  }) as PluginHostReadSnapshotV1;
}
