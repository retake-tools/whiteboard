import {
  Archive,
  Boxes,
  CircleOff,
  Loader2,
  PackagePlus,
  RefreshCw,
  ShieldAlert,
  X,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactElement,
} from 'react';
import type {
  PluginModuleRuntimeRecordV1,
} from '@retake-tools/package-sdk';
import type {
  PackageLifecycleControllerV1,
} from '../core/packageLifecycleClient';
import type {
  PluginRuntimeControllerV1,
} from '../core/pluginRuntimeManagementClient';
import { useI18n } from '../i18n';
import {
  PluginManagerDevelopment,
} from './PluginManagerDevelopment';
import {
  PluginManagerModuleCard,
  PluginManagerPackageCard,
} from './PluginManagerPackageCard';

type PluginManagerTab = 'add' | 'development' | 'installed';

export function PluginManager({
  initialTab = 'installed',
  packageController,
  pluginController,
  onClose,
}: {
  initialTab?: PluginManagerTab;
  packageController: PackageLifecycleControllerV1;
  pluginController: PluginRuntimeControllerV1;
  onClose: () => void;
}): ReactElement {
  const { locale, t } = useI18n();
  const packageSnapshot = useSyncExternalStore(
    packageController.subscribe,
    packageController.getSnapshot,
    packageController.getSnapshot,
  );
  const updateSnapshot = useSyncExternalStore(
    packageController.subscribe,
    packageController.getUpdateSnapshot,
    packageController.getUpdateSnapshot,
  );
  const pluginSnapshot = useSyncExternalStore(
    pluginController.subscribe,
    pluginController.getSnapshot,
    pluginController.getSnapshot,
  );
  const [activeTab, setActiveTab] = useState<PluginManagerTab>(initialTab);
  const [source, setSource] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const didRequestInitialSnapshot = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (packageSnapshot || didRequestInitialSnapshot.current) return;
    didRequestInitialSnapshot.current = true;
    void run('refresh', packageController.refresh);
  }, [packageController, packageSnapshot]);

  useEffect(() => {
    if (updateSnapshot) return;
    void run('check-updates', packageController.checkUpdates);
  }, [packageController, updateSnapshot]);

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

  const install = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextSource = source.trim();
    if (!nextSource) return;
    void run('install', async () => {
      await packageController.mutate({
        action: 'install',
        source: nextSource,
      });
      setSource('');
      setActiveTab('installed');
    });
  };

  const modulesByPackage = new Map<string, PluginModuleRuntimeRecordV1[]>();
  for (const moduleRecord of pluginSnapshot.modules) {
    const packageId = moduleRecord.packageLock.packageId;
    const packageModules = modulesByPackage.get(packageId) ?? [];
    packageModules.push(moduleRecord);
    modulesByPackage.set(packageId, packageModules);
  }
  const installedPackageIds = new Set(
    packageSnapshot?.packages.map((record) => record.packageId) ?? [],
  );
  const unmatchedModules = pluginSnapshot.modules.filter(
    (record) => !installedPackageIds.has(record.packageLock.packageId),
  );
  return (
    <div
      className="plugin-manager-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="plugin-manager-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('pluginSettings.title')}
      >
        <header className="plugin-manager-header">
          <div>
            <span className="plugin-manager-kicker">
              <Boxes size={13} />
              {t('pluginSettings.kicker')}
            </span>
            <h2>{t('pluginSettings.title')}</h2>
            <p>{t('pluginSettings.description')}</p>
          </div>
          <button
            type="button"
            className="plugin-manager-close"
            aria-label={t('pluginSettings.close')}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <nav className="plugin-manager-tabs" role="tablist">
          <button
            type="button"
            id="plugin-manager-installed-tab"
            role="tab"
            aria-controls="plugin-manager-installed-panel"
            aria-selected={activeTab === 'installed'}
            className={activeTab === 'installed' ? 'is-active' : undefined}
            onClick={() => setActiveTab('installed')}
          >
            {t('pluginSettings.tabInstalled')}
            <span>{packageSnapshot?.packages.length ?? 0}</span>
          </button>
          <button
            type="button"
            id="plugin-manager-add-tab"
            role="tab"
            aria-controls="plugin-manager-add-panel"
            aria-selected={activeTab === 'add'}
            className={activeTab === 'add' ? 'is-active' : undefined}
            onClick={() => setActiveTab('add')}
          >
            {t('pluginSettings.tabAdd')}
          </button>
          <button
            type="button"
            id="plugin-manager-development-tab"
            role="tab"
            aria-controls="plugin-manager-development-panel"
            aria-selected={activeTab === 'development'}
            className={activeTab === 'development' ? 'is-active' : undefined}
            onClick={() => setActiveTab('development')}
          >
            {t('pluginSettings.tabDevelopment')}
            {packageController.getDevelopmentSnapshot()?.links.length ? (
              <span>
                {packageController.getDevelopmentSnapshot()?.links.length}
              </span>
            ) : null}
          </button>
        </nav>

        {activeTab === 'installed' ? (
          <div
            id="plugin-manager-installed-panel"
            className="plugin-manager-panel"
            role="tabpanel"
            aria-labelledby="plugin-manager-installed-tab"
          >
            <div className="plugin-manager-controls">
              <div>
                <strong>{t('pluginSettings.safeMode')}</strong>
                <small>{t('pluginSettings.safeModeDescription')}</small>
              </div>
              <button
                type="button"
                className={
                  pluginSnapshot.safeMode
                    ? 'is-danger is-active'
                    : 'is-danger'
                }
                disabled={Boolean(busyId)}
                onClick={() => void run(
                  'safe-mode',
                  () => pluginController.setSafeMode(
                    !pluginSnapshot.safeMode,
                  ),
                )}
              >
                {busyId === 'safe-mode'
                  ? <Loader2 className="is-spinning" size={15} />
                  : <CircleOff size={15} />}
                {pluginSnapshot.safeMode
                  ? t('pluginSettings.leaveSafeMode')
                  : t('pluginSettings.enterSafeMode')}
              </button>
              <button
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => void run(
                  'check-updates',
                  packageController.checkUpdates,
                )}
              >
                {busyId === 'check-updates'
                  ? <Loader2 className="is-spinning" size={15} />
                  : <RefreshCw size={15} />}
                {t('packageLibrary.checkUpdates')}
              </button>
              <button
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => void run(
                  'refresh',
                  packageController.refresh,
                )}
              >
                {busyId === 'refresh'
                  ? <Loader2 className="is-spinning" size={15} />
                  : <RefreshCw size={15} />}
                {t('pluginSettings.refresh')}
              </button>
            </div>

            <div className="plugin-manager-content">
              <p className="plugin-manager-section-description">
                {t('pluginSettings.installedDescription')}
              </p>
              {error ? (
                <div className="plugin-manager-error" role="alert">
                  <ShieldAlert size={16} />
                  {error}
                </div>
              ) : null}
              {!packageSnapshot ? (
                <EmptyState
                  busy
                  icon={<Loader2 className="is-spinning" size={22} />}
                  title={t('packageLibrary.loading')}
                />
              ) : packageSnapshot.packages.length === 0
                && unmatchedModules.length === 0 ? (
                  <EmptyState
                    icon={<Archive size={22} />}
                    title={t('packageLibrary.empty')}
                    description={t('packageLibrary.emptyDescription')}
                  />
                ) : (
                  <div className="plugin-manager-package-list">
                    {packageSnapshot.packages.map((record) => (
                      <PluginManagerPackageCard
                        key={record.packageId}
                        busyId={busyId}
                        locale={locale}
                        modules={modulesByPackage.get(record.packageId) ?? []}
                        record={record}
                        updateCheck={updateSnapshot?.checks.find(
                          (entry) => entry.packageId === record.packageId,
                        )}
                        safeMode={pluginSnapshot.safeMode}
                        t={t}
                        onLifecycleAction={(action) => void run(
                          `package:${record.packageId}:${action}`,
                          async () => {
                            await packageController.mutate({
                            action,
                            packageId: record.packageId,
                            });
                            if (action === 'update') {
                              await packageController.checkUpdates();
                            }
                          },
                        )}
                        onRuntimeAction={(pluginModuleId, action) => void run(
                          `module:${pluginModuleId}:${action}`,
                          () => pluginController.manageModule(
                            pluginModuleId,
                            action,
                          ),
                        )}
                        onPermissionChange={(pluginModuleId, permissions) => (
                          void run(
                            `module:${pluginModuleId}:permissions`,
                            () => pluginController.setPermissions(
                              pluginModuleId,
                              permissions,
                            ),
                          )
                        )}
                      />
                    ))}
                    {unmatchedModules.length > 0 ? (
                      <section className="plugin-manager-unmatched-modules">
                        <h3>{t('pluginSettings.unmatchedModules')}</h3>
                        {unmatchedModules.map((record) => (
                          <PluginManagerModuleCard
                            key={record.pluginModuleId}
                            busyId={busyId}
                            locale={locale}
                            record={record}
                            safeMode={pluginSnapshot.safeMode}
                            t={t}
                            onAction={(action) => void run(
                              `module:${record.pluginModuleId}:${action}`,
                              () => pluginController.manageModule(
                                record.pluginModuleId,
                                action,
                              ),
                            )}
                            onPermissionChange={(permissions) => void run(
                              `module:${record.pluginModuleId}:permissions`,
                              () => pluginController.setPermissions(
                                record.pluginModuleId,
                                permissions,
                              ),
                            )}
                          />
                        ))}
                      </section>
                    ) : null}
                  </div>
                )}
            </div>
          </div>
        ) : activeTab === 'add' ? (
          <div
            id="plugin-manager-add-panel"
            className="plugin-manager-panel"
            role="tabpanel"
            aria-labelledby="plugin-manager-add-tab"
          >
            <div className="plugin-manager-content plugin-manager-add-content">
              <div>
                <h3>{t('pluginSettings.tabAdd')}</h3>
                <p>{t('pluginSettings.addDescription')}</p>
                <a
                  className="plugin-manager-directory-link"
                  href="https://github.com/retake-tools/plugin-directory"
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('pluginSettings.browseDirectory')}
                </a>
              </div>
              {error ? (
                <div className="plugin-manager-error" role="alert">
                  <ShieldAlert size={16} />
                  {error}
                </div>
              ) : null}
              <form className="plugin-manager-install" onSubmit={install}>
                <label htmlFor="retake-package-install-source">
                  <strong>{t('packageLibrary.installSource')}</strong>
                  <small>{t('packageLibrary.installHint')}</small>
                </label>
                <input
                  id="retake-package-install-source"
                  name="retakePackageInstallSource"
                  value={source}
                  disabled={Boolean(busyId)}
                  placeholder={t('packageLibrary.installPlaceholder')}
                  onChange={(event) => setSource(event.target.value)}
                />
                <button
                  type="submit"
                  className="is-primary"
                  disabled={Boolean(busyId) || source.trim().length === 0}
                >
                  {busyId === 'install'
                    ? <Loader2 className="is-spinning" size={15} />
                    : <PackagePlus size={15} />}
                  {t('packageLibrary.install')}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div
            id="plugin-manager-development-panel"
            className="plugin-manager-panel"
            role="tabpanel"
            aria-labelledby="plugin-manager-development-tab"
          >
            <div className="plugin-manager-content">
              <PluginManagerDevelopment
                packageController={packageController}
              />
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function EmptyState({
  busy = false,
  description,
  icon,
  title,
}: {
  busy?: boolean;
  description?: string;
  icon: ReactElement;
  title: string;
}): ReactElement {
  return (
    <div className="plugin-manager-empty" aria-busy={busy || undefined}>
      {icon}
      <strong>{title}</strong>
      {description ? <span>{description}</span> : null}
    </div>
  );
}
