import type {
  ActivatedPluginWebModuleV2,
  PluginHostApiV2,
  PluginModuleRuntimeRecordV1,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';

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

export interface PluginWebModuleReconcileInputV1 {
  activate?: (
    record: PluginModuleRuntimeRecordV1,
    host: PluginHostApiV2,
  ) => Promise<ActivatedPluginWebModuleV2>;
  createHost(record: PluginModuleRuntimeRecordV1): PluginHostApiV2;
  onFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  resolveModuleUrl?: (record: PluginModuleRuntimeRecordV1) => string;
  snapshot: PluginRuntimeSnapshotV1;
  validateSessions?: (
    sessions: ActivatedPluginWebModuleSession[],
  ) => Array<{ error: string; pluginModuleId: string }>;
}

export interface PluginWebModuleRuntimeV1 {
  dispose(pluginModuleId: string): Promise<void>;
  disposeAll(): Promise<void>;
  reconcile(
    input: PluginWebModuleReconcileInputV1,
  ): Promise<PluginWebModuleReconcileResult>;
}

export function createPluginWebModuleRuntime(): PluginWebModuleRuntimeV1 {
  const activatedModules = new Map<
    string,
    Promise<ActivatedPluginWebModuleSession>
  >();
  return Object.freeze({
    dispose: (pluginModuleId: string) => disposePluginWebModulesFromCache(
      activatedModules,
      pluginModuleId,
    ),
    disposeAll: () => disposePluginWebModulesFromCache(activatedModules),
    reconcile: (input: PluginWebModuleReconcileInputV1) => (
      reconcilePluginWebModulesWithCache(activatedModules, input)
    ),
  });
}

const defaultPluginWebModuleRuntime = createPluginWebModuleRuntime();

/** @deprecated Prefer a Host-owned runtime from createPluginWebModuleRuntime. */
export function reconcilePluginWebModules(
  input: PluginWebModuleReconcileInputV1,
): Promise<PluginWebModuleReconcileResult> {
  return defaultPluginWebModuleRuntime.reconcile(input);
}

/** @deprecated Prefer runtime.dispose() on a Host-owned runtime. */
export async function disposePluginWebModule(
  pluginModuleId: string,
): Promise<void> {
  return defaultPluginWebModuleRuntime.dispose(pluginModuleId);
}

async function reconcilePluginWebModulesWithCache(
  activatedModules: Map<string, Promise<ActivatedPluginWebModuleSession>>,
  input: PluginWebModuleReconcileInputV1,
): Promise<PluginWebModuleReconcileResult> {
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
      session = (
        input.activate
        ?? ((candidate, candidateHost) => activateRecord(
          candidate,
          candidateHost,
          input.resolveModuleUrl,
        ))
      )(record, host)
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

async function disposePluginWebModulesFromCache(
  activatedModules: Map<string, Promise<ActivatedPluginWebModuleSession>>,
  pluginModuleId?: string,
): Promise<void> {
  await Promise.all([...activatedModules.entries()].map(
    async ([key, session]) => {
      if (
        pluginModuleId
        && !await session.then(
          (value) => value.record.pluginModuleId === pluginModuleId,
          () => false,
        )
      ) return;
      activatedModules.delete(key);
      await (await session).activation.dispose();
    },
  ));
}

async function activateRecord(
  record: PluginModuleRuntimeRecordV1,
  host: PluginHostApiV2,
  resolveModuleUrl?: (record: PluginModuleRuntimeRecordV1) => string,
): Promise<ActivatedPluginWebModuleV2> {
  if (!resolveModuleUrl) {
    throw new Error(
      'Plugin Web Module activation requires an activate function or module URL resolver.',
    );
  }
  const [{ activatePluginWebModule }, namespace] = await Promise.all([
    import('@retake-tools/plugin-runtime'),
    import(/* @vite-ignore */ resolveModuleUrl(record)),
  ]);
  return activatePluginWebModule({
    host,
    manifest: record.manifest,
    module: namespace,
    packageDigest: record.packageLock.digest,
  });
}

function moduleCacheKey(record: PluginModuleRuntimeRecordV1): string {
  return `${record.pluginModuleId}@${record.packageLock.digest}`;
}
