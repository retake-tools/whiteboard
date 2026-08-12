import type {
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
} from '@retake-tools/package-sdk';
import { PluginHostErrorV2 } from '@retake-tools/plugin-runtime';
import {
  pluginDraftView,
  type PluginHostDraftRecordV2,
} from './pluginDrafts';
import type { AssetRecord } from '../../core/types';
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

export interface CreatePluginHostReadStoreOptionsV1 {
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
}

export function createPluginHostReadStore(
  initial: PluginHostReadSnapshotV2,
  options: CreatePluginHostReadStoreOptionsV1 = {},
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
  const importImage = options.importImage ?? unavailableImageImporter;
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

async function unavailableImageImporter(): Promise<never> {
  throw new PluginHostErrorV2(
    'unavailable',
    'Plugin image import is not configured for this Host.',
  );
}
