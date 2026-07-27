import type {
  ActivatedPluginWebModuleV1,
  PluginAssetV1,
  PluginExecutionRunInputV1,
  PluginExecutionViewV1,
  PluginHostApiV1,
  PluginHostReadSnapshotV1,
  PluginImageImportV1,
  PluginModuleRuntimeRecordV1,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import { createImageAssetFromDataUrl } from './assetStore';

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
  options: {
    authorizeExecution?: (
      pluginModuleId: string,
      capabilityId: string,
    ) => boolean;
    importImage?: (
      input: PluginImageImportV1 & { projectId: string },
    ) => Promise<PluginAssetV1>;
  } = {},
): PluginHostReadStore {
  let current = freezeReadSnapshot(initial);
  let boundAssets = new Map<string, PluginAssetV1>();
  let executionRunner: PluginExecutionRunnerV1 | undefined;
  const executionControllers = new Map<string, Set<AbortController>>();
  let retainedModuleDigests = new Map<string, string>();
  const listeners = new Set<(snapshot: PluginHostReadSnapshotV1) => void>();
  const importImage = options.importImage ?? createImageAssetFromDataUrl;
  return {
    abortModuleExecutions(pluginModuleId) {
      for (const controller of (
        executionControllers.get(pluginModuleId) ?? []
      )) {
        controller.abort();
      }
      executionControllers.delete(pluginModuleId);
    },
    host: (version, pluginModuleId) => ({
      assets: Object.freeze({
        getBound(assetId: string) {
          if (!current.boundAssetIds.includes(assetId)) return null;
          return boundAssets.get(assetId) ?? null;
        },
        async importImage(input: PluginImageImportV1) {
          if (!current.projectId) {
            throw new Error('Plugin asset import requires an active project.');
          }
          if (!input.dataUrl.startsWith('data:image/')) {
            throw new Error('Plugin asset import requires an image data URL.');
          }
          return freezePluginAsset(await importImage({
            ...input,
            projectId: current.projectId,
          }));
        },
      }),
      execution: Object.freeze({
        async run(input: PluginExecutionRunInputV1) {
          assertExecutionRunInput(
            input,
            current,
            pluginModuleId,
            options.authorizeExecution,
          );
          if (!executionRunner) {
            throw new Error(
              'Plugin execution is unavailable before the active Board is ready.',
            );
          }
          const controller = new AbortController();
          const controllers = executionControllers.get(pluginModuleId)
            ?? new Set<AbortController>();
          controllers.add(controller);
          executionControllers.set(pluginModuleId, controllers);
          try {
            return await executionRunner({
              input,
              pluginModuleId,
              signal: controller.signal,
            });
          } finally {
            controllers.delete(controller);
            if (controllers.size === 0) {
              executionControllers.delete(pluginModuleId);
            }
          }
        },
      }),
      getReadSnapshot: () => current,
      subscribeReadSnapshot(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      version,
    }),
    retainModules(modules) {
      const retained = new Map(
        modules.map((module) => [
          module.pluginModuleId,
          module.packageDigest,
        ]),
      );
      for (const pluginModuleId of executionControllers.keys()) {
        if (
          retained.get(pluginModuleId)
          === retainedModuleDigests.get(pluginModuleId)
        ) continue;
        for (const controller of (
          executionControllers.get(pluginModuleId) ?? []
        )) {
          controller.abort();
        }
        executionControllers.delete(pluginModuleId);
      }
      retainedModuleDigests = retained;
    },
    setExecutionRunner(runner) {
      executionRunner = runner;
    },
    update(snapshot, assets = []) {
      if (
        current.projectId !== snapshot.projectId
        || current.boardId !== snapshot.boardId
      ) {
        for (const controllers of executionControllers.values()) {
          for (const controller of controllers) controller.abort();
        }
        executionControllers.clear();
      }
      const nextAssets = new Map(
        assets.map((asset) => [asset.assetId, freezePluginAsset(asset)]),
      );
      const snapshotChanged = !sameReadSnapshot(current, snapshot);
      const assetsChanged = !sameAssetMap(boundAssets, nextAssets);
      if (!snapshotChanged && !assetsChanged) return;
      current = freezeReadSnapshot(snapshot);
      boundAssets = nextAssets;
      for (const listener of listeners) listener(current);
    },
  };
}

export interface PluginHostReadStore {
  abortModuleExecutions(pluginModuleId: string): void;
  host(version: number, pluginModuleId: string): PluginHostApiV1;
  retainModules(modules: readonly {
    packageDigest: string;
    pluginModuleId: string;
  }[]): void;
  setExecutionRunner(runner: PluginExecutionRunnerV1 | undefined): void;
  update(
    snapshot: PluginHostReadSnapshotV1,
    assets?: readonly PluginAssetV1[],
  ): void;
}

export interface PluginExecutionRunnerRequestV1 {
  input: PluginExecutionRunInputV1;
  pluginModuleId: string;
  signal: AbortSignal;
}

export type PluginExecutionRunnerV1 = (
  request: PluginExecutionRunnerRequestV1,
) => Promise<PluginExecutionViewV1>;

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

function assertExecutionRunInput(
  input: PluginExecutionRunInputV1,
  snapshot: PluginHostReadSnapshotV1,
  pluginModuleId: string,
  authorize: (
    pluginModuleId: string,
    capabilityId: string,
  ) => boolean = () => false,
): void {
  if (
    typeof input !== 'object'
    || input === null
    || typeof input.capabilityId !== 'string'
    || input.capabilityId.trim() !== input.capabilityId
    || input.capabilityId.length === 0
    || typeof input.execute !== 'function'
    || !Array.isArray(input.inputBlockIds)
    || input.inputBlockIds.length === 0
    || new Set(input.inputBlockIds).size !== input.inputBlockIds.length
    || input.inputBlockIds.some((blockId) => (
      typeof blockId !== 'string'
      || !snapshot.boundBlockIds.includes(blockId)
    ))
    || !isJsonObject(input.parameters)
  ) {
    throw new Error(
      'Plugin execution requires a valid Capability, bound input Blocks, JSON parameters, and an executor.',
    );
  }
  if (!snapshot.projectId || !snapshot.boardId) {
    throw new Error('Plugin execution requires an active Board.');
  }
  if (!authorize(pluginModuleId, input.capabilityId)) {
    throw new Error(
      `PluginModule does not own the requested Capability: ${input.capabilityId}`,
    );
  }
}

function isJsonObject(value: unknown): boolean {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): boolean {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
  ) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isJsonObject(value);
}

function sameTextArray(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameAssetMap(
  left: ReadonlyMap<string, PluginAssetV1>,
  right: ReadonlyMap<string, PluginAssetV1>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [assetId, asset] of left) {
    const candidate = right.get(assetId);
    if (
      !candidate
      || asset.createdAt !== candidate.createdAt
      || asset.duration !== candidate.duration
      || asset.height !== candidate.height
      || asset.kind !== candidate.kind
      || asset.mimeType !== candidate.mimeType
      || asset.previewUrl !== candidate.previewUrl
      || asset.width !== candidate.width
    ) return false;
  }
  return true;
}

function freezePluginAsset(asset: PluginAssetV1): PluginAssetV1 {
  return Object.freeze({
    assetId: asset.assetId,
    createdAt: asset.createdAt,
    ...(asset.duration === undefined ? {} : { duration: asset.duration }),
    ...(asset.height === undefined ? {} : { height: asset.height }),
    kind: asset.kind,
    mimeType: asset.mimeType,
    previewUrl: asset.previewUrl,
    ...(asset.width === undefined ? {} : { width: asset.width }),
  });
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
