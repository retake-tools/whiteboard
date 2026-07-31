import { Check, ChevronDown, SlidersHorizontal, Sparkles } from 'lucide-react';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import {
  currentExecutionProviderSettings,
  resolveAgentExecutionConnection,
  subscribeExecutionProviderSettings,
} from '../core/executionProviderPreferences';
import {
  imageComposerAspectRatios,
  imageComposerGenerationParams,
  imageComposerResolutions,
  type ImageComposerAspectRatio,
  type ImageComposerResolution,
} from '../core/imageComposer';
import type { ExecutionConnectionSummary } from '../core/executionProviders';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import { useUnifiedComposerDraft } from './UnifiedComposerProvider';

export function ImageComposerControls({ projectId }: { projectId: string }): ReactElement {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const connectionButtonRef = useRef<HTMLButtonElement>(null);
  const parametersButtonRef = useRef<HTMLButtonElement>(null);
  const [openPopover, setOpenPopover] = useState<'connection' | 'parameters'>();
  const {
    imageConnectionId,
    imageGenerationParams,
    setImageConnectionId,
    setImageGenerationParams,
    setImageGenerationParamsTouched,
  } = useUnifiedComposerDraft();
  const settings = useSyncExternalStore(
    subscribeExecutionProviderSettings,
    currentExecutionProviderSettings,
    currentExecutionProviderSettings,
  );
  const readyConnections = useMemo(
    () => (settings?.connections ?? []).filter(isReadyImageConnection),
    [settings],
  );
  const preferredConnection = useMemo(() => resolveAgentExecutionConnection({
    capabilityId: 'image.text_to_image',
    initialConnectionId: 'codex-app-server',
    projectId,
    settings,
  }), [projectId, settings]);
  const requestedConnection = settings?.connections.find(
    (connection) => connection.connectionId === imageConnectionId,
  );
  const preferredConnectionId = preferredConnection && isReadyImageConnection(preferredConnection)
    ? preferredConnection.connectionId
    : undefined;
  const selectedConnectionId = requestedConnection && isReadyImageConnection(requestedConnection)
    ? requestedConnection.connectionId
    : preferredConnectionId
    ?? readyConnections[0]?.connectionId
    ?? '';
  const selectedConnection = settings?.connections.find(
    (connection) => connection.connectionId === selectedConnectionId,
  );

  useEffect(() => {
    if (selectedConnectionId && imageConnectionId !== selectedConnectionId) {
      setImageConnectionId(selectedConnectionId);
    }
  }, [imageConnectionId, selectedConnectionId, setImageConnectionId]);

  useDismissiblePopover({
    active: Boolean(openPopover),
    focusOnEscapeRef: openPopover === 'connection'
      ? connectionButtonRef
      : parametersButtonRef,
    onDismiss: () => setOpenPopover(undefined),
    rootRef,
  });

  function updateGenerationParam(
    patch: Partial<{
      aspectRatioPreset: ImageComposerAspectRatio;
      targetResolution: ImageComposerResolution;
      variationCount: number;
    }>,
  ): void {
    setImageGenerationParamsTouched(true);
    setImageGenerationParams((current) => imageComposerGenerationParams({
      ...current,
      ...patch,
    }));
  }

  return (
    <div
      ref={rootRef}
      className="image-composer-controls"
      aria-label={t('skillComposer.imageParameters')}
    >
      <div className="image-composer-control-wrap">
        <button
          ref={connectionButtonRef}
          type="button"
          className="image-composer-control"
          aria-expanded={openPopover === 'connection'}
          disabled={readyConnections.length === 0}
          onClick={() => setOpenPopover((current) => (
            current === 'connection' ? undefined : 'connection'
          ))}
        >
          <Sparkles size={13} strokeWidth={1.75} />
          <span>{selectedConnection
            ? connectionLabel(selectedConnection, true)
            : t('skillComposer.noImageConnections')}</span>
          <ChevronDown size={12} strokeWidth={1.75} />
        </button>
        {openPopover === 'connection' ? (
          <div
            className="image-composer-popover is-connection"
            role="dialog"
            aria-label={t('skillComposer.connection')}
          >
            {readyConnections.map((connection) => (
              <button
                type="button"
                className={connection.connectionId === selectedConnectionId
                  ? 'is-selected'
                  : undefined}
                aria-pressed={connection.connectionId === selectedConnectionId}
                key={connection.connectionId}
                onClick={() => {
                  setImageConnectionId(connection.connectionId);
                  setOpenPopover(undefined);
                }}
            >
                <span>{connectionLabel(connection, true)}</span>
                {connection.connectionId === selectedConnectionId
                  ? <Check size={13} />
                  : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className="image-composer-control-wrap">
        <button
          ref={parametersButtonRef}
          type="button"
          className="image-composer-control is-parameters"
          aria-expanded={openPopover === 'parameters'}
          onClick={() => setOpenPopover((current) => (
            current === 'parameters' ? undefined : 'parameters'
          ))}
        >
          <SlidersHorizontal size={13} strokeWidth={1.75} />
          <span>
            {imageGenerationParams.aspectRatioPreset ?? '9:16'}
            {' · '}{imageGenerationParams.targetResolution ?? '2K'}
            {' · '}{imageGenerationParams.variationCount ?? 1}x
          </span>
          <ChevronDown size={12} strokeWidth={1.75} />
        </button>
        {openPopover === 'parameters' ? (
          <div
            className="image-composer-popover is-parameters"
            role="dialog"
            aria-label={t('skillComposer.imageParameters')}
          >
            <ParameterOptions
              label={t('skillComposer.aspectRatio')}
              options={imageComposerAspectRatios}
              selected={imageGenerationParams.aspectRatioPreset ?? '9:16'}
              onSelect={(value) => updateGenerationParam({
                aspectRatioPreset: value as ImageComposerAspectRatio,
              })}
            />
            <ParameterOptions
              label={t('skillComposer.resolution')}
              options={imageComposerResolutions}
              selected={imageGenerationParams.targetResolution ?? '2K'}
              onSelect={(value) => updateGenerationParam({
                targetResolution: value as ImageComposerResolution,
              })}
            />
            <ParameterOptions
              label={t('skillComposer.imageCount')}
              options={['1x', '2x', '3x', '4x']}
              selected={`${imageGenerationParams.variationCount ?? 1}x`}
              onSelect={(value) => updateGenerationParam({
                variationCount: Number(value.slice(0, -1)),
              })}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ParameterOptions({
  label,
  onSelect,
  options,
  selected,
}: {
  label: string;
  onSelect: (value: string) => void;
  options: readonly string[];
  selected: string;
}): ReactElement {
  return (
    <section className="image-composer-parameter-group">
      <strong>{label}</strong>
      <div>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            className={option === selected ? 'is-selected' : undefined}
            aria-pressed={option === selected}
            onClick={() => onSelect(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </section>
  );
}

function isReadyImageConnection(connection: ExecutionConnectionSummary): boolean {
  return connection.connectorId !== 'codex-managed'
    && connection.enabled
    && connection.status === 'ready'
    && connection.enabledUseCases.includes('image')
    && connection.supportedCapabilityIds.includes('image.text_to_image')
    && connection.supportedCapabilityIds.includes('image.image_to_image');
}

function connectionLabel(connection: ExecutionConnectionSummary, ready: boolean): string {
  const label = connection.modelId
    ? `${connection.displayName} · ${connection.modelId}`
    : connection.displayName;
  return ready ? label : `${label} · ${connection.status}`;
}
