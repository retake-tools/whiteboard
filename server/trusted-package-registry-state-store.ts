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
  fetchTrustedRegistryCatalog,
  type VerifiedTrustedRegistryCatalog,
} from './trusted-package-registry-client';
import {
  parseTrustedRegistryRoot,
  parseTrustedRegistryState,
  type TrustedRegistryStateV1,
} from './trusted-package-registry-contracts';

export class TrustedPackageRegistryStateStore {
  readonly stateRoot: string;

  constructor(input: { workspaceRoot: string }) {
    this.stateRoot = path.join(
      path.resolve(input.workspaceRoot),
      'packages',
      'trusted-registries',
    );
  }

  async read(registryId: string): Promise<TrustedRegistryStateV1 | undefined> {
    assertRegistryId(registryId);
    try {
      const value = JSON.parse(
        await readFile(this.statePath(registryId), 'utf8'),
      ) as unknown;
      const state = parseTrustedRegistryState(value);
      if (state.registryId !== registryId) {
        throw new Error('Trusted Registry state file registryId does not match its path.');
      }
      return structuredClone(state);
    } catch (error) {
      if (isNotFoundError(error)) return undefined;
      if (error instanceof SyntaxError) {
        throw new Error('Trusted Registry state file is invalid JSON.');
      }
      throw error;
    }
  }

  async write(stateInput: unknown): Promise<TrustedRegistryStateV1> {
    const state = parseTrustedRegistryState(stateInput);
    await mkdir(this.stateRoot, { recursive: true });
    return this.withRegistryLock(state.registryId, async () => {
      const previous = await this.read(state.registryId);
      assertStateTransition(previous, state);
      const outputPath = this.statePath(state.registryId);
      const temporaryPath = `${outputPath}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`;
      try {
        await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
          flag: 'wx',
          mode: 0o600,
        });
        await rename(temporaryPath, outputPath);
      } finally {
        await rm(temporaryPath, { force: true });
      }
      return structuredClone(state);
    });
  }

  private statePath(registryId: string): string {
    assertRegistryId(registryId);
    return path.join(this.stateRoot, `${registryId}.state.json`);
  }

  private async withRegistryLock<T>(
    registryId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lockPath = path.join(this.stateRoot, `${registryId}.state.lock`);
    let handle: Awaited<ReturnType<typeof open>>;
    try {
      handle = await open(lockPath, 'wx', 0o600);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        throw new Error(`Another Trusted Registry state update is active: ${registryId}`);
      }
      throw error;
    }
    try {
      return await operation();
    } finally {
      await handle.close();
      await unlink(lockPath).catch(() => undefined);
    }
  }
}

export async function fetchTrustedRegistryCatalogWithState(input: {
  fetchImpl?: typeof fetch;
  now?: Date;
  root: unknown;
  signal?: AbortSignal;
  stateStore: TrustedPackageRegistryStateStore;
  timeoutMs?: number;
}): Promise<VerifiedTrustedRegistryCatalog> {
  const root = parseTrustedRegistryRoot(input.root);
  const previousState = await input.stateStore.read(root.registryId);
  if (input.signal?.aborted) {
    throw new Error('Trusted Registry catalog request was cancelled.');
  }
  const verified = await fetchTrustedRegistryCatalog({
    fetchImpl: input.fetchImpl,
    now: input.now,
    previousState,
    root,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
  });
  if (input.signal?.aborted) {
    throw new Error('Trusted Registry catalog request was cancelled.');
  }
  await input.stateStore.write(verified.state);
  return verified;
}

function assertStateTransition(
  previous: TrustedRegistryStateV1 | undefined,
  next: TrustedRegistryStateV1,
): void {
  if (!previous) return;
  if (previous.registryId !== next.registryId) {
    throw new Error('Trusted Registry state belongs to a different Registry.');
  }
  if (next.rootVersion < previous.rootVersion) {
    throw new Error('Trusted Registry Root state rollback detected.');
  }
  if (next.catalogVersion < previous.catalogVersion) {
    throw new Error('Trusted Registry catalog state rollback detected.');
  }
  if (
    next.catalogVersion === previous.catalogVersion
    && next.catalogDigest !== previous.catalogDigest
  ) throw new Error('Trusted Registry catalog state equivocation detected.');
  const nextReleases = new Map(
    next.releases.map((release) => [`${release.packageId}@${release.version}`, release]),
  );
  for (const release of previous.releases) {
    const current = nextReleases.get(`${release.packageId}@${release.version}`);
    if (
      !current
      || current.digest !== release.digest
      || current.archiveDigest !== release.archiveDigest
    ) throw new Error(`Trusted Registry release history conflict: ${release.packageId}@${release.version}`);
  }
}

function assertRegistryId(registryId: string): void {
  if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)+$/.test(registryId)) {
    throw new Error('Trusted Registry state registryId is invalid.');
  }
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isAlreadyExistsError(error: unknown): boolean {
  return error instanceof Error
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'EEXIST';
}
