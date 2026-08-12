import {
  Component,
  createElement,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  PluginContributionRegistryV1,
  RegisteredPluginPanelV1,
} from '../host-kit/plugin';

export function PluginPanelHost({
  anchorBlockId,
  onFatalFailure,
  registry,
}: {
  anchorBlockId?: string;
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
  const hostRef = useRef<HTMLElement | null>(null);
  const [anchorPosition, setAnchorPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const [hasVisibleAnchoredPanel, setHasVisibleAnchoredPanel] = useState(false);

  useLayoutEffect(() => {
    if (!anchorBlockId) {
      setHasVisibleAnchoredPanel(false);
      return;
    }
    const panelHost = hostRef.current;
    if (!panelHost) return;
    let frame = 0;
    const observedPanels = new Set<Element>();
    const resizeObserver = new ResizeObserver(() => scheduleMeasurement());

    function observePanels(): void {
      const currentPanels = new Set(
        panelHost!.querySelectorAll('.plugin-panel-host__panel'),
      );
      for (const panel of observedPanels) {
        if (currentPanels.has(panel)) continue;
        resizeObserver.unobserve(panel);
        observedPanels.delete(panel);
      }
      for (const panel of currentPanels) {
        if (observedPanels.has(panel)) continue;
        observedPanels.add(panel);
        resizeObserver.observe(panel);
      }
    }

    function scheduleMeasurement(): void {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        observePanels();
        const next = [...observedPanels].some((panel) => {
          const bounds = panel.getBoundingClientRect();
          return bounds.width > 0.5 && bounds.height > 0.5;
        });
        setHasVisibleAnchoredPanel((current) => (
          current === next ? current : next
        ));
      });
    }

    observePanels();
    resizeObserver.observe(panelHost);
    const mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => (
        record.target instanceof HTMLElement
        && record.target.classList.contains('plugin-panel-host__panel')
      ))) scheduleMeasurement();
    });
    mutationObserver.observe(panelHost, { childList: true, subtree: true });
    scheduleMeasurement();
    return () => {
      window.cancelAnimationFrame(frame);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [anchorBlockId]);

  useLayoutEffect(() => {
    if (!anchorBlockId || !hasVisibleAnchoredPanel) {
      setAnchorPosition(null);
      return;
    }
    const escapedBlockId = CSS.escape(anchorBlockId);
    const node = document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${escapedBlockId}"]`,
    );
    const host = hostRef.current;
    if (!node || !host) return;
    const anchorNode = node;
    const hostElement = host;

    let frame = 0;
    function update(): void {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const nodeBounds = anchorNode.getBoundingClientRect();
        const hostBounds = hostElement.getBoundingClientRect();
        if (hostBounds.width <= 0 || hostBounds.height <= 0) return;
        const margin = 16;
        const minimumTop = 72;
        const left = clamp(
          nodeBounds.left + nodeBounds.width / 2 - hostBounds.width / 2,
          margin,
          window.innerWidth - margin - hostBounds.width,
        );
        const top = clamp(
          nodeBounds.top - hostBounds.height - 12,
          minimumTop,
          window.innerHeight - margin - hostBounds.height,
        );
        setAnchorPosition((current) => (
          current
          && Math.abs(current.left - left) < 0.5
          && Math.abs(current.top - top) < 0.5
            ? current
            : { left, top }
        ));
      });
    }

    const observer = new ResizeObserver(update);
    observer.observe(anchorNode);
    observer.observe(hostElement);
    document.addEventListener('pointermove', update, true);
    document.addEventListener('wheel', update, true);
    window.addEventListener('resize', update);
    update();
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('pointermove', update, true);
      document.removeEventListener('wheel', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorBlockId, hasVisibleAnchoredPanel]);

  if (panels.length === 0) return null;
  const anchorStyle = anchorPosition
    ? {
        left: anchorPosition.left,
        right: 'auto',
        top: anchorPosition.top,
      } satisfies CSSProperties
    : undefined;
  return (
    <section
      aria-label="Plugin panels"
      className={`plugin-panel-host nodrag nopan nowheel${anchorBlockId ? ' is-block-anchored' : ''}`}
      data-retake-plugin-slot="workspace.overlay"
      onPointerDown={(event) => event.stopPropagation()}
      onWheel={(event) => event.stopPropagation()}
      ref={hostRef}
      style={anchorStyle}
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
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
      data-retake-plugin-ui="panel"
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
