import { ImagePlus, Sparkles } from 'lucide-react';
import { memo, type ReactElement } from 'react';
import { useI18n } from '../i18n';

interface BlankWorkspaceStartProps {
  onGenerateImage: () => void;
  onOpenImage: () => void;
}

export const BlankWorkspaceStart = memo(function BlankWorkspaceStart({
  onGenerateImage,
  onOpenImage,
}: BlankWorkspaceStartProps): ReactElement {
  const { t } = useI18n();

  return (
    <section className="blank-workspace-start" aria-labelledby="blank-workspace-title">
      <div className="blank-workspace-card">
        <span className="blank-workspace-icon" aria-hidden="true">
          <ImagePlus size={22} />
        </span>
        <div className="blank-workspace-copy">
          <h1 id="blank-workspace-title">{t('blankWorkspace.title')}</h1>
          <p>{t('blankWorkspace.description')}</p>
        </div>
        <div className="blank-workspace-actions">
          <button type="button" className="is-primary" onClick={onOpenImage}>
            <ImagePlus size={17} />
            <span>{t('blankWorkspace.openImage')}</span>
          </button>
          <button type="button" onClick={onGenerateImage}>
            <Sparkles size={17} />
            <span>{t('blankWorkspace.generateImage')}</span>
          </button>
        </div>
        <small>{t('blankWorkspace.hint')}</small>
      </div>
    </section>
  );
});
