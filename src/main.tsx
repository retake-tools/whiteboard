import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import './styles.css';
import './feedback.css';
import './components/board-history-panel.css';
import './components/blank-workspace-start.css';
import './components/agent-workspace.css';
import './components/execution-inspector.css';
import './components/execution-image-viewer.css';
import './components/execution-providers-settings.css';
import './components/group-toolbar.css';
import './components/group-inspector.css';
import './components/group-draw-overlay.css';
import './components/image-generation-panel.css';
import './components/image-context-command-menu.css';
import './components/image-inspector-panel.css';
import './components/image-focus-workspace.css';
import './components/generation-task-panel.css';
import './components/input-reference-picker.css';
import './components/project-board.css';
import './components/project-board-manager.css';
import './components/plugin-panel-host.css';
import './components/plugin-manager.css';
import './components/workflow-continuation.css';
import './components/top-bar.css';
import './components/workspace-sidebar-rail.css';
import './components/workspace-shell.css';
import './components/workspace-create-menu.css';
import './nodes/block-node.css';
import './nodes/operation-inline-controls.css';
import './host-kit/styles/canvas-host.css';
import { App } from './App';
import { I18nProvider } from './i18n';
import { installPluginHostExternals } from './core/pluginHostExternals';
import { installResizeObserverErrorGuard } from './core/resizeObserverErrorGuard';
import { createWhiteboardPluginHostRuntime } from './whiteboard/runtime/createWhiteboardPluginHostRuntime';
import { createWhiteboardCanvasHost } from './whiteboard/createWhiteboardCanvasHost';
import { CanvasHostProvider } from './host-kit/react';

installResizeObserverErrorGuard();
installPluginHostExternals();
const root = createRoot(document.getElementById('root')!);
void createWhiteboardPluginHostRuntime()
  .then(async (runtime) => {
    const canvasHost = await createWhiteboardCanvasHost(runtime);
    window.addEventListener('pagehide', () => {
      void canvasHost.dispose();
    }, { once: true });
    root.render(
      <StrictMode>
        <I18nProvider>
          <CanvasHostProvider host={canvasHost}>
            <App
              canvasHost={canvasHost}
              packageBootstrapFailures={runtime.packageBootstrapFailures}
              onPluginContributionFatalFailure={runtime.onPluginContributionFatalFailure}
              onPluginDraftRunnerChange={runtime.onPluginDraftRunnerChange}
              onPluginExecutionRunnerChange={runtime.onPluginExecutionRunnerChange}
              onPluginHostEnvironmentChange={runtime.onPluginHostEnvironmentChange}
              onPluginHostScopeChange={runtime.onPluginHostScopeChange}
              onPluginManagerOpenChange={runtime.onPluginManagerOpenChange}
              pluginContributionRegistry={runtime.pluginContributionRegistry}
              packageLifecycleController={runtime.packageLifecycleController}
              pluginRuntimeController={runtime.pluginRuntimeController}
            />
          </CanvasHostProvider>
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
