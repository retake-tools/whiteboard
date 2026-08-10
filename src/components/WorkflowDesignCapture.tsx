import { ScanSearch } from 'lucide-react';
import type { ReactElement } from 'react';
import type { WorkflowSelectionCaptureProposalV1 } from '../core/workflowSelectionCapture';
import { useI18n } from '../i18n';

export function WorkflowDesignCapture({
  busy,
  onCapture,
  onPreview,
  proposal,
  selectedBlockCount,
}: {
  busy: boolean;
  onCapture: () => void;
  onPreview: () => void;
  proposal?: WorkflowSelectionCaptureProposalV1;
  selectedBlockCount: number;
}): ReactElement {
  const { t } = useI18n();

  return (
    <section className="workflow-design-capture">
      <strong>{t('workflowAuthoring.captureSelection')}</strong>
      <small>{selectedBlockCount} {t('workflowAuthoring.selectedBlocks')}</small>
      <button
        type="button"
        disabled={selectedBlockCount === 0 || busy}
        onClick={onPreview}
      >
        <ScanSearch size={14} />{t('workflowAuthoring.previewCapture')}
      </button>
      {proposal ? (
        <div className={proposal.valid ? 'is-valid' : 'is-invalid'}>
          <span>{proposal.valid
            ? `${proposal.definition?.steps.length ?? 0} Steps`
            : `${proposal.issues.length} ${t('workflowAuthoring.issues')}`}</span>
          {proposal.issues.length > 0 ? (
            <ul>{proposal.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
          ) : null}
          <button
            type="button"
            disabled={!proposal.valid || busy}
            onClick={onCapture}
          >
            {t('workflowAuthoring.createFromSelection')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
