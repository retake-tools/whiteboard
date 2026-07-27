import {
  Archive,
  Boxes,
  GitBranch,
  Loader2,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Trash2,
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
  PackageLifecycleControllerV1,
} from '../core/packageLifecycleClient';
import type {
  PackageLifecycleRecordV1,
} from '../core/packageLifecycleContracts';
import { useI18n, type I18nContextValue } from '../i18n';

export function PackageLibrarySettings({
  controller,
  onClose,
}: {
  controller: PackageLifecycleControllerV1;
  onClose: () => void;
}): ReactElement {
  const { t } = useI18n();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
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
    if (snapshot || didRequestInitialSnapshot.current) return;
    didRequestInitialSnapshot.current = true;
    void run('refresh', controller.refresh);
  }, [controller, snapshot]);

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
      await controller.mutate({ action: 'install', source: nextSource });
      setSource('');
    });
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
        className="plugin-runtime-settings-dialog package-library-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={t('packageLibrary.title')}
      >
        <header className="plugin-runtime-settings-header">
          <div>
            <span className="plugin-runtime-settings-kicker">
              <Boxes size={13} />
              {t('packageLibrary.kicker')}
            </span>
            <h2>{t('packageLibrary.title')}</h2>
            <p>{t('packageLibrary.description')}</p>
          </div>
          <button
            type="button"
            className="plugin-runtime-settings-close"
            aria-label={t('packageLibrary.close')}
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <form className="package-library-install" onSubmit={install}>
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
          <button
            type="button"
            disabled={Boolean(busyId)}
            onClick={() => void run('refresh', controller.refresh)}
          >
            {busyId === 'refresh'
              ? <Loader2 className="is-spinning" size={15} />
              : <RefreshCw size={15} />}
            {t('packageLibrary.refresh')}
          </button>
        </form>

        <div className="plugin-runtime-settings-content">
          {error ? (
            <div className="plugin-runtime-settings-error" role="alert">
              {error}
            </div>
          ) : null}
          {!snapshot ? (
            <div className="plugin-runtime-settings-empty" aria-busy="true">
              <Loader2 className="is-spinning" size={22} />
              <strong>{t('packageLibrary.loading')}</strong>
            </div>
          ) : snapshot.packages.length === 0 ? (
            <div className="plugin-runtime-settings-empty">
              <Archive size={22} />
              <strong>{t('packageLibrary.empty')}</strong>
              <span>{t('packageLibrary.emptyDescription')}</span>
            </div>
          ) : (
            <div className="package-library-list">
              {snapshot.packages.map((record) => (
                <PackageCard
                  key={record.packageId}
                  busyId={busyId}
                  record={record}
                  t={t}
                  onMutate={(action) => void run(
                    `${record.packageId}:${action}`,
                    () => controller.mutate({
                      action,
                      packageId: record.packageId,
                    }),
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

function PackageCard({
  busyId,
  onMutate,
  record,
  t,
}: {
  busyId?: string;
  onMutate: (action: 'remove' | 'rollback' | 'update') => void;
  record: PackageLifecycleRecordV1;
  t: I18nContextValue['t'];
}): ReactElement {
  const isBusy = busyId?.startsWith(`${record.packageId}:`) ?? false;
  const mutate = (action: 'remove' | 'rollback' | 'update'): void => {
    if (
      action === 'remove'
      && !window.confirm(`${t('packageLibrary.confirmRemove')} ${record.name}?`)
    ) return;
    if (
      action === 'rollback'
      && !window.confirm(`${t('packageLibrary.confirmRollback')} ${record.name}?`)
    ) return;
    onMutate(action);
  };
  return (
    <article className="package-library-card">
      <header>
        <span className="plugin-runtime-module-icon">
          {record.source.kind === 'git'
            ? <GitBranch size={18} />
            : <Archive size={18} />}
        </span>
        <span>
          <strong>{record.name}</strong>
          <small>{record.packageId} · v{record.version}</small>
        </span>
        <em className="package-library-role">
          {record.isRoot
            ? t('packageLibrary.root')
            : t('packageLibrary.dependency')}
        </em>
      </header>
      <p>{record.description}</p>
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
          <div className="plugin-runtime-tags">
            {record.dependencies.map((dependency) => (
              <code key={dependency.packageId}>
                {dependency.packageId} {dependency.range}
              </code>
            ))}
          </div>
        </section>
      ) : null}
      <footer>
        <span>
          {record.history.length > 0
            ? `${record.history.length} ${t('packageLibrary.previousVersions')}`
            : t('packageLibrary.noPreviousVersion')}
        </span>
        {record.isRoot ? (
          <div>
            {record.source.canUpdate ? (
              <button
                type="button"
                disabled={Boolean(busyId)}
                onClick={() => mutate('update')}
              >
                {isBusy ? <Loader2 className="is-spinning" size={14} /> : <RefreshCw size={14} />}
                {t('packageLibrary.update')}
              </button>
            ) : null}
            {record.history.length > 0 ? (
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
        ) : null}
      </footer>
    </article>
  );
}
