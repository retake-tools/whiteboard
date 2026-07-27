import {
  Component,
  createContext,
  createElement,
  memo,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react';
import type {
  BlockData,
} from '../core/types';
import type {
  PluginContributionRegistryV1,
  PluginRendererBlockTypeV1,
  PluginRendererBlockViewV1,
  RegisteredPluginBlockRendererV1,
} from '../core/pluginContributionRegistry';

interface PluginBlockRendererContextV1 {
  onFatalFailure(
    pluginModuleId: string,
    message: string,
  ): Promise<void> | void;
  renderers: ReadonlyMap<string, RegisteredPluginBlockRendererV1>;
}

const emptyRenderers = new Map<
  string,
  RegisteredPluginBlockRendererV1
>();
const emptyRendererList: readonly RegisteredPluginBlockRendererV1[] =
  Object.freeze([]);
const PluginBlockRendererContext = createContext<
  PluginBlockRendererContextV1
>({
  onFatalFailure: () => undefined,
  renderers: emptyRenderers,
});

export function PluginBlockRendererProvider({
  children,
  onFatalFailure,
  registry,
}: {
  children: ReactNode;
  onFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  registry?: PluginContributionRegistryV1;
}): ReactElement {
  const renderers = useSyncExternalStore(
    registry?.subscribe ?? emptySubscribe,
    registry?.getRendererSnapshot ?? emptyRendererSnapshot,
    registry?.getRendererSnapshot ?? emptyRendererSnapshot,
  );
  const rendererMap = useMemo(
    () => new Map(
      renderers.map((renderer) => [
        renderer.contributionId,
        renderer,
      ]),
    ),
    [renderers],
  );
  const value = useMemo<PluginBlockRendererContextV1>(() => ({
    onFatalFailure: onFatalFailure ?? (() => undefined),
    renderers: rendererMap,
  }), [onFatalFailure, rendererMap]);
  return (
    <PluginBlockRendererContext.Provider value={value}>
      {children}
    </PluginBlockRendererContext.Provider>
  );
}

export function PluginBlockRendererSlot({
  blockId,
  coreFallback,
  data,
  selected,
  type,
}: {
  blockId: string;
  coreFallback: ReactElement;
  data: BlockData;
  selected: boolean;
  type: PluginRendererBlockTypeV1;
}): ReactElement {
  const context = useContext(PluginBlockRendererContext);
  const contributionId = typeof data.rendererContributionId === 'string'
    ? data.rendererContributionId
    : undefined;
  const renderer = contributionId
    ? context.renderers.get(contributionId)
    : undefined;
  if (
    !renderer
    || renderer.failure
    || !renderer.supportedBlockTypes.includes(type)
  ) return coreFallback;

  return (
    <PluginBlockRendererErrorBoundary
      contributionId={renderer.contributionId}
      fallback={coreFallback}
      key={renderer.contributionId}
      onFatalFailure={context.onFatalFailure}
      pluginModuleId={renderer.pluginModuleId}
    >
      <div
        className="plugin-block-renderer"
        data-retake-plugin-renderer={renderer.contributionId}
        data-retake-plugin-ui="renderer"
      >
        <MemoizedPluginBlockRenderer
          assetId={
            typeof data.assetId === 'string' ? data.assetId : undefined
          }
          blockId={blockId}
          body={typeof data.body === 'string' ? data.body : undefined}
          previewUrl={
            typeof data.previewUrl === 'string'
              ? data.previewUrl
              : undefined
          }
          renderer={renderer}
          selected={selected}
          title={data.title}
          type={type}
        />
      </div>
    </PluginBlockRendererErrorBoundary>
  );
}

const MemoizedPluginBlockRenderer = memo(
  function MemoizedPluginBlockRenderer({
    assetId,
    blockId,
    body,
    previewUrl,
    renderer,
    selected,
    title,
    type,
  }: {
    assetId?: string;
    blockId: string;
    body?: string;
    previewUrl?: string;
    renderer: RegisteredPluginBlockRendererV1;
    selected: boolean;
    title: string;
    type: PluginRendererBlockTypeV1;
  }): ReactElement {
    const block = freezeBlockView({
      ...(assetId === undefined ? {} : { assetId }),
      blockId,
      ...(body === undefined ? {} : { body }),
      ...(previewUrl === undefined ? {} : { previewUrl }),
      title,
      type,
    });
    return createElement(renderer.component, {
      block,
      host: renderer.host,
      selected,
    });
  },
);

class PluginBlockRendererErrorBoundary extends Component<{
  children: ReactNode;
  contributionId: string;
  fallback: ReactElement;
  onFatalFailure(
    pluginModuleId: string,
    message: string,
  ): Promise<void> | void;
  pluginModuleId: string;
}, {
  failed: boolean;
}> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: true } {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo): void {
    void this.props.onFatalFailure(
      this.props.pluginModuleId,
      `Plugin renderer ${
        this.props.contributionId
      } failed: ${error.message}`,
    );
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function freezeBlockView(
  block: PluginRendererBlockViewV1,
): PluginRendererBlockViewV1 {
  return Object.freeze({
    ...(block.assetId === undefined ? {} : { assetId: block.assetId }),
    blockId: block.blockId,
    ...(block.body === undefined ? {} : { body: block.body }),
    ...(block.previewUrl === undefined
      ? {}
      : { previewUrl: block.previewUrl }),
    title: block.title,
    type: block.type,
  });
}

function emptySubscribe(): () => void {
  return () => undefined;
}

function emptyRendererSnapshot(): readonly RegisteredPluginBlockRendererV1[] {
  return emptyRendererList;
}
