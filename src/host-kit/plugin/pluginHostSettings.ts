import type {
  PluginHostReadSnapshotV2,
  PluginJsonValueV2,
  PluginSettingScopeV1,
  PluginSettingsSnapshotV1,
  PluginSettingsV1,
} from '@retake-tools/package-sdk';
import {
  migratePluginSettingsRecordV1,
  parsePluginSettingsScopeValuesV1,
  PluginHostErrorV2,
  resolvePluginSettingsValuesV1,
} from '@retake-tools/plugin-runtime';
export interface PluginSettingsPersistedEntryV1 {
  readonly pluginModuleId: string;
  readonly schemaVersion: number;
  readonly scope: PluginSettingScopeV1;
  readonly scopeId: string;
  readonly settingsId: string;
  readonly values: Readonly<Record<string, PluginJsonValueV2>>;
}

export interface PluginSettingsPersistedStateV1 {
  readonly entries: readonly PluginSettingsPersistedEntryV1[];
  readonly revision: number;
  readonly schemaVersion: 1;
}

export interface UpdatePluginSettingsStateInputV1 {
  readonly definition: PluginSettingsV1;
  readonly pluginModuleId: string;
  readonly scope: PluginSettingScopeV1;
  readonly scopeId: string;
  readonly values: Readonly<Record<string, PluginJsonValueV2>>;
}

export interface PluginSettingsDefinitionRegistrationV1 {
  definition: PluginSettingsV1;
  pluginModuleId: string;
}

export interface PluginHostSettingsDependenciesV1 {
  loadSettingsState?: () => Promise<PluginSettingsPersistedStateV1>;
  updateSettingsState?: (
    input: UpdatePluginSettingsStateInputV1,
  ) => Promise<PluginSettingsPersistedStateV1>;
}

export function createPluginHostSettingsStore(
  dependencies: PluginHostSettingsDependenciesV1 = {},
) {
  const listeners = new Set<() => void>();
  let definitions: readonly PluginSettingsDefinitionRegistrationV1[] =
    Object.freeze([]);
  let persistedState: PluginSettingsPersistedStateV1 = {
    entries: [],
    revision: 0,
    schemaVersion: 1,
  };
  let snapshots = new Map<string, PluginSettingsSnapshotV1>();

  return Object.freeze({
    getSnapshot(pluginModuleId: string, settingsId: string) {
      return snapshots.get(settingsIdentity(pluginModuleId, settingsId))
        ?? null;
    },
    async setDefinitions(
      nextDefinitions: readonly PluginSettingsDefinitionRegistrationV1[],
      scope: PluginHostReadSnapshotV2,
    ) {
      definitions = Object.freeze(nextDefinitions.map((entry) => (
        Object.freeze({
          definition: entry.definition,
          pluginModuleId: entry.pluginModuleId,
        })
      )));
      persistedState = dependencies.loadSettingsState
        ? await dependencies.loadSettingsState()
        : emptySettingsState();
      recompute(scope);
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async update(input: {
      pluginModuleId: string;
      scope: PluginSettingScopeV1;
      settingsId: string;
      snapshot: PluginHostReadSnapshotV2;
      values: Readonly<Record<string, PluginJsonValueV2>>;
    }) {
      const registration = definitions.find((entry) => (
        entry.pluginModuleId === input.pluginModuleId
        && entry.definition.settingsId === input.settingsId
      ));
      if (!registration) {
        throw new PluginHostErrorV2(
          'not_found',
          'Plugin Settings definition is not registered.',
        );
      }
      const values = parsePluginSettingsScopeValuesV1(
        registration.definition,
        input.scope,
        input.values,
      );
      if (!dependencies.updateSettingsState) {
        throw new PluginHostErrorV2(
          'unavailable',
          'Plugin Settings persistence is not configured for this Host.',
        );
      }
      persistedState = await dependencies.updateSettingsState({
        definition: registration.definition,
        pluginModuleId: input.pluginModuleId,
        scope: input.scope,
        scopeId: settingsScopeId(input.scope, input.snapshot),
        values,
      });
      recompute(input.snapshot);
      return snapshots.get(
        settingsIdentity(input.pluginModuleId, input.settingsId),
      )!;
    },
    updateScope: recompute,
  });

  function recompute(scope: PluginHostReadSnapshotV2): void {
    const next = new Map<string, PluginSettingsSnapshotV1>();
    for (const registration of definitions) {
      const valuesByScope: Partial<Record<
        PluginSettingScopeV1,
        Readonly<Record<string, PluginJsonValueV2>>
      >> = {};
      for (const settingScope of ['workspace', 'project', 'board'] as const) {
        const scopeId = optionalSettingsScopeId(settingScope, scope);
        if (!scopeId) continue;
        const stored = persistedState.entries.find((entry) => (
          entry.pluginModuleId === registration.pluginModuleId
          && entry.settingsId === registration.definition.settingsId
          && entry.scope === settingScope
          && entry.scopeId === scopeId
        ));
        if (!stored) continue;
        valuesByScope[settingScope] = parsePluginSettingsScopeValuesV1(
          registration.definition,
          settingScope,
          migratePluginSettingsRecordV1(registration.definition, {
            schemaVersion: stored.schemaVersion,
            values: stored.values,
          }).values,
        );
      }
      const definition = registration.definition;
      next.set(
        settingsIdentity(registration.pluginModuleId, definition.settingsId),
        Object.freeze({
          revision: [
            persistedState.revision,
            scope.projectId ?? 'no-project',
            scope.boardId ?? 'no-board',
            definition.schemaVersion,
          ].join(':'),
          schemaVersion: definition.schemaVersion,
          settingsId: definition.settingsId,
          values: resolvePluginSettingsValuesV1(definition, valuesByScope),
        }),
      );
    }
    if (sameSettingsSnapshots(snapshots, next)) return;
    snapshots = next;
    for (const listener of listeners) listener();
  }
}

function emptySettingsState(): PluginSettingsPersistedStateV1 {
  return { entries: [], revision: 0, schemaVersion: 1 };
}

function settingsScopeId(
  scope: PluginSettingScopeV1,
  snapshot: PluginHostReadSnapshotV2,
): string {
  const scopeId = optionalSettingsScopeId(scope, snapshot);
  if (!scopeId) {
    throw new PluginHostErrorV2(
      'unavailable',
      `Plugin Settings ${scope} scope is unavailable.`,
    );
  }
  return scopeId;
}

function optionalSettingsScopeId(
  scope: PluginSettingScopeV1,
  snapshot: PluginHostReadSnapshotV2,
): string | null {
  if (scope === 'workspace') return 'workspace';
  if (scope === 'project') return snapshot.projectId;
  return snapshot.projectId && snapshot.boardId
    ? `${snapshot.projectId}:${snapshot.boardId}`
    : null;
}

function settingsIdentity(
  pluginModuleId: string,
  settingsId: string,
): string {
  return `${pluginModuleId}:${settingsId}`;
}

function sameSettingsSnapshots(
  left: ReadonlyMap<string, PluginSettingsSnapshotV1>,
  right: ReadonlyMap<string, PluginSettingsSnapshotV1>,
): boolean {
  return left.size === right.size
    && [...left].every(([key, value]) => {
      const other = right.get(key);
      return other?.revision === value.revision
        && JSON.stringify(other.values) === JSON.stringify(value.values);
    });
}
