import {
  Component,
  createElement,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  PluginContributionRegistryV1,
  RegisteredPluginPanelV1,
} from '../core/pluginContributionRegistry';

export function PluginPanelHost({
  onFatalFailure,
  registry,
}: {
  onFatalFailure(
    pluginModuleId: string,
    message: string,
  ): Promise<void> | void;
  registry: PluginContributionRegistryV1;
}): ReactElement | null {
  const panels = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
  if (panels.length === 0) return null;
  return (
    <section
      aria-label="Plugin panels"
      className="plugin-panel-host"
      data-retake-plugin-slot="workspace.overlay"
    >
      {panels.map((panel) => (
        panel.failure ? (
          <PluginContributionFallback
            contributionId={panel.contributionId}
            key={panel.contributionId}
          />
        ) : (
          <PluginContributionErrorBoundary
            contributionId={panel.contributionId}
            key={panel.contributionId}
            onFatalFailure={onFatalFailure}
            pluginModuleId={panel.pluginModuleId}
          >
            <PluginPanel panel={panel} />
          </PluginContributionErrorBoundary>
        )
      ))}
    </section>
  );
}

function PluginPanel({
  panel,
}: {
  panel: RegisteredPluginPanelV1;
}): ReactElement {
  return (
    <div
      className="plugin-panel-host__panel"
      data-retake-plugin-contribution={panel.contributionId}
      data-retake-plugin-module={panel.pluginModuleId}
    >
      {createElement(panel.component, { host: panel.host })}
    </div>
  );
}

class PluginContributionErrorBoundary extends Component<{
  children: ReactNode;
  contributionId: string;
  onFatalFailure(
    pluginModuleId: string,
    message: string,
  ): Promise<void> | void;
  pluginModuleId: string;
}, {
  error: string | null;
}> {
  state = { error: null as string | null };

  static getDerivedStateFromError(error: unknown): { error: string } {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    void this.props.onFatalFailure(
      this.props.pluginModuleId,
      `Plugin contribution ${
        this.props.contributionId
      } failed: ${error.message}`,
    );
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <PluginContributionFallback
        contributionId={this.props.contributionId}
      />
    );
  }
}

function PluginContributionFallback({
  contributionId,
}: {
  contributionId: string;
}): ReactElement {
  return (
    <section
      className="plugin-panel-host__fallback"
      data-retake-plugin-fallback={contributionId}
      role="alert"
    >
      <strong>Plugin panel unavailable</strong>
      <code>{contributionId}</code>
    </section>
  );
}
