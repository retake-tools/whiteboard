import { randomBytes } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import {
  parsePluginRuntimeSnapshot,
  type PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';

export const pluginRuntimeStateFile = 'retake.plugin-runtime.json';

const mutationQueues = new Map<string, Promise<void>>();

export class PluginRuntimeStateStore {
  readonly statePath: string;
  private readonly lockPath: string;

  constructor(packagesRoot: string) {
    const root = path.resolve(packagesRoot);
    this.statePath = path.join(root, pluginRuntimeStateFile);
    this.lockPath = path.join(root, 'plugin-runtime.lock');
  }

  async read(): Promise<PluginRuntimeSnapshotV1 | undefined> {
    try {
      return parsePluginRuntimeSnapshot(
        JSON.parse(await readFile(this.statePath, 'utf8')) as unknown,
      );
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return undefined;
      if (error instanceof SyntaxError) {
        throw new Error('Plugin Runtime state is invalid JSON.');
      }
      throw error;
    }
  }

  async readTolerant(): Promise<PluginRuntimeSnapshotV1 | undefined> {
    try {
      return await this.read();
    } catch (error) {
      if (
        error instanceof Error
        && (
          error.message.includes('Installed PluginModule manifest is invalid')
          || error.message.includes(
            'Plugin Runtime snapshot schemaVersion is unsupported',
          )
        )
      ) return undefined;
      throw error;
    }
  }

  async write(snapshot: PluginRuntimeSnapshotV1): Promise<void> {
    const parsed = parsePluginRuntimeSnapshot(snapshot);
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

  async withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    let releaseTurn = (): void => {};
    const turn = new Promise<void>((resolve) => {
      releaseTurn = resolve;
    });
    const previous = mutationQueues.get(this.lockPath) ?? Promise.resolve();
    const queued = previous.then(
      () => turn,
      () => turn,
    );
    mutationQueues.set(this.lockPath, queued);
    await previous.catch(() => undefined);
    try {
      return await this.withFileMutationLock(operation);
    } finally {
      releaseTurn();
      if (mutationQueues.get(this.lockPath) === queued) {
        mutationQueues.delete(this.lockPath);
      }
    }
  }

  private async withFileMutationLock<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    await mkdir(path.dirname(this.lockPath), { recursive: true });
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(this.lockPath, 'wx', 0o600);
      await handle.writeFile(
        `${JSON.stringify({
          createdAt: new Date().toISOString(),
          pid: process.pid,
        })}\n`,
      );
    } catch (error) {
      if (isNodeError(error, 'EEXIST')) {
        throw new Error('Another Plugin Runtime mutation is already active.');
      }
      throw error;
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(this.lockPath).catch(() => undefined);
    }
  }
}

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
