import {
  Boxes,
  CheckCircle2,
  CircleOff,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import type {
  PluginModuleRuntimeRecordV1,
} from '@retake-tools/package-sdk';
import {
  resolvePluginLocalizedTextV2,
} from '@retake-tools/package-contracts';
import type {
  PluginRuntimeControllerV1,
  PluginRuntimeManagementActionV1,
} from '../core/pluginRuntimeManagementClient';
import { useI18n, type I18nContextValue } from '../i18n';

export function PluginRuntimeSettings({
  controller,
  onClose,
}: {
  controller: PluginRuntimeControllerV1;
  onClose: () => void;
}): ReactElement {
  const { locale, t } = useI18n();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const run = async (
    busyKey: string,
    operation: () => Promise<unknown>,
  ): Promise<void> => {
    setBusyId(busyKey);
    setError(undefined);
    try {
      await operation();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusyId(undefined);
    }
  };

  return (
    <div
      className="plugin-runtime-settings-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="plugin-runtime-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('pluginSettings.title')}
      >
        <header className="plugin-runtime-settings-header">
          <div>
            <span className="plugin-runtime-settings-kicker">
              <Boxes size={13} />
              {t('pluginSettings.kicker')}
            </span>
            <h2>{t('pluginSettings.title')}</h2>
            <p>{t('pluginSettings.description')}</p>
          </div>
          <button
            type="button"
            className="plugin-runtime-settings-close"
            aria-label={t('pluginSettings.close')}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <div className="plugin-runtime-settings-controls">
          <div>
            <strong>{t('pluginSettings.safeMode')}</strong>
            <small>{t('pluginSettings.safeModeDescription')}</small>
          </div>
          <button
            type="button"
            className={snapshot.safeMode ? 'is-danger is-active' : 'is-danger'}
            disabled={Boolean(busyId)}
            onClick={() => void run(
              'safe-mode',
              () => controller.setSafeMode(!snapshot.safeMode),
            )}
          >
            {busyId === 'safe-mode'
              ? <Loader2 className="is-spinning" size={15} />
              : <CircleOff size={15} />}
            {snapshot.safeMode
              ? t('pluginSettings.leaveSafeMode')
              : t('pluginSettings.enterSafeMode')}
          </button>
          <button
            type="button"
            disabled={Boolean(busyId)}
            onClick={() => void run('refresh', controller.refresh)}
          >
            {busyId === 'refresh'
              ? <Loader2 className="is-spinning" size={15} />
              : <RefreshCw size={15} />}
            {t('pluginSettings.refresh')}
          </button>
        </div>

        <div className="plugin-runtime-settings-content">
          {error ? (
            <div className="plugin-runtime-settings-error" role="alert">
              <ShieldAlert size={16} />
              {error}
            </div>
          ) : null}
          {snapshot.modules.length === 0 ? (
            <div className="plugin-runtime-settings-empty">
              <Boxes size={22} />
              <strong>{t('pluginSettings.empty')}</strong>
              <span>{t('pluginSettings.emptyDescription')}</span>
            </div>
          ) : (
            <div className="plugin-runtime-module-list">
              {snapshot.modules.map((record) => (
                <PluginRuntimeModuleCard
                  key={record.pluginModuleId}
                  busyId={busyId}
                  locale={locale}
                  record={record}
                  safeMode={snapshot.safeMode}
                  t={t}
                  onAction={(action) => void run(
                    `${record.pluginModuleId}:${action}`,
                    () => controller.manageModule(record.pluginModuleId, action),
                  )}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function PluginRuntimeModuleCard({
  busyId,
  locale,
  onAction,
  record,
  safeMode,
  t,
}: {
  busyId?: string;
  locale: string;
  onAction: (action: PluginRuntimeManagementActionV1) => void;
  record: PluginModuleRuntimeRecordV1;
  safeMode: boolean;
  t: I18nContextValue['t'];
}): ReactElement {
  const isBusy = busyId?.startsWith(`${record.pluginModuleId}:`) ?? false;
  const action = nextAction(record, safeMode);
  return (
    <article className="plugin-runtime-module-card">
      <header>
        <span className="plugin-runtime-module-icon">
          {record.status === 'enabled'
            ? <CheckCircle2 size={18} />
            : <Boxes size={18} />}
        </span>
        <span>
          <strong>
            {resolvePluginLocalizedTextV2(
              record.manifest.name,
              locale === 'zh' ? 'zh-CN' : 'en',
            )}
          </strong>
          <small>
            {record.pluginModuleId} · v{record.manifest.version}
          </small>
        </span>
        <em className={`plugin-runtime-status is-${record.status}`}>
          {statusLabel(record.status, t)}
        </em>
      </header>

      <p>
        {resolvePluginLocalizedTextV2(
          record.manifest.description,
          locale === 'zh' ? 'zh-CN' : 'en',
        )}
      </p>
      <dl>
        <div>
          <dt>{t('pluginSettings.publisher')}</dt>
          <dd>{record.publisherId}</dd>
        </div>
        <div>
          <dt>{t('pluginSettings.package')}</dt>
          <dd>{record.packageLock.packageId}@{record.packageLock.version}</dd>
        </div>
      </dl>

      <section>
        <strong>{t('pluginSettings.permissions')}</strong>
        <div className="plugin-runtime-tags">
          {record.manifest.permissions.length > 0
            ? record.manifest.permissions.map((permission) => (
              <code key={permission}>{permission}</code>
            ))
            : <span>{t('pluginSettings.noPermissions')}</span>}
        </div>
      </section>
      <section>
        <strong>{t('pluginSettings.contributions')}</strong>
        <div className="plugin-runtime-tags">
          {record.manifest.contributions.map((contribution) => (
            <code key={contribution.contributionId}>
              {contribution.kind}: {contribution.contributionId}
            </code>
          ))}
        </div>
      </section>

      {record.failure ? (
        <div className="plugin-runtime-module-failure">
          <ShieldAlert size={14} />
          {record.failure.message}
        </div>
      ) : null}
      <footer>
        <span>
          {record.grant
            ? <><ShieldCheck size={14} />{t('pluginSettings.permissionsGranted')}</>
            : <><ShieldAlert size={14} />{t('pluginSettings.permissionsNotGranted')}</>}
          {record.trust
            ? <><ShieldCheck size={14} />{t('pluginSettings.codeTrusted')}</>
            : <><ShieldAlert size={14} />{t('pluginSettings.codeNotTrusted')}</>}
        </span>
        {action ? (
          <button
            type="button"
            className={action === 'disable' ? 'is-secondary' : 'is-primary'}
            disabled={Boolean(busyId)}
            onClick={() => onAction(action)}
          >
            {isBusy ? <Loader2 className="is-spinning" size={15} /> : null}
            {actionLabel(action, t)}
          </button>
        ) : null}
      </footer>
      {!record.trust ? (
        <small className="plugin-runtime-trust-warning">
          {t('pluginSettings.trustWarning')}
        </small>
      ) : null}
    </article>
  );
}

function nextAction(
  record: PluginModuleRuntimeRecordV1,
  safeMode: boolean,
): PluginRuntimeManagementActionV1 | undefined {
  if (record.status === 'incompatible') return undefined;
  if (!record.grant) return 'grant';
  if (!record.trust) return 'trust';
  if (record.desiredState === 'enabled' && record.status !== 'failed') {
    return 'disable';
  }
  if (!safeMode && record.negotiatedHostApiVersion !== null) return 'enable';
  return undefined;
}

function actionLabel(
  action: PluginRuntimeManagementActionV1,
  t: I18nContextValue['t'],
): string {
  if (action === 'grant') return t('pluginSettings.grant');
  if (action === 'trust') return t('pluginSettings.trust');
  if (action === 'disable') return t('pluginSettings.disable');
  return t('pluginSettings.enable');
}

function statusLabel(
  status: PluginModuleRuntimeRecordV1['status'],
  t: I18nContextValue['t'],
): string {
  if (status === 'installed') return t('pluginSettings.statusInstalled');
  if (status === 'enabled') return t('pluginSettings.statusEnabled');
  if (status === 'disabled') return t('pluginSettings.statusDisabled');
  if (status === 'failed') return t('pluginSettings.statusFailed');
  return t('pluginSettings.statusIncompatible');
}
