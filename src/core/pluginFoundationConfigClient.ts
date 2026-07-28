import {
  type PluginHostExperienceProfileV1,
  type PluginJsonValueV2,
  type PluginProfileOverrideStateV1,
  type PluginProfileStateV1,
  type PluginSettingScopeV1,
  type PluginSettingsV1,
} from '@retake-tools/package-sdk';
import {
  parsePluginHostExperienceProfileV1,
  parsePluginProfileStateV1,
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

export async function loadPluginSettingsState(): Promise<
  PluginSettingsPersistedStateV1
> {
  return parseSettingsState(await requestJson(
    '/api/local/plugin-foundation/settings',
  ));
}

export async function updatePluginSettingsState(input: {
  definition: PluginSettingsV1;
  pluginModuleId: string;
  scope: PluginSettingScopeV1;
  scopeId: string;
  values: Readonly<Record<string, PluginJsonValueV2>>;
}): Promise<PluginSettingsPersistedStateV1> {
  return parseSettingsState(await requestJson(
    '/api/local/plugin-foundation/settings',
    {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  ));
}

export async function loadPluginExperience(): Promise<
  PluginHostExperienceProfileV1
> {
  return parsePluginHostExperienceProfileV1(await requestJson(
    '/api/local/plugin-foundation/experience',
  ));
}

export async function loadPluginProfile(): Promise<PluginProfileStateV1> {
  return parsePluginProfileStateV1(await requestJson(
    '/api/local/plugin-foundation/profile',
  ));
}

export async function updatePluginProfile(input: {
  boardId: string | null;
  pluginModuleId: string;
  projectId: string;
  scope: 'board' | 'project';
  state: PluginProfileOverrideStateV1;
}): Promise<PluginProfileStateV1> {
  return parsePluginProfileStateV1(await requestJson(
    '/api/local/plugin-foundation/profile',
    {
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    },
  ));
}

export async function savePluginExperience(
  profile: PluginHostExperienceProfileV1,
): Promise<PluginHostExperienceProfileV1> {
  return parsePluginHostExperienceProfileV1(await requestJson(
    '/api/local/plugin-foundation/experience',
    {
      body: JSON.stringify(profile),
      headers: { 'Content-Type': 'application/json' },
      method: 'PUT',
    },
  ));
}

function parseSettingsState(value: unknown): PluginSettingsPersistedStateV1 {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || !Number.isInteger(value.revision)
    || !Array.isArray(value.entries)
  ) {
    throw new Error('Plugin Settings response is invalid.');
  }
  return {
    entries: value.entries as unknown as PluginSettingsPersistedEntryV1[],
    revision: value.revision as number,
    schemaVersion: 1,
  };
}

async function requestJson(url: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      isRecord(body) && typeof body.error === 'string'
        ? body.error
        : `Plugin Foundation request failed with HTTP ${response.status}.`,
    );
  }
  return body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
