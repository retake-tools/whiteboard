import { useEffect, useMemo, useSyncExternalStore, type ReactElement } from 'react';
import {
  currentExecutionProviderSettings,
  resolveExecutionConnectionPreference,
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
import { useI18n } from '../i18n';
import { useUnifiedComposerDraft } from './UnifiedComposerProvider';

export function ImageComposerControls({ projectId }: { projectId: string }): ReactElement {
  const { t } = useI18n();
  const {
    imageConnectionId,
    imageGenerationParams,
    setImageConnectionId,
    setImageGenerationParams,
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
  const preferredConnectionId = useMemo(() => resolveExecutionConnectionPreference({
    capabilityId: 'image.text_to_image',
    initialConnectionId: 'codex-managed',
    projectId,
    settings,
    useCase: 'image',
  }).connectionId, [projectId, settings]);
  const selectedConnectionId = imageConnectionId
    ?? preferredConnectionId
    ?? readyConnections[0]?.connectionId
    ?? '';
  const selectedConnection = settings?.connections.find(
    (connection) => connection.connectionId === selectedConnectionId,
  );
  const connections = useMemo(() => {
    if (
      !selectedConnection
      || readyConnections.some((connection) => connection.connectionId === selectedConnection.connectionId)
    ) return readyConnections;
    return [selectedConnection, ...readyConnections];
  }, [readyConnections, selectedConnection]);

  useEffect(() => {
    if (!imageConnectionId && selectedConnectionId) setImageConnectionId(selectedConnectionId);
  }, [imageConnectionId, selectedConnectionId, setImageConnectionId]);

  function updateGenerationParam(
    patch: Partial<{
      aspectRatioPreset: ImageComposerAspectRatio;
      targetResolution: ImageComposerResolution;
      variationCount: number;
    }>,
  ): void {
    setImageGenerationParams((current) => imageComposerGenerationParams({
      ...current,
      ...patch,
    }));
  }

  return (
    <div className="image-composer-controls" aria-label={t('skillComposer.imageParameters')}>
      <label className="image-composer-connection">
        <span>{t('skillComposer.connection')}</span>
        <select
          aria-label={t('skillComposer.connection')}
          disabled={connections.length === 0}
          value={selectedConnectionId}
          onChange={(event) => setImageConnectionId(event.target.value)}
        >
          {connections.length === 0 ? (
            <option value="">{t('skillComposer.noImageConnections')}</option>
          ) : connections.map((connection) => (
            <option
              key={connection.connectionId}
              disabled={!isReadyImageConnection(connection)}
              value={connection.connectionId}
            >
              {connectionLabel(connection, isReadyImageConnection(connection))}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{t('skillComposer.aspectRatio')}</span>
        <select
          aria-label={t('skillComposer.aspectRatio')}
          value={imageGenerationParams.aspectRatioPreset ?? '9:16'}
          onChange={(event) => updateGenerationParam({
            aspectRatioPreset: event.target.value as ImageComposerAspectRatio,
          })}
        >
          {imageComposerAspectRatios.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label>
        <span>{t('skillComposer.resolution')}</span>
        <select
          aria-label={t('skillComposer.resolution')}
          value={imageGenerationParams.targetResolution ?? '2K'}
          onChange={(event) => updateGenerationParam({
            targetResolution: event.target.value as ImageComposerResolution,
          })}
        >
          {imageComposerResolutions.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <label>
        <span>{t('skillComposer.imageCount')}</span>
        <select
          aria-label={t('skillComposer.imageCount')}
          value={imageGenerationParams.variationCount ?? 1}
          onChange={(event) => updateGenerationParam({ variationCount: Number(event.target.value) })}
        >
          {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    </div>
  );
}

function isReadyImageConnection(connection: ExecutionConnectionSummary): boolean {
  return connection.enabled
    && connection.status === 'ready'
    && connection.enabledUseCases.includes('image')
    && connection.supportedCapabilityIds.includes('image.text_to_image');
}

function connectionLabel(connection: ExecutionConnectionSummary, ready: boolean): string {
  const label = connection.modelId
    ? `${connection.displayName} · ${connection.modelId}`
    : connection.displayName;
  return ready ? label : `${label} · ${connection.status}`;
}
