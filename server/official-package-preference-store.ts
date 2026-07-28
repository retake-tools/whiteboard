import { randomBytes } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export const officialPackagePreferenceFile =
  'retake.official-package-preferences.json';
export const officialDefaultPackageIds = [
  'design.retake.image-studio',
  'design.retake.video-studio',
] as const;
export const officialDefaultPluginModuleIds = [
  'design.retake.image-studio.web',
  'design.retake.video-studio.web',
] as const;

export interface OfficialPackagePreferenceStateV1 {
  disabledPluginModuleIds: string[];
  removedPackageIds: string[];
  revokedGrantPluginModuleIds: string[];
  schemaVersion: 1;
  updatedAt: string;
}

export class OfficialPackagePreferenceStore {
  readonly statePath: string;

  constructor(packagesRoot: string) {
    this.statePath = path.join(
      path.resolve(packagesRoot),
      officialPackagePreferenceFile,
    );
  }

  async read(): Promise<OfficialPackagePreferenceStateV1> {
    try {
      return parseOfficialPackagePreferenceState(
        JSON.parse(await readFile(this.statePath, 'utf8')) as unknown,
      );
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return emptyState();
      if (error instanceof SyntaxError) {
        throw new Error('Official Package preference state is invalid JSON.');
      }
      throw error;
    }
  }

  async setPackageRemoved(
    packageId: string,
    removed: boolean,
  ): Promise<OfficialPackagePreferenceStateV1> {
    return this.update((state) => setMembership(
      state.removedPackageIds,
      packageId,
      removed,
    ));
  }

  async setPluginDisabled(
    pluginModuleId: string,
    disabled: boolean,
  ): Promise<OfficialPackagePreferenceStateV1> {
    return this.update((state) => setMembership(
      state.disabledPluginModuleIds,
      pluginModuleId,
      disabled,
    ));
  }

  async setPluginGrantRevoked(
    pluginModuleId: string,
    revoked: boolean,
  ): Promise<OfficialPackagePreferenceStateV1> {
    return this.update((state) => setMembership(
      state.revokedGrantPluginModuleIds,
      pluginModuleId,
      revoked,
    ));
  }

  private async update(
    mutation: (state: OfficialPackagePreferenceStateV1) => void,
  ): Promise<OfficialPackagePreferenceStateV1> {
    const state = await this.read();
    mutation(state);
    state.updatedAt = new Date().toISOString();
    await this.write(state);
    return state;
  }

  private async write(
    state: OfficialPackagePreferenceStateV1,
  ): Promise<void> {
    const parsed = parseOfficialPackagePreferenceState(state);
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath =
      `${this.statePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(parsed, null, 2)}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      await rename(temporaryPath, this.statePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

export function parseOfficialPackagePreferenceState(
  value: unknown,
): OfficialPackagePreferenceStateV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Official Package preference state is invalid.');
  }
  return {
    disabledPluginModuleIds: stringArray(
      value.disabledPluginModuleIds,
      'disabledPluginModuleIds',
    ),
    removedPackageIds: stringArray(
      value.removedPackageIds,
      'removedPackageIds',
    ),
    revokedGrantPluginModuleIds: stringArray(
      value.revokedGrantPluginModuleIds,
      'revokedGrantPluginModuleIds',
    ),
    schemaVersion: 1,
    updatedAt: requiredText(value.updatedAt, 'updatedAt'),
  };
}

function emptyState(): OfficialPackagePreferenceStateV1 {
  return {
    disabledPluginModuleIds: [],
    removedPackageIds: [],
    revokedGrantPluginModuleIds: [],
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
  };
}

function setMembership(
  values: string[],
  value: string,
  present: boolean,
): void {
  const next = new Set(values);
  if (present) next.add(value);
  else next.delete(value);
  values.splice(0, values.length, ...[...next].sort(compareText));
}

function stringArray(value: unknown, label: string): string[] {
  if (
    !Array.isArray(value)
    || value.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    throw new Error(`Official Package preference ${label} is invalid.`);
  }
  const values = [...new Set(value)].sort(compareText);
  if (values.length !== value.length) {
    throw new Error(`Official Package preference ${label} has duplicates.`);
  }
  return values;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Official Package preference ${label} is invalid.`);
  }
  return value;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
