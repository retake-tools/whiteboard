import {
  Bot,
  CheckCircle2,
  CloudCog,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  TerminalSquare,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useState, type ReactElement } from 'react';
import {
  checkExecutionProviderConnection,
  createExecutionProviderConnection,
  deleteExecutionProviderConnection,
  loadExecutionProviderSettings,
  saveExecutionProviderDefault,
  updateExecutionProviderConnection,
} from '../core/executionProviderClient';
import type {
  ExecutionCapabilityClass,
  ExecutionConnectionStatus,
  ExecutionConnectionSummary,
  ExecutionConnectionTemplate,
  ExecutionDefaultSelection,
  ExecutionProviderSettingsSnapshot,
} from '../core/executionProviders';
import { useI18n, type I18nContextValue } from '../i18n';
import { TooltipIconButton } from './Tooltip';

interface ExecutionProvidersSettingsProps {
  projectId: string;
  onClose: () => void;
}

interface ConnectionDraft {
  templateId: string;
  displayName: string;
  providerLabel: string;
  apiKey: string;
  baseUrl: string;
  modelIds: string;
}

const capabilityClasses: ExecutionCapabilityClass[] = ['text', 'document', 'image', 'video', 'audio', 'agent'];
const emptyDraft: ConnectionDraft = {
  templateId: '',
  displayName: '',
  providerLabel: '',
  apiKey: '',
  baseUrl: '',
  modelIds: '',
};

export function ExecutionProvidersSettings({ projectId, onClose }: ExecutionProvidersSettingsProps): ReactElement {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<'connections' | 'defaults'>('connections');
  const [snapshot, setSnapshot] = useState<ExecutionProviderSettingsSnapshot>();
  const [error, setError] = useState<string>();
  const [busyId, setBusyId] = useState<string>();
  const [editingId, setEditingId] = useState<string>();
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState<ConnectionDraft>(emptyDraft);

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

  function beginCreate(): void {
    const template = snapshot?.connectionTemplates[0];
    setEditingId(undefined);
    setIsCreating(true);
    setDraft(template ? draftFromTemplate(template) : emptyDraft);
    setError(undefined);
  }

  function beginConfigure(connection: ExecutionConnectionSummary): void {
    setIsCreating(false);
    setEditingId(connection.connectionId);
    setDraft({
      templateId: connection.templateId ?? '',
      displayName: connection.displayName,
      providerLabel: connection.providerLabel,
      apiKey: '',
      baseUrl: connection.baseUrl ?? '',
      modelIds: connection.models.map((model) => model.modelId).join('\n'),
    });
    setError(undefined);
  }

  function cancelForm(): void {
    setEditingId(undefined);
    setIsCreating(false);
    setDraft(emptyDraft);
  }

  async function createConnection(): Promise<void> {
    setBusyId('create');
    setError(undefined);
    try {
      setSnapshot(await createExecutionProviderConnection({
        templateId: draft.templateId,
        displayName: draft.displayName,
        providerLabel: draft.providerLabel,
        projectId,
        baseUrl: draft.baseUrl,
        models: parseModels(draft.modelIds),
        apiKey: draft.apiKey,
      }));
      cancelForm();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  }

  async function saveConnection(connection: ExecutionConnectionSummary): Promise<void> {
    setBusyId(connection.connectionId);
    setError(undefined);
    try {
      setSnapshot(await updateExecutionProviderConnection({
        connectionId: connection.connectionId,
        projectId,
        displayName: draft.displayName,
        providerLabel: draft.providerLabel,
        baseUrl: draft.baseUrl,
        models: parseModels(draft.modelIds),
        apiKey: draft.apiKey,
      }));
      cancelForm();
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

  async function deleteConnection(connection: ExecutionConnectionSummary): Promise<void> {
    if (!window.confirm(`${t('settings.confirmDeleteConnection')} “${connection.displayName}”?`)) return;
    setBusyId(connection.connectionId);
    setError(undefined);
    try {
      setSnapshot(await deleteExecutionProviderConnection(connection.connectionId, projectId));
      if (editingId === connection.connectionId) cancelForm();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  }

  async function saveDefault(
    capabilityClass: ExecutionCapabilityClass,
    connectionId: string,
    model: string | undefined,
    scope: 'workspace' | 'project',
  ): Promise<void> {
    const busyKey = `${scope}:${capabilityClass}`;
    setBusyId(busyKey);
    setError(undefined);
    try {
      setSnapshot(await saveExecutionProviderDefault({
        capabilityClass,
        connectionId: connectionId || undefined,
        model,
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
    <div className="execution-settings-backdrop" role="presentation" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="execution-settings-dialog" role="dialog" aria-modal="true" aria-label={t('settings.executionProviders')}>
        <header className="execution-settings-header">
          <div>
            <span className="execution-settings-kicker"><CloudCog size={15} /> Retake</span>
            <h2>{t('settings.executionProviders')}</h2>
            <p>{t('settings.executionProvidersDescription')}</p>
          </div>
          <TooltipIconButton className="execution-settings-close" label={t('context.close')} onClick={onClose}><X size={18} /></TooltipIconButton>
        </header>

        <nav className="execution-settings-tabs" aria-label={t('settings.executionProviders')}>
          <button type="button" className={activeTab === 'connections' ? 'is-active' : ''} onClick={() => setActiveTab('connections')}>{t('settings.connections')}</button>
          <button type="button" className={activeTab === 'defaults' ? 'is-active' : ''} onClick={() => setActiveTab('defaults')}>{t('settings.defaults')}</button>
        </nav>

        <div className="execution-settings-content">
          {error ? <div className="execution-settings-error" role="alert">{error}</div> : null}
          {!snapshot ? (
            <div className="execution-settings-loading"><Loader2 size={18} /> {t('settings.loadingProviders')}</div>
          ) : activeTab === 'connections' ? (
            <>
              <div className="execution-connections-heading">
                <div><h3>{t('settings.connections')}</h3><p>{t('settings.connectionsDescription')}</p></div>
                <button type="button" className="execution-add-connection" onClick={beginCreate}><Plus size={14} /> {t('settings.addConnection')}</button>
              </div>
              {isCreating ? (
                <ConnectionForm
                  busy={busyId === 'create'}
                  draft={draft}
                  templates={snapshot.connectionTemplates}
                  onCancel={cancelForm}
                  onDraftChange={setDraft}
                  onSave={() => void createConnection()}
                  t={t}
                />
              ) : null}
              <div className="execution-connection-grid">
                {snapshot.connections.map((connection) => (
                  <ConnectionCard
                    key={connection.connectionId}
                    busy={busyId === connection.connectionId}
                    connection={connection}
                    draft={draft}
                    editing={editingId === connection.connectionId}
                    onBeginConfigure={() => beginConfigure(connection)}
                    onCancelConfigure={cancelForm}
                    onCheck={() => void checkConnection(connection.connectionId)}
                    onDelete={() => void deleteConnection(connection)}
                    onDraftChange={setDraft}
                    onSave={() => void saveConnection(connection)}
                    t={t}
                  />
                ))}
              </div>
            </>
          ) : (
            <DefaultsPanel
              busyId={busyId}
              connections={snapshot.connections}
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

function ConnectionForm({ busy, draft, templates, onCancel, onDraftChange, onSave, t }: {
  busy: boolean;
  draft: ConnectionDraft;
  templates?: ExecutionConnectionTemplate[];
  onCancel: () => void;
  onDraftChange: (draft: ConnectionDraft) => void;
  onSave: () => void;
  t: I18nContextValue['t'];
}): ReactElement {
  return (
    <div className="execution-connection-form execution-create-connection-form">
      {templates ? (
        <label><span>{t('settings.connectionTemplate')}</span><select value={draft.templateId} onChange={(event) => {
          const template = templates.find((candidate) => candidate.templateId === event.currentTarget.value);
          if (template) onDraftChange(draftFromTemplate(template));
        }}>{templates.map((template) => <option key={template.templateId} value={template.templateId}>{template.displayName}</option>)}</select></label>
      ) : null}
      <label><span>{t('settings.connectionName')}</span><input value={draft.displayName} onChange={(event) => onDraftChange({ ...draft, displayName: event.currentTarget.value })} /></label>
      <label><span>{t('settings.providerLabel')}</span><input value={draft.providerLabel} onChange={(event) => onDraftChange({ ...draft, providerLabel: event.currentTarget.value })} /></label>
      <label><span>{t('settings.baseUrl')}</span><input value={draft.baseUrl} onChange={(event) => onDraftChange({ ...draft, baseUrl: event.currentTarget.value })} /></label>
      <label><span>{t('settings.modelIds')}</span><textarea placeholder={t('settings.modelIdsPlaceholder')} value={draft.modelIds} onChange={(event) => onDraftChange({ ...draft, modelIds: event.currentTarget.value })} /></label>
      <label><span>{t('settings.apiKey')}</span><input type="password" autoComplete="off" placeholder={t(templates ? 'settings.apiKeyCreatePlaceholder' : 'settings.apiKeyPlaceholder')} value={draft.apiKey} onChange={(event) => onDraftChange({ ...draft, apiKey: event.currentTarget.value })} /></label>
      <div><button type="button" onClick={onCancel}>{t('projectBoard.cancel')}</button><button type="button" className="is-primary" disabled={busy || !draft.templateId || !draft.displayName.trim()} onClick={onSave}>{t(templates ? 'settings.createConnection' : 'settings.saveConnection')}</button></div>
    </div>
  );
}

function ConnectionCard({ busy, connection, draft, editing, onBeginConfigure, onCancelConfigure, onCheck, onDelete, onDraftChange, onSave, t }: {
  busy: boolean;
  connection: ExecutionConnectionSummary;
  draft: ConnectionDraft;
  editing: boolean;
  onBeginConfigure: () => void;
  onCancelConfigure: () => void;
  onCheck: () => void;
  onDelete: () => void;
  onDraftChange: (draft: ConnectionDraft) => void;
  onSave: () => void;
  t: I18nContextValue['t'];
}): ReactElement {
  return (
    <article className="execution-connection-card">
      <header>
        <span className="execution-provider-icon"><ProviderIcon connection={connection} /></span>
        <span><strong>{connection.displayName}</strong><small>{connection.providerLabel} · {connection.description}</small></span>
        <span className={`execution-status is-${connection.status}`}>{busy ? <Loader2 size={12} /> : null}{busy ? t('settings.statusChecking') : statusLabel(connection.status, t)}</span>
      </header>
      <div className="execution-connection-meta">
        <span>{connection.implementationKind.replace('_', ' ')}</span>
        {connection.connectionKind === 'model_provider' ? <span>{connection.hasCredential ? <CheckCircle2 size={13} /> : <KeyRound size={13} />}{connection.hasCredential ? t('settings.credentialsStored') : t('settings.credentialsMissing')}</span> : null}
      </div>
      <div className="execution-capability-list">
        <strong>{t('settings.capabilities')}</strong>
        {connection.supportedCapabilityIds.length ? connection.supportedCapabilityIds.map((capabilityId) => <span key={capabilityId}>{capabilityId}</span>) : <span>{t('settings.noBoundCapabilities')}</span>}
      </div>
      {connection.models.length ? <div className="execution-capability-list"><strong>{t('settings.models')}</strong>{connection.models.map((model) => <span key={model.modelId}>{model.displayName || model.modelId}</span>)}</div> : null}
      {connection.lastError ? <p className="execution-connection-error">{connection.lastError}</p> : null}
      {connection.connectorId === 'openai-compatible' ? <p className="execution-connection-check-note">{t('settings.checkMayCost')}</p> : null}
      {editing ? (
        <ConnectionForm busy={busy} draft={draft} onCancel={onCancelConfigure} onDraftChange={onDraftChange} onSave={onSave} t={t} />
      ) : (
        <footer>
          {connection.deletable ? <button type="button" className="is-danger" onClick={onDelete}><Trash2 size={13} /> {t('settings.deleteConnection')}</button> : null}
          {connection.configurable ? <button type="button" onClick={onBeginConfigure}>{t('settings.configure')}</button> : null}
          {connection.connectionId !== 'retake-mock' && connection.connectionId !== 'codex-managed' ? <button type="button" disabled={busy} onClick={onCheck}><RefreshCw size={13} /> {t('settings.checkConnection')}</button> : null}
        </footer>
      )}
    </article>
  );
}

function DefaultsPanel({ busyId, connections, projectDefaults, workspaceDefaults, onSave, t }: {
  busyId?: string;
  connections: ExecutionConnectionSummary[];
  projectDefaults: ExecutionDefaultSelection[];
  workspaceDefaults: ExecutionDefaultSelection[];
  onSave: (capabilityClass: ExecutionCapabilityClass, connectionId: string, model: string | undefined, scope: 'workspace' | 'project') => Promise<void>;
  t: I18nContextValue['t'];
}): ReactElement {
  return (
    <div className="execution-default-sections">
      {(['workspace', 'project'] as const).map((scope) => (
        <section key={scope}>
          <h3>{t(scope === 'workspace' ? 'settings.workspaceDefaults' : 'settings.projectDefaults')}</h3>
          {capabilityClasses.map((capabilityClass) => {
            const compatible = connections.filter((connection) => connection.status === 'ready' && connection.capabilityClasses.includes(capabilityClass));
            const options: Array<{ connection: ExecutionConnectionSummary; model?: string }> = [];
            compatible.forEach((connection) => {
              if (connection.models.length) {
                connection.models.forEach((model) => options.push({ connection, model: model.modelId }));
              } else {
                options.push({ connection });
              }
            });
            const selected = (scope === 'workspace' ? workspaceDefaults : projectDefaults).find((value) => value.capabilityClass === capabilityClass);
            return (
              <label key={capabilityClass}>
                <span>{capabilityLabel(capabilityClass, t)}</span>
                <select value={selected ? encodeDefaultValue(selected.connectionId, selected.model) : ''} disabled={busyId === `${scope}:${capabilityClass}`} onChange={(event) => {
                  const decoded = decodeDefaultValue(event.currentTarget.value);
                  void onSave(capabilityClass, decoded.connectionId, decoded.model, scope);
                }}>
                  <option value="">{scope === 'project' ? t('settings.inheritWorkspace') : t('settings.noCompatibleConnection')}</option>
                  {options.map(({ connection, model }) => <option key={encodeDefaultValue(connection.connectionId, model)} value={encodeDefaultValue(connection.connectionId, model)}>{connection.displayName}{model ? ` · ${model}` : ''}</option>)}
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

function draftFromTemplate(template: ExecutionConnectionTemplate): ConnectionDraft {
  return {
    templateId: template.templateId,
    displayName: template.displayName,
    providerLabel: template.providerLabel,
    apiKey: '',
    baseUrl: template.defaultBaseUrl ?? '',
    modelIds: template.defaultModels.map((model) => model.modelId).join('\n'),
  };
}

function parseModels(value: string): Array<{ modelId: string }> {
  return [...new Set(value.split(/[\n,]/).map((modelId) => modelId.trim()).filter(Boolean))].map((modelId) => ({ modelId }));
}

function encodeDefaultValue(connectionId: string, model?: string): string {
  return `${connectionId}\u001f${model ?? ''}`;
}

function decodeDefaultValue(value: string): { connectionId: string; model?: string } {
  const [connectionId = '', model = ''] = value.split('\u001f');
  return { connectionId, ...(model ? { model } : {}) };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Execution provider request failed.';
}
