import { ImageIcon, X } from 'lucide-react';
import { useEffect, useRef, type ReactElement } from 'react';
import type {
  ComposerImageReferenceMode,
  ComposerImageReferenceSetting,
} from '../core/referenceIntent';
import { useI18n } from '../i18n';
import { ReferenceIntentEditor } from './ReferenceIntentEditor';

export interface ReferenceImageOption {
  blockId: string;
  previewUrl: string;
  title: string;
}

export interface ReferenceInputSlotOption {
  label: string;
  mode: Extract<ComposerImageReferenceMode, 'reference' | 'source'>;
  slotId: string;
}

export function InputReferencePicker({
  anchor,
  allowedModes,
  images,
  onCancel,
  onChangeSetting,
  onConfirm,
  onSelectImage,
  onSelectSlot,
  selectedImage,
  selectedSlotId,
  setting,
  slotOptions,
}: {
  anchor: { x: number; y: number };
  allowedModes: readonly ComposerImageReferenceMode[];
  images: ReferenceImageOption[];
  onCancel: () => void;
  onChangeSetting: (setting: ComposerImageReferenceSetting) => void;
  onConfirm: () => void;
  onSelectImage: (blockId: string) => void;
  onSelectSlot: (slotId: string) => void;
  selectedImage?: ReferenceImageOption;
  selectedSlotId?: string;
  setting: ComposerImageReferenceSetting;
  slotOptions: readonly ReferenceInputSlotOption[];
}): ReactElement {
  const { t } = useI18n();
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const left = Math.max(16, Math.min(anchor.x, window.innerWidth - 376));
  const top = Math.max(16, Math.min(anchor.y, window.innerHeight - 470));

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (event.target instanceof Node && pickerRef.current?.contains(event.target)) return;
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
      ref={pickerRef}
      className="input-reference-picker"
      role="dialog"
      aria-label={selectedImage ? t('operationReference.pickerTitle') : t('operationReference.imagePickerTitle')}
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header>
        <span>
          <strong>
            {selectedImage ? t('operationReference.pickerTitle') : t('operationReference.imagePickerTitle')}
          </strong>
          <small>
            {selectedImage
              ? t('operationReference.pickerDescription')
              : t('operationReference.imagePickerDescription')}
          </small>
        </span>
        <button type="button" aria-label={t('context.close')} onClick={onCancel}>
          <X size={16} />
        </button>
      </header>
      {selectedImage ? (
        <>
          <div className="input-reference-selected-image">
            <img src={selectedImage.previewUrl} alt="" />
            <strong>{selectedImage.title}</strong>
          </div>
          {slotOptions.length > 1 ? (
            <section
              className="input-reference-slot-options"
              aria-label={t('operationReference.bindingTitle')}
            >
              {slotOptions.map((option) => (
                <button
                  key={option.slotId}
                  type="button"
                  className={selectedSlotId === option.slotId ? 'is-selected' : ''}
                  aria-pressed={selectedSlotId === option.slotId}
                  onClick={() => onSelectSlot(option.slotId)}
                >
                  {option.label}
                </button>
              ))}
            </section>
          ) : null}
          <ReferenceIntentEditor
            allowedModes={allowedModes}
            setting={setting}
            showModeOptions={slotOptions.length <= 1}
            title={t('operationReference.bindingTitle')}
            onChange={onChangeSetting}
          />
          <button
            type="button"
            className="input-reference-confirm"
            disabled={
              (slotOptions.length > 1 && !selectedSlotId)
              || (setting.mode === 'reference' && !setting.instruction.trim())
            }
            onClick={onConfirm}
          >
            {t('operationReference.confirm')}
          </button>
        </>
      ) : images.length ? (
        <div className="input-reference-image-list">
          {images.map((image) => (
            <button key={image.blockId} type="button" onClick={() => onSelectImage(image.blockId)}>
              <img src={image.previewUrl} alt="" />
              <span>{image.title}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="input-reference-empty">
          <ImageIcon size={20} />
          <span>{t('operationReference.noImages')}</span>
        </div>
      )}
    </div>
  );
}
