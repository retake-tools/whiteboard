import { Check, Clock3, LoaderCircle, RotateCcw, TriangleAlert, X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { ExecutionResultSummary, ExecutionStatus } from '../core/types';
import { useI18n } from '../i18n';

export interface ExecutionProgressRecord {
  readonly outputAssetIds: readonly string[];
  readonly outputBlockIds: readonly string[];
  readonly resultSummary?: ExecutionResultSummary;
  readonly status: ExecutionStatus;
}

export function ExecutionProgressSummary({
  execution,
  onRetry,
}: {
  execution?: ExecutionProgressRecord;
  onRetry?: () => void;
}): ReactElement | null {
  const { t } = useI18n();
  if (!execution) return null;
  const requested = execution.resultSummary?.requested ?? execution.outputBlockIds.length;
  const succeeded = execution.resultSummary?.succeeded ?? execution.outputAssetIds.length;
  const failed = execution.resultSummary?.failed ?? (
    execution.status === 'failed' ? Math.max(0, requested - succeeded) : 0
  );
  if (requested <= 1 && execution.status === 'succeeded') return null;
  const partial = succeeded > 0 && failed > 0;
  const statusLabel = partial
    ? t('executionProgress.partial')
    : t(`status.${execution.status}` as const);
  const retryable = execution.status === 'failed' || execution.status === 'canceled';

  return (
    <div
      className={`execution-progress-summary is-${execution.status}${partial ? ' is-partial' : ''}`}
      role="status"
      aria-label={`${succeeded}/${requested} · ${statusLabel}`}
    >
      <ExecutionProgressIcon status={execution.status} partial={partial} />
      <strong>{succeeded}/{requested}</strong>
      <span>{statusLabel}</span>
      {failed > 0 ? <small>{failed} {t('executionProgress.failed')}</small> : null}
      {retryable && onRetry ? (
        <button
          type="button"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onRetry();
          }}
        >
          <RotateCcw size={12} />
          {t('executionProgress.retry')}
        </button>
      ) : null}
    </div>
  );
}

function ExecutionProgressIcon({
  partial,
  status,
}: {
  partial: boolean;
  status: ExecutionStatus;
}): ReactElement {
  if (status === 'queued') return <Clock3 size={14} />;
  if (status === 'running') return <LoaderCircle className="is-spinning" size={14} />;
  if (partial || status === 'failed') return <TriangleAlert size={14} />;
  if (status === 'canceled') return <X size={14} />;
  return <Check size={14} />;
}
