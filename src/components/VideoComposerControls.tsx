import { ChevronDown, Clapperboard } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import {
  currentExecutionProviderSettings,
  subscribeExecutionProviderSettings,
} from '../core/executionProviderPreferences';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import { useUnifiedComposerDraft } from './UnifiedComposerProvider';

export function VideoComposerControls(): ReactElement {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const settings = useSyncExternalStore(
    subscribeExecutionProviderSettings,
    currentExecutionProviderSettings,
    currentExecutionProviderSettings,
  );
  const {
    setVideoConnectionId,
    setVideoParameters,
    videoConnectionId,
    videoParameters,
  } = useUnifiedComposerDraft();
  const connections = useMemo(() => settings?.connections.filter(
    (connection) =>
      connection.enabled
      && connection.status === 'ready'
      && connection.enabledUseCases.includes('video')
      && connection.supportedCapabilityIds.includes('video.generate'),
  ) ?? [], [settings]);
  const connectionId = connections.some((connection) => connection.connectionId === videoConnectionId)
    ? videoConnectionId
    : connections[0]?.connectionId;

  useEffect(() => {
    if (connectionId && connectionId !== videoConnectionId) {
      setVideoConnectionId(connectionId);
    }
  }, [connectionId, setVideoConnectionId, videoConnectionId]);

  useDismissiblePopover({
    active: open,
    focusOnEscapeRef: triggerRef,
    onDismiss: () => setOpen(false),
    rootRef,
  });

  return (
    <div ref={rootRef} className="agent-composer-preferences">
      <button
        ref={triggerRef}
        type="button"
        className="agent-composer-preferences-trigger"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Clapperboard size={14} />
        <span>{videoParameters.aspectRatio} · {videoParameters.durationSeconds}s · {videoParameters.outputCount}x</span>
        <ChevronDown size={12} />
      </button>
      {open ? (
        <div className="agent-composer-preferences-popover" role="dialog" aria-label={t('skillComposer.modeVideo')}>
          <label>
            <span>{t('skillComposer.connection')}</span>
            <select value={connectionId ?? ''} onChange={(event) => setVideoConnectionId(event.target.value)}>
              {connections.map((connection) => (
                <option key={connection.connectionId} value={connection.connectionId}>
                  {connection.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>{t('skillComposer.aspectRatio')}</span>
            <select value={videoParameters.aspectRatio} onChange={(event) => setVideoParameters((current) => ({ ...current, aspectRatio: event.target.value }))}>
              {['9:16', '16:9', '1:1'].map((value) => <option key={value}>{value}</option>)}
            </select>
          </label>
          <label>
            <span>{t('skillComposer.durationSeconds')}</span>
            <select value={videoParameters.durationSeconds} onChange={(event) => setVideoParameters((current) => ({ ...current, durationSeconds: Number(event.target.value) }))}>
              {[4, 5, 8, 10, 12, 15].map((value) => <option key={value} value={value}>{value}s</option>)}
            </select>
          </label>
          <label>
            <span>{t('skillComposer.candidateCount')}</span>
            <select value={videoParameters.outputCount} onChange={(event) => setVideoParameters((current) => ({ ...current, outputCount: Number(event.target.value) }))}>
              {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
      ) : null}
    </div>
  );
}
