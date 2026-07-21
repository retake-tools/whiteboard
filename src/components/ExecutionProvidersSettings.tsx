import {
  Bot,
  CheckCircle2,
  CloudCog,
  KeyRound,
  Loader2,
  PackagePlus,
  RefreshCw,
  Server,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import {
  checkExecutionProviderConnection,
  loadExecutionProviderSettings,
  saveExecutionProviderDefault,
  updateExecutionProviderConnection,
} from '../core/executionProviderClient';
import type {
  ExecutionCapabilityClass,
  ExecutionConnectionStatus,
  ExecutionConnectionSummary,
  ExecutionProviderSettingsSnapshot,
} from '../core/executionProviders';
import { useI18n, type I18nContextValue } from '../i18n';
import { TooltipIconButton } from './Tooltip';

interface ExecutionProvidersSettingsProps {
  projectId: string;
  onClose: () => void;
}

interface ConnectionDraft {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const capabilityClasses: ExecutionCapabilityClass[] = ['text', 'document', 'image', 'video', 'audio', 'agent'];

export function ExecutionProvidersSettings({ projectId, onClose }: ExecutionProvidersSettingsProps): ReactElement {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'connections' | 'defaults'>('connections');
  const [snapshot, setSnapshot] = useState<ExecutionProviderSettingsSnapshot>();
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState<ConnectionDraft>({ apiKey: '', baseUrl: '', model: '' });

  useEffect(() => {
    let active = true;
    void loadExecutionProviderSettings(projectId)
      .then((loaded) => { if (active) setSnapshot(loaded); })
      .catch((caught) => { if (active) setError(errorMessage(caught)); });
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      active = false;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose, projectId]);

  const installed = snapshot?.connections.filter((connection) => connection.packageStatus === 'installed') ?? [];
  const catalog = snapshot?.connections.filter((connection) => connection.packageStatus === 'available') ?? [];

  function beginConfigure(connection: ExecutionConnectionSummary): void {
    setEditingId(connection.connectionId);
    setDraft({ apiKey: '', baseUrl: connection.baseUrl ?? '', model: connection.model ?? '' });
    setError(undefined);
  }

  async function saveConnection(connection: ExecutionConnectionSummary): Promise<void> {
    setBusyId(connection.connectionId);
    setError(undefined);
    try {
      setSnapshot(await updateExecutionProviderConnection({
        providerId: connection.providerId,
        projectId,
        baseUrl: draft.baseUrl,
        model: draft.model,
        apiKey: draft.apiKey,
      }));
      setEditingId(undefined);
      setDraft({ apiKey: '', baseUrl: '', model: '' });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  }

  async function checkConnection(connectionId: string): Promise<void> {
    setBusyId(connectionId);
    setError(undefined);
    try {
      setSnapshot(await checkExecutionProviderConnection(connectionId, projectId));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  }

  async function saveDefault(
    capabilityClass: ExecutionCapabilityClass,
    connectionId: string,
    scope: 'workspace' | 'project',
  ): Promise<void> {
    const busyKey = `${scope}:${capabilityClass}`;
    setBusyId(busyKey);
    setError(undefined);
    try {
      setSnapshot(await saveExecutionProviderDefault({
        capabilityClass,
        connectionId: connectionId || undefined,
        projectId: scope === 'project' ? projectId : undefined,
        responseProjectId: projectId,
      }));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  }

  return (
    <div
      className="execution-settings-backdrop"
      role="presentation"
      onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <section className="execution-settings-dialog" role="dialog" aria-modal="true" aria-label={t('settings.executionProviders')}>
        <header className="execution-settings-header">
          <div>
            <span className="execution-settings-kicker"><CloudCog size={15} /> Retake</span>
            <h2>{t('settings.executionProviders')}</h2>
            <p>{t('settings.executionProvidersDescription')}</p>
          </div>
          <TooltipIconButton className="execution-settings-close" label={t('context.close')} onClick={onClose}>
            <X size={18} />
          </TooltipIconButton>
        </header>

        <nav className="execution-settings-tabs" aria-label={t('settings.executionProviders')}>
          <button type="button" className={activeTab === 'connections' ? 'is-active' : ''} onClick={() => setActiveTab('connections')}>
            {t('settings.connections')}
          </button>
          <button type="button" className={activeTab === 'defaults' ? 'is-active' : ''} onClick={() => setActiveTab('defaults')}>
            {t('settings.defaults')}
          </button>
        </nav>

        <div className="execution-settings-content">
          {error ? <div className="execution-settings-error" role="alert">{error}</div> : null}
          {!snapshot ? (
            <div className="execution-settings-loading"><Loader2 size={18} /> {t('settings.loadingProviders')}</div>
          ) : activeTab === 'connections' ? (
            <>
              <div className="execution-connection-grid">
                {installed.map((connection) => (
                  <ConnectionCard
                    key={connection.connectionId}
                    busy={busyId === connection.connectionId}
                    connection={connection}
                    draft={draft}
                    editing={editingId === connection.connectionId}
                    onBeginConfigure={() => beginConfigure(connection)}
                    onCancelConfigure={() => setEditingId(undefined)}
                    onCheck={() => void checkConnection(connection.connectionId)}
                    onDraftChange={setDraft}
                    onSave={() => void saveConnection(connection)}
                    t={t}
                  />
                ))}
              </div>
              <section className="execution-package-catalog">
                <h3><PackagePlus size={16} /> {t('settings.catalog')}</h3>
                <div className="execution-package-list">
                  {catalog.map((connection) => (
                    <div key={connection.connectionId}>
                      <ProviderIcon connection={connection} />
                      <span><strong>{connection.displayName}</strong><small>{connection.description}</small></span>
                      <em>{t('settings.packageAvailable')}</em>
                    </div>
                  ))}
                </div>
              </section>
            </>
          ) : (
            <DefaultsPanel
              busyId={busyId}
              connections={installed}
              projectDefaults={snapshot.projectDefaults}
              workspaceDefaults={snapshot.workspaceDefaults}
              onSave={saveDefault}
              t={t}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function ConnectionCard({
  busy,
  connection,
  draft,
  editing,
  onBeginConfigure,
  onCancelConfigure,
  onCheck,
  onDraftChange,
  onSave,
  t,
}: {
  busy: boolean;
  connection: ExecutionConnectionSummary;
  draft: ConnectionDraft;
  editing: boolean;
  onBeginConfigure: () => void;
  onCancelConfigure: () => void;
  onCheck: () => void;
  onDraftChange: (draft: ConnectionDraft) => void;
  onSave: () => void;
  t: I18nContextValue['t'];
}): ReactElement {
  return (
    <article className="execution-connection-card">
      <header>
        <span className="execution-provider-icon"><ProviderIcon connection={connection} /></span>
        <span><strong>{connection.displayName}</strong><small>{connection.description}</small></span>
        <span className={`execution-status is-${connection.status}`}>
          {busy ? <Loader2 size={12} /> : null}{busy ? t('settings.statusChecking') : statusLabel(connection.status, t)}
        </span>
      </header>
      <div className="execution-connection-meta">
        <span>{connection.implementationKind.replace('_', ' ')}</span>
        <span>{connection.hasCredential ? <CheckCircle2 size={13} /> : <KeyRound size={13} />}{connection.hasCredential ? t('settings.credentialsStored') : t('settings.credentialsMissing')}</span>
      </div>
      <div className="execution-capability-list">
        <strong>{t('settings.capabilities')}</strong>
        {connection.supportedCapabilityIds.map((capabilityId) => <span key={capabilityId}>{capabilityId}</span>)}
      </div>
      {connection.lastError ? <p className="execution-connection-error">{connection.lastError}</p> : null}
      {connection.connectionId === 'openai-compatible' ? <p className="execution-connection-check-note">{t('settings.checkMayCost')}</p> : null}
      {editing ? (
        <div className="execution-connection-form">
          <label><span>{t('settings.baseUrl')}</span><input value={draft.baseUrl} onChange={(event) => onDraftChange({ ...draft, baseUrl: event.currentTarget.value })} /></label>
          <label><span>{t('settings.model')}</span><input value={draft.model} onChange={(event) => onDraftChange({ ...draft, model: event.currentTarget.value })} /></label>
          <label><span>{t('settings.apiKey')}</span><input type="password" autoComplete="off" placeholder={t('settings.apiKeyPlaceholder')} value={draft.apiKey} onChange={(event) => onDraftChange({ ...draft, apiKey: event.currentTarget.value })} /></label>
          <div><button type="button" onClick={onCancelConfigure}>{t('projectBoard.cancel')}</button><button type="button" className="is-primary" disabled={busy} onClick={onSave}>{t('settings.saveConnection')}</button></div>
        </div>
      ) : (
        <footer>
          {connection.configurable ? <button type="button" onClick={onBeginConfigure}>{t('settings.configure')}</button> : null}
          {connection.connectionId !== 'retake-mock' && connection.connectionId !== 'codex-managed' ? (
            <button type="button" disabled={busy} onClick={onCheck}><RefreshCw size={13} /> {t('settings.checkConnection')}</button>
          ) : null}
        </footer>
      )}
    </article>
  );
}

function DefaultsPanel({ busyId, connections, projectDefaults, workspaceDefaults, onSave, t }: {
  busyId?: string;
  connections: ExecutionConnectionSummary[];
  projectDefaults: { capabilityClass: ExecutionCapabilityClass; connectionId: string }[];
  workspaceDefaults: { capabilityClass: ExecutionCapabilityClass; connectionId: string }[];
  onSave: (capabilityClass: ExecutionCapabilityClass, connectionId: string, scope: 'workspace' | 'project') => Promise<void>;
  t: I18nContextValue['t'];
}): ReactElement {
  return (
    <div className="execution-default-sections">
      {(['workspace', 'project'] as const).map((scope) => (
        <section key={scope}>
          <h3>{t(scope === 'workspace' ? 'settings.workspaceDefaults' : 'settings.projectDefaults')}</h3>
          {capabilityClasses.map((capabilityClass) => {
            const options = connections.filter((connection) => connection.status === 'ready' && connection.capabilityClasses.includes(capabilityClass));
            const selected = (scope === 'workspace' ? workspaceDefaults : projectDefaults)
              .find((value) => value.capabilityClass === capabilityClass)?.connectionId ?? '';
            return (
              <label key={capabilityClass}>
                <span>{capabilityLabel(capabilityClass, t)}</span>
                <select value={selected} disabled={busyId === `${scope}:${capabilityClass}`} onChange={(event) => void onSave(capabilityClass, event.currentTarget.value, scope)}>
                  <option value="">{scope === 'project' ? t('settings.inheritWorkspace') : t('settings.noCompatibleConnection')}</option>
                  {options.map((connection) => <option key={connection.connectionId} value={connection.connectionId}>{connection.displayName}{connection.model ? ` · ${connection.model}` : ''}</option>)}
                </select>
              </label>
            );
          })}
        </section>
      ))}
    </div>
  );
}

function ProviderIcon({ connection }: { connection: ExecutionConnectionSummary }): ReactElement {
  if (connection.connectionKind === 'agent_host') return <Bot size={18} />;
  if (connection.connectionKind === 'provider_cli') return <TerminalSquare size={18} />;
  if (connection.connectionKind === 'local') return <Server size={18} />;
  return <CloudCog size={18} />;
}

function statusLabel(status: ExecutionConnectionStatus, t: I18nContextValue['t']): string {
  if (status === 'not_installed') return t('settings.statusNotInstalled');
  if (status === 'needs_credentials') return t('settings.statusNeedsCredentials');
  if (status === 'needs_login') return t('settings.statusNeedsLogin');
  if (status === 'checking') return t('settings.statusChecking');
  if (status === 'ready') return t('settings.statusReady');
  return t('settings.statusUnavailable');
}

function capabilityLabel(capabilityClass: ExecutionCapabilityClass, t: I18nContextValue['t']): string {
  if (capabilityClass === 'text') return t('settings.defaultText');
  if (capabilityClass === 'document') return t('settings.defaultDocument');
  if (capabilityClass === 'image') return t('settings.defaultImage');
  if (capabilityClass === 'video') return t('settings.defaultVideo');
  if (capabilityClass === 'audio') return t('settings.defaultAudio');
  return t('settings.defaultAgent');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Execution provider request failed.';
}
