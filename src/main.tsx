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
import './components/workflow-continuation.css';
import './components/top-bar.css';
import './nodes/block-node.css';
import './nodes/operation-inline-controls.css';
import { App } from './App';
import { I18nProvider } from './i18n';
import { bootstrapInstalledRuntimeRegistry } from './core/installedRuntimeRegistryClient';
import {
  createPluginHostReadStore,
  reconcilePluginWebModules,
} from './core/pluginWebModuleLoader';

const root = createRoot(document.getElementById('root')!);
const pluginHostReadStore = createPluginHostReadStore({
  boardId: null,
  boundAssetIds: [],
  boundBlockIds: [],
  boundGroupIds: [],
  projectId: null,
  revision: 'unbound',
  selectedBlockIds: [],
});

void bootstrapInstalledRuntimeRegistry()
  .then(async ({ pluginRuntime }) => {
    const pluginModules = await reconcilePluginWebModules({
      createHost: (record) => pluginHostReadStore.host(
        record.negotiatedHostApiVersion!,
      ),
      snapshot: pluginRuntime,
    });
    if (pluginModules.failures.length > 0) {
      console.error('Retake Plugin activation failed.', pluginModules.failures);
    }
    root.render(
      <StrictMode>
        <I18nProvider>
          <App />
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
