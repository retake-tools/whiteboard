import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './feedback.css';
import './components/board-history-panel.css';
import './components/agent-workspace.css';
import './components/execution-inspector.css';
import './components/execution-providers-settings.css';
import './components/group-toolbar.css';
import './components/group-inspector.css';
import './components/group-draw-overlay.css';
import './components/image-generation-panel.css';
import './components/input-reference-picker.css';
import './components/project-board.css';
import './components/plugin-panel-host.css';
import './components/plugin-manager.css';
import './components/workflow-continuation.css';
import './components/top-bar.css';
import './nodes/block-node.css';
import './nodes/operation-inline-controls.css';
import { App } from './App';
import { I18nProvider } from './i18n';
import {
  bootstrapInstalledRuntimeRegistry,
  reportPluginFatalFailure,
} from './core/installedRuntimeRegistryClient';
import {
  createPluginHostReadStore,
  disposePluginWebModule,
  reconcilePluginWebModules,
} from './core/pluginWebModuleLoader';
import { installPluginHostExternals } from './core/pluginHostExternals';
import {
  createPluginContributionRegistry,
} from './core/pluginContributionRegistry';
import {
  createPluginRuntimeController,
  loadPluginRuntimeSnapshot,
  type PluginActivationDemandV1,
  type PluginRuntimeControllerV1,
} from './core/pluginRuntimeManagementClient';
import type {
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import {
  createPackageLifecycleController,
  type PackageLifecycleControllerV1,
} from './core/packageLifecycleClient';
import type {
  PackageDevelopmentSnapshotV1,
} from './core/packageLifecycleContracts';
import {
  listConnectedPluginExecutionConnections,
} from './app/runConnectedPluginExecution';
import {
  loadPluginExperience,
  loadPluginProfile,
} from './core/pluginFoundationConfigClient';
import {
  resolveCandidateActivationDecision,
} from './core/pluginDevelopmentActivation';

installPluginHostExternals();
const root = createRoot(document.getElementById('root')!);
const pluginContributionRegistry = createPluginContributionRegistry();
const pluginHostReadStore = createPluginHostReadStore({
  boardId: null,
  boundAssetIds: [],
  boundBlockIds: [],
  boundGroupIds: [],
  projectId: null,
  revision: 'unbound',
  selectedBlockIds: [],
}, {
  authorizeExecution: (pluginModuleId, capabilityId) => (
    pluginContributionRegistry.ownsCapability(
      pluginModuleId,
      capabilityId,
    )
  ),
});
pluginHostReadStore.setConnectionLister(
  listConnectedPluginExecutionConnections,
);
let pluginRuntimeController: PluginRuntimeControllerV1 | undefined;
let packageLifecycleController: PackageLifecycleControllerV1 | undefined;
let pluginProfileScopeKey = '';
let pluginActivationContextKey = '';
let pluginActivationProjectId = '';
let pluginActivationBoardId = '';
let pluginActivationDemand: PluginActivationDemandV1 = {
  boardBound: false,
  hasBlocks: false,
  hasOperationBlocks: false,
  managerOpen: false,
  selectedBlockCount: 0,
};

function reconcilePluginActivationContext(
  projectId: string,
  boardId: string,
  demand: PluginActivationDemandV1,
): void {
  const scopeKey = `${projectId}:${boardId}`;
  const contextKey = `${scopeKey}:${JSON.stringify(demand)}`;
  if (contextKey === pluginActivationContextKey) return;
  const scopeChanged = scopeKey !== pluginProfileScopeKey;
  pluginProfileScopeKey = scopeKey;
  pluginActivationContextKey = contextKey;
  pluginActivationProjectId = projectId;
  pluginActivationBoardId = boardId;
  pluginActivationDemand = structuredClone(demand);
  if (scopeChanged) pluginContributionRegistry.replace([]);
  void pluginRuntimeController?.setScope({
    boardId,
    demand,
    projectId,
  }).catch((error: unknown) => {
    if (pluginActivationContextKey === contextKey) {
      pluginActivationContextKey = '';
      if (scopeChanged) {
        pluginProfileScopeKey = '';
        pluginActivationProjectId = '';
        pluginActivationBoardId = '';
      }
    }
    console.error(
      'Retake Plugin activation context update failed.',
      error,
    );
  });
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

async function applyPluginRuntimeSnapshot(
  baseSnapshot: PluginRuntimeSnapshotV1,
  effectiveSnapshot: PluginRuntimeSnapshotV1,
): Promise<PluginRuntimeSnapshotV1> {
  const development = await loadPackageDevelopmentSnapshot();
  const candidateModuleIds = new Set(development.links.flatMap((link) => (
    link.candidate?.identity.pluginModules.map(
      (identity) => identity.pluginModuleId,
    ) ?? []
  )));
  pluginHostReadStore.retainModules(
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
    createHost: (record) => pluginHostReadStore.host(
      record.negotiatedHostApiVersion!,
      record.pluginModuleId,
      record.manifest.permissions,
    ),
    onFatalFailure: async (pluginModuleId, message) => {
      pluginContributionRegistry.removeModule(pluginModuleId);
      pluginHostReadStore.abortModuleExecutions(pluginModuleId);
      if (!candidateModuleIds.has(pluginModuleId)) {
        await reportPluginFatalFailure(pluginModuleId, message);
      }
    },
    snapshot: effectiveSnapshot,
    validateSessions: (sessions) => (
      pluginContributionRegistry.replace(sessions)
    ),
  });
  if (pluginModules.failures.length > 0) {
    console.error('Retake Plugin activation failed.', pluginModules.failures);
  }
  const rejectedCandidate = await resolveLinkedDevelopmentCandidates(
    development,
    effectiveSnapshot,
    pluginModules,
  );
  await pluginHostReadStore.setSettingsDefinitions(
    pluginContributionRegistry.getSettingsSnapshot()
      .filter((entry) => entry.failure === null)
      .map((entry) => ({
        definition: entry.definition,
        pluginModuleId: entry.pluginModuleId,
      })),
  );
  return pluginModules.failures.length > 0 || rejectedCandidate
    ? loadPluginRuntimeSnapshot()
    : baseSnapshot;
}

async function loadPackageDevelopmentSnapshot(): Promise<
  PackageDevelopmentSnapshotV1
> {
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
      const body = await response.json().catch(() => ({})) as {
        error?: unknown;
      };
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

void bootstrapInstalledRuntimeRegistry()
  .then(async ({ pluginRuntime }) => {
    const profile = await loadPluginProfile();
    pluginContributionRegistry.setCommandExperience(
      (await loadPluginExperience()).commandOverrides,
    );
    const initialRuntimeSnapshot = await applyPluginRuntimeSnapshot(
      pluginRuntime,
      unboundPluginRuntimeSnapshot(pluginRuntime),
    );
    pluginRuntimeController = createPluginRuntimeController({
      applySnapshot: applyPluginRuntimeSnapshot,
      initialProfileState: profile,
      initialSnapshot: initialRuntimeSnapshot,
    });
    packageLifecycleController = createPackageLifecycleController({
      pluginRuntimeController,
    });
    root.render(
      <StrictMode>
        <I18nProvider>
          <App
            onPluginContributionFatalFailure={(pluginModuleId, message) => {
              pluginContributionRegistry.failModule(pluginModuleId, message);
              pluginHostReadStore.abortModuleExecutions(pluginModuleId);
              void disposePluginWebModule(pluginModuleId)
                .catch(() => undefined);
              return reportPluginFatalFailure(pluginModuleId, message)
                .then(async () => {
                  await pluginRuntimeController?.refresh();
                })
                .catch((error: unknown) => {
                  console.error(
                    'Retake Plugin fatal failure report failed.',
                    { error, pluginModuleId },
                  );
                });
            }}
            onPluginDraftRunnerChange={pluginHostReadStore.setDraftRunner}
            onPluginExecutionRunnerChange={
              pluginHostReadStore.setExecutionRunner
            }
            onPluginHostEnvironmentChange={
              (environment) => {
                pluginHostReadStore.updateEnvironment(environment);
                pluginContributionRegistry.setLocale(environment.locale);
              }
            }
            onPluginHostScopeChange={(snapshot, assets, drafts, demand) => {
              pluginHostReadStore.update(snapshot, assets, drafts);
              if (!snapshot.projectId || !snapshot.boardId) return;
              reconcilePluginActivationContext(
                snapshot.projectId,
                snapshot.boardId,
                {
                  ...demand,
                  managerOpen: pluginActivationDemand.managerOpen,
                },
              );
            }}
            onPluginManagerOpenChange={(managerOpen) => {
              if (pluginActivationDemand.managerOpen === managerOpen) return;
              pluginActivationDemand = {
                ...pluginActivationDemand,
                managerOpen,
              };
              if (!pluginActivationProjectId || !pluginActivationBoardId) return;
              reconcilePluginActivationContext(
                pluginActivationProjectId,
                pluginActivationBoardId,
                pluginActivationDemand,
              );
            }}
            pluginContributionRegistry={pluginContributionRegistry}
            packageLifecycleController={packageLifecycleController}
            pluginRuntimeController={pluginRuntimeController}
          />
        </I18nProvider>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    root.render(
      <main className="workspace-load-shell" role="alert">
        <section className="workspace-load-card is-error">
          <h1>Retake Package bootstrap failed</h1>
          <code>{message}</code>
          <p>Check the Workspace Package lock and bundled Package files, then reload Retake.</p>
        </section>
      </main>,
    );
  });
