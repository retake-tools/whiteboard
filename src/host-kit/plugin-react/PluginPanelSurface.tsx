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
} from '../plugin';

export interface PluginPanelSurfacePropsV1 {
  readonly className?: string;
  readonly onFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  readonly registry: PluginContributionRegistryV1;
}

export function PluginPanelSurface(
  props: PluginPanelSurfacePropsV1,
): ReactElement | null {
  const panels = useSyncExternalStore(
    props.registry.subscribe,
    props.registry.getSnapshot,
    props.registry.getSnapshot,
  );
  if (panels.length === 0) return null;
  return (
    <section
      className={props.className}
      data-retake-plugin-slot="workspace.overlay"
    >
      {panels.map((panel) => (
        <PluginPanelBoundary
          key={panel.contributionId}
          onFatalFailure={props.onFatalFailure}
          panel={panel}
        >
          {createElement(panel.component, { host: panel.host })}
        </PluginPanelBoundary>
      ))}
    </section>
  );
}

class PluginPanelBoundary extends Component<{
  readonly children: ReactNode;
  readonly onFatalFailure?: PluginPanelSurfacePropsV1['onFatalFailure'];
  readonly panel: RegisteredPluginPanelV1;
}, { readonly failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    const message = error instanceof Error ? error.message : String(error);
    void this.props.onFatalFailure?.(
      this.props.panel.pluginModuleId,
      message,
    );
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
