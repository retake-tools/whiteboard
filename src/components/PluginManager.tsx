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
  PluginProfileOverrideStateV1,
  PluginProfileScopeV1,
} from '@retake-tools/package-sdk';
import type {
  PackageLifecycleControllerV1,
} from '../core/packageLifecycleClient';
import type {
  PluginRuntimeControllerV1,
} from '../core/pluginRuntimeManagementClient';
import { useI18n } from '../i18n';
import {
  PluginManagerModuleCard,
  PluginManagerPackageCard,
} from './PluginManagerPackageCard';

type PluginManagerTab = 'add' | 'installed';

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
  const pluginSnapshot = useSyncExternalStore(
    pluginController.subscribe,
    pluginController.getSnapshot,
    pluginController.getSnapshot,
  );
  const profileProjection = pluginController.getProfileProjection();
  const profileState = pluginController.getProfileState();
  const profileContext = pluginController.getScope();
  const [activeTab, setActiveTab] = useState<PluginManagerTab>(initialTab);
  const [profileScope, setProfileScope] =
    useState<PluginProfileScopeV1>('workspace');
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
  const effectiveProfiles = new Map(
    profileProjection.modules.map((entry) => [
      entry.pluginModuleId,
      entry,
    ]),
  );

  const updateProfile = (
    record: PluginModuleRuntimeRecordV1,
    state: PluginProfileOverrideStateV1,
  ): void => {
    if (profileScope === 'workspace') {
      void run(
        `module:${record.pluginModuleId}:${state}`,
        () => pluginController.manageModule(
          record.pluginModuleId,
          state === 'enabled' ? 'enable' : 'disable',
        ),
      );
      return;
    }
    if (!profileContext.projectId) return;
    void run(
      `profile:${record.pluginModuleId}:${profileScope}`,
      () => pluginController.updateProfile({
        boardId: profileScope === 'board'
          ? profileContext.boardId
          : null,
        pluginModuleId: record.pluginModuleId,
        projectId: profileContext.projectId!,
        scope: profileScope,
        state,
      }),
    );
  };

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
                  'refresh',
                  packageController.refresh,
                )}
              >
                {busyId === 'refresh'
                  ? <Loader2 className="is-spinning" size={15} />
                  : <RefreshCw size={15} />}
                {t('pluginSettings.refresh')}
              </button>
              <label className="plugin-manager-profile-scope">
                <span>
                  <strong>{t('pluginSettings.profileScope')}</strong>
                  <small>
                    {t('pluginSettings.profileScopeDescription')}
                  </small>
                </span>
                <select
                  aria-label={t('pluginSettings.profileScope')}
                  value={profileScope}
                  onChange={(event) => setProfileScope(
                    event.target.value as PluginProfileScopeV1,
                  )}
                >
                  <option value="workspace">
                    {t('pluginSettings.scopeWorkspace')}
                  </option>
                  <option
                    value="project"
                    disabled={!profileContext.projectId}
                  >
                    {t('pluginSettings.scopeProject')}
                  </option>
                  <option
                    value="board"
                    disabled={!profileContext.boardId}
                  >
                    {t('pluginSettings.scopeBoard')}
                  </option>
                </select>
              </label>
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
                        effectiveProfiles={effectiveProfiles}
                        profileContext={profileContext}
                        profileScope={profileScope}
                        profileState={profileState}
                        record={record}
                        safeMode={pluginSnapshot.safeMode}
                        t={t}
                        onLifecycleAction={(action) => void run(
                          `package:${record.packageId}:${action}`,
                          () => packageController.mutate({
                            action,
                            packageId: record.packageId,
                          }),
                        )}
                        onRuntimeAction={(pluginModuleId, action) => void run(
                          `module:${pluginModuleId}:${action}`,
                          () => pluginController.manageModule(
                            pluginModuleId,
                            action,
                          ),
                        )}
                        onProfileChange={(moduleRecord, state) => (
                          updateProfile(moduleRecord, state)
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
                            effectiveProfile={effectiveProfiles.get(
                              record.pluginModuleId,
                            )}
                            profileContext={profileContext}
                            profileScope={profileScope}
                            profileState={profileState}
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
                            onProfileChange={(state) => updateProfile(
                              record,
                              state,
                            )}
                          />
                        ))}
                      </section>
                    ) : null}
                  </div>
                )}
            </div>
          </div>
        ) : (
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
