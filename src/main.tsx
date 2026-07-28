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
  type PluginRuntimeControllerV1,
} from './core/pluginRuntimeManagementClient';
import type {
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import {
  createPackageLifecycleController,
  type PackageLifecycleControllerV1,
} from './core/packageLifecycleClient';
import {
  listConnectedPluginExecutionConnections,
} from './app/runConnectedPluginExecution';
import {
  loadPluginExperience,
  loadPluginProfile,
} from './core/pluginFoundationConfigClient';

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
    onFatalFailure: reportPluginFatalFailure,
    snapshot: effectiveSnapshot,
  });
  if (pluginModules.failures.length > 0) {
    console.error('Retake Plugin activation failed.', pluginModules.failures);
  }
  const contributionFailures = pluginContributionRegistry.replace(
    pluginModules.sessions,
  );
  await Promise.all(contributionFailures.map(async (failure) => {
    pluginContributionRegistry.removeModule(failure.pluginModuleId);
    pluginHostReadStore.abortModuleExecutions(failure.pluginModuleId);
    await disposePluginWebModule(failure.pluginModuleId)
      .catch(() => undefined);
    await reportPluginFatalFailure(
      failure.pluginModuleId,
      failure.error,
    ).catch(() => undefined);
  }));
  await pluginHostReadStore.setSettingsDefinitions(
    pluginContributionRegistry.getSettingsSnapshot()
      .filter((entry) => entry.failure === null)
      .map((entry) => ({
        definition: entry.definition,
        pluginModuleId: entry.pluginModuleId,
      })),
  );
  return pluginModules.failures.length > 0 || contributionFailures.length > 0
    ? loadPluginRuntimeSnapshot()
    : baseSnapshot;
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
            onPluginHostScopeChange={(snapshot, assets, drafts) => {
              pluginHostReadStore.update(snapshot, assets, drafts);
              if (!snapshot.projectId || !snapshot.boardId) return;
              const scopeKey = `${snapshot.projectId}:${snapshot.boardId}`;
              if (scopeKey === pluginProfileScopeKey) return;
              pluginProfileScopeKey = scopeKey;
              pluginContributionRegistry.replace([]);
              void pluginRuntimeController?.setScope({
                boardId: snapshot.boardId,
                projectId: snapshot.projectId,
              }).catch((error: unknown) => {
                if (pluginProfileScopeKey === scopeKey) {
                  pluginProfileScopeKey = '';
                }
                console.error(
                  'Retake Plugin Profile scope update failed.',
                  error,
                );
              });
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
