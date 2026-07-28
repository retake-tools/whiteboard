import type {
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import type {
  PackageDevelopmentLinkV1,
} from './packageLifecycleContracts';
import type {
  PluginWebModuleReconcileResult,
} from './pluginWebModuleLoader';

export function resolveCandidateActivationDecision(input: {
  effectiveSnapshot: PluginRuntimeSnapshotV1;
  link: PackageDevelopmentLinkV1;
  result: PluginWebModuleReconcileResult;
}): { accept: boolean; error?: string } {
  const candidate = input.link.candidate;
  if (!candidate) return { accept: true };
  const moduleIds = new Set(candidate.identity.pluginModules.map(
    (identity) => identity.pluginModuleId,
  ));
  const fallback = input.result.fallbacks.find((entry) => (
    entry.rejectedDigest === candidate.lastGood.digest
    && moduleIds.has(entry.pluginModuleId)
  ));
  const failure = input.result.failures.find(
    (entry) => moduleIds.has(entry.pluginModuleId),
  );
  const candidateActivated = candidate.identity.pluginModules.every(
    (identity) => {
      const runtimeRecord = input.effectiveSnapshot.modules.find((record) => (
        record.pluginModuleId === identity.pluginModuleId
        && record.packageLock.digest === candidate.lastGood.digest
      ));
      if (!runtimeRecord) return false;
      return runtimeRecord.status !== 'enabled'
        || input.result.sessions.some((session) => (
          session.record.pluginModuleId === identity.pluginModuleId
          && session.record.packageLock.digest === candidate.lastGood.digest
        ));
    },
  );
  const accept = !fallback && !failure && candidateActivated;
  return {
    accept,
    ...(accept ? {} : {
      error: fallback?.error
        ?? failure?.error
        ?? 'Linked candidate did not activate every required PluginModule.',
    }),
  };
}
