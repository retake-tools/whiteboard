import { ImagePlus, Pencil, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, type ReactElement } from 'react';
import { useI18n } from '../i18n';

export function OperationFromImagePicker({
  anchor,
  onCancel,
  onSelect,
}: {
  anchor: { x: number; y: number };
  onCancel: () => void;
  onSelect: (mode: 'edit' | 'similar' | 'reference') => void;
}): ReactElement {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const left = Math.max(16, Math.min(anchor.x, window.innerWidth - 300));
  const top = Math.max(16, Math.min(anchor.y, window.innerHeight - 250));

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) {
        return;
      }
      onCancel();
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') onCancel();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onCancel]);

  return (
    <div
      ref={rootRef}
      className="operation-from-image-picker"
      role="dialog"
      aria-label={t('operationReference.createOperation')}
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header>
        <span>
          <strong>{t('operationReference.createOperation')}</strong>
          <small>{t('operationReference.createOperationDescription')}</small>
        </span>
        <button type="button" aria-label={t('context.close')} onClick={onCancel}>
          <X size={15} />
        </button>
      </header>
      <button type="button" onClick={() => onSelect('edit')}>
        <Pencil size={16} />
        <span>
          <strong>{t('operationReference.createEdit')}</strong>
          <small>{t('operationReference.createEditDescription')}</small>
        </span>
      </button>
      <button type="button" onClick={() => onSelect('similar')}>
        <Sparkles size={16} />
        <span>
          <strong>{t('operationReference.createSimilar')}</strong>
          <small>{t('operationReference.createSimilarDescription')}</small>
        </span>
      </button>
      <button type="button" onClick={() => onSelect('reference')}>
        <ImagePlus size={16} />
        <span>
          <strong>{t('operationReference.createReference')}</strong>
          <small>{t('operationReference.createReferenceDescription')}</small>
        </span>
      </button>
    </div>
  );
}
