import { Download, ImagePlus, ImageUp } from 'lucide-react';
import type { MouseEvent, ReactElement, ReactNode, RefObject } from 'react';
import { useI18n } from '../i18n';

export function ImageContextCommandMenu({
  canReplaceImage,
  onClose,
  onDownloadImage,
  onInteract,
  onRegenerate,
  onReplaceImage,
  pluginActions,
  popoverRef,
}: {
  canReplaceImage: boolean;
  onClose: () => void;
  onDownloadImage: () => void;
  onInteract?: () => void;
  onRegenerate?: () => void;
  onReplaceImage: () => void;
  pluginActions?: ReactNode;
  popoverRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  const { t } = useI18n();

  function run(action: () => void): void {
    onClose();
    action();
    onInteract?.();
  }

  return (
    <div
      ref={popoverRef}
      id="image-context-command-menu"
      className="context-popover image-context-command-menu"
      aria-label={t('context.moreTools')}
      onClickCapture={(event: MouseEvent<HTMLDivElement>) => {
        const button = (event.target as HTMLElement).closest('button');
        if (!button || button.getAttribute('aria-disabled') === 'true') return;
        onClose();
      }}
    >
      <h2>{t('context.more')}</h2>
      <div className="image-context-command-list">
        {onRegenerate ? (
          <MenuButton icon={<ImagePlus size={17} />} label={t('context.regenerate')} onClick={() => run(onRegenerate)} />
        ) : null}
        {canReplaceImage ? (
          <MenuButton icon={<ImageUp size={17} />} label={t('context.replaceImage')} onClick={() => run(onReplaceImage)} />
        ) : null}
        <MenuButton icon={<Download size={17} />} label={t('context.downloadImage')} onClick={() => run(onDownloadImage)} />
        {pluginActions}
      </div>
    </div>
  );
}

function MenuButton({
  icon,
  label,
  onClick,
}: {
  icon: ReactElement;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button type="button" className="image-context-menu-action" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}
