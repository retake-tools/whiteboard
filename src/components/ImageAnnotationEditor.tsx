import {
  Maximize2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type WheelEvent,
} from 'react';
import {
  annotationColorOptions,
  annotationManifestFromDraft,
  annotationMarksMissingIntent,
  compileAnnotationInstruction,
  hasExecutableAnnotationIntent,
  nextAnnotationMarkId,
  type AnnotationColor,
  type AnnotationDraft,
  type AnnotationDraftContent,
  type AnnotationManifest,
  type AnnotationMark as CoreAnnotationMark,
  type AnnotationMarkKind,
  type AnnotationPoint,
  type AnnotationStrokeSize,
} from '../core/imageAnnotations';
import { useI18n } from '../i18n';
import {
  createAnnotatedComposite,
  type AnnotationComposite,
} from './imageAnnotationComposite';
import {
  annotationBrushStrokeWidthPixels,
  annotationMarkFocusPoint,
  clamp,
  clampImageViewPan,
  defaultArrowEnd,
  distance,
  hitTestAnnotationMark,
  metricsStageCenterX,
  metricsStageCenterY,
  readImageDisplayMetrics,
  transformImageDisplayMetrics,
  translateAnnotationMark,
  type ImageDisplayMetrics,
} from './imageAnnotationGeometry';
import {
  AnnotationIdBadge,
  AnnotationQuickDelete,
  AnnotationSvgMark,
  type EndpointHandle,
} from './ImageAnnotationOverlay';
import {
  AnnotationSidePanel,
  AnnotationToolStrip,
  type AnnotationTool,
} from './ImageAnnotationControls';
import { TooltipIconButton } from './Tooltip';

export type { AnnotationComposite } from './imageAnnotationComposite';

// This interaction surface predates the structured annotation model and still
// contains cohesive pointer, zoom, and panel plumbing. Geometry, SVG rendering,
// canvas export, and provider-neutral prompt semantics now live in focused
// modules so those responsibilities no longer grow in this file.

interface ImageAnnotationEditorProps {
  imageUrl?: string;
  initialDraft?: AnnotationDraft;
  instruction: string;
  runLabel: string;
  title: string;
  unavailableLabel: string;
  onInstructionChange: (instruction: string) => void;
  onDraftChange: (draft: AnnotationDraftContent) => void;
  onRun: (input: {
    instruction: string;
    manifest: AnnotationManifest;
    composite: AnnotationComposite;
  }) => void;
}

type AnnotationMark = CoreAnnotationMark;
type MarkColor = AnnotationColor;
type StrokeSize = AnnotationStrokeSize;
type Point = AnnotationPoint;
type DragTarget =
  | { type: 'draw'; markId: string }
  | { type: 'endpoint'; markId: string; endpoint: EndpointHandle; lastPoint: Point }
  | { type: 'move'; markId: string; lastPoint: Point }
  | { type: 'pan'; lastClientPoint: Point }
  | null;

const colorOptions = annotationColorOptions.map((option) => option.value);
const defaultMarkColor: MarkColor = annotationColorOptions[0].value;
const supportedMarkKinds = new Set<AnnotationMarkKind>(['marker', 'arrow', 'pen', 'brush', 'rect', 'ellipse']);

export function ImageAnnotationEditor({
  imageUrl,
  initialDraft,
  instruction,
  runLabel,
  title,
  unavailableLabel,
  onDraftChange,
  onInstructionChange,
  onRun,
}: ImageAnnotationEditorProps): ReactElement {
  const { t } = useI18n();
  const editorRef = useRef<HTMLDivElement | null>(null);
  const stageAreaRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [activeTool, setActiveTool] = useState<AnnotationTool>('select');
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [hoveredMarkId, setHoveredMarkId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [marks, setMarks] = useState<AnnotationMark[]>(() => supportedInitialMarks(initialDraft));
  const [imageAspectRatio, setImageAspectRatio] = useState<number | null>(null);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [strokeSize, setStrokeSize] = useState<StrokeSize>('m');
  const [metrics, setMetrics] = useState<ImageDisplayMetrics | null>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null);
  const [viewPan, setViewPan] = useState<Point>({ x: 0, y: 0 });
  const [viewZoom, setViewZoom] = useState(1);
  const historyRef = useRef<{ past: AnnotationMark[][]; future: AnnotationMark[][] }>({
    past: [],
    future: [],
  });
  const gestureDirtyRef = useRef(false);
  const suppressNextIdleDraftPublishRef = useRef(false);
  const onDraftChangeRef = useRef(onDraftChange);
  onDraftChangeRef.current = onDraftChange;

  useEffect(() => {
    setMarks(supportedInitialMarks(initialDraft));
    setSelectedMarkId(null);
    setHoveredMarkId(null);
    setDragTarget(null);
    setActiveTool('select');
    setImageAspectRatio(null);
    setViewPan({ x: 0, y: 0 });
    setViewZoom(1);
    gestureDirtyRef.current = false;
    suppressNextIdleDraftPublishRef.current = false;
    historyRef.current = { past: [], future: [] };
    setHistoryRevision((revision) => revision + 1);
  }, [imageUrl]);

  useLayoutEffect(() => {
    if (dragTarget) return;
    if (suppressNextIdleDraftPublishRef.current) {
      suppressNextIdleDraftPublishRef.current = false;
      return;
    }
    onDraftChangeRef.current({
      schemaVersion: 1,
      globalInstruction: instruction,
      marks: structuredClone(marks),
    });
  }, [dragTarget, instruction, marks]);

  useEffect(() => {
    function preventBrowserHistorySwipe(event: globalThis.WheelEvent): void {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('.annotation-stage')) return;
      event.preventDefault();
    }

    window.addEventListener('wheel', preventBrowserHistorySwipe, { capture: true, passive: false });
    return () => window.removeEventListener('wheel', preventBrowserHistorySwipe, true);
  }, []);

  useLayoutEffect(() => {
    const selectedInput = editorRef.current?.querySelector<HTMLInputElement>(
      `.annotation-intent-input[data-mark-id="${selectedMarkId ?? ''}"]`,
    );
    if (selectedInput && selectedInput.value.length === 0) {
      selectedInput.focus();
    }
  }, [selectedMarkId, marks.length]);

  useEffect(() => {
    function updateMetrics(): void {
      setMetrics(readImageDisplayMetrics(stageRef.current, imageRef.current));
    }

    updateMetrics();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMetrics);
    if (stageRef.current) {
      observer?.observe(stageRef.current);
    }
    window.addEventListener('resize', updateMetrics);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateMetrics);
    };
  }, [imageUrl]);

  useEffect(() => {
    function updateStageSize(): void {
      const stageArea = stageAreaRef.current;
      if (!stageArea) return;

      const bounds = stageArea.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return;

      const nextSize = {
        width: Math.max(120, bounds.width),
        height: Math.max(120, bounds.height),
      };
      setStageSize((current) => {
        if (current && Math.abs(current.width - nextSize.width) < 0.5 && Math.abs(current.height - nextSize.height) < 0.5) {
          return current;
        }
        return nextSize;
      });
    }

    updateStageSize();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateStageSize);
    if (stageAreaRef.current) {
      observer?.observe(stageAreaRef.current);
    }
    window.addEventListener('resize', updateStageSize);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', updateStageSize);
    };
  }, []);

  useLayoutEffect(() => {
    setMetrics(readImageDisplayMetrics(stageRef.current, imageRef.current));
  }, [imageAspectRatio, stageSize]);

  const hoveredMark = useMemo(
    () => marks.find((mark) => mark.id === hoveredMarkId),
    [hoveredMarkId, marks],
  );
  const overlayActionMark = useMemo(
    () => marks.find((mark) => mark.id === (hoveredMarkId ?? selectedMarkId)),
    [hoveredMarkId, marks, selectedMarkId],
  );
  const displayedSelectedMarkId = hoveredMarkId ?? selectedMarkId;
  const canRedo = historyRevision >= 0 && historyRef.current.future.length > 0;
  const canUndo = historyRevision >= 0 && historyRef.current.past.length > 0;
  const manifest = useMemo<AnnotationManifest>(
    () => ({ schemaVersion: 1, globalInstruction: instruction, marks }),
    [instruction, marks],
  );
  const compiledInstruction = useMemo(() => compileAnnotationInstruction(manifest), [manifest]);
  const missingIntentIds = useMemo(() => annotationMarksMissingIntent(manifest), [manifest]);
  const canRun = Boolean(
    imageUrl && hasExecutableAnnotationIntent(manifest) && missingIntentIds.length === 0,
  );
  const baseMetrics = metrics;
  const renderMetrics = baseMetrics ? transformImageDisplayMetrics(baseMetrics, viewZoom, viewPan) : null;

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      if (isEditableKeyboardTarget(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (!selectedMarkId) return;
      recordHistory();
      removeMark(selectedMarkId);
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [selectedMarkId, marks]);

  function currentMetrics(): ImageDisplayMetrics | null {
    return metrics ? transformImageDisplayMetrics(metrics, viewZoom, viewPan) : null;
  }

  function stagePoint(event: PointerEvent): Point | null {
    const activeMetrics = currentMetrics();
    if (!activeMetrics) return null;

    const x = (event.clientX - activeMetrics.displayLeft) / activeMetrics.displayWidth;
    const y = (event.clientY - activeMetrics.displayTop) / activeMetrics.displayHeight;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }

  function recordHistory(snapshot: AnnotationMark[] = marks): void {
    historyRef.current = {
      past: [...historyRef.current.past, structuredClone(snapshot)].slice(-80),
      future: [],
    };
    setHistoryRevision((revision) => revision + 1);
  }

  function undoMarks(): void {
    const previous = historyRef.current.past.at(-1);
    if (!previous) return;
    historyRef.current = {
      past: historyRef.current.past.slice(0, -1),
      future: [structuredClone(marks), ...historyRef.current.future].slice(0, 80),
    };
    setMarks(structuredClone(previous));
    setSelectedMarkId(null);
    setHistoryRevision((revision) => revision + 1);
  }

  function redoMarks(): void {
    const next = historyRef.current.future[0];
    if (!next) return;
    historyRef.current = {
      past: [...historyRef.current.past, structuredClone(marks)].slice(-80),
      future: historyRef.current.future.slice(1),
    };
    setMarks(structuredClone(next));
    setSelectedMarkId(null);
    setHistoryRevision((revision) => revision + 1);
  }

  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>): void {
    stopCanvasGesture(event);
    if (!imageUrl || !currentMetrics()) return;

    const point = stagePoint(event);
    const hitMark = point ? hitTestAnnotationMark(marks, point) : undefined;

    if (event.button === 1 || (activeTool === 'select' && viewZoom > 1 && !hitMark)) {
      event.preventDefault();
      safeSetPointerCapture(stageRef.current ?? event.currentTarget, event.pointerId);
      setSelectedMarkId(null);
      gestureDirtyRef.current = false;
      setDragTarget({ type: 'pan', lastClientPoint: { x: event.clientX, y: event.clientY } });
      return;
    }

    if (!point) return;

    if (activeTool === 'select') {
      setSelectedMarkId(null);
      return;
    }

    if (activeTool === 'eraser') {
      if (hitMark) {
        recordHistory();
        removeMark(hitMark.id);
      }
      return;
    }

    const mark = createMark(activeTool, point, defaultMarkColor, strokeSize, marks);
    if (!mark) return;

    recordHistory();
    gestureDirtyRef.current = true;
    safeSetPointerCapture(stageRef.current ?? event.currentTarget, event.pointerId);
    setMarks((current) => [...current, mark]);
    setSelectedMarkId(mark.id);
    setDragTarget({ type: 'draw', markId: mark.id });
  }

  function handleStagePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!dragTarget) {
      const hoveredMark = activeTool === 'select'
        ? eventTargetMarkId(event.target)
        : null;
      setHoveredMarkId((current) => (current === hoveredMark ? current : hoveredMark));
      return;
    }
    stopCanvasGesture(event);

    if (dragTarget.type === 'pan') {
      const dx = event.clientX - dragTarget.lastClientPoint.x;
      const dy = event.clientY - dragTarget.lastClientPoint.y;
      panImageView(dx, dy);
      setDragTarget({ type: 'pan', lastClientPoint: { x: event.clientX, y: event.clientY } });
      return;
    }

    const point = stagePoint(event);
    if (!point) return;

    if (dragTarget.type === 'draw') {
      updateDrawingMark(dragTarget.markId, point);
      return;
    }

    if (dragTarget.type === 'endpoint') {
      if (point.x === dragTarget.lastPoint.x && point.y === dragTarget.lastPoint.y) return;
      markGestureDirty();
      updateMarkEndpoint(dragTarget.markId, dragTarget.endpoint, point);
      setDragTarget({ ...dragTarget, lastPoint: point });
      return;
    }

    const dx = point.x - dragTarget.lastPoint.x;
    const dy = point.y - dragTarget.lastPoint.y;
    if (dx === 0 && dy === 0) return;
    markGestureDirty();
    moveMark(dragTarget.markId, dx, dy);
    setDragTarget({ ...dragTarget, lastPoint: point });
  }

  function handleStagePointerUp(event: PointerEvent<HTMLDivElement>): void {
    stopCanvasGesture(event);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (dragTarget?.type === 'draw') {
      finalizeDrawingMark();
    }
    if (!gestureDirtyRef.current) {
      suppressNextIdleDraftPublishRef.current = true;
    }
    gestureDirtyRef.current = false;
    setDragTarget(null);
  }

  function markGestureDirty(): void {
    if (gestureDirtyRef.current) return;
    recordHistory();
    gestureDirtyRef.current = true;
  }

  function updateDrawingMark(markId: string, point: Point): void {
    setMarks((current) =>
      current.map((mark) => {
        if (mark.id !== markId) return mark;
        if (mark.kind === 'pen' || mark.kind === 'brush') return { ...mark, points: [...mark.points, point] };
        if (mark.kind === 'marker') return mark;
        if (mark.kind === 'arrow' || mark.kind === 'rect' || mark.kind === 'ellipse') {
          return { ...mark, end: point };
        }
        return mark;
      }),
    );
  }

  function updateMarkEndpoint(markId: string, endpoint: EndpointHandle, point: Point): void {
    setMarks((current) =>
      current.map((mark) => {
        if (mark.id !== markId || (mark.kind !== 'arrow' && mark.kind !== 'rect')) return mark;
        if (endpoint === 'start' || endpoint === 'end') return { ...mark, [endpoint]: point };
        if (mark.kind !== 'rect') return mark;
        if (endpoint === 'startXEndY') {
          return { ...mark, start: { ...mark.start, x: point.x }, end: { ...mark.end, y: point.y } };
        }
        return { ...mark, start: { ...mark.start, y: point.y }, end: { ...mark.end, x: point.x } };
      }),
    );
  }

  function finalizeDrawingMark(): void {
    setMarks((current) =>
      current.map((mark) => {
        if (mark.kind === 'arrow' && dragTarget?.type === 'draw' && dragTarget.markId === mark.id && distance(mark.start, mark.end) <= 0.015) {
          return { ...mark, end: defaultArrowEnd(mark.start) };
        }
        return mark;
      }).filter((mark) => {
        if (mark.kind === 'pen' || mark.kind === 'brush') return mark.points.length >= 2;
        if ('start' in mark && 'end' in mark) return distance(mark.start, mark.end) > 0.015;
        return true;
      }),
    );
    if (activeTool !== 'pen' && activeTool !== 'brush') {
      setActiveTool('select');
    }
  }

  function updateSelectedMarkColor(nextColor: MarkColor): void {
    if (!selectedMarkId) return;
    recordHistory();
    setMarks((current) =>
      current.map((mark) => (mark.id === selectedMarkId ? { ...mark, color: nextColor } : mark)),
    );
  }

  function updateSelectedMarkStrokeSize(nextStrokeSize: StrokeSize): void {
    setStrokeSize(nextStrokeSize);
    if (!selectedMarkId) return;
    recordHistory();
    setMarks((current) =>
      current.map((mark) => (mark.id === selectedMarkId ? { ...mark, strokeSize: nextStrokeSize } : mark)),
    );
  }

  function startMoveMark(event: PointerEvent, markId: string): void {
    if (activeTool === 'eraser') {
      stopCanvasGesture(event);
      recordHistory();
      removeMark(markId);
      return;
    }
    stopCanvasGesture(event);
    const point = stagePoint(event);
    if (!point) return;

    safeSetPointerCapture(stageRef.current ?? event.currentTarget, event.pointerId);
    gestureDirtyRef.current = false;
    selectExistingMark(markId);
    setDragTarget({ type: 'move', markId, lastPoint: point });
  }

  function startEndpointDrag(event: PointerEvent, markId: string, endpoint: EndpointHandle): void {
    stopCanvasGesture(event);
    const point = stagePoint(event);
    if (!point) return;
    safeSetPointerCapture(stageRef.current ?? event.currentTarget, event.pointerId);
    gestureDirtyRef.current = false;
    selectExistingMark(markId);
    setDragTarget({ type: 'endpoint', markId, endpoint, lastPoint: point });
  }

  function selectExistingMark(markId: string): void {
    const mark = marks.find((candidate) => candidate.id === markId);
    setSelectedMarkId(markId);
    if (!mark) return;
    setStrokeSize(mark.strokeSize);
  }

  function selectMarkFromList(markId: string): void {
    selectExistingMark(markId);
    if (viewZoom <= 1 || !metrics) return;

    const mark = marks.find((candidate) => candidate.id === markId);
    if (!mark) return;

    const focus = annotationMarkFocusPoint(mark);
    const nextPan = {
      x: (metrics.stageLeft + metrics.stageRight) / 2
        - metrics.displayLeft
        - focus.x * metrics.displayWidth * viewZoom,
      y: (metrics.stageTop + metrics.stageBottom) / 2
        - metrics.displayTop
        - focus.y * metrics.displayHeight * viewZoom,
    };
    setViewPan(clampImageViewPan(metrics, viewZoom, nextPan));
  }

  function moveMark(markId: string, dx: number, dy: number): void {
    setMarks((current) =>
      current.map((mark) => (mark.id === markId ? translateAnnotationMark(mark, dx, dy) : mark)),
    );
  }

  function updateMarkIntent(markId: string, intent: string): void {
    setMarks((current) =>
      current.map((mark) => {
        if (mark.id !== markId) return mark;
        return { ...mark, intent };
      }),
    );
  }

  function removeMark(markId: string): void {
    const nextMarks = marks.filter((mark) => mark.id !== markId);
    setMarks(nextMarks);
    setSelectedMarkId((current) => (current === markId ? null : current));
    setHoveredMarkId((current) => (current === markId ? null : current));
  }

  function removeMarkFromOverlay(event: PointerEvent, markId: string): void {
    stopCanvasGesture(event);
    recordHistory();
    removeMark(markId);
  }

  function clearAnnotationDraft(): void {
    if (marks.length === 0 && !instruction.trim()) return;
    if (!window.confirm(t('context.clearAnnotationDraftConfirm'))) return;
    setMarks([]);
    onInstructionChange('');
    setSelectedMarkId(null);
    historyRef.current = { past: [], future: [] };
    setHistoryRevision((revision) => revision + 1);
  }

  function handleStageWheel(event: WheelEvent<HTMLDivElement>): void {
    stopCanvasGesture(event);
    zoomImageView(event.clientX, event.clientY, viewZoom * Math.exp(-event.deltaY * 0.0014));
  }

  function zoomImageView(clientX: number, clientY: number, requestedZoom: number): void {
    const currentBaseMetrics = metrics;
    if (!currentBaseMetrics) return;

    const nextZoom = clamp(requestedZoom, 1, 5);
    const currentMetrics = transformImageDisplayMetrics(currentBaseMetrics, viewZoom, viewPan);
    const anchor = {
      x: clamp((clientX - currentMetrics.displayLeft) / currentMetrics.displayWidth, 0, 1),
      y: clamp((clientY - currentMetrics.displayTop) / currentMetrics.displayHeight, 0, 1),
    };
    const nextPan = {
      x: clientX - currentBaseMetrics.displayLeft - anchor.x * currentBaseMetrics.displayWidth * nextZoom,
      y: clientY - currentBaseMetrics.displayTop - anchor.y * currentBaseMetrics.displayHeight * nextZoom,
    };

    setViewZoom(nextZoom);
    setViewPan(clampImageViewPan(currentBaseMetrics, nextZoom, nextPan));
  }

  function panImageView(dx: number, dy: number): void {
    const currentBaseMetrics = metrics;
    if (!currentBaseMetrics || viewZoom <= 1) return;
    setViewPan((current) => clampImageViewPan(currentBaseMetrics, viewZoom, { x: current.x + dx, y: current.y + dy }));
  }

  function resetImageView(): void {
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  }

  async function runAnnotationEdit(): Promise<void> {
    if (!imageUrl) return;
    const manifestSnapshot = annotationManifestFromDraft(manifest);
    const composite = await createAnnotatedComposite(imageUrl, marks);
    onRun({ instruction: compiledInstruction, manifest: manifestSnapshot, composite });
  }

  return (
    <div
      ref={editorRef}
      className="annotation-editor nodrag nopan nowheel"
      onPointerDown={stopCanvasGesture}
      onWheel={stopWheelGesture}
      onDoubleClick={stopCanvasGesture}
    >
      <div className="annotation-editor-shell">
        <AnnotationToolStrip
          activeTool={activeTool}
          canRedo={canRedo}
          canUndo={canUndo}
          onActiveToolChange={setActiveTool}
          onClear={clearAnnotationDraft}
          onRedo={redoMarks}
          onUndo={undoMarks}
        />

        <div ref={stageAreaRef} className="annotation-stage-column">
          <div
            ref={stageRef}
            className={`annotation-stage nodrag nopan nowheel is-${activeTool}-tool${dragTarget?.type === 'pan' ? ' is-panning' : ''}${dragTarget?.type === 'move' ? ' is-moving-mark' : ''}${dragTarget?.type === 'endpoint' ? ' is-resizing-mark' : ''}${viewZoom > 1 ? ' is-zoomed' : ''}`}
            style={annotationStageStyle(imageAspectRatio, stageSize)}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handleStagePointerMove}
            onPointerUp={handleStagePointerUp}
            onPointerCancel={handleStagePointerUp}
            onPointerLeave={() => {
              if (!dragTarget) setHoveredMarkId(null);
            }}
            onWheelCapture={handleStageWheel}
          >
            {imageUrl ? (
              <img
                ref={imageRef}
                className="annotation-source-image"
                src={imageUrl}
                alt={title}
                draggable={false}
                style={renderMetrics ? overlayStyle(renderMetrics) : undefined}
                onDragStart={(event) => event.preventDefault()}
                onLoad={() => {
                  const image = imageRef.current;
                  if (image?.naturalWidth && image.naturalHeight) {
                    setImageAspectRatio(image.naturalWidth / image.naturalHeight);
                  }
                  setMetrics(readImageDisplayMetrics(stageRef.current, imageRef.current));
                }}
              />
            ) : (
              <div className="annotation-stage-placeholder">{unavailableLabel}</div>
            )}
            {imageUrl && renderMetrics ? (
              <svg
                className="annotation-overlay nodrag nopan nowheel"
                style={overlayStyle(renderMetrics)}
                viewBox="0 0 1 1"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <defs>
                  {colorOptions.map((option) => (
                    <marker
                      key={option}
                      id={`annotation-arrowhead-${option.slice(1)}`}
                      markerHeight="7"
                      markerWidth="7"
                      orient="auto"
                      refX="6"
                      refY="3.5"
                    >
                      <path d="M0,0 L7,3.5 L0,7 Z" fill={option} />
                    </marker>
                  ))}
                </defs>
                {marks.map((mark) => (
                  <AnnotationSvgMark
                    key={mark.id}
                    mark={mark}
                    selected={mark.id === selectedMarkId || mark.id === hoveredMarkId}
                    fixedShapeYScale={renderMetrics.displayWidth / renderMetrics.displayHeight}
                    brushStrokeWidth={annotationBrushStrokeWidthPixels(
                      mark.strokeSize,
                      renderMetrics.displayWidth,
                      renderMetrics.displayHeight,
                    )}
                    onPointerDown={(event) => startMoveMark(event, mark.id)}
                    onEndpointPointerDown={(event, endpoint) => startEndpointDrag(event, mark.id, endpoint)}
                  />
                ))}
                {marks.map((mark) => (
                  <AnnotationIdBadge
                    key={`badge-${mark.id}`}
                    mark={mark}
                    selected={mark.id === selectedMarkId || mark.id === hoveredMarkId}
                    fixedShapeYScale={renderMetrics.displayWidth / renderMetrics.displayHeight}
                    onPointerDown={(event) => startMoveMark(event, mark.id)}
                  />
                ))}
                {overlayActionMark ? (
                  <AnnotationQuickDelete
                    fixedShapeYScale={renderMetrics.displayWidth / renderMetrics.displayHeight}
                    mark={overlayActionMark}
                    onPointerDown={(event) => removeMarkFromOverlay(event, overlayActionMark.id)}
                  />
                ) : null}
              </svg>
            ) : null}
            {hoveredMark?.intent.trim() && renderMetrics ? (
              <div
                className={`annotation-hover-prompt ${annotationHoverPromptPlacement(hoveredMark)}`}
                style={annotationHoverPromptStyle(hoveredMark, renderMetrics)}
                role="tooltip"
              >
                <strong>{hoveredMark.id}</strong>
                <span>{hoveredMark.intent.trim()}</span>
              </div>
            ) : null}
            {imageUrl ? (
              <div className="annotation-zoom-controls nowheel" onPointerDown={stopCanvasGesture} onWheel={stopWheelGesture} onWheelCapture={stopWheelGesture}>
                <TooltipIconButton label={t('toolbar.zoomOut')} onClick={() => zoomImageView(metricsStageCenterX(metrics), metricsStageCenterY(metrics), viewZoom / 1.2)}>
                  <ZoomOut size={14} />
                </TooltipIconButton>
                <span>{Math.round(viewZoom * 100)}%</span>
                <TooltipIconButton label={t('toolbar.zoomIn')} onClick={() => zoomImageView(metricsStageCenterX(metrics), metricsStageCenterY(metrics), viewZoom * 1.2)}>
                  <ZoomIn size={14} />
                </TooltipIconButton>
                <TooltipIconButton label={t('toolbar.fitView')} onClick={resetImageView}>
                  <Maximize2 size={14} />
                </TooltipIconButton>
              </div>
            ) : null}
          </div>
        </div>

        <AnnotationSidePanel
          colors={colorOptions}
          compiledInstruction={compiledInstruction}
          displayedSelectedMarkId={displayedSelectedMarkId}
          instruction={instruction}
          marks={marks}
          missingIntentIds={missingIntentIds}
          selectedMarkId={selectedMarkId}
          strokeSize={strokeSize}
          onDeleteMark={(markId) => {
            recordHistory();
            removeMark(markId);
          }}
          onInstructionChange={onInstructionChange}
          onMarkFocus={selectExistingMark}
          onMarkIntentChange={updateMarkIntent}
          onMarkSelect={selectMarkFromList}
          onSelectedMarkColorChange={updateSelectedMarkColor}
          onStrokeSizeChange={updateSelectedMarkStrokeSize}
        />
      </div>

      <button
        type="button"
        className="primary-popover-button"
        disabled={!canRun}
        onClick={() => void runAnnotationEdit()}
      >
        {runLabel}
      </button>
    </div>
  );
}

function createMark(
  tool: AnnotationTool,
  point: Point,
  color: MarkColor,
  strokeSize: StrokeSize,
  marks: AnnotationMark[],
): AnnotationMark | null {
  if (tool === 'select' || tool === 'eraser') return null;
  const id = nextAnnotationMarkId(marks, tool);
  const base = { id, color, strokeSize, intent: '' };
  if (tool === 'marker') return { ...base, kind: 'marker', point };
  if (tool === 'arrow') return { ...base, kind: 'arrow', start: point, end: point };
  if (tool === 'pen' || tool === 'brush') return { ...base, kind: tool, points: [point] };
  if (tool === 'rect') return { ...base, kind: 'rect', start: point, end: point };
  if (tool === 'ellipse') return { ...base, kind: 'ellipse', start: point, end: point };
  return null;
}

function supportedInitialMarks(draft: AnnotationDraft | undefined): AnnotationMark[] {
  if (!Array.isArray(draft?.marks)) return [];
  const supported = draft.marks.filter((mark) => supportedMarkKinds.has(mark.kind));
  return structuredClone(supported);
}

function eventTargetMarkId(target: EventTarget): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest('[data-annotation-mark-id]')?.getAttribute('data-annotation-mark-id') ?? null;
}

function overlayStyle(metrics: ImageDisplayMetrics): CSSProperties {
  return {
    left: metrics.displayLeft - metrics.stageLeft,
    top: metrics.displayTop - metrics.stageTop,
    width: metrics.displayWidth,
    height: metrics.displayHeight,
  };
}

function annotationHoverPromptStyle(mark: AnnotationMark, metrics: ImageDisplayMetrics): CSSProperties {
  const anchor = annotationMarkFocusPoint(mark);
  return {
    left: metrics.displayLeft - metrics.stageLeft + anchor.x * metrics.displayWidth,
    top: metrics.displayTop - metrics.stageTop + anchor.y * metrics.displayHeight,
  };
}

function annotationHoverPromptPlacement(mark: AnnotationMark): string {
  const anchor = annotationMarkFocusPoint(mark);
  const horizontal = anchor.x > 0.62 ? 'is-left' : 'is-right';
  if (anchor.y < 0.18) return `${horizontal} is-below`;
  if (anchor.y > 0.82) return `${horizontal} is-above`;
  return `${horizontal} is-centered`;
}

function annotationStageStyle(
  imageAspectRatio: number | null,
  stageSize: { width: number; height: number } | null,
): CSSProperties {
  if (!imageAspectRatio && !stageSize) return {};
  return {
    '--annotation-aspect': imageAspectRatio ?? 1.6,
    '--annotation-aspect-ratio': imageAspectRatio ?? 1.6,
    ...(stageSize ? { width: stageSize.width, height: stageSize.height } : {}),
  } as CSSProperties;
}

function stopCanvasGesture(
  event: PointerEvent | WheelEvent | MouseEvent | KeyboardEvent,
): void {
  event.stopPropagation();
}

function stopWheelGesture(event: WheelEvent): void {
  event.stopPropagation();
}

function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function safeSetPointerCapture(target: Element, pointerId: number): void {
  try {
    target.setPointerCapture?.(pointerId);
  } catch (_error) {
    // Synthetic pointer events and some embedded hosts may not expose an active
    // pointer at handler time. Drawing still works without capture while the
    // pointer remains over the annotation stage.
  }
}
