import { MessageSquareText } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../i18n';

export function AnnotationOperationPreviewButton({
  executionId,
  label,
  markCount,
  previewLabel,
  previewUrl,
}: {
  executionId: string;
  label: string;
  markCount?: number;
  previewLabel: string;
  previewUrl?: string;
}): ReactElement {
  const { t } = useI18n();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);
  const openTimerRef = useRef<number | undefined>(undefined);
  const closeTimerRef = useRef<number | undefined>(undefined);
  const [isPreviewVisible, setIsPreviewVisible] = useState(false);
  const [geometry, setGeometry] = useState<AnnotationPreviewGeometry | undefined>(undefined);

  function clearTimer(timerRef: typeof openTimerRef): void {
    if (timerRef.current === undefined) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = undefined;
  }

  function showPreview(immediate = false): void {
    if (!previewUrl) return;
    clearTimer(closeTimerRef);
    clearTimer(openTimerRef);
    if (immediate) {
      setIsPreviewVisible(true);
      return;
    }
    openTimerRef.current = window.setTimeout(() => setIsPreviewVisible(true), 180);
  }

  function hidePreview(): void {
    clearTimer(openTimerRef);
    clearTimer(closeTimerRef);
    closeTimerRef.current = window.setTimeout(() => setIsPreviewVisible(false), 120);
  }

  function openEditor(): void {
    setIsPreviewVisible(false);
    window.dispatchEvent(new CustomEvent('retake:open-annotation-editor', { detail: { executionId } }));
  }

  useEffect(() => () => {
    clearTimer(openTimerRef);
    clearTimer(closeTimerRef);
  }, []);

  useLayoutEffect(() => {
    if (!isPreviewVisible || !buttonRef.current) return undefined;

    function updateGeometry(): void {
      const anchorRect = buttonRef.current?.getBoundingClientRect();
      if (!anchorRect) return;
      const previewWidth = Math.min(300, window.innerWidth - 24);
      const measuredHeight = previewRef.current?.getBoundingClientRect().height ?? 240;
      const left = clampPreviewPosition(anchorRect.right - previewWidth, 12, window.innerWidth - previewWidth - 12);
      const fitsBelow = anchorRect.bottom + 8 + measuredHeight <= window.innerHeight - 12;
      const top = fitsBelow
        ? anchorRect.bottom + 8
        : Math.max(12, anchorRect.top - measuredHeight - 8);
      setGeometry((current) => current && current.left === left && current.top === top ? current : { left, top });
    }

    updateGeometry();
    window.addEventListener('resize', updateGeometry);
    window.addEventListener('scroll', updateGeometry, true);
    return () => {
      window.removeEventListener('resize', updateGeometry);
      window.removeEventListener('scroll', updateGeometry, true);
    };
  }, [isPreviewVisible]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="block-heading-info-button nodrag nopan"
        aria-label={label}
        title={previewUrl ? undefined : label}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerEnter={() => showPreview()}
        onPointerLeave={hidePreview}
        onFocus={() => showPreview(true)}
        onBlur={hidePreview}
        onClick={(event) => {
          event.stopPropagation();
          openEditor();
        }}
      >
        <MessageSquareText size={15} />
      </button>
      {isPreviewVisible && previewUrl && geometry ? createPortal(
        <div
          ref={previewRef}
          className="annotation-operation-preview nodrag nopan nowheel"
          role="tooltip"
          style={{ '--annotation-preview-left': `${geometry.left}px`, '--annotation-preview-top': `${geometry.top}px` } as AnnotationPreviewStyle}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerEnter={() => showPreview(true)}
          onPointerLeave={hidePreview}
        >
          <img src={previewUrl} alt={previewLabel} />
          <div>
            <strong>{previewLabel}</strong>
            <span>{typeof markCount === 'number' ? `${markCount} ${t('inspector.annotationMarks')}` : label}</span>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

type AnnotationPreviewGeometry = { left: number; top: number };
type AnnotationPreviewStyle = CSSProperties & {
  '--annotation-preview-left': string;
  '--annotation-preview-top': string;
};

function clampPreviewPosition(value: number, min: number, max: number): number {
  if (max < min) return value;
  return Math.min(max, Math.max(min, value));
}
