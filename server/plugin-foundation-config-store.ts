import { randomBytes } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  parsePluginHostExperienceProfileV1,
  parsePluginSettingsScopeValuesV1,
  parsePluginSettingsV1,
  type PluginHostExperienceProfileV1,
  type PluginJsonValueV2,
  type PluginSettingScopeV1,
  type PluginSettingsV1,
} from '@retake-tools/package-sdk';

export const pluginSettingsStateFile = 'retake.plugin-settings.json';
export const pluginExperienceStateFile = 'retake.plugin-experience.json';

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

export class PluginFoundationConfigStore {
  readonly experiencePath: string;
  readonly settingsPath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(packagesRoot: string) {
    const root = path.resolve(packagesRoot);
    this.experiencePath = path.join(root, pluginExperienceStateFile);
    this.settingsPath = path.join(root, pluginSettingsStateFile);
  }

  async readExperience(): Promise<PluginHostExperienceProfileV1> {
    try {
      return parsePluginHostExperienceProfileV1(
        JSON.parse(await readFile(this.experiencePath, 'utf8')) as unknown,
      );
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return defaultExperience();
      if (error instanceof SyntaxError) {
        throw new Error('Plugin Experience state is invalid JSON.');
      }
      throw error;
    }
  }

  async readSettings(): Promise<PluginSettingsPersistedStateV1> {
    try {
      return parseSettingsState(
        JSON.parse(await readFile(this.settingsPath, 'utf8')) as unknown,
      );
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return emptySettingsState();
      if (error instanceof SyntaxError) {
        throw new Error('Plugin Settings state is invalid JSON.');
      }
      throw error;
    }
  }

  async replaceExperience(
    profile: PluginHostExperienceProfileV1,
  ): Promise<PluginHostExperienceProfileV1> {
    const parsed = parsePluginHostExperienceProfileV1(profile);
    return this.enqueue(async () => {
      await writeJsonAtomic(this.experiencePath, parsed);
      return parsed;
    });
  }

  async updateSettings(input: {
    definition: PluginSettingsV1;
    pluginModuleId: string;
    scope: PluginSettingScopeV1;
    scopeId: string;
    values: Readonly<Record<string, PluginJsonValueV2>>;
  }): Promise<PluginSettingsPersistedStateV1> {
    const definition = parsePluginSettingsV1(input.definition);
    if (!isNamespacedId(input.pluginModuleId) || input.scopeId.length === 0) {
      throw new Error('Plugin Settings persistence identity is invalid.');
    }
    const values = parsePluginSettingsScopeValuesV1(
      definition,
      input.scope,
      input.values,
    );
    return this.enqueue(async () => {
      const current = await this.readSettings();
      const entries = current.entries.filter((entry) => !(
        entry.pluginModuleId === input.pluginModuleId
        && entry.settingsId === definition.settingsId
        && entry.scope === input.scope
        && entry.scopeId === input.scopeId
      ));
      if (Object.keys(values).length > 0) {
        entries.push(Object.freeze({
          pluginModuleId: input.pluginModuleId,
          schemaVersion: definition.schemaVersion,
          scope: input.scope,
          scopeId: input.scopeId,
          settingsId: definition.settingsId,
          values,
        }));
      }
      entries.sort(compareSettingsEntry);
      const next = Object.freeze({
        entries: Object.freeze(entries),
        revision: current.revision + 1,
        schemaVersion: 1 as const,
      });
      await writeJsonAtomic(this.settingsPath, next);
      return next;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function parseSettingsState(value: unknown): PluginSettingsPersistedStateV1 {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || !Number.isInteger(value.revision)
    || (value.revision as number) < 0
    || !Array.isArray(value.entries)
  ) {
    throw new Error('Plugin Settings state is invalid.');
  }
  const identities = new Set<string>();
  const entries = value.entries.map((entry) => {
    if (
      !isRecord(entry)
      || !isNamespacedId(entry.pluginModuleId)
      || !isNamespacedId(entry.settingsId)
      || !Number.isInteger(entry.schemaVersion)
      || (entry.schemaVersion as number) <= 0
      || (
        entry.scope !== 'board'
        && entry.scope !== 'project'
        && entry.scope !== 'workspace'
      )
      || typeof entry.scopeId !== 'string'
      || entry.scopeId.length === 0
      || !isJsonRecord(entry.values)
    ) {
      throw new Error('Plugin Settings state entry is invalid.');
    }
    const identity = [
      entry.pluginModuleId,
      entry.settingsId,
      entry.scope,
      entry.scopeId,
    ].join(':');
    if (identities.has(identity)) {
      throw new Error('Plugin Settings state contains a duplicate entry.');
    }
    identities.add(identity);
    return Object.freeze({
      pluginModuleId: entry.pluginModuleId,
      schemaVersion: entry.schemaVersion as number,
      scope: entry.scope,
      scopeId: entry.scopeId,
      settingsId: entry.settingsId,
      values: Object.freeze({ ...entry.values }),
    }) as PluginSettingsPersistedEntryV1;
  });
  if (!sameEntryOrder(entries, [...entries].sort(compareSettingsEntry))) {
    throw new Error('Plugin Settings state entries must be sorted.');
  }
  return Object.freeze({
    entries: Object.freeze(entries),
    revision: value.revision as number,
    schemaVersion: 1,
  });
}

function defaultExperience(): PluginHostExperienceProfileV1 {
  return Object.freeze({
    commandOverrides: Object.freeze([]),
    profileId: 'retake.experience.whiteboard',
    schemaVersion: 1,
  });
}

function emptySettingsState(): PluginSettingsPersistedStateV1 {
  return Object.freeze({
    entries: Object.freeze([]),
    revision: 0,
    schemaVersion: 1,
  });
}

function compareSettingsEntry(
  left: PluginSettingsPersistedEntryV1,
  right: PluginSettingsPersistedEntryV1,
): number {
  return [
    left.pluginModuleId.localeCompare(right.pluginModuleId),
    left.settingsId.localeCompare(right.settingsId),
    left.scope.localeCompare(right.scope),
    left.scopeId.localeCompare(right.scopeId),
  ].find((value) => value !== 0) ?? 0;
}

function sameEntryOrder(
  left: readonly PluginSettingsPersistedEntryV1[],
  right: readonly PluginSettingsPersistedEntryV1[],
): boolean {
  return left.every((entry, index) => entry === right[index]);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath =
    `${filePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(value, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 },
    );
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function isJsonRecord(
  value: unknown,
): value is Record<string, PluginJsonValueV2> {
  return isRecord(value)
    && Object.values(value).every((entry) => isJsonValue(entry));
}

function isJsonValue(value: unknown): value is PluginJsonValueV2 {
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
  ) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isNamespacedId(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
