import {
  AlertTriangle,
  Link2,
  Loader2,
  RefreshCw,
  Unlink,
} from 'lucide-react';
import {
  useEffect,
  useState,
  type FormEvent,
  type ReactElement,
} from 'react';
import type {
  PackageLifecycleControllerV1,
} from '../core/packageLifecycleClient';
import { useI18n } from '../i18n';

export function PluginManagerDevelopment({
  packageController,
}: {
  packageController: PackageLifecycleControllerV1;
}): ReactElement {
  const { t } = useI18n();
  const snapshot = packageController.getDevelopmentSnapshot();
  const [sourceRoot, setSourceRoot] = useState('');
  const [confirmTrust, setConfirmTrust] = useState(false);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    void packageController.refreshDevelopment().catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : String(caught));
    });
  }, [packageController]);

  useEffect(() => {
    if (!snapshot?.links.some((link) => link.watching)) return;
    const timer = window.setInterval(() => {
      void packageController.refreshDevelopment().catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
      });
    }, 400);
    return () => window.clearInterval(timer);
  }, [packageController, snapshot?.links]);

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

  const link = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const exactSourceRoot = sourceRoot.trim();
    if (!exactSourceRoot || !confirmTrust) return;
    void run('link', async () => {
      await packageController.mutateDevelopment({
        action: 'link',
        confirmTrust: true,
        sourceRoot: exactSourceRoot,
      });
      setSourceRoot('');
      setConfirmTrust(false);
    });
  };

  return (
    <section className="plugin-development">
      <header className="plugin-development-intro">
        <div>
          <h3>{t('pluginSettings.developmentTitle')}</h3>
          <p>{t('pluginSettings.developmentDescription')}</p>
        </div>
      </header>

      <form className="plugin-development-link" onSubmit={link}>
        <label>
          <span>{t('pluginSettings.sourceRoot')}</span>
          <input
            onChange={(event) => setSourceRoot(event.target.value)}
            placeholder="/absolute/path/to/plugin"
            value={sourceRoot}
          />
        </label>
        <label className="plugin-development-trust">
          <input
            checked={confirmTrust}
            onChange={(event) => setConfirmTrust(event.target.checked)}
            type="checkbox"
          />
          <span>{t('pluginSettings.linkedTrustConfirm')}</span>
        </label>
        <button
          className="primary"
          disabled={!sourceRoot.trim() || !confirmTrust || Boolean(busyId)}
          type="submit"
        >
          {busyId === 'link' ? <Loader2 className="spin" size={14} /> : (
            <Link2 size={14} />
          )}
          {t('pluginSettings.linkSource')}
        </button>
      </form>

      {error ? <p className="plugin-manager-error">{error}</p> : null}

      <div className="plugin-development-list">
        {snapshot?.links.map((link) => (
          <article className="plugin-development-card" key={link.linkId}>
            <header>
              <div>
                <strong>{link.sourceLabel}</strong>
                <code>{link.identity.packageId}</code>
              </div>
              <span className={`plugin-development-status is-${link.status}`}>
                {t(link.candidate
                  ? 'pluginSettings.devStatusActivating'
                  : developmentStatusKey(link.status))}
              </span>
            </header>
            <dl>
              <div>
                <dt>{t('pluginSettings.lastGood')}</dt>
                <dd><code>{link.lastGood.digest.slice(0, 20)}…</code></dd>
              </div>
              <div>
                <dt>{t('pluginSettings.buildDuration')}</dt>
                <dd>{Math.round(link.lastGood.buildDurationMs)} ms</dd>
              </div>
              <div>
                <dt>{t('pluginSettings.watch')}</dt>
                <dd>{link.watching
                  ? t('pluginSettings.watchOn')
                  : t('pluginSettings.watchOff')}</dd>
              </div>
            </dl>
            {link.error ? (
              <p className="plugin-development-error">
                <AlertTriangle size={14} />
                {link.error}
              </p>
            ) : null}
            <footer>
              {link.status === 'needs_confirmation' ? (
                <button
                  disabled={Boolean(busyId)}
                  onClick={() => void run(
                    `${link.linkId}:confirm`,
                    () => packageController.mutateDevelopment({
                      action: 'confirm_identity',
                      linkId: link.linkId,
                    }),
                  )}
                  type="button"
                >
                  {t('pluginSettings.confirmIdentity')}
                </button>
              ) : (
                <button
                  disabled={Boolean(busyId)}
                  onClick={() => void run(
                    `${link.linkId}:rebuild`,
                    () => packageController.mutateDevelopment({
                      action: 'rebuild',
                      linkId: link.linkId,
                    }),
                  )}
                  type="button"
                >
                  <RefreshCw size={14} />
                  {t('pluginSettings.rebuild')}
                </button>
              )}
              <button
                disabled={Boolean(busyId)}
                onClick={() => void run(
                  `${link.linkId}:watch`,
                  () => packageController.mutateDevelopment({
                    action: link.watching ? 'unwatch' : 'watch',
                    linkId: link.linkId,
                  }),
                )}
                type="button"
              >
                {link.watching
                  ? t('pluginSettings.stopWatch')
                  : t('pluginSettings.startWatch')}
              </button>
              <button
                disabled={Boolean(busyId)}
                onClick={() => void run(
                  `${link.linkId}:retain`,
                  () => packageController.mutateDevelopment({
                    action: 'unlink',
                    disposition: 'retain',
                    linkId: link.linkId,
                  }),
                )}
                type="button"
              >
                <Unlink size={14} />
                {t('pluginSettings.unlinkRetain')}
              </button>
              <button
                className="danger"
                disabled={Boolean(busyId)}
                onClick={() => {
                  if (!window.confirm(t('pluginSettings.unlinkRemoveConfirm'))) {
                    return;
                  }
                  void run(
                    `${link.linkId}:remove`,
                    () => packageController.mutateDevelopment({
                      action: 'unlink',
                      disposition: 'remove',
                      linkId: link.linkId,
                    }),
                  );
                }}
                type="button"
              >
                {t('pluginSettings.unlinkRemove')}
              </button>
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}

function developmentStatusKey(
  status: 'failed' | 'idle' | 'needs_confirmation' | 'ready',
):
  | 'pluginSettings.devStatusFailed'
  | 'pluginSettings.devStatusIdle'
  | 'pluginSettings.devStatusNeedsConfirmation'
  | 'pluginSettings.devStatusReady' {
  if (status === 'failed') return 'pluginSettings.devStatusFailed';
  if (status === 'needs_confirmation') {
    return 'pluginSettings.devStatusNeedsConfirmation';
  }
  if (status === 'ready') return 'pluginSettings.devStatusReady';
  return 'pluginSettings.devStatusIdle';
}
