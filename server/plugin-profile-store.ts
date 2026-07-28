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
  emptyPluginProfileStateV1,
  parsePluginProfileStateV1,
  updatePluginProfileOverrideV1,
  type PluginProfileOverrideStateV1,
  type PluginProfileStateV1,
} from '@retake-tools/package-sdk';

export const pluginProfileStateFile = 'retake.plugin-profile.json';

export class PluginProfileStore {
  readonly profilePath: string;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(packagesRoot: string) {
    this.profilePath = path.join(
      path.resolve(packagesRoot),
      pluginProfileStateFile,
    );
  }

  async read(): Promise<PluginProfileStateV1> {
    try {
      return parsePluginProfileStateV1(
        JSON.parse(await readFile(this.profilePath, 'utf8')) as unknown,
      );
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return emptyPluginProfileStateV1();
      if (error instanceof SyntaxError) {
        throw new Error('Plugin Profile state is invalid JSON.');
      }
      throw error;
    }
  }

  async update(input: {
    boardId: string | null;
    pluginModuleId: string;
    projectId: string;
    scope: 'board' | 'project';
    state: PluginProfileOverrideStateV1;
  }): Promise<PluginProfileStateV1> {
    return this.enqueue(async () => {
      const next = updatePluginProfileOverrideV1(await this.read(), input);
      await writeJsonAtomic(this.profilePath, next);
      return next;
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
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

function isNodeError(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}
