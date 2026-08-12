import type {
  PluginAssetV2,
  PluginHostEnvironmentSnapshotV2,
  PluginHostExperienceProfileV1,
  PluginHostReadSnapshotV2,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import { listConnectedPluginExecutionConnections } from '../../app/runConnectedPluginExecution';
import {
  bootstrapInstalledRuntimeRegistry,
  confirmPluginActivation,
  reportPluginFatalFailure,
  type PackageBootstrapNoticeV1,
} from '../../core/installedRuntimeRegistryClient';
import {
  createPackageLifecycleController,
  type PackageLifecycleControllerV1,
} from '../../core/packageLifecycleClient';
import type { PackageDevelopmentSnapshotV1 } from '../../core/packageLifecycleContracts';
import {
  createPluginContributionRegistry,
  type PluginContributionRegistryV1,
} from '../../core/pluginContributionRegistry';
import { resolveCandidateActivationDecision } from '../../core/pluginDevelopmentActivation';
import {
  loadPluginExperience,
  loadPluginProfile,
} from '../../core/pluginFoundationConfigClient';
import type { PluginHostDraftRecordV2 } from '../../core/pluginDrafts';
import {
  createPluginHostReadStore,
  disposePluginWebModule,
  reconcilePluginWebModules,
  type PluginDraftRunnerV2,
  type PluginExecutionRunnerV2,
  type PluginHostReadStore,
} from '../../core/pluginWebModuleLoader';
import {
  createPluginRuntimeController,
  loadPluginRuntimeSnapshot,
  type PluginActivationDemandV1,
  type PluginRuntimeControllerV1,
} from '../../core/pluginRuntimeManagementClient';
import type {
  HostPackageRuntimeAdapterV1,
  HostPackageRuntimeSnapshotV1,
  HostRuntimeDemandV1,
} from '../../host-kit';

export interface WhiteboardPluginHostRuntime {
  readonly experience: PluginHostExperienceProfileV1;
  readonly packageBootstrapFailures: PackageBootstrapNoticeV1[];
  readonly packageLifecycleController: PackageLifecycleControllerV1;
  readonly packageRuntimeAdapter: HostPackageRuntimeAdapterV1;
  readonly pluginContributionRegistry: PluginContributionRegistryV1;
  readonly pluginRuntimeController: PluginRuntimeControllerV1;
  onPluginContributionFatalFailure(
    pluginModuleId: string,
    message: string,
  ): Promise<void>;
  onPluginDraftRunnerChange(runner: PluginDraftRunnerV2 | undefined): void;
  onPluginExecutionRunnerChange(runner: PluginExecutionRunnerV2 | undefined): void;
  onPluginHostEnvironmentChange(snapshot: PluginHostEnvironmentSnapshotV2): void;
  onPluginHostScopeChange(
    snapshot: PluginHostReadSnapshotV2,
    assets: readonly PluginAssetV2[],
    drafts: readonly PluginHostDraftRecordV2[],
    demand: PluginActivationDemandV1,
  ): void;
  onPluginManagerOpenChange(open: boolean): void;
}

export async function createWhiteboardPluginHostRuntime(): Promise<WhiteboardPluginHostRuntime> {
  const pluginContributionRegistry = createPluginContributionRegistry();
  const pluginHostReadStore = createReadStore(pluginContributionRegistry);
  const { packageFailures, pluginRuntime } = await bootstrapInstalledRuntimeRegistry();
  const [profile, experience] = await Promise.all([
    loadPluginProfile(),
    loadPluginExperience(),
  ]);
  pluginContributionRegistry.setCommandExperience(experience.commandOverrides);

  let pluginRuntimeController: PluginRuntimeControllerV1;
  const applySnapshot = createSnapshotApplicator(
    pluginContributionRegistry,
    pluginHostReadStore,
  );
  const initialRuntimeSnapshot = await applySnapshot(
    pluginRuntime,
    unboundPluginRuntimeSnapshot(pluginRuntime),
  );
  pluginRuntimeController = createPluginRuntimeController({
    applySnapshot,
    initialProfileState: profile,
    initialSnapshot: initialRuntimeSnapshot,
  });
  const packageLifecycleController = createPackageLifecycleController({
    pluginRuntimeController,
  });
  const state = createActivationState(
    pluginContributionRegistry,
    pluginRuntimeController,
  );
  const packageRuntimeAdapter = createPackageRuntimeAdapter({
    failures: packageFailures.map((failure) => ({
      message: failure.error,
      ...(failure.packageId ? { packageId: failure.packageId } : {}),
    })),
    pluginRuntimeController,
  });

  const runtime: WhiteboardPluginHostRuntime = {
    experience,
    packageBootstrapFailures: packageFailures,
    packageLifecycleController,
    packageRuntimeAdapter,
    pluginContributionRegistry,
    pluginRuntimeController,
    async onPluginContributionFatalFailure(pluginModuleId, message) {
      pluginContributionRegistry.failModule(pluginModuleId, message);
      pluginHostReadStore.abortModuleExecutions(pluginModuleId);
      void disposePluginWebModule(pluginModuleId).catch(() => undefined);
      await reportPluginFatalFailure(pluginModuleId, message)
        .then(() => pluginRuntimeController.refresh())
        .then(() => undefined)
        .catch((error: unknown) => {
          console.error(
            'Retake Plugin fatal failure report failed.',
            { error, pluginModuleId },
          );
        });
    },
    onPluginDraftRunnerChange: pluginHostReadStore.setDraftRunner,
    onPluginExecutionRunnerChange: pluginHostReadStore.setExecutionRunner,
    onPluginHostEnvironmentChange(environment) {
      pluginHostReadStore.updateEnvironment(environment);
      pluginContributionRegistry.setLocale(environment.locale);
    },
    onPluginHostScopeChange(snapshot, assets, drafts, demand) {
      pluginHostReadStore.update(snapshot, assets, drafts);
      if (!snapshot.projectId || !snapshot.boardId) return;
      state.reconcile(snapshot.projectId, snapshot.boardId, {
        ...demand,
        managerOpen: state.demand().managerOpen,
      });
    },
    onPluginManagerOpenChange: state.setManagerOpen,
  };
  return Object.freeze(runtime);
}

function createReadStore(
  registry: PluginContributionRegistryV1,
): PluginHostReadStore {
  const store = createPluginHostReadStore({
    boardId: null,
    boundAssetIds: [],
    boundBlockIds: [],
    boundGroupIds: [],
    projectId: null,
    revision: 'unbound',
    selectedBlockIds: [],
  }, {
    authorizeExecution: (pluginModuleId, capabilityId) => (
      registry.ownsCapability(pluginModuleId, capabilityId)
    ),
  });
  store.setConnectionLister(listConnectedPluginExecutionConnections);
  return store;
}

function createActivationState(
  registry: PluginContributionRegistryV1,
  controller: PluginRuntimeControllerV1,
): {
  demand(): PluginActivationDemandV1;
  reconcile(projectId: string, boardId: string, demand: PluginActivationDemandV1): void;
  setManagerOpen(open: boolean): void;
} {
  let profileScopeKey = '';
  let activationContextKey = '';
  let projectId = '';
  let boardId = '';
  let demand: PluginActivationDemandV1 = {
    boardBound: false,
    hasBlocks: false,
    hasOperationBlocks: false,
    managerOpen: false,
    selectedBlockCount: 0,
  };

  function reconcile(
    nextProjectId: string,
    nextBoardId: string,
    nextDemand: PluginActivationDemandV1,
  ): void {
    const scopeKey = `${nextProjectId}:${nextBoardId}`;
    const contextKey = `${scopeKey}:${JSON.stringify(nextDemand)}`;
    if (contextKey === activationContextKey) return;
    const scopeChanged = scopeKey !== profileScopeKey;
    profileScopeKey = scopeKey;
    activationContextKey = contextKey;
    projectId = nextProjectId;
    boardId = nextBoardId;
    demand = structuredClone(nextDemand);
    if (scopeChanged) registry.replace([]);
    void controller.setScope({
      boardId: nextBoardId,
      demand: nextDemand,
      projectId: nextProjectId,
    }).catch((error: unknown) => {
      if (activationContextKey === contextKey) {
        activationContextKey = '';
        if (scopeChanged) {
          profileScopeKey = '';
          projectId = '';
          boardId = '';
        }
      }
      console.error('Retake Plugin activation context update failed.', error);
    });
  }

  return {
    demand: () => demand,
    reconcile,
    setManagerOpen(open) {
      if (demand.managerOpen === open) return;
      demand = { ...demand, managerOpen: open };
      if (!projectId || !boardId) return;
      reconcile(projectId, boardId, demand);
    },
  };
}

function createSnapshotApplicator(
  registry: PluginContributionRegistryV1,
  readStore: PluginHostReadStore,
): (
  baseSnapshot: PluginRuntimeSnapshotV1,
  effectiveSnapshot: PluginRuntimeSnapshotV1,
) => Promise<PluginRuntimeSnapshotV1> {
  return async (baseSnapshot, effectiveSnapshot) => {
    const development = await loadPackageDevelopmentSnapshot();
    const candidateModuleIds = new Set(development.links.flatMap((link) => (
      link.candidate?.identity.pluginModules.map(
        (identity) => identity.pluginModuleId,
      ) ?? []
    )));
    readStore.retainModules(
      effectiveSnapshot.safeMode
        ? []
        : effectiveSnapshot.modules
          .filter((record) => record.status === 'enabled')
          .map((record) => ({
            packageDigest: record.packageLock.digest,
            pluginModuleId: record.pluginModuleId,
          })),
    );
    const pluginModules = await reconcilePluginWebModules({
      createHost: (record) => readStore.host(
        record.negotiatedHostApiVersion!,
        record.pluginModuleId,
        record.manifest.permissions,
      ),
      onFatalFailure: async (pluginModuleId) => {
        registry.removeModule(pluginModuleId);
        readStore.abortModuleExecutions(pluginModuleId);
      },
      snapshot: effectiveSnapshot,
      validateSessions: (sessions) => registry.replace(sessions),
    });
    if (pluginModules.failures.length > 0) {
      console.error('Retake Plugin activation failed.', pluginModules.failures);
    }
    await Promise.all([
      ...pluginModules.fallbacks
        .filter((fallback) => !candidateModuleIds.has(fallback.pluginModuleId))
        .map((fallback) => reportPluginFatalFailure(
          fallback.pluginModuleId,
          fallback.error,
          {
            rejectedDigest: fallback.rejectedDigest,
            retainedDigest: fallback.retainedDigest,
          },
        )),
      ...pluginModules.failures
        .filter((failure) => !candidateModuleIds.has(failure.pluginModuleId))
        .map((failure) => reportPluginFatalFailure(
          failure.pluginModuleId,
          failure.error,
        )),
    ]);
    const fallbackModuleIds = new Set(
      pluginModules.fallbacks.map((fallback) => fallback.pluginModuleId),
    );
    await Promise.all(pluginModules.sessions
      .filter((session) => (
        !candidateModuleIds.has(session.record.pluginModuleId)
        && !fallbackModuleIds.has(session.record.pluginModuleId)
      ))
      .map((session) => confirmPluginActivation({
        packageDigest: session.record.packageLock.digest,
        packageId: session.record.packageLock.packageId,
        pluginModuleId: session.record.pluginModuleId,
      })));
    const rejectedCandidate = await resolveLinkedDevelopmentCandidates(
      development,
      effectiveSnapshot,
      pluginModules,
    );
    await readStore.setSettingsDefinitions(
      registry.getSettingsSnapshot()
        .filter((entry) => entry.failure === null)
        .map((entry) => ({
          definition: entry.definition,
          pluginModuleId: entry.pluginModuleId,
        })),
    );
    return pluginModules.failures.length > 0
      || pluginModules.fallbacks.length > 0
      || rejectedCandidate
      ? loadPluginRuntimeSnapshot()
      : baseSnapshot;
  };
}

function unboundPluginRuntimeSnapshot(
  snapshot: PluginRuntimeSnapshotV1,
): PluginRuntimeSnapshotV1 {
  return {
    ...structuredClone(snapshot),
    modules: snapshot.modules.map((record) => ({
      ...structuredClone(record),
      status: record.status === 'enabled' ? 'disabled' : record.status,
    })),
  };
}

async function loadPackageDevelopmentSnapshot(): Promise<PackageDevelopmentSnapshotV1> {
  const response = await fetch('/api/local/package-development');
  if (!response.ok) {
    throw new Error(
      `Package development request failed with HTTP ${response.status}.`,
    );
  }
  return response.json() as Promise<PackageDevelopmentSnapshotV1>;
}

async function resolveLinkedDevelopmentCandidates(
  development: PackageDevelopmentSnapshotV1,
  effectiveSnapshot: PluginRuntimeSnapshotV1,
  result: Awaited<ReturnType<typeof reconcilePluginWebModules>>,
): Promise<boolean> {
  let rejected = false;
  for (const link of development.links) {
    const candidate = link.candidate;
    if (!candidate) continue;
    const decision = resolveCandidateActivationDecision({
      effectiveSnapshot,
      link,
      result,
    });
    const response = await fetch('/api/local/package-development', {
      body: JSON.stringify({
        action: decision.accept ? 'accept_candidate' : 'reject_candidate',
        digest: candidate.lastGood.digest,
        ...(decision.accept ? {} : { error: decision.error }),
        linkId: link.linkId,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: unknown };
      throw new Error(
        typeof body.error === 'string'
          ? body.error
          : `Candidate resolution failed with HTTP ${response.status}.`,
      );
    }
    rejected ||= !decision.accept;
  }
  return rejected;
}

function createPackageRuntimeAdapter(input: {
  failures: HostPackageRuntimeSnapshotV1['failures'];
  pluginRuntimeController: PluginRuntimeControllerV1;
}): HostPackageRuntimeAdapterV1 {
  const snapshot = (): HostPackageRuntimeSnapshotV1 => ({
    failures: input.failures,
    pluginRuntime: input.pluginRuntimeController.getSnapshot(),
    revision: input.pluginRuntimeController.getSnapshot().updatedAt,
    schemaVersion: 1,
  });
  const adapter: HostPackageRuntimeAdapterV1 = {
    adapterVersion: 1,
    async bootstrap() {
      return snapshot();
    },
    async dispose() {
      await Promise.all(input.pluginRuntimeController.getSnapshot().modules.map(
        (module) => disposePluginWebModule(module.pluginModuleId),
      ));
    },
    async setScope({ demand, scope }) {
      await input.pluginRuntimeController.setScope({
        boardId: scope.boardId,
        demand: pluginDemand(demand),
        projectId: scope.projectId,
      });
      return snapshot();
    },
    subscribe(listener: (snapshot: HostPackageRuntimeSnapshotV1) => void) {
      return input.pluginRuntimeController.subscribe(() => listener(snapshot()));
    },
  };
  return Object.freeze(adapter);
}

function pluginDemand(demand: HostRuntimeDemandV1): PluginActivationDemandV1 {
  return { ...demand };
}
