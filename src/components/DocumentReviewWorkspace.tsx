import { Braces, Eye, Loader2, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { useDocumentStream } from '../core/documentStreamStore';
import { summarizeMarkdown } from '../core/markdownDocument';
import type { AssetRecord, BlockRecord } from '../core/types';
import { useI18n } from '../i18n';
import { SafeMarkdown } from './SafeMarkdown';
import './document-review-workspace.css';

interface DocumentReviewWorkspaceProps {
  asset?: AssetRecord;
  block: BlockRecord;
  onClose: () => void;
}

export function DocumentReviewWorkspace({ asset, block, onClose }: DocumentReviewWorkspaceProps): ReactElement {
  const { t } = useI18n();
  const stream = useDocumentStream(block.blockId);
  const [savedMarkdown, setSavedMarkdown] = useState('');
  const [loadError, setLoadError] = useState('');
  const [view, setView] = useState<'preview' | 'source'>('preview');
  const isRunning = block.data.status === 'queued' || block.data.status === 'running';
  const markdown = isRunning && stream ? stream : savedMarkdown || stream;

  useEffect(() => {
    const controller = new AbortController();
    setLoadError('');
    setSavedMarkdown('');
    if (!asset?.previewUrl) return () => controller.abort();
    void fetch(asset.previewUrl, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then(setSavedMarkdown)
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : t('document.loadFailed'));
      });
    return () => controller.abort();
  }, [asset?.previewUrl, t]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const summary = useMemo(
    () => markdown ? summarizeMarkdown(markdown, block.data.title) : undefined,
    [block.data.title, markdown],
  );
  const outline = summary?.outline ?? block.data.documentOutline ?? [];

  return (
    <div className="document-review-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="document-review-workspace" role="dialog" aria-modal="true" aria-labelledby="document-review-title">
        <header>
          <div>
            <span>{t('document.reviewWorkspace')}</span>
            <h2 id="document-review-title">{summary?.title || block.data.title}</h2>
          </div>
          <div className="document-review-actions">
            <div className="document-review-view-toggle" role="group" aria-label={t('document.viewMode')}>
              <button type="button" className={view === 'preview' ? 'is-active' : ''} onClick={() => setView('preview')}>
                <Eye size={15} />{t('document.preview')}
              </button>
              <button type="button" className={view === 'source' ? 'is-active' : ''} onClick={() => setView('source')}>
                <Braces size={15} />{t('document.source')}
              </button>
            </div>
            <button type="button" className="document-review-close" aria-label={t('context.close')} onClick={onClose}><X size={19} /></button>
          </div>
        </header>
        <div className="document-review-layout">
          <aside>
            <strong>{t('document.outline')}</strong>
            {outline.length ? <ol>{outline.map((item, index) => <li key={`${item}:${index}`}>{item}</li>)}</ol> : <p>{t('document.noOutline')}</p>}
          </aside>
          <article className="document-review-content">
            {loadError ? <div className="document-review-error" role="alert">{t('document.loadFailed')}: {loadError}</div> : null}
            {!markdown && isRunning ? <div className="document-review-loading"><Loader2 size={18} />{t('document.waiting')}</div> : null}
            {!markdown && !isRunning && !loadError ? <p>{t('document.empty')}</p> : null}
            {markdown && view === 'source' ? <pre className="document-markdown-source">{markdown}</pre> : null}
            {markdown && view === 'preview' ? (
              <div className="document-markdown-preview">
                <SafeMarkdown externalImageBlockedLabel={t('document.externalImageBlocked')} markdown={markdown} />
              </div>
            ) : null}
          </article>
        </div>
        <footer>
          <span>{(summary?.characterCount ?? block.data.documentCharacterCount ?? 0).toLocaleString()} {t('document.characters')}</span>
          <span>{isRunning ? t('document.streaming') : t('document.savedAsset')}</span>
        </footer>
      </section>
    </div>
  );
}
