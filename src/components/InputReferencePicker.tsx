import { ImageIcon, X } from 'lucide-react';
import { useEffect, useRef, type ReactElement } from 'react';
import type { ExecutionInputRole } from '../core/types';
import { useI18n } from '../i18n';
import { InputRoleOptionList } from './InputRoleOptionList';

export interface ReferenceImageOption {
  blockId: string;
  previewUrl: string;
  title: string;
}

export function InputReferencePicker({
  anchor,
  disabledRoles,
  images,
  onCancel,
  onSelectImage,
  onSelectRole,
  roles,
  selectedImage,
}: {
  anchor: { x: number; y: number };
  disabledRoles: ExecutionInputRole[];
  images: ReferenceImageOption[];
  onCancel: () => void;
  onSelectImage: (blockId: string) => void;
  onSelectRole: (role: ExecutionInputRole) => void;
  roles: ExecutionInputRole[];
  selectedImage?: ReferenceImageOption;
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
      aria-label={selectedImage ? t('operationInputRole.pickerTitle') : t('operationInputRole.imagePickerTitle')}
      style={{ left, top }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header>
        <span>
          <strong>
            {selectedImage ? t('operationInputRole.pickerTitle') : t('operationInputRole.imagePickerTitle')}
          </strong>
          <small>
            {selectedImage
              ? t('operationInputRole.pickerDescription')
              : t('operationInputRole.imagePickerDescription')}
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
          <InputRoleOptionList
            disabledRoles={disabledRoles}
            roles={roles}
            onSelect={onSelectRole}
          />
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
          <span>{t('operationInputRole.noImages')}</span>
        </div>
      )}
    </div>
  );
}
