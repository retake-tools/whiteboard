import {
  Archive,
  Boxes,
  CheckCircle2,
  GitBranch,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { ReactElement } from 'react';
import type {
  PluginModuleRuntimeRecordV1,
} from '@retake-tools/package-sdk';
import {
  resolvePluginLocalizedTextV2,
} from '@retake-tools/package-contracts';
import type {
  PackageLifecycleRecordV1,
  PackageUpdateCheckV1,
} from '../core/packageLifecycleContracts';
import type {
  PluginRuntimeManagementActionV1,
} from '../core/pluginRuntimeManagementClient';
import type { I18nContextValue } from '../i18n';

export function PluginManagerPackageCard({
  busyId,
  locale,
  modules,
  onPermissionChange,
  onLifecycleAction,
  onRuntimeAction,
  record,
  updateCheck,
  safeMode,
  t,
}: {
  busyId?: string;
  locale: string;
  modules: PluginModuleRuntimeRecordV1[];
  onLifecycleAction: (
    action: 'remove' | 'repair' | 'rollback' | 'update'
  ) => void;
  onRuntimeAction: (
    pluginModuleId: string,
    action: PluginRuntimeManagementActionV1,
  ) => void;
  onPermissionChange: (
    pluginModuleId: string,
    permissions: PluginModuleRuntimeRecordV1['manifest']['permissions'],
  ) => void;
  record: PackageLifecycleRecordV1;
  updateCheck?: PackageUpdateCheckV1;
  safeMode: boolean;
  t: I18nContextValue['t'];
}): ReactElement {
  const isBusy = busyId?.startsWith(`package:${record.packageId}:`) ?? false;
  const mutate = (
    action: 'remove' | 'repair' | 'rollback' | 'update',
  ): void => {
    if (
      action === 'remove'
      && !window.confirm(`${t('packageLibrary.confirmRemove')} ${record.name}?`)
    ) return;
    if (
      action === 'rollback'
      && !window.confirm(
        `${t('packageLibrary.confirmRollback')} ${record.name}?`,
      )
    ) return;
    onLifecycleAction(action);
  };

  return (
    <article className="plugin-manager-package-card">
      <header>
        <span className="plugin-manager-icon">
          {record.source.kind === 'git'
            ? <GitBranch size={18} />
            : <Archive size={18} />}
        </span>
        <span>
          <strong>{record.name}</strong>
          <small>{record.packageId} · v{record.version}</small>
        </span>
        <em className="plugin-manager-package-role">
          {record.isRoot
            ? t('packageLibrary.root')
            : t('packageLibrary.dependency')}
        </em>
      </header>
      <p>{record.description}</p>
      {record.loadFailure ? (
        <div className="plugin-manager-error" role="alert">
          <ShieldAlert size={16} />
          <span>
            <strong>{t('packageLibrary.isolated')}</strong>
            <small>{record.loadFailure.message}</small>
          </span>
        </div>
      ) : null}
      {updateCheck ? (
        <PackageUpdateStatus check={updateCheck} t={t} />
      ) : null}
      {record.isRoot && (
        record.loadFailure || updateCheck?.status === 'available'
      ) ? (
        <div className="plugin-manager-package-primary-action">
          <button
            type="button"
            className="is-primary"
            disabled={Boolean(busyId)}
            onClick={() => mutate(record.loadFailure ? 'repair' : 'update')}
          >
            {isBusy
              ? <Loader2 className="is-spinning" size={14} />
              : <RefreshCw size={14} />}
            {record.loadFailure
              ? t('packageLibrary.repair')
              : t('packageLibrary.update')}
          </button>
        </div>
      ) : null}
      <dl>
        <div>
          <dt>{t('packageLibrary.source')}</dt>
          <dd title={record.source.label}>{record.source.label}</dd>
        </div>
        <div>
          <dt>{t('packageLibrary.components')}</dt>
          <dd>
            {[
              `${record.componentCounts.skills} Skill`,
              `${record.componentCounts.workflows} Workflow`,
              `${record.componentCounts.agentPresets} Agent`,
              `${record.componentCounts.pluginModules} Module`,
            ].join(' · ')}
          </dd>
        </div>
      </dl>
      {record.dependencies.length > 0 ? (
        <section>
          <strong>{t('packageLibrary.dependencies')}</strong>
          <div className="plugin-manager-tags">
            {record.dependencies.map((dependency) => (
              <code key={dependency.packageId}>
                {dependency.packageId} {dependency.range}
              </code>
            ))}
          </div>
        </section>
      ) : null}
      <section className="plugin-manager-package-modules">
        <strong>{t('pluginSettings.runtimeAndPermissions')}</strong>
        {modules.length > 0 ? (
          <div className="plugin-manager-module-list">
            {modules.map((moduleRecord) => (
              <PluginManagerModuleCard
                key={moduleRecord.pluginModuleId}
                busyId={busyId}
                locale={locale}
                onPermissionChange={(permissions) => onPermissionChange(
                  moduleRecord.pluginModuleId,
                  permissions,
                )}
                record={moduleRecord}
                safeMode={safeMode}
                t={t}
                onAction={(action) => onRuntimeAction(
                  moduleRecord.pluginModuleId,
                  action,
                )}
              />
            ))}
          </div>
        ) : (
          <span className="plugin-manager-no-modules">
            {t('pluginSettings.noModules')}
          </span>
        )}
      </section>
      {record.isRoot ? (
        <footer className="plugin-manager-package-footer">
          <span>
            {record.history.length > 0
              ? `${record.history.length} ${
                t('packageLibrary.previousVersions')
              }`
              : t('packageLibrary.noPreviousVersion')}
          </span>
          <div>
            {record.history.length > 0 && !record.loadFailure ? (
              <button
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => mutate('rollback')}
              >
                <RotateCcw size={14} />
                {t('packageLibrary.rollback')}
              </button>
            ) : null}
            <button
              type="button"
              className="is-danger"
              disabled={Boolean(busyId)}
              onClick={() => mutate('remove')}
            >
              <Trash2 size={14} />
              {t('packageLibrary.remove')}
            </button>
          </div>
        </footer>
      ) : null}
    </article>
  );
}

function PackageUpdateStatus({
  check,
  t,
}: {
  check: PackageUpdateCheckV1;
  t: I18nContextValue['t'];
}): ReactElement {
  const label = check.status === 'available'
    ? t('packageLibrary.updateAvailable')
    : check.status === 'current'
      ? t('packageLibrary.updateCurrent')
      : check.status === 'pinned'
        ? t('packageLibrary.updatePinned')
        : check.status === 'error'
          ? t('packageLibrary.updateCheckError')
          : t('packageLibrary.updateUnsupported');
  return (
    <section className={`plugin-manager-update-status is-${check.status}`}>
      <strong>{label}</strong>
      {check.status === 'available' && check.candidate ? (
        <span>
          v{check.currentVersion} → v{check.candidate.version}
        </span>
      ) : null}
      {check.detail ? <small>{check.detail}</small> : null}
      {check.candidate?.notices.map((notice) => (
        <small key={`${notice.kind}:${notice.advisoryId ?? notice.message}`}>
          {notice.message}
        </small>
      ))}
    </section>
  );
}

export function PluginManagerModuleCard({
  busyId,
  locale,
  onAction,
  onPermissionChange,
  record,
  safeMode,
  t,
}: {
  busyId?: string;
  locale: string;
  onAction: (action: PluginRuntimeManagementActionV1) => void;
  onPermissionChange: (
    permissions: PluginModuleRuntimeRecordV1['manifest']['permissions'],
  ) => void;
  record: PluginModuleRuntimeRecordV1;
  safeMode: boolean;
  t: I18nContextValue['t'];
}): ReactElement {
  const isBusy = busyId?.startsWith(
    `module:${record.pluginModuleId}:`,
  ) ?? false;
  const action = nextAction(record, safeMode);
  const displayedStatus = record.status;
  return (
    <article className="plugin-manager-module-card">
      <header>
        <span className="plugin-manager-icon">
          {displayedStatus === 'enabled'
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
          <small>{record.pluginModuleId} · v{record.manifest.version}</small>
        </span>
        <em className={`plugin-manager-status is-${displayedStatus}`}>
          {statusLabel(displayedStatus, t)}
        </em>
      </header>
      <p>
        {resolvePluginLocalizedTextV2(
          record.manifest.description,
          locale === 'zh' ? 'zh-CN' : 'en',
        )}
      </p>
      <details className="plugin-manager-module-details">
        <summary>
          <span>
            <strong>{t('pluginSettings.details')}</strong>
            <small>
              {record.manifest.permissions.length} {
                t('pluginSettings.permissions')
              } · {record.manifest.contributions.length} {
                t('pluginSettings.contributions')
              }
            </small>
          </span>
        </summary>
        <dl>
          <div>
            <dt>{t('pluginSettings.publisher')}</dt>
            <dd>{record.publisherId}</dd>
          </div>
          <div>
            <dt>{t('pluginSettings.permissions')}</dt>
            <dd>
              {record.manifest.permissions.length > 0
                ? record.manifest.permissions.length
                : t('pluginSettings.noPermissions')}
            </dd>
          </div>
        </dl>
        <section>
          <strong>{t('pluginSettings.permissions')}</strong>
          <div className="plugin-manager-permission-list">
            {record.manifest.permissions.length > 0
              ? record.manifest.permissions.map((permission) => (
                <label key={permission}>
                  <input
                    type="checkbox"
                    checked={record.grant?.permissions.includes(permission)
                      ?? false}
                    disabled={Boolean(busyId)}
                    onChange={(event) => {
                      const next = record.manifest.permissions.filter(
                        (candidate) => candidate === permission
                          ? event.target.checked
                          : record.grant?.permissions.includes(candidate)
                            ?? false,
                      );
                      onPermissionChange(next);
                    }}
                  />
                  <code>{permission}</code>
                </label>
              ))
              : <span>{t('pluginSettings.noPermissions')}</span>}
          </div>
        </section>
        <section>
          <strong>{t('pluginSettings.contributions')}</strong>
          <div className="plugin-manager-tags">
            {record.manifest.contributions.map((contribution) => (
              <code key={contribution.contributionId}>
                {contribution.kind}: {contribution.contributionId}
              </code>
            ))}
          </div>
        </section>
        {record.grant ? (
          <footer>
            <button
              type="button"
              className="is-secondary"
              disabled={Boolean(busyId)}
              onClick={() => onAction('revoke')}
            >
              {busyId === `module:${record.pluginModuleId}:revoke`
                ? <Loader2 className="is-spinning" size={15} />
                : null}
              {actionLabel('revoke', t)}
            </button>
          </footer>
        ) : null}
      </details>
      {record.failure ? (
        <div className="plugin-manager-module-failure">
          <ShieldAlert size={14} />
          {record.failure.message}
        </div>
      ) : null}
      <footer>
        <span>
          {record.grant
            ? <><ShieldCheck size={14} />{
              t('pluginSettings.permissionsGranted')
            }</>
            : <><ShieldAlert size={14} />{
              t('pluginSettings.permissionsNotGranted')
            }</>}
          {record.trust
            ? <><ShieldCheck size={14} />{
              t('pluginSettings.codeTrusted')
            }</>
            : <><ShieldAlert size={14} />{
              t('pluginSettings.codeNotTrusted')
            }</>}
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
        <small className="plugin-manager-trust-warning">
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
  if (action === 'revoke') return t('pluginSettings.revoke');
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
