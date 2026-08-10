import type {
  ActivatedPluginWebModuleV2,
  PluginAssetV2,
  PluginConnectedExecutionRunInputV2,
  PluginConnectedExecutionViewV2,
  PluginDraftViewV2,
  PluginExecutionConnectionViewV2,
  PluginExecutionRunInputV2,
  PluginExecutionViewV2,
  PluginHostApiV2,
  PluginHostEnvironmentSnapshotV2,
  PluginHostReadSnapshotV2,
  PluginImageImportV2,
  PluginJsonValueV2,
  PluginSettingScopeV1,
  PluginModuleRuntimeRecordV1,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import { PluginHostErrorV2 } from '@retake-tools/plugin-runtime';
import { createImageAssetFromDataUrl } from './assetStore';
import {
  pluginDraftView,
  type PluginHostDraftRecordV2,
} from './pluginDrafts';
import type { AssetRecord } from './types';
import {
  normalizePluginHostError,
  pluginHostMessage,
} from './pluginHostErrors';
import { createPluginHostEnvironment } from './pluginHostEnvironment';
import {
  createPluginHostSettingsStore,
  type PluginHostSettingsDependenciesV1,
  type PluginSettingsDefinitionRegistrationV1,
} from './pluginHostSettings';
import {
  assertConnectedExecutionRunInput,
  assertDraftAccess,
  assertExecutionRunInput,
  assertOwnedCapability,
  assertPluginDraftValue,
  freezePluginAsset,
  freezePluginDraft,
  freezeReadSnapshot,
  sameAssetMap,
  samePluginDrafts,
  sameReadSnapshot,
} from './pluginHostValidation';

const activatedModules = new Map<
  string,
  Promise<ActivatedPluginWebModuleSession>
>();

export interface ActivatedPluginWebModuleSession {
  activation: ActivatedPluginWebModuleV2;
  host: PluginHostApiV2;
  record: PluginModuleRuntimeRecordV1;
}

export interface PluginWebModuleReconcileResult {
  activated: ActivatedPluginWebModuleV2[];
  fallbacks: Array<{
    error: string;
    pluginModuleId: string;
    rejectedDigest: string;
    retainedDigest: string;
  }>;
  failures: Array<{ error: string; pluginModuleId: string }>;
  sessions: ActivatedPluginWebModuleSession[];
}

export async function reconcilePluginWebModules(input: {
  activate?: (
    record: PluginModuleRuntimeRecordV1,
    host: PluginHostApiV2,
  ) => Promise<ActivatedPluginWebModuleV2>;
  createHost(record: PluginModuleRuntimeRecordV1): PluginHostApiV2;
  onFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  snapshot: PluginRuntimeSnapshotV1;
  validateSessions?: (
    sessions: ActivatedPluginWebModuleSession[],
  ) => Array<{ error: string; pluginModuleId: string }>;
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
  const settled = await Promise.all(enabled.map(async (record): Promise<
    | {
      cacheKey: string;
      fallback?: PluginWebModuleReconcileResult['fallbacks'][number];
      ok: true;
      session: ActivatedPluginWebModuleSession;
    }
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
      return { cacheKey: key, ok: true, session: await session };
    } catch (error) {
      activatedModules.delete(key);
      const message = error instanceof Error ? error.message : String(error);
      const fallback = [...activatedModules.entries()].find(
        ([fallbackKey]) => (
          fallbackKey !== key
          && fallbackKey.startsWith(`${record.pluginModuleId}@`)
        ),
      );
      if (fallback) {
        try {
          return {
            cacheKey: fallback[0],
            fallback: {
              error: message,
              pluginModuleId: record.pluginModuleId,
              rejectedDigest: record.packageLock.digest,
              retainedDigest: (await fallback[1]).record.packageLock.digest,
            },
            ok: true,
            session: await fallback[1],
          };
        } catch {
          activatedModules.delete(fallback[0]);
        }
      }
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
  let resolved = settled;
  const validationFailures = input.validateSessions?.(
    resolved.flatMap((entry) => entry.ok ? [entry.session] : []),
  ) ?? [];
  if (validationFailures.length > 0) {
    resolved = await Promise.all(resolved.map(async (entry) => {
      if (!entry.ok) return entry;
      const failure = validationFailures.find(
        (candidate) => (
          candidate.pluginModuleId === entry.session.record.pluginModuleId
        ),
      );
      if (!failure) return entry;
      activatedModules.delete(entry.cacheKey);
      await entry.session.activation.dispose().catch(() => undefined);
      const fallback = [...activatedModules.entries()].find(
        ([fallbackKey]) => fallbackKey.startsWith(
          `${failure.pluginModuleId}@`,
        ),
      );
      if (fallback) {
        try {
          const session = await fallback[1];
          return {
            cacheKey: fallback[0],
            fallback: {
              error: failure.error,
              pluginModuleId: failure.pluginModuleId,
              rejectedDigest: entry.session.record.packageLock.digest,
              retainedDigest: session.record.packageLock.digest,
            },
            ok: true as const,
            session,
          };
        } catch {
          activatedModules.delete(fallback[0]);
        }
      }
      try {
        await input.onFatalFailure?.(
          failure.pluginModuleId,
          failure.error,
        );
      } catch {
        // Validation already detached the candidate; reporting is best effort.
      }
      return {
        error: failure.error,
        ok: false as const,
        pluginModuleId: failure.pluginModuleId,
      };
    }));
    const restoredFailures = input.validateSessions?.(
      resolved.flatMap((entry) => entry.ok ? [entry.session] : []),
    ) ?? [];
    for (const failure of restoredFailures) {
      const entry = resolved.find((candidate) => (
        candidate.ok
        && candidate.session.record.pluginModuleId === failure.pluginModuleId
      ));
      if (!entry?.ok) continue;
      activatedModules.delete(entry.cacheKey);
      await entry.session.activation.dispose().catch(() => undefined);
      try {
        await input.onFatalFailure?.(
          failure.pluginModuleId,
          failure.error,
        );
      } catch {
        // Validation already detached the fallback; reporting is best effort.
      }
      resolved = resolved.map((candidate) => (
        candidate === entry
          ? {
            error: failure.error,
            ok: false as const,
            pluginModuleId: failure.pluginModuleId,
          }
          : candidate
      ));
    }
  }
  const retainedKeys = new Set(
    resolved.flatMap((entry) => entry.ok ? [entry.cacheKey] : []),
  );
  const resolvedModuleIds = new Set(
    resolved.flatMap((entry) => (
      entry.ok ? [entry.session.record.pluginModuleId] : []
    )),
  );
  const awaitingReplacement = input.snapshot.modules
    .filter((record) => (
      record.desiredState === 'enabled'
      && !resolvedModuleIds.has(record.pluginModuleId)
    ))
    .map((record) => ({
      candidateKey: moduleCacheKey(record),
      pluginModuleId: record.pluginModuleId,
    }));
  const stale = [...activatedModules.entries()].filter(
    ([key]) => (
      !retainedKeys.has(key)
      && !awaitingReplacement.some((candidate) => (
        key !== candidate.candidateKey
        && key.startsWith(`${candidate.pluginModuleId}@`)
      ))
    ),
  );
  await Promise.all(stale.map(async ([key, activation]) => {
    activatedModules.delete(key);
    try {
      await (await activation).activation.dispose();
    } catch {
      // A stale module is already detached; fatal disposal is reported by Host telemetry later.
    }
  }));
  return {
    activated: resolved.flatMap((entry) => (
      entry.ok ? [entry.session.activation] : []
    )),
    fallbacks: resolved.flatMap((entry) => (
      entry.ok && entry.fallback ? [entry.fallback] : []
    )),
    failures: resolved.flatMap((entry) => (
      !entry.ok
        ? [{ error: entry.error, pluginModuleId: entry.pluginModuleId }]
        : []
    )),
    sessions: resolved.flatMap((entry) => (
      entry.ok ? [entry.session] : []
    )),
  };
}

export function createPluginHostReadStore(
  initial: PluginHostReadSnapshotV2,
  options: {
    authorizeExecution?: (
      pluginModuleId: string,
      capabilityId: string,
    ) => boolean;
    importImage?: (
      input: PluginImageImportV2 & { projectId: string },
    ) => Promise<AssetRecord>;
    loadSettingsState?: PluginHostSettingsDependenciesV1['loadSettingsState'];
    updateSettingsState?:
      PluginHostSettingsDependenciesV1['updateSettingsState'];
  } = {},
): PluginHostReadStore {
  let current = freezeReadSnapshot(initial);
  let boundAssets = new Map<string, PluginAssetV2>();
  let boundDrafts: readonly PluginHostDraftRecordV2[] = Object.freeze([]);
  let connectionLister: PluginConnectionListerV2 | undefined;
  let draftRunner: PluginDraftRunnerV2 | undefined;
  let executionRunner: PluginExecutionRunnerV2 | undefined;
  const executionControllers = new Map<string, Set<AbortController>>();
  const importedAssetsByModule = new Map<string, Map<string, AssetRecord>>();
  let retainedModuleDigests = new Map<string, string>();
  const listeners = new Set<(snapshot: PluginHostReadSnapshotV2) => void>();
  const settings = createPluginHostSettingsStore({
    loadSettingsState: options.loadSettingsState,
    updateSettingsState: options.updateSettingsState,
  });
  const importImage = options.importImage ?? createImageAssetFromDataUrl;
  const environment = createPluginHostEnvironment();
  return {
    abortModuleExecutions(pluginModuleId) {
      for (const controller of (
        executionControllers.get(pluginModuleId) ?? []
      )) {
        controller.abort();
      }
      executionControllers.delete(pluginModuleId);
    },
    host: (version, pluginModuleId, permissions = []) => {
      if (version !== 2) {
        throw new PluginHostErrorV2(
          'invalid_argument',
          pluginHostMessage(
            environment.api.getSnapshot().locale,
            'hostVersion',
          ),
        );
      }
      const importedAssets = importedAssetsByModule.get(pluginModuleId)
        ?? new Map<string, AssetRecord>();
      importedAssetsByModule.set(pluginModuleId, importedAssets);
      return {
        assets: Object.freeze({
          getBound(assetId: string) {
            if (!current.boundAssetIds.includes(assetId)) return null;
            return boundAssets.get(assetId) ?? null;
          },
          async importImage(input: PluginImageImportV2) {
            if (!current.projectId) {
              throw new PluginHostErrorV2(
                'unavailable',
                pluginHostMessage(
                  environment.api.getSnapshot().locale,
                  'activeProject',
                ),
              );
            }
            if (
              !input
              || typeof input.dataUrl !== 'string'
              || !input.dataUrl.startsWith('data:image/')
            ) {
              throw new PluginHostErrorV2(
                'invalid_argument',
                pluginHostMessage(
                  environment.api.getSnapshot().locale,
                  'imageDataUrl',
                ),
              );
            }
            try {
              const imported = await importImage({
                ...input,
                projectId: current.projectId,
              });
              importedAssets.set(imported.assetId, imported);
              return freezePluginAsset(imported);
            } catch (error) {
              throw normalizePluginHostError(
                error,
                environment.api.getSnapshot().locale,
              );
            }
          },
        }),
        drafts: Object.freeze({
          getBound(input: {
            blockId: string;
            capabilityId: string;
          }) {
            assertDraftAccess(
              input,
              current,
              pluginModuleId,
              options.authorizeExecution,
              environment.api.getSnapshot().locale,
            );
            const exact = boundDrafts.find((draft) => (
              draft.blockId === input.blockId
              && draft.capabilityId === input.capabilityId
              && draft.pluginModuleId === pluginModuleId
            ));
            const legacy = boundDrafts.find((draft) => (
              draft.legacy
              && draft.blockId === input.blockId
              && draft.capabilityId === input.capabilityId
            ));
            return exact
              ? pluginDraftView(exact)
              : legacy
                ? pluginDraftView(legacy)
                : null;
          },
          async saveBound(input: {
            blockId: string;
            capabilityId: string;
            value: PluginJsonValueV2 | null;
          }) {
            assertDraftAccess(
              input,
              current,
              pluginModuleId,
              options.authorizeExecution,
              environment.api.getSnapshot().locale,
            );
            if (!permissions.includes('retake.draft.write.bound')) {
              throw new PluginHostErrorV2(
                'not_authorized',
                pluginHostMessage(
                  environment.api.getSnapshot().locale,
                  'draftPermission',
                ),
              );
            }
            assertPluginDraftValue(
              input.value,
              environment.api.getSnapshot().locale,
            );
            if (!draftRunner) {
              throw new PluginHostErrorV2(
                'unavailable',
                pluginHostMessage(
                  environment.api.getSnapshot().locale,
                  'boardUnavailable',
                ),
              );
            }
            try {
              return await draftRunner({
                blockId: input.blockId,
                capabilityId: input.capabilityId,
                pluginModuleId,
                value: input.value,
              });
            } catch (error) {
              throw normalizePluginHostError(
                error,
                environment.api.getSnapshot().locale,
              );
            }
          },
        }),
        environment: environment.api,
        execution: Object.freeze({
          listConnections(input: { capabilityId: string }) {
            assertOwnedCapability(
              input.capabilityId,
              pluginModuleId,
              options.authorizeExecution,
              environment.api.getSnapshot().locale,
            );
            if (!current.projectId || !connectionLister) return [];
            try {
              return connectionLister({
                capabilityId: input.capabilityId,
                projectId: current.projectId,
              });
            } catch (error) {
              throw normalizePluginHostError(
                error,
                environment.api.getSnapshot().locale,
              );
            }
          },
          async runConnected(input: PluginConnectedExecutionRunInputV2) {
            assertConnectedExecutionRunInput(
              input,
              current,
              pluginModuleId,
              importedAssets,
              options.authorizeExecution,
              environment.api.getSnapshot().locale,
            );
            if (!executionRunner) {
              throw new PluginHostErrorV2(
                'unavailable',
                pluginHostMessage(
                  environment.api.getSnapshot().locale,
                  'boardUnavailable',
                ),
              );
            }
            const controller = retainExecutionController(
              executionControllers,
              pluginModuleId,
            );
            try {
              return await executionRunner({
                input,
                importedAssets: [...importedAssets.values()].map(
                  (asset) => structuredClone(asset),
                ),
                kind: 'connected',
                pluginModuleId,
                signal: controller.signal,
              }) as PluginConnectedExecutionViewV2;
            } catch (error) {
              throw normalizePluginHostError(
                error,
                environment.api.getSnapshot().locale,
              );
            } finally {
              releaseExecutionController(
                executionControllers,
                pluginModuleId,
                controller,
              );
            }
          },
          async run(input: PluginExecutionRunInputV2) {
            assertExecutionRunInput(
              input,
              current,
              pluginModuleId,
              options.authorizeExecution,
              environment.api.getSnapshot().locale,
            );
            if (!executionRunner) {
              throw new PluginHostErrorV2(
                'unavailable',
                pluginHostMessage(
                  environment.api.getSnapshot().locale,
                  'boardUnavailable',
                ),
              );
            }
            const controller = retainExecutionController(
              executionControllers,
              pluginModuleId,
            );
            try {
              return await executionRunner({
                input,
                kind: 'local',
                pluginModuleId,
                signal: controller.signal,
              }) as PluginExecutionViewV2;
            } catch (error) {
              throw normalizePluginHostError(
                error,
                environment.api.getSnapshot().locale,
              );
            } finally {
              releaseExecutionController(
                executionControllers,
                pluginModuleId,
                controller,
              );
            }
          },
        }),
        settings: Object.freeze({
          getSnapshot(settingsId: string) {
            return settings.getSnapshot(pluginModuleId, settingsId);
          },
          subscribe(listener: () => void) {
            return settings.subscribe(listener);
          },
          async update(input: {
            settingsId: string;
            scope: PluginSettingScopeV1;
            values: Readonly<Record<string, PluginJsonValueV2>>;
          }) {
            if (!permissions.includes('retake.settings.write.self')) {
              throw new PluginHostErrorV2(
                'not_authorized',
                'Plugin Settings write permission is required.',
              );
            }
            return settings.update({
              pluginModuleId,
              scope: input.scope,
              settingsId: input.settingsId,
              snapshot: current,
              values: input.values,
            });
          },
        }),
        getReadSnapshot: () => current,
        subscribeReadSnapshot(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        version: 2,
      };
    },
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
      for (const [pluginModuleId, assets] of importedAssetsByModule) {
        if (
          retained.get(pluginModuleId)
          === retainedModuleDigests.get(pluginModuleId)
        ) continue;
        assets.clear();
        importedAssetsByModule.delete(pluginModuleId);
      }
      retainedModuleDigests = retained;
    },
    setConnectionLister(lister) {
      connectionLister = lister;
    },
    setDraftRunner(runner) {
      draftRunner = runner;
    },
    setExecutionRunner(runner) {
      executionRunner = runner;
    },
    async setSettingsDefinitions(definitions) {
      await settings.setDefinitions(definitions, current);
    },
    update(snapshot, assets = [], drafts = []) {
      if (
        current.projectId !== snapshot.projectId
        || current.boardId !== snapshot.boardId
      ) {
        for (const controllers of executionControllers.values()) {
          for (const controller of controllers) controller.abort();
        }
        executionControllers.clear();
        for (const assets of importedAssetsByModule.values()) assets.clear();
        importedAssetsByModule.clear();
      }
      const nextAssets = new Map(
        assets.map((asset) => [asset.assetId, freezePluginAsset(asset)]),
      );
      const snapshotChanged = !sameReadSnapshot(current, snapshot);
      const assetsChanged = !sameAssetMap(boundAssets, nextAssets);
      const nextDrafts = drafts.map(freezePluginDraft);
      const draftsChanged = !samePluginDrafts(boundDrafts, nextDrafts);
      if (!snapshotChanged && !assetsChanged && !draftsChanged) return;
      current = freezeReadSnapshot(snapshot);
      boundAssets = nextAssets;
      boundDrafts = Object.freeze(nextDrafts);
      for (const listener of listeners) listener(current);
      settings.updateScope(current);
    },
    updateEnvironment: environment.update,
  };

}

export interface PluginHostReadStore {
  abortModuleExecutions(pluginModuleId: string): void;
  host(
    version: number,
    pluginModuleId: string,
    permissions?: readonly string[],
  ): PluginHostApiV2;
  retainModules(modules: readonly {
    packageDigest: string;
    pluginModuleId: string;
  }[]): void;
  setConnectionLister(lister: PluginConnectionListerV2 | undefined): void;
  setDraftRunner(runner: PluginDraftRunnerV2 | undefined): void;
  setExecutionRunner(runner: PluginExecutionRunnerV2 | undefined): void;
  setSettingsDefinitions(
    definitions: readonly PluginSettingsDefinitionRegistrationV1[],
  ): Promise<void>;
  update(
    snapshot: PluginHostReadSnapshotV2,
    assets?: readonly PluginAssetV2[],
    drafts?: readonly PluginHostDraftRecordV2[],
  ): void;
  updateEnvironment(snapshot: PluginHostEnvironmentSnapshotV2): void;
}

export type {
  PluginSettingsDefinitionRegistrationV1,
} from './pluginHostSettings';

export interface PluginDraftRunnerRequestV2 {
  blockId: string;
  capabilityId: string;
  pluginModuleId: string;
  value: PluginJsonValueV2 | null;
}

export type PluginDraftRunnerV2 = (
  request: PluginDraftRunnerRequestV2,
) => Promise<PluginDraftViewV2 | null>;

export type PluginConnectionListerV2 = (input: {
  capabilityId: string;
  projectId: string;
}) => readonly PluginExecutionConnectionViewV2[];

export type PluginExecutionRunnerRequestV2 =
  | {
      input: PluginExecutionRunInputV2;
      kind: 'local';
      pluginModuleId: string;
      signal: AbortSignal;
    }
  | {
      input: PluginConnectedExecutionRunInputV2;
      importedAssets: readonly AssetRecord[];
      kind: 'connected';
      pluginModuleId: string;
      signal: AbortSignal;
    };

export type PluginExecutionRunnerV2 = (
  request: PluginExecutionRunnerRequestV2,
) => Promise<PluginConnectedExecutionViewV2 | PluginExecutionViewV2>;

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
  host: PluginHostApiV2,
): Promise<ActivatedPluginWebModuleV2> {
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

function retainExecutionController(
  controllersByModule: Map<string, Set<AbortController>>,
  pluginModuleId: string,
): AbortController {
  const controller = new AbortController();
  const controllers = controllersByModule.get(pluginModuleId)
    ?? new Set<AbortController>();
  controllers.add(controller);
  controllersByModule.set(pluginModuleId, controllers);
  return controller;
}

function releaseExecutionController(
  controllersByModule: Map<string, Set<AbortController>>,
  pluginModuleId: string,
  controller: AbortController,
): void {
  const controllers = controllersByModule.get(pluginModuleId);
  controllers?.delete(controller);
  if (controllers?.size === 0) {
    controllersByModule.delete(pluginModuleId);
  }
}
