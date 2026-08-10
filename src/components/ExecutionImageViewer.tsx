import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactElement,
  type WheelEvent,
} from 'react';
import type { AssetRecord } from '../core/types';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

interface ExecutionImageViewerProps {
  hasSiblings: boolean;
  image?: { asset: AssetRecord; title: string };
  onNext: () => void;
  onPrevious: () => void;
}

interface PanGesture {
  pointerId: number;
  x: number;
  y: number;
}

const minimumZoom = 1;
const maximumZoom = 5;
const zoomStep = 1.2;

function imageTransform(
  pan: { x: number; y: number },
  zoom: number,
): string {
  if (
    Math.abs(pan.x) < 0.01
    && Math.abs(pan.y) < 0.01
    && Math.abs(zoom - minimumZoom) < 0.001
  ) return 'none';
  return `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`;
}

export function ExecutionImageViewer({
  hasSiblings,
  image,
  onNext,
  onPrevious,
}: ExecutionImageViewerProps): ReactElement {
  const { t } = useI18n();
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(minimumZoom);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const panRef = useRef(pan);
  const panGestureRef = useRef<PanGesture | undefined>(undefined);
  const transformFrameRef = useRef<number | undefined>(undefined);

  function applyImageTransform(
    nextPan = panRef.current,
    nextZoom = zoom,
  ): void {
    panRef.current = nextPan;
    if (transformFrameRef.current !== undefined) {
      window.cancelAnimationFrame(transformFrameRef.current);
    }
    transformFrameRef.current = window.requestAnimationFrame(() => {
      transformFrameRef.current = undefined;
      if (!imageRef.current) return;
      imageRef.current.style.transform = imageTransform(nextPan, nextZoom);
    });
  }

  function resetView(): void {
    panGestureRef.current = undefined;
    const nextPan = { x: 0, y: 0 };
    panRef.current = nextPan;
    setPan(nextPan);
    setZoom(minimumZoom);
  }

  function updateZoom(nextZoom: number): void {
    const clamped = Math.min(maximumZoom, Math.max(minimumZoom, nextZoom));
    setZoom(clamped);
    if (clamped <= minimumZoom) {
      const nextPan = { x: 0, y: 0 };
      panRef.current = nextPan;
      setPan(nextPan);
    }
  }

  function finishPan(event: PointerEvent<HTMLDivElement>): void {
    if (panGestureRef.current?.pointerId !== event.pointerId) return;
    panGestureRef.current = undefined;
    event.currentTarget.classList.remove('is-panning');
    setPan(panRef.current);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  useLayoutEffect(() => {
    resetView();
  }, [image?.asset.assetId]);

  useLayoutEffect(() => {
    panRef.current = pan;
  }, [pan.x, pan.y]);

  useEffect(() => () => {
    if (transformFrameRef.current !== undefined) {
      window.cancelAnimationFrame(transformFrameRef.current);
    }
  }, []);

  return (
    <div
      className={`execution-result-stage${zoom > minimumZoom ? ' is-zoomed' : ''}`}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest('button')) return;
        event.preventDefault();
        event.stopPropagation();
        resetView();
      }}
      onPointerCancel={finishPan}
      onPointerDown={(event) => {
        if (zoom <= minimumZoom || (event.target as HTMLElement).closest('button')) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.classList.add('is-panning');
        panGestureRef.current = {
          pointerId: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
      }}
      onPointerMove={(event) => {
        const gesture = panGestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        event.preventDefault();
        event.stopPropagation();
        applyImageTransform({
          x: panRef.current.x + event.clientX - gesture.x,
          y: panRef.current.y + event.clientY - gesture.y,
        });
        panGestureRef.current = { ...gesture, x: event.clientX, y: event.clientY };
      }}
      onPointerUp={finishPan}
      onWheel={(event: WheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        event.stopPropagation();
        updateZoom(zoom * Math.exp(-event.deltaY * 0.0014));
      }}
    >
      {image ? (
        <img
          draggable={false}
          ref={imageRef}
          src={image.asset.previewUrl}
          alt={image.title}
          style={{ transform: imageTransform(pan, zoom) }}
        />
      ) : null}
      {!image ? (
        <div className="execution-result-empty">
          <span>{t('inspector.none')}</span>
        </div>
      ) : null}
      {hasSiblings ? (
        <>
          <button
            type="button"
            className="execution-result-navigation is-previous"
            aria-label={t('inspector.previousPreview')}
            onClick={onPrevious}
          >
            <ChevronLeft size={26} />
          </button>
          <button
            type="button"
            className="execution-result-navigation is-next"
            aria-label={t('inspector.nextPreview')}
            onClick={onNext}
          >
            <ChevronRight size={26} />
          </button>
        </>
      ) : null}
      {image ? (
        <div
          className="execution-image-zoom-controls"
          role="group"
          aria-label={t('inspector.zoomControls')}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <TooltipIconButton
            label={t('inspector.zoomOut')}
            disabled={zoom <= minimumZoom}
            onClick={() => updateZoom(zoom / zoomStep)}
          >
            <ZoomOut size={15} />
          </TooltipIconButton>
          <span>{Math.round(zoom * 100)}%</span>
          <TooltipIconButton
            label={t('inspector.zoomIn')}
            disabled={zoom >= maximumZoom}
            onClick={() => updateZoom(zoom * zoomStep)}
          >
            <ZoomIn size={15} />
          </TooltipIconButton>
          <TooltipIconButton label={t('inspector.zoomReset')} onClick={resetView}>
            <Maximize2 size={15} />
          </TooltipIconButton>
        </div>
      ) : null}
    </div>
  );
}
