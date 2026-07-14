import { useEffect, useRef, useState, type PointerEvent, type ReactElement } from 'react';
import { useI18n } from '../i18n';

export interface DrawRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface GroupDrawOverlayProps {
  getCandidateCount: (rect: DrawRect) => number;
  onCancel: () => void;
  onComplete: (rect: DrawRect) => void;
}

export function GroupDrawOverlay({ getCandidateCount, onCancel, onComplete }: GroupDrawOverlayProps): ReactElement {
  const { t } = useI18n();
  const startRef = useRef<{ x: number; y: number } | undefined>(undefined);
  const [rect, setRect] = useState<DrawRect | undefined>();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onCancel();
    }
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [onCancel]);

  function localPoint(event: PointerEvent<HTMLDivElement>): { x: number; y: number } {
    const bounds = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;
    const point = localPoint(event);
    startRef.current = point;
    setRect({ x: point.x, y: point.y, width: 0, height: 0 });
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>): void {
    const start = startRef.current;
    if (!start) return;
    const point = localPoint(event);
    setRect(normalizeDrawRect({ x: start.x, y: start.y, width: point.x - start.x, height: point.y - start.y }));
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>): void {
    const start = startRef.current;
    const point = localPoint(event);
    const completed = start
      ? normalizeDrawRect({ x: start.x, y: start.y, width: point.x - start.x, height: point.y - start.y })
      : rect;
    startRef.current = undefined;
    setRect(undefined);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!completed || completed.width < 48 || completed.height < 48) return;
    onComplete(completed);
  }

  return (
    <div
      className="group-draw-overlay"
      aria-label={t('group.drawHint')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div className="group-draw-hint">{t('group.drawHint')}</div>
      {rect ? (
        <div
          className="group-draw-rect"
          style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
        >
          <span>{getCandidateCount(rect)} {t('group.items')}</span>
        </div>
      ) : null}
    </div>
  );
}

function normalizeDrawRect(rect: DrawRect): DrawRect {
  return {
    x: rect.width < 0 ? rect.x + rect.width : rect.x,
    y: rect.height < 0 ? rect.y + rect.height : rect.y,
    width: Math.abs(rect.width),
    height: Math.abs(rect.height),
  };
}
