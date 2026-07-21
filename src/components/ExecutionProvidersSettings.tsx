import {
  Bot,
  CheckCircle2,
  CloudCog,
  Copy,
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
  duplicateExecutionProviderConnection,
  loadCodexAppServerModels,
  loadExecutionProviderSettings,
  saveExecutionProviderDefault,
  updateExecutionProviderConnection,
  type CodexAppServerModelCatalog,
} from '../core/executionProviderClient';
import type {
  ExecutionConnectionStatus,
  ExecutionConnectionSummary,
  ExecutionConnectionTemplate,
  ExecutionDefaultSelection,
  ExecutionProviderSettingsSnapshot,
  ExecutionUseCase,
} from '../core/executionProviders';
import { useI18n, type I18nContextValue } from '../i18n';
import { TooltipIconButton } from './Tooltip';

interface ExecutionProvidersSettingsProps {
  projectId: string;
  onClose: () => void;
}

interface ConnectionDraft {
  connectorId: string;
  templateId: string;
  displayName: string;
  providerLabel: string;
  apiKey: string;
  baseUrl: string;
  modelId: string;
  enabledUseCases: ExecutionUseCase[];
}

const executionUseCases: ExecutionUseCase[] = ['text', 'image', 'video', 'audio'];
const emptyDraft: ConnectionDraft = {
  connectorId: '',
  templateId: '',
  displayName: '',
  providerLabel: '',
  apiKey: '',
  baseUrl: '',
  modelId: '',
  enabledUseCases: [],
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
  const [codexModels, setCodexModels] = useState<CodexAppServerModelCatalog>();
  const [codexModelsLoading, setCodexModelsLoading] = useState(false);
  const [codexModelsError, setCodexModelsError] = useState<string>();

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

  useEffect(() => {
    if ((!isCreating && !editingId) || draft.connectorId !== 'codex-app-server' || codexModels || codexModelsLoading || codexModelsError) return;
    setCodexModelsLoading(true);
    void loadCodexAppServerModels()
      .then((catalog) => setCodexModels(catalog))
      .catch((caught) => setCodexModelsError(errorMessage(caught)))
      .finally(() => setCodexModelsLoading(false));
  }, [codexModels, codexModelsError, codexModelsLoading, draft.connectorId, editingId, isCreating]);

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
      connectorId: connection.connectorId,
      templateId: connection.templateId ?? '',
      displayName: connection.displayName,
      providerLabel: connection.providerLabel,
      apiKey: '',
      baseUrl: connection.baseUrl ?? '',
      modelId: connection.modelId ?? '',
      enabledUseCases: [...connection.enabledUseCases],
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
        modelId: draft.modelId,
        apiKey: draft.apiKey,
        enabledUseCases: draft.enabledUseCases,
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
        modelId: draft.modelId,
        apiKey: draft.apiKey,
        enabledUseCases: draft.enabledUseCases,
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

  async function duplicateConnection(connection: ExecutionConnectionSummary): Promise<void> {
    setBusyId(`duplicate:${connection.connectionId}`);
    setError(undefined);
    try {
      const result = await duplicateExecutionProviderConnection(connection.connectionId, projectId);
      setSnapshot(result.snapshot);
      const duplicated = result.snapshot.connections.find(
        (candidate) => candidate.connectionId === result.duplicatedConnectionId,
      );
      if (duplicated) beginConfigure(duplicated);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusyId(undefined);
    }
  }

  async function saveDefault(
    useCase: ExecutionUseCase,
    connectionId: string,
    scope: 'workspace' | 'project',
  ): Promise<void> {
    const busyKey = `${scope}:${useCase}`;
    setBusyId(busyKey);
    setError(undefined);
    try {
      setSnapshot(await saveExecutionProviderDefault({
        useCase,
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
                  codexModels={codexModels}
                  codexModelsError={codexModelsError}
                  codexModelsLoading={codexModelsLoading}
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
                    codexModels={codexModels}
                    codexModelsError={codexModelsError}
                    codexModelsLoading={codexModelsLoading}
                    editing={editingId === connection.connectionId}
                    onBeginConfigure={() => beginConfigure(connection)}
                    onCancelConfigure={cancelForm}
                    onCheck={() => void checkConnection(connection.connectionId)}
                    onDelete={() => void deleteConnection(connection)}
                    onDuplicate={() => void duplicateConnection(connection)}
                    duplicating={busyId === `duplicate:${connection.connectionId}`}
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

function ConnectionForm({ busy, codexModels, codexModelsError, codexModelsLoading, draft, templates, onCancel, onDraftChange, onSave, t }: {
  busy: boolean;
  codexModels?: CodexAppServerModelCatalog;
  codexModelsError?: string;
  codexModelsLoading: boolean;
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
      {draft.connectorId !== 'codex-app-server' ? <label><span>{t('settings.baseUrl')}</span><input value={draft.baseUrl} onChange={(event) => onDraftChange({ ...draft, baseUrl: event.currentTarget.value })} /></label> : null}
      <label>
        <span>{t('settings.modelIds')}</span>
        <input
          list={draft.connectorId === 'codex-app-server' ? 'codex-app-server-models' : undefined}
          placeholder={t('settings.modelIdsPlaceholder')}
          value={draft.modelId}
          onChange={(event) => onDraftChange({ ...draft, modelId: event.currentTarget.value })}
        />
      </label>
      {draft.connectorId === 'codex-app-server' ? (
        <>
          <datalist id="codex-app-server-models">
            {codexModels?.models.filter((model) =>
              !draft.enabledUseCases.includes('image') || model.inputModalities.includes('image')).map((model) => (
              <option key={model.id} value={model.id}>
                {model.displayName}
                {model.isDefault ? ` · ${t('settings.catalogDefault')}` : ''}
                {model.upgrade ? ` · → ${model.upgrade}` : ''}
              </option>
            ))}
          </datalist>
          <p className="execution-connection-form-note">
            {codexModelsLoading
              ? t('settings.loadingModels')
              : codexModels
                ? `${t('settings.modelsFromCli')} ${codexModels.version ?? ''}`
                : `${t('settings.modelCatalogUnavailable')} ${codexModelsError ?? ''}`}
          </p>
        </>
      ) : null}
      {draft.connectorId !== 'codex-app-server' ? <label><span>{t('settings.apiKey')}</span><input type="password" autoComplete="off" placeholder={t(templates ? 'settings.apiKeyCreatePlaceholder' : 'settings.apiKeyPlaceholder')} value={draft.apiKey} onChange={(event) => onDraftChange({ ...draft, apiKey: event.currentTarget.value })} /></label> : null}
      <fieldset className="execution-use-case-fieldset">
        <legend>{t('settings.useCases')}</legend>
        <p>{t('settings.useCasesDescription')}</p>
        <div>
          {executionUseCases.map((useCase) => (
            <label key={useCase}>
              <input
                type="checkbox"
                checked={draft.enabledUseCases.includes(useCase)}
                onChange={() => onDraftChange({
                  ...draft,
                  enabledUseCases: toggleUseCase(draft.enabledUseCases, useCase),
                })}
              />
              <span>{useCaseLabel(useCase, t)}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="execution-connection-form-note">{t('settings.testRequired')}</p>
      <div><button type="button" onClick={onCancel}>{t('projectBoard.cancel')}</button><button type="button" className="is-primary" disabled={busy || Boolean(templates && !draft.templateId) || !draft.displayName.trim() || !draft.modelId.trim() || !draft.enabledUseCases.length} onClick={onSave}>{t(templates ? 'settings.createConnection' : 'settings.saveConnection')}</button></div>
    </div>
  );
}

function ConnectionCard({ busy, codexModels, codexModelsError, codexModelsLoading, connection, draft, duplicating, editing, onBeginConfigure, onCancelConfigure, onCheck, onDelete, onDuplicate, onDraftChange, onSave, t }: {
  busy: boolean;
  codexModels?: CodexAppServerModelCatalog;
  codexModelsError?: string;
  codexModelsLoading: boolean;
  connection: ExecutionConnectionSummary;
  draft: ConnectionDraft;
  duplicating: boolean;
  editing: boolean;
  onBeginConfigure: () => void;
  onCancelConfigure: () => void;
  onCheck: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
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
        <strong>{t('settings.useCases')}</strong>
        {connection.enabledUseCases.length
          ? connection.enabledUseCases.map((useCase) => <span key={useCase}>{useCaseLabel(useCase, t)}</span>)
          : <span>{t('settings.agentHostUseCases')}</span>}
      </div>
      {connection.modelId ? <div className="execution-capability-list"><strong>{t('settings.models')}</strong><span>{connection.modelId}</span></div> : null}
      {connection.lastCheckedAt ? <p className="execution-connection-check-result"><strong>{t('settings.lastTested')}:</strong> {new Date(connection.lastCheckedAt).toLocaleString()}</p> : null}
      {connection.lastCheckMessage ? <p className="execution-connection-check-result">{connection.lastCheckMessage}</p> : null}
      {connection.lastError ? <p className="execution-connection-error">{connection.lastError}</p> : null}
      {['openai-compatible', 'anthropic-native', 'google-native', 'volcengine-ark', 'byteplus-modelark'].includes(connection.connectorId) ? <p className="execution-connection-check-note">{t('settings.checkMayCost')}</p> : null}
      {editing ? (
        <ConnectionForm busy={busy} codexModels={codexModels} codexModelsError={codexModelsError} codexModelsLoading={codexModelsLoading} draft={draft} onCancel={onCancelConfigure} onDraftChange={onDraftChange} onSave={onSave} t={t} />
      ) : (
        <footer>
          {connection.deletable ? <button type="button" className="is-danger" onClick={onDelete}><Trash2 size={13} /> {t('settings.deleteConnection')}</button> : null}
          {connection.configurable ? <button type="button" className="is-icon" aria-label={t('settings.duplicateConnection')} title={t('settings.duplicateConnection')} disabled={duplicating} onClick={onDuplicate}>{duplicating ? <Loader2 size={13} /> : <Copy size={13} />}</button> : null}
          {connection.configurable ? <button type="button" onClick={onBeginConfigure}>{t('settings.configure')}</button> : null}
          {connection.connectionId !== 'retake-mock' && connection.connectionId !== 'codex-managed' ? <button type="button" data-connection-test={connection.connectionId} disabled={busy} onClick={onCheck}><RefreshCw size={13} /> {t('settings.checkConnection')}</button> : null}
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
  onSave: (useCase: ExecutionUseCase, connectionId: string, scope: 'workspace' | 'project') => Promise<void>;
  t: I18nContextValue['t'];
}): ReactElement {
  return (
    <div className="execution-default-sections">
      {(['workspace', 'project'] as const).map((scope) => (
        <section key={scope}>
          <h3>{t(scope === 'workspace' ? 'settings.workspaceDefaults' : 'settings.projectDefaults')}</h3>
          {executionUseCases.map((useCase) => {
            const compatible = connections.filter((connection) => connection.status === 'ready' && connection.enabledUseCases.includes(useCase));
            const selected = (scope === 'workspace' ? workspaceDefaults : projectDefaults).find((value) => value.useCase === useCase);
            return (
              <label key={useCase}>
                <span>{useCaseLabel(useCase, t)}</span>
                <select value={selected?.connectionId ?? ''} disabled={busyId === `${scope}:${useCase}`} onChange={(event) => {
                  void onSave(useCase, event.currentTarget.value, scope);
                }}>
                  <option value="">{scope === 'project' ? t('settings.inheritWorkspace') : t('settings.noCompatibleConnection')}</option>
                  {compatible.map((connection) => <option key={connection.connectionId} value={connection.connectionId}>{connection.displayName}{connection.modelId ? ` · ${connection.modelId}` : ''}</option>)}
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
  if (status === 'untested') return t('settings.statusUntested');
  if (status === 'checking') return t('settings.statusChecking');
  if (status === 'ready') return t('settings.statusReady');
  return t('settings.statusUnavailable');
}

function useCaseLabel(useCase: ExecutionUseCase, t: I18nContextValue['t']): string {
  if (useCase === 'text') return t('settings.defaultText');
  if (useCase === 'image') return t('settings.defaultImage');
  if (useCase === 'video') return t('settings.defaultVideo');
  return t('settings.defaultAudio');
}

function draftFromTemplate(template: ExecutionConnectionTemplate): ConnectionDraft {
  return {
    connectorId: template.connectorId,
    templateId: template.templateId,
    displayName: template.displayName,
    providerLabel: template.providerLabel,
    apiKey: '',
    baseUrl: template.defaultBaseUrl ?? '',
    modelId: template.defaultModelId ?? '',
    enabledUseCases: [...template.defaultUseCases],
  };
}

function toggleUseCase(useCases: ExecutionUseCase[], useCase: ExecutionUseCase): ExecutionUseCase[] {
  return useCases.includes(useCase)
    ? useCases.filter((candidate) => candidate !== useCase)
    : [...useCases, useCase];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Execution provider request failed.';
}
