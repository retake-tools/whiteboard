import { randomBytes } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import type { PluginModuleRuntimeRecordV1 } from '@retake-tools/package-sdk';

export const packageActivationGuardFile =
  'retake.package-activation-guards.json';

export interface PackageActivationGuardV1 {
  candidateDigest: string;
  candidateInstallationId: string;
  confirmedPluginModuleIds: string[];
  createdAt: string;
  packageId: string;
  pendingPluginModuleIds: string[];
  previousDigest: string;
  previousInstallationId: string;
  previousPluginModules: PluginModuleRuntimeRecordV1[];
}

export class PackageActivationGuardStore {
  readonly statePath: string;

  constructor(packagesRoot: string) {
    this.statePath = path.join(
      path.resolve(packagesRoot),
      packageActivationGuardFile,
    );
  }

  async list(): Promise<PackageActivationGuardV1[]> {
    try {
      const value = JSON.parse(await readFile(this.statePath, 'utf8')) as unknown;
      if (!isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.guards)) {
        throw new Error('Package activation guard state is invalid.');
      }
      return value.guards.map(parseGuard).sort((left, right) => (
        compareText(left.packageId, right.packageId)
      ));
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return [];
      throw error;
    }
  }

  async stage(guard: PackageActivationGuardV1): Promise<void> {
    const parsed = parseGuard(guard);
    const guards = (await this.list()).filter(
      (entry) => entry.packageId !== parsed.packageId,
    );
    guards.push(parsed);
    await this.write(guards);
  }

  async confirm(input: {
    candidateDigest: string;
    packageId: string;
    pluginModuleId: string;
  }): Promise<{ confirmed: boolean }> {
    const guards = await this.list();
    const guard = guards.find((entry) => entry.packageId === input.packageId);
    if (!guard || guard.candidateDigest !== input.candidateDigest) {
      return { confirmed: false };
    }
    if (!guard.pendingPluginModuleIds.includes(input.pluginModuleId)) {
      throw new Error('PluginModule is not part of the pending Package activation.');
    }
    const confirmedPluginModuleIds = [...new Set([
      ...guard.confirmedPluginModuleIds,
      input.pluginModuleId,
    ])].sort(compareText);
    if (confirmedPluginModuleIds.length === guard.pendingPluginModuleIds.length) {
      await this.write(guards.filter((entry) => entry !== guard));
      return { confirmed: true };
    }
    await this.write(guards.map((entry) => (
      entry === guard ? { ...entry, confirmedPluginModuleIds } : entry
    )));
    return { confirmed: false };
  }

  async clear(packageId: string): Promise<void> {
    const guards = await this.list();
    if (!guards.some((entry) => entry.packageId === packageId)) return;
    await this.write(guards.filter((entry) => entry.packageId !== packageId));
  }

  private async write(guards: PackageActivationGuardV1[]): Promise<void> {
    await mkdir(path.dirname(this.statePath), { recursive: true });
    const temporaryPath =
      `${this.statePath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({
          guards: guards.map(parseGuard).sort((left, right) => (
            compareText(left.packageId, right.packageId)
          )),
          schemaVersion: 1,
        }, null, 2)}\n`,
        { flag: 'wx', mode: 0o600 },
      );
      await rename(temporaryPath, this.statePath);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}

function parseGuard(value: unknown): PackageActivationGuardV1 {
  if (!isRecord(value)) throw new Error('Package activation guard is invalid.');
  const textKeys = [
    'candidateDigest',
    'candidateInstallationId',
    'createdAt',
    'packageId',
    'previousDigest',
    'previousInstallationId',
  ] as const;
  for (const key of textKeys) {
    if (typeof value[key] !== 'string' || value[key].length === 0) {
      throw new Error(`Package activation guard ${key} is invalid.`);
    }
  }
  if (
    !Array.isArray(value.pendingPluginModuleIds)
    || value.pendingPluginModuleIds.length === 0
    || value.pendingPluginModuleIds.some((entry) => typeof entry !== 'string')
    || !Array.isArray(value.confirmedPluginModuleIds)
    || value.confirmedPluginModuleIds.some((entry) => typeof entry !== 'string')
  ) {
    throw new Error('Package activation guard PluginModule IDs are invalid.');
  }
  const pendingPluginModuleIds = [...new Set(
    value.pendingPluginModuleIds as string[],
  )].sort(compareText);
  const confirmedPluginModuleIds = [...new Set(
    value.confirmedPluginModuleIds as string[],
  )].sort(compareText);
  if (confirmedPluginModuleIds.some(
    (entry) => !pendingPluginModuleIds.includes(entry),
  )) {
    throw new Error('Package activation guard confirmations are invalid.');
  }
  const previousPluginModules = Array.isArray(value.previousPluginModules)
    ? value.previousPluginModules.map((entry) => {
        if (
          !isRecord(entry)
          || typeof entry.pluginModuleId !== 'string'
          || !isRecord(entry.packageLock)
          || entry.packageLock.packageId !== value.packageId
          || entry.packageLock.digest !== value.previousDigest
          || entry.packageLock.installationId !== value.previousInstallationId
        ) {
          throw new Error(
            'Package activation guard previous Plugin Runtime is invalid.',
          );
        }
        return structuredClone(entry) as unknown as PluginModuleRuntimeRecordV1;
      })
    : [];
  return {
    candidateDigest: value.candidateDigest as string,
    candidateInstallationId: value.candidateInstallationId as string,
    confirmedPluginModuleIds,
    createdAt: value.createdAt as string,
    packageId: value.packageId as string,
    pendingPluginModuleIds,
    previousDigest: value.previousDigest as string,
    previousInstallationId: value.previousInstallationId as string,
    previousPluginModules,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
