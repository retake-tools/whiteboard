import { Clock, ExternalLink } from 'lucide-react';
import type { ReactElement } from 'react';
import { useDocumentStream } from '../core/documentStreamStore';
import { summarizeMarkdown } from '../core/markdownDocument';
import type { BlockData } from '../core/types';
import { useI18n } from '../i18n';

export function DocumentBlockBody({ blockId, data }: { blockId: string; data: BlockData }): ReactElement {
  const { t } = useI18n();
  const stream = useDocumentStream(blockId);
  const streamingSummary = stream ? summarizeMarkdown(stream, data.title) : undefined;
  const excerpt = streamingSummary?.excerpt || data.documentExcerpt || '';
  const outline = streamingSummary?.outline ?? data.documentOutline ?? [];
  const characterCount = streamingSummary?.characterCount ?? data.documentCharacterCount ?? 0;
  const status = data.status;

  function openReview(): void {
    const eventName = typeof data.sourceExecutionId === 'string'
      ? 'retake:open-execution-inspector'
      : 'retake:open-document-review';
    window.dispatchEvent(new CustomEvent(eventName, { detail: { blockId } }));
  }

  return (
    <div
      className="document-block-body"
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        openReview();
      }}
    >
      <div className="document-block-meta">
        {status === 'queued' || status === 'running' ? (
          <span className={`status-pill status-${status}`}><Clock size={13} />{t(`status.${status}`)}</span>
        ) : null}
        <span>{characterCount.toLocaleString()} {t('document.characters')}</span>
      </div>
      {outline.length ? (
        <ul className="document-block-outline">
          {outline.slice(0, 3).map((item, index) => <li key={`${item}:${index}`}>{item.trim()}</li>)}
        </ul>
      ) : null}
      <p>{excerpt || (status === 'queued' || status === 'running' ? t('document.waiting') : t('document.empty'))}</p>
      <div className="document-block-actions">
        <button
          type="button"
          aria-label={t('document.openReview')}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            openReview();
          }}
        >
          <ExternalLink size={13} />{t('document.openReview')}
        </button>
      </div>
    </div>
  );
}
