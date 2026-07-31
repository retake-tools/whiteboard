import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import {
  currentExecutionProviderSettings,
  subscribeExecutionProviderSettings,
} from '../core/executionProviderPreferences';
import { listAvailableComposerModes } from '../core/composerContributions';
import { imageComposerAspectRatios, imageComposerResolutions } from '../core/imageComposer';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import { useUnifiedComposerDraft } from './UnifiedComposerProvider';

export function AgentComposerPreferencesControls(): ReactElement {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const settings = useSyncExternalStore(
    subscribeExecutionProviderSettings,
    currentExecutionProviderSettings,
    currentExecutionProviderSettings,
  );
  const { agentPreferences, setAgentPreferences } = useUnifiedComposerDraft();
  const availableModes = useMemo(() => listAvailableComposerModes(settings), [settings]);
  const mediaConnections = useMemo(() => settings?.connections.filter(
    (connection) =>
      connection.enabled
      && connection.status === 'ready'
      && connection.connectorId !== 'codex-managed'
      && (connection.enabledUseCases.includes('image') || connection.enabledUseCases.includes('video')),
  ) ?? [], [settings]);
  const selectedConnection = mediaConnections.find(
    (connection) => connection.connectionId === agentPreferences.connectionId,
  );
  const preferenceSummary = [
    agentPreferences.outputType === 'image'
      ? t('skillComposer.modeImage')
      : agentPreferences.outputType === 'video'
        ? t('skillComposer.modeVideo')
        : undefined,
    selectedConnection?.displayName,
    agentPreferences.aspectRatioPreset,
    agentPreferences.targetResolution,
    agentPreferences.variationCount ? `${agentPreferences.variationCount}x` : undefined,
  ].filter((value): value is string => Boolean(value));

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
        <SlidersHorizontal size={14} strokeWidth={1.75} />
        <span>{preferenceSummary.length
          ? preferenceSummary.join(' · ')
          : t('skillComposer.autoPreferences')}</span>
        <ChevronDown size={12} strokeWidth={1.75} />
      </button>
      {open ? (
        <div className="agent-composer-preferences-popover" role="dialog" aria-label={t('skillComposer.autoPreferences')}>
          {availableModes.length > 2 ? (
            <PreferenceOptionGroup
              label={t('skillComposer.outputType')}
              options={[
                { label: t('skillComposer.auto'), value: 'auto' },
                ...(availableModes.some((mode) => mode.mode === 'image')
                  ? [{ label: t('skillComposer.modeImage'), value: 'image' }]
                  : []),
                ...(availableModes.some((mode) => mode.mode === 'video')
                  ? [{ label: t('skillComposer.modeVideo'), value: 'video' }]
                  : []),
              ]}
              selected={agentPreferences.outputType}
              onSelect={(value) => setAgentPreferences((current) => ({
                  ...current,
                  outputType: value as typeof current.outputType,
                }))}
            />
          ) : null}
          <PreferenceOptionGroup
            isWide
            label={t('skillComposer.connection')}
            options={[
              { label: t('skillComposer.auto'), value: '' },
              ...mediaConnections.map((connection) => ({
                description: connection.modelId,
                label: connection.displayName,
                value: connection.connectionId,
              })),
            ]}
            selected={agentPreferences.connectionId ?? ''}
            onSelect={(value) => setAgentPreferences((current) => ({
                ...current,
                connectionId: value || undefined,
              }))}
          />
          <PreferenceOptionGroup
            label={t('skillComposer.aspectRatio')}
            options={[
              { label: t('skillComposer.auto'), value: '' },
              ...imageComposerAspectRatios.map((value) => ({ label: value, value })),
            ]}
            selected={agentPreferences.aspectRatioPreset ?? ''}
            onSelect={(value) => setAgentPreferences((current) => ({
                ...current,
                aspectRatioPreset: value || undefined,
              }))}
          />
          <PreferenceOptionGroup
            label={t('skillComposer.resolution')}
            options={[
              { label: t('skillComposer.auto'), value: '' },
              ...imageComposerResolutions.map((value) => ({ label: value, value })),
            ]}
            selected={agentPreferences.targetResolution ?? ''}
            onSelect={(value) => setAgentPreferences((current) => ({
                ...current,
                targetResolution: value || undefined,
              }))}
          />
          <PreferenceOptionGroup
            label={t('skillComposer.candidateCount')}
            options={[
              { label: t('skillComposer.auto'), value: '' },
              ...[1, 2, 3, 4].map((value) => ({ label: `${value}x`, value: String(value) })),
            ]}
            selected={agentPreferences.variationCount ? String(agentPreferences.variationCount) : ''}
            onSelect={(value) => setAgentPreferences((current) => ({
                ...current,
                variationCount: value ? Number(value) as 1 | 2 | 3 | 4 : undefined,
              }))}
          />
        </div>
      ) : null}
    </div>
  );
}

function PreferenceOptionGroup({
  isWide = false,
  label,
  onSelect,
  options,
  selected,
}: {
  isWide?: boolean;
  label: string;
  onSelect: (value: string) => void;
  options: ReadonlyArray<{
    description?: string;
    label: string;
    value: string;
  }>;
  selected: string;
}): ReactElement {
  return (
    <section className="agent-composer-preference-group">
      <strong>{label}</strong>
      <div className={isWide ? 'agent-composer-preference-options is-wide' : 'agent-composer-preference-options'}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={option.value === selected}
            className={option.value === selected ? 'is-selected' : undefined}
            onClick={() => onSelect(option.value)}
          >
            <span>{option.label}</span>
            {option.description ? <small>{option.description}</small> : null}
          </button>
        ))}
      </div>
    </section>
  );
}
