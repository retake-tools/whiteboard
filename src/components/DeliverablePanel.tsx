import {
  ArrowLeft,
  Check,
  Download,
  FileCheck2,
  PackageOpen,
  TriangleAlert,
  X,
} from 'lucide-react';
import { memo, type ReactElement } from 'react';
import type { AssetRecord, BlockRecord } from '../core/types';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

interface DeliverablePanelProps {
  asset: AssetRecord;
  block: BlockRecord;
  onBack: () => void;
  onClose: () => void;
  onDownloadPreview: () => void;
  previewUrl: string;
}

export const DeliverablePanel = memo(function DeliverablePanel({
  asset,
  block,
  onBack,
  onClose,
  onDownloadPreview,
  previewUrl,
}: DeliverablePanelProps): ReactElement {
  const { t } = useI18n();
  const width = asset.width ?? Math.round(block.size.width);
  const height = asset.height ?? Math.round(block.size.height);
  const format = asset.mimeType.replace('image/', '').toUpperCase();

  return (
    <section className="deliverable-panel" aria-label={t('deliverable.title')}>
      <header className="deliverable-panel-header">
        <TooltipIconButton label={t('deliverable.back')} onClick={onBack}>
          <ArrowLeft size={17} />
        </TooltipIconButton>
        <div>
          <span>{t('deliverable.eyebrow')}</span>
          <h2>{t('deliverable.title')}</h2>
        </div>
        <TooltipIconButton label={t('deliverable.close')} onClick={onClose}>
          <X size={17} />
        </TooltipIconButton>
      </header>

      <div className="deliverable-panel-scroll">
        <section className="deliverable-preview-card">
          <img src={previewUrl} alt="" />
          <div>
            <h3>{block.data.title}</h3>
            <p>{width} × {height} px · {format}</p>
          </div>
          <span className="deliverable-status is-attention">
            <TriangleAlert size={13} />
            {t('deliverable.needsAttention')}
          </span>
        </section>

        <section className="deliverable-gate-section">
          <header>
            <div>
              <h3>{t('deliverable.contentGate')}</h3>
              <p>{t('deliverable.contentGateHint')}</p>
            </div>
            <span className="deliverable-gate-state is-pending">{t('deliverable.pending')}</span>
          </header>
          <ul>
            <li className="is-known">
              <Check size={15} />
              <span>{t('deliverable.memberLinked')}</span>
            </li>
            <li>
              <TriangleAlert size={15} />
              <span>{t('deliverable.safeAreaPending')}</span>
            </li>
          </ul>
        </section>

        <section className="deliverable-gate-section">
          <header>
            <div>
              <h3>{t('deliverable.fileGate')}</h3>
              <p>{t('deliverable.fileGateHint')}</p>
            </div>
            <span className="deliverable-gate-state is-pending">{t('deliverable.pending')}</span>
          </header>
          <dl>
            <div>
              <dt>{t('deliverable.recordedPixels')}</dt>
              <dd>{width} × {height}</dd>
            </div>
            <div>
              <dt>{t('deliverable.recordedFormat')}</dt>
              <dd>{format}</dd>
            </div>
            <div>
              <dt>{t('deliverable.readback')}</dt>
              <dd>{t('deliverable.notVerified')}</dd>
            </div>
          </dl>
        </section>

        <section className="deliverable-actions">
          <button type="button" className="is-primary" onClick={onDownloadPreview}>
            <Download size={17} />
            <span>{t('deliverable.downloadPreview')}</span>
          </button>
          <button type="button" disabled>
            <FileCheck2 size={17} />
            <span>{t('deliverable.verifyAndExport')}</span>
          </button>
          <button type="button" disabled>
            <PackageOpen size={17} />
            <span>{t('deliverable.exportProject')}</span>
          </button>
          <p>{t('deliverable.unavailableHint')}</p>
        </section>
      </div>
    </section>
  );
});
