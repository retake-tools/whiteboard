import { AlertTriangle, CheckCircle2, Loader2, X } from 'lucide-react';
import type { ReactElement } from 'react';
import type { DomainVideoLaunchReviewState } from '../app/useDomainVideoLaunchReviewController';
import './domain-video-launch-review-dialog.css';

export function DomainVideoLaunchReviewDialog({
  onAuthorize,
  onClose,
  state,
}: {
  onAuthorize: () => void;
  onClose: () => void;
  state: DomainVideoLaunchReviewState;
}): ReactElement {
  const review = state.review;
  return (
    <div className="domain-video-review-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-label="Domain Video Launch Review"
        aria-modal="true"
        className="domain-video-review-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <small>Domain Video</small>
            <h2>执行条件审阅</h2>
          </div>
          <button type="button" aria-label="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        {state.loading ? (
          <div className="domain-video-review-state"><Loader2 className="is-spinning" />正在读取生成包与连接条件…</div>
        ) : state.error ? (
          <div className="domain-video-review-state is-error"><AlertTriangle />{state.error}</div>
        ) : review ? (
          <div className="domain-video-review-content">
            <div className={`domain-video-review-summary ${review.ready ? 'is-ready' : 'is-blocked'}`}>
              {review.ready ? <CheckCircle2 /> : <AlertTriangle />}
              <div>
                <strong>{review.ready ? '执行条件已满足' : '执行条件尚未满足'}</strong>
                <span>{review.ready ? '确认后，授权仅绑定本次精确请求；任一条件变化都需要重新审阅。' : `${review.issues.length} 个阻断项需要处理。`}</span>
              </div>
            </div>
            <dl>
              <div><dt>Package Gate</dt><dd>{review.packageGate.status} · {review.packageGate.freshness}</dd></div>
              <div><dt>Connection</dt><dd>{review.route.connectionId ?? '未选择'}</dd></div>
              <div><dt>Provider / model</dt><dd>{review.route.provider ?? '—'} · {review.route.model ?? '—'}</dd></div>
              <div><dt>Route / Adapter</dt><dd>{review.route.routeKind ?? '—'} · {review.route.adapterId ?? '—'}</dd></div>
              <div><dt>候选 / 质量</dt><dd>{review.request?.launchParameters.outputCount ?? '—'} · {review.request?.launchParameters.qualityTier ?? '—'}</dd></div>
              <div><dt>画幅 / 时长</dt><dd>{review.request?.packageProfile.aspectRatio ?? '—'} · {review.request?.packageProfile.durationSeconds ?? '—'}s</dd></div>
              <div><dt>References</dt><dd>{review.request?.referenceBindings.length ?? 0}</dd></div>
              <div><dt>Prompt</dt><dd>{review.providerPrompt.characterCount} / {review.providerPrompt.maxCharacterCount} chars</dd></div>
              <div><dt>成本</dt><dd>{review.costDisclosure?.billingSource ?? 'unknown'} · {review.costDisclosure?.estimateStatus ?? 'unknown'}</dd></div>
              <div><dt>取消</dt><dd>{review.route.cancellation ?? '未声明'}</dd></div>
            </dl>
            {review.issues.length > 0 ? (
              <ul className="domain-video-review-issues">
                {review.issues.map((issue, index) => (
                  <li key={`${issue.code}:${index}`}><code>{issue.code}</code><span>{issue.message}</span></li>
                ))}
              </ul>
            ) : null}
            {review.providerPrompt.preview ? (
              <div className="domain-video-review-prompt">
                <strong>Provider-neutral Submit Source</strong>
                <pre>{review.providerPrompt.preview}</pre>
              </div>
            ) : null}
            <footer>
              <button type="button" onClick={onClose}>关闭</button>
              <button
                type="button"
                className="is-primary"
                disabled={!review.ready || state.executing}
                onClick={onAuthorize}
              >
                {state.executing
                  ? '正在保存授权…'
                  : review.route.routeKind === 'local'
                    ? '确认并本地执行'
                    : '授权并提交 Provider'}
              </button>
            </footer>
          </div>
        ) : null}
      </section>
    </div>
  );
}
