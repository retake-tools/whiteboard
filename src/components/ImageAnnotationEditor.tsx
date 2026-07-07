import {
  ArrowUpRight,
  Circle,
  Eraser,
  Maximize2,
  MousePointer2,
  PenLine,
  RectangleHorizontal,
  RotateCcw,
  Redo2,
  Trash2,
  Type,
  Undo2,
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
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

export interface AnnotationComposite {
  dataUrl: string;
  width: number;
  height: number;
}

interface ImageAnnotationEditorProps {
  imageUrl?: string;
  instruction: string;
  placeholder: string;
  runLabel: string;
  title: string;
  unavailableLabel: string;
  onInstructionChange: (instruction: string) => void;
  onRun: (input: { instruction: string; composite: AnnotationComposite }) => void;
}

type AnnotationTool = 'select' | 'arrow' | 'pen' | 'rect' | 'ellipse' | 'text' | 'eraser';
type MarkKind = 'arrow' | 'pen' | 'rect' | 'ellipse' | 'text';
type StrokeSize = 'xs' | 's' | 'm' | 'l' | 'xl';

const colorOptions = [
  '#111827',
  '#64748b',
  '#dc2626',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#2563eb',
  '#a855f7',
  '#ec4899',
] as const;

type MarkColor = (typeof colorOptions)[number];

interface BaseMark {
  id: string;
  kind: MarkKind;
  color: MarkColor;
  strokeSize: StrokeSize;
}

interface ArrowMark extends BaseMark {
  kind: 'arrow';
  start: Point;
  end: Point;
  text: string;
}

interface PenMark extends BaseMark {
  kind: 'pen';
  points: Point[];
}

interface RectMark extends BaseMark {
  kind: 'rect';
  start: Point;
  end: Point;
}

interface EllipseMark extends BaseMark {
  kind: 'ellipse';
  start: Point;
  end: Point;
}

interface TextMark extends BaseMark {
  kind: 'text';
  point: Point;
  text: string;
}

type AnnotationMark = ArrowMark | PenMark | RectMark | EllipseMark | TextMark;
type DragTarget =
  | { type: 'draw'; markId: string }
  | { type: 'endpoint'; markId: string; endpoint: 'start' | 'end' }
  | { type: 'move'; markId: string; lastPoint: Point }
  | { type: 'pan'; lastClientPoint: Point }
  | null;

interface Point {
  x: number;
  y: number;
}

interface ImageDisplayMetrics {
  naturalWidth: number;
  naturalHeight: number;
  displayLeft: number;
  displayTop: number;
  displayWidth: number;
  displayHeight: number;
}

const strokeOptions: StrokeSize[] = ['xs', 's', 'm', 'l'];

const strokeBySize = {
  xs: 0.8,
  s: 1.2,
  m: 1.8,
  l: 2.8,
  xl: 4,
} satisfies Record<StrokeSize, number>;

const endpointHandleRadiusBySize = {
  xs: 0.009,
  s: 0.011,
  m: 0.013,
  l: 0.016,
  xl: 0.019,
} satisfies Record<StrokeSize, number>;

export function ImageAnnotationEditor({
  imageUrl,
  instruction,
  placeholder,
  runLabel,
  title,
  unavailableLabel,
  onInstructionChange,
  onRun,
}: ImageAnnotationEditorProps): ReactElement {
  const { t } = useI18n();
  const stageAreaRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [activeTool, setActiveTool] = useState<AnnotationTool>('select');
  const [selectedMarkId, setSelectedMarkId] = useState<string | null>(null);
  const [editingTextMarkId, setEditingTextMarkId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [marks, setMarks] = useState<AnnotationMark[]>([]);
  const [color, setColor] = useState<MarkColor>('#dc2626');
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

  useEffect(() => {
    setMarks([]);
    setSelectedMarkId(null);
    setEditingTextMarkId(null);
    setDragTarget(null);
    setActiveTool('select');
    setImageAspectRatio(null);
    setViewPan({ x: 0, y: 0 });
    setViewZoom(1);
    historyRef.current = { past: [], future: [] };
    setHistoryRevision((revision) => revision + 1);
  }, [imageUrl]);

  useEffect(() => {
    function preventBrowserHistorySwipe(event: globalThis.WheelEvent): void {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest('.annotation-editor')) return;
      event.preventDefault();
    }

    window.addEventListener('wheel', preventBrowserHistorySwipe, { capture: true, passive: false });
    return () => window.removeEventListener('wheel', preventBrowserHistorySwipe, true);
  }, []);

  useLayoutEffect(() => {
    const selectedInput = stageRef.current?.querySelector<HTMLInputElement>(
      `.annotation-label-input[data-mark-id="${selectedMarkId ?? ''}"]`,
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

  const selectedMark = useMemo(
    () => marks.find((mark) => mark.id === selectedMarkId),
    [marks, selectedMarkId],
  );
  const canRedo = historyRevision >= 0 && historyRef.current.future.length > 0;
  const canUndo = historyRevision >= 0 && historyRef.current.past.length > 0;
  const canRun = Boolean(imageUrl && (marks.length > 0 || instruction.trim()));
  const baseMetrics = readImageDisplayMetrics(stageRef.current, imageRef.current) ?? metrics;
  const renderMetrics = baseMetrics ? transformImageDisplayMetrics(baseMetrics, viewZoom, viewPan) : null;

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent): void {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const shouldKeepEditingText =
        isEditableKeyboardTarget(event.target) &&
        !(isAnnotationLabelInput(event.target) && editingTextMarkId !== selectedMarkId);
      if (shouldKeepEditingText) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (!selectedMarkId) return;
      recordHistory();
      removeMark(selectedMarkId);
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [editingTextMarkId, selectedMarkId, marks]);

  function currentMetrics(): ImageDisplayMetrics | null {
    const currentBaseMetrics = readImageDisplayMetrics(stageRef.current, imageRef.current) ?? metrics;
    return currentBaseMetrics ? transformImageDisplayMetrics(currentBaseMetrics, viewZoom, viewPan) : null;
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
    onInstructionChange(marksToInstruction(previous));
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
    onInstructionChange(marksToInstruction(next));
    setHistoryRevision((revision) => revision + 1);
  }

  function handleStagePointerDown(event: PointerEvent<HTMLDivElement>): void {
    stopCanvasGesture(event);
    if (!imageUrl || !currentMetrics()) return;

    const point = stagePoint(event);
    const hitMark = point ? hitTestMark(marks, point) : undefined;

    if (event.button === 1 || (activeTool === 'select' && viewZoom > 1 && !hitMark)) {
      event.preventDefault();
      safeSetPointerCapture(stageRef.current ?? event.currentTarget, event.pointerId);
      setSelectedMarkId(null);
      setEditingTextMarkId(null);
      setDragTarget({ type: 'pan', lastClientPoint: { x: event.clientX, y: event.clientY } });
      return;
    }

    if (!point) return;

    if (activeTool === 'select') {
      setSelectedMarkId(null);
      setEditingTextMarkId(null);
      return;
    }

    if (activeTool === 'eraser') {
      if (hitMark) {
        recordHistory();
        removeMark(hitMark.id);
      }
      return;
    }

    const mark = createMark(activeTool, point, color, strokeSize);
    if (!mark) return;

    recordHistory();
    safeSetPointerCapture(stageRef.current ?? event.currentTarget, event.pointerId);
    setMarks((current) => [...current, mark]);
    setSelectedMarkId(mark.id);
    setEditingTextMarkId(mark.kind === 'text' ? mark.id : null);
    setDragTarget({ type: 'draw', markId: mark.id });
  }

  function handleStageDoubleClick(event: MouseEvent<HTMLDivElement>): void {
    stopCanvasGesture(event);
    const activeMetrics = currentMetrics();
    if (!imageUrl || !activeMetrics) return;

    const point = mouseStagePoint(event, activeMetrics);
    if (!point) return;
    const mark = createMark('text', point, color, strokeSize);
    if (!mark) return;

    recordHistory();
    setMarks((current) => [...current, mark]);
    setSelectedMarkId(mark.id);
    setEditingTextMarkId(mark.id);
    setActiveTool('select');
  }

  function handleStagePointerMove(event: PointerEvent<HTMLDivElement>): void {
    if (!dragTarget) return;
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
      updateArrowEndpoint(dragTarget.markId, dragTarget.endpoint, point);
      return;
    }

    const dx = point.x - dragTarget.lastPoint.x;
    const dy = point.y - dragTarget.lastPoint.y;
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
    setDragTarget(null);
  }

  function updateDrawingMark(markId: string, point: Point): void {
    setMarks((current) =>
      current.map((mark) => {
        if (mark.id !== markId) return mark;
        if (mark.kind === 'pen') return { ...mark, points: [...mark.points, point] };
        if (mark.kind === 'text') return mark;
        if (mark.kind === 'arrow' || mark.kind === 'rect' || mark.kind === 'ellipse') {
          return { ...mark, end: point };
        }
        return mark;
      }),
    );
  }

  function updateArrowEndpoint(markId: string, endpoint: 'start' | 'end', point: Point): void {
    setMarks((current) =>
      current.map((mark) => {
        if (mark.id !== markId || mark.kind !== 'arrow') return mark;
        return { ...mark, [endpoint]: point };
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
        if (mark.kind === 'text') return true;
        if (mark.kind === 'pen') return mark.points.length >= 2;
        if ('start' in mark && 'end' in mark) return distance(mark.start, mark.end) > 0.015;
        return true;
      }),
    );
    if (activeTool !== 'pen') {
      setActiveTool('select');
    }
  }

  function updateSelectedMarkColor(nextColor: MarkColor): void {
    setColor(nextColor);
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
    recordHistory();
    selectExistingMark(markId, { editing: false });
    setDragTarget({ type: 'move', markId, lastPoint: point });
  }

  function startTextMarkPointerDown(event: PointerEvent<HTMLInputElement>, markId: string): void {
    if (activeTool === 'eraser') {
      stopCanvasGesture(event);
      recordHistory();
      removeMark(markId);
      return;
    }

    if (activeTool === 'select') {
      event.preventDefault();
      startMoveMark(event, markId);
      return;
    }

    stopCanvasGesture(event);
    selectExistingMark(markId, { editing: activeTool === 'text' });
  }

  function editTextMark(event: MouseEvent<HTMLInputElement>, markId: string): void {
    stopCanvasGesture(event);
    selectExistingMark(markId, { editing: true });
    event.currentTarget.focus();
    event.currentTarget.select();
  }

  function startArrowEndpointDrag(event: PointerEvent, markId: string, endpoint: 'start' | 'end'): void {
    stopCanvasGesture(event);
    recordHistory();
    safeSetPointerCapture(stageRef.current ?? event.currentTarget, event.pointerId);
    selectExistingMark(markId, { editing: false });
    setDragTarget({ type: 'endpoint', markId, endpoint });
  }

  function selectExistingMark(markId: string, options: { editing: boolean }): void {
    const mark = marks.find((candidate) => candidate.id === markId);
    setSelectedMarkId(markId);
    setEditingTextMarkId(options.editing && mark?.kind === 'text' ? markId : null);
    if (!mark) return;
    setColor(mark.color);
    setStrokeSize(mark.strokeSize);
  }

  function moveMark(markId: string, dx: number, dy: number): void {
    setMarks((current) =>
      current.map((mark) => (mark.id === markId ? translateMark(mark, dx, dy) : mark)),
    );
  }

  function updateMarkText(markId: string, text: string): void {
    setMarks((current) =>
      current.map((mark) => {
        if (mark.id !== markId) return mark;
        if (mark.kind === 'arrow' || mark.kind === 'text') return { ...mark, text };
        return mark;
      }),
    );
    const noteSummary = marksToInstruction(
      marks.map((mark) => {
        if (mark.id !== markId) return mark;
        if (mark.kind === 'arrow' || mark.kind === 'text') return { ...mark, text };
        return mark;
      }),
    );
    onInstructionChange(noteSummary);
  }

  function removeMark(markId: string): void {
    const nextMarks = marks.filter((mark) => mark.id !== markId);
    setMarks(nextMarks);
    setSelectedMarkId((current) => (current === markId ? null : current));
    setEditingTextMarkId((current) => (current === markId ? null : current));
    onInstructionChange(marksToInstruction(nextMarks));
  }

  function clearMarks(): void {
    if (marks.length === 0) return;
    if (!window.confirm(t('context.clearMarksConfirm'))) return;
    recordHistory();
    setMarks([]);
    setSelectedMarkId(null);
    setEditingTextMarkId(null);
    onInstructionChange('');
  }

  function handleStageWheel(event: WheelEvent<HTMLDivElement>): void {
    stopCanvasGesture(event);
    zoomImageView(event.clientX, event.clientY, viewZoom * Math.exp(-event.deltaY * 0.0014));
  }

  function zoomImageView(clientX: number, clientY: number, requestedZoom: number): void {
    const currentBaseMetrics = readImageDisplayMetrics(stageRef.current, imageRef.current) ?? metrics;
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
    setViewPan(clampImageViewPan(currentBaseMetrics, nextZoom, nextPan, stageRef.current));
  }

  function panImageView(dx: number, dy: number): void {
    const currentBaseMetrics = readImageDisplayMetrics(stageRef.current, imageRef.current) ?? metrics;
    if (!currentBaseMetrics || viewZoom <= 1) return;
    setViewPan((current) => clampImageViewPan(currentBaseMetrics, viewZoom, { x: current.x + dx, y: current.y + dy }, stageRef.current));
  }

  function resetImageView(): void {
    setViewZoom(1);
    setViewPan({ x: 0, y: 0 });
  }

  async function runAnnotationEdit(): Promise<void> {
    if (!imageUrl) return;
    const composite = await createAnnotatedComposite(imageUrl, marks);
    onRun({ instruction: marksToInstruction(marks) || instruction, composite });
  }

  return (
    <div
      className="annotation-editor nodrag nopan nowheel"
      onPointerDown={stopCanvasGesture}
      onWheel={stopWheelGesture}
      onDoubleClick={stopCanvasGesture}
    >
      <div className="annotation-editor-shell">
        <div className="annotation-tool-strip" aria-label={t('context.annotationTools')}>
          <ToolButton active={activeTool === 'select'} label={t('context.selectMarkTool')} onClick={() => setActiveTool('select')}>
            <MousePointer2 size={15} />
          </ToolButton>
          <ToolButton active={activeTool === 'arrow'} label={t('context.arrowTool')} onClick={() => setActiveTool('arrow')}>
            <ArrowUpRight size={15} />
          </ToolButton>
          <ToolButton active={activeTool === 'pen'} label={t('context.penTool')} onClick={() => setActiveTool('pen')}>
            <PenLine size={15} />
          </ToolButton>
          <ToolButton active={activeTool === 'rect'} label={t('context.rectangleTool')} onClick={() => setActiveTool('rect')}>
            <RectangleHorizontal size={15} />
          </ToolButton>
          <ToolButton active={activeTool === 'ellipse'} label={t('context.ellipseTool')} onClick={() => setActiveTool('ellipse')}>
            <Circle size={15} />
          </ToolButton>
          <ToolButton active={activeTool === 'text'} label={t('context.textMarkTool')} onClick={() => setActiveTool('text')}>
            <Type size={15} />
          </ToolButton>
          <ToolButton active={activeTool === 'eraser'} label={t('context.eraserTool')} onClick={() => setActiveTool('eraser')}>
            <Eraser size={15} />
          </ToolButton>
          <ToolButton disabled={!canUndo} label={t('context.undoAnnotation')} onClick={undoMarks}>
            <Undo2 size={15} />
          </ToolButton>
          <ToolButton disabled={!canRedo} label={t('context.redoAnnotation')} onClick={redoMarks}>
            <Redo2 size={15} />
          </ToolButton>
          <ToolButton label={t('context.clearMarks')} onClick={clearMarks}>
            <RotateCcw size={15} />
          </ToolButton>
        </div>

        <div ref={stageAreaRef} className="annotation-stage-column">
          <div
            ref={stageRef}
            className={`annotation-stage nodrag nopan nowheel is-${activeTool}-tool${dragTarget?.type === 'pan' ? ' is-panning' : ''}${viewZoom > 1 ? ' is-zoomed' : ''}`}
            style={annotationStageStyle(imageAspectRatio, stageSize)}
            onPointerDown={handleStagePointerDown}
            onPointerMove={handleStagePointerMove}
            onPointerUp={handleStagePointerUp}
            onPointerCancel={handleStagePointerUp}
            onDoubleClick={handleStageDoubleClick}
            onWheelCapture={handleStageWheel}
          >
            {imageUrl ? (
              <img
                ref={imageRef}
                className="annotation-source-image"
                src={imageUrl}
                alt={title}
                draggable={false}
                style={renderMetrics ? overlayStyle(renderMetrics, stageRef.current) : undefined}
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
                style={overlayStyle(renderMetrics, stageRef.current)}
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
                    selected={mark.id === selectedMarkId}
                    onPointerDown={(event) => startMoveMark(event, mark.id)}
                    onEndpointPointerDown={(event, endpoint) => startArrowEndpointDrag(event, mark.id, endpoint)}
                  />
                ))}
              </svg>
            ) : null}
            {imageUrl && renderMetrics
              ? marks.map((mark) =>
                  mark.kind === 'text' ? (
                    <input
                      key={mark.id}
                      data-mark-id={mark.id}
                      className={`annotation-label-input nodrag nopan${mark.id === selectedMarkId ? ' is-selected' : ''}${mark.id === editingTextMarkId ? ' is-editing' : ''}`}
                      placeholder={placeholder}
                      readOnly={editingTextMarkId !== mark.id}
                      style={labelStyle(mark, renderMetrics, stageRef.current)}
                      value={mark.text}
                      onChange={(event) => updateMarkText(mark.id, event.target.value)}
                      onDoubleClick={(event) => editTextMark(event, mark.id)}
                      onFocus={() => {
                        if (activeTool === 'text' || editingTextMarkId === mark.id) {
                          selectExistingMark(mark.id, { editing: true });
                          return;
                        }
                        selectExistingMark(mark.id, { editing: false });
                      }}
                      onBlur={() => {
                        setEditingTextMarkId((current) => (current === mark.id ? null : current));
                      }}
                      onKeyDown={stopCanvasGesture}
                      onPointerDown={(event) => startTextMarkPointerDown(event, mark.id)}
                      onWheel={stopWheelGesture}
                      onWheelCapture={stopWheelGesture}
                    />
                  ) : null,
                )
              : null}
            {imageUrl ? (
              <div className="annotation-zoom-controls nowheel" onPointerDown={stopCanvasGesture} onWheel={stopWheelGesture} onWheelCapture={stopWheelGesture}>
                <TooltipIconButton label={t('toolbar.zoomOut')} onClick={() => zoomImageView(stageCenterX(stageRef.current), stageCenterY(stageRef.current), viewZoom / 1.2)}>
                  <ZoomOut size={14} />
                </TooltipIconButton>
                <span>{Math.round(viewZoom * 100)}%</span>
                <TooltipIconButton label={t('toolbar.zoomIn')} onClick={() => zoomImageView(stageCenterX(stageRef.current), stageCenterY(stageRef.current), viewZoom * 1.2)}>
                  <ZoomIn size={14} />
                </TooltipIconButton>
                <TooltipIconButton label={t('toolbar.fitView')} onClick={resetImageView}>
                  <Maximize2 size={14} />
                </TooltipIconButton>
              </div>
            ) : null}
          </div>
        </div>

        <div className="annotation-side-panel">
          <div className="annotation-control-group">
            <span>{t('context.markColor')}</span>
            <div className="annotation-swatch-row">
              {colorOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`annotation-swatch${color === option ? ' is-active' : ''}`}
                  style={{ background: option }}
                  aria-label={option}
                  onClick={() => updateSelectedMarkColor(option)}
                />
              ))}
            </div>
          </div>
          <div className="annotation-control-group">
            <span>{t('context.strokeSize')}</span>
            <div className="annotation-size-row">
              {strokeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={strokeSize === option ? 'is-active' : ''}
                  onClick={() => updateSelectedMarkStrokeSize(option)}
                >
                  {option.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
          {selectedMark ? (
            <button
              type="button"
              className="secondary-popover-button"
              onClick={() => {
                recordHistory();
                removeMark(selectedMark.id);
              }}
            >
              <Trash2 size={13} />
              {t('context.deleteMark')}
            </button>
          ) : null}
        </div>
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

function AnnotationSvgMark({
  mark,
  onEndpointPointerDown,
  onPointerDown,
  selected,
}: {
  mark: AnnotationMark;
  onEndpointPointerDown: (event: PointerEvent, endpoint: 'start' | 'end') => void;
  onPointerDown: (event: PointerEvent) => void;
  selected: boolean;
}): ReactElement | null {
  const strokeWidth = strokeBySize[mark.strokeSize] / 420;
  const className = `annotation-svg-mark${selected ? ' is-selected' : ''}`;

  if (mark.kind === 'arrow') {
    const handleRadius = endpointHandleRadiusBySize[mark.strokeSize];
    const handleStrokeWidth = Math.max(strokeWidth * 1.6, 0.003);

    return (
      <g className={className} onPointerDown={onPointerDown}>
        <line
          x1={mark.start.x}
          x2={mark.end.x}
          y1={mark.start.y}
          y2={mark.end.y}
          stroke={mark.color}
          strokeLinecap="round"
          strokeWidth={strokeWidth}
          markerEnd={`url(#annotation-arrowhead-${mark.color.slice(1)})`}
        />
        <line
          x1={mark.start.x}
          x2={mark.end.x}
          y1={mark.start.y}
          y2={mark.end.y}
          className="annotation-line-hitbox"
          pointerEvents="stroke"
          vectorEffect="non-scaling-stroke"
        />
        {selected ? (
          <>
            <path
              className="annotation-endpoint-handle"
              d={diamondPath(mark.start, handleRadius)}
              fill="#ffffff"
              stroke={mark.color}
              strokeWidth={handleStrokeWidth}
              onPointerDown={(event) => onEndpointPointerDown(event, 'start')}
            />
            <path
              className="annotation-endpoint-handle"
              d={diamondPath(mark.end, handleRadius)}
              fill="#ffffff"
              stroke={mark.color}
              strokeWidth={handleStrokeWidth}
              onPointerDown={(event) => onEndpointPointerDown(event, 'end')}
            />
          </>
        ) : null}
      </g>
    );
  }

  if (mark.kind === 'pen') {
    return (
      <polyline
        className={className}
        points={mark.points.map((point) => `${point.x},${point.y}`).join(' ')}
        fill="none"
        stroke={mark.color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
        onPointerDown={onPointerDown}
      />
    );
  }

  if (mark.kind === 'rect' || mark.kind === 'ellipse') {
    const bounds = normalizedBounds(mark.start, mark.end);
    if (mark.kind === 'ellipse') {
      return (
        <ellipse
          className={className}
          cx={bounds.x + bounds.width / 2}
          cy={bounds.y + bounds.height / 2}
          rx={bounds.width / 2}
          ry={bounds.height / 2}
          fill="transparent"
          stroke={mark.color}
          strokeWidth={strokeWidth}
          onPointerDown={onPointerDown}
        />
      );
    }

    return (
      <rect
        className={className}
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill="transparent"
        stroke={mark.color}
        strokeWidth={strokeWidth}
        onPointerDown={onPointerDown}
      />
    );
  }

  return null;
}

function ToolButton({
  active,
  children,
  disabled,
  label,
  onClick,
}: {
  active?: boolean;
  children: ReactElement;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <TooltipIconButton disabled={disabled} isPressed={active} label={label} onClick={onClick}>
      {children}
    </TooltipIconButton>
  );
}

function createMark(
  tool: AnnotationTool,
  point: Point,
  color: MarkColor,
  strokeSize: StrokeSize,
): AnnotationMark | null {
  const id = `mark_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  if (tool === 'arrow') return { id, kind: 'arrow', color, strokeSize, start: point, end: point, text: '' };
  if (tool === 'pen') return { id, kind: 'pen', color, strokeSize, points: [point] };
  if (tool === 'rect') return { id, kind: 'rect', color, strokeSize, start: point, end: point };
  if (tool === 'ellipse') return { id, kind: 'ellipse', color, strokeSize, start: point, end: point };
  if (tool === 'text') return { id, kind: 'text', color, strokeSize, point, text: '' };
  return null;
}

function translateMark(mark: AnnotationMark, dx: number, dy: number): AnnotationMark {
  if (mark.kind === 'arrow' || mark.kind === 'rect' || mark.kind === 'ellipse') {
    return { ...mark, start: clampPoint(addPoint(mark.start, dx, dy)), end: clampPoint(addPoint(mark.end, dx, dy)) };
  }
  if (mark.kind === 'pen') return { ...mark, points: mark.points.map((point) => clampPoint(addPoint(point, dx, dy))) };
  return { ...mark, point: clampPoint(addPoint(mark.point, dx, dy)) };
}

function hitTestMark(marks: AnnotationMark[], point: Point): AnnotationMark | undefined {
  return [...marks].reverse().find((mark) => {
    if (mark.kind === 'text') return distance(mark.point, point) < 0.06;
    if (mark.kind === 'pen') return mark.points.some((candidate) => distance(candidate, point) < 0.04);
    if (mark.kind === 'arrow') return distanceToSegment(point, mark.start, mark.end) < 0.04;
    const bounds = normalizedBounds(mark.start, mark.end);
    return point.x >= bounds.x && point.x <= bounds.x + bounds.width && point.y >= bounds.y && point.y <= bounds.y + bounds.height;
  });
}

function labelStyle(mark: TextMark, metrics: ImageDisplayMetrics, stage: HTMLDivElement | null): CSSProperties {
  const stageRect = stage?.getBoundingClientRect();
  const originLeft = stageRect ? metrics.displayLeft - stageRect.left : 0;
  const originTop = stageRect ? metrics.displayTop - stageRect.top : 0;
  const fontSize = clamp(metrics.displayWidth / 37.5, 13, 30);
  const maxWidth = Math.max(140, metrics.displayWidth * 0.62);
  const minWidth = Math.min(210, maxWidth);
  const width = clamp(metrics.displayWidth * 0.42, minWidth, maxWidth);
  return {
    left: originLeft + mark.point.x * metrics.displayWidth,
    top: originTop + mark.point.y * metrics.displayHeight,
    color: mark.color,
    fontSize,
    width,
  };
}

function overlayStyle(metrics: ImageDisplayMetrics, stage: HTMLDivElement | null): CSSProperties {
  const stageRect = stage?.getBoundingClientRect();
  return {
    left: stageRect ? metrics.displayLeft - stageRect.left : 0,
    top: stageRect ? metrics.displayTop - stageRect.top : 0,
    width: metrics.displayWidth,
    height: metrics.displayHeight,
  };
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

async function createAnnotatedComposite(
  imageUrl: string,
  marks: AnnotationMark[],
): Promise<AnnotationComposite> {
  const image = await loadImage(imageUrl);
  const width = image.naturalWidth || 1024;
  const height = image.naturalHeight || 768;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create annotation canvas.');

  context.drawImage(image, 0, 0, width, height);
  for (const mark of marks) {
    drawMark(context, mark, width, height);
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width,
    height,
  };
}

function drawMark(context: CanvasRenderingContext2D, mark: AnnotationMark, width: number, height: number): void {
  context.save();
  context.strokeStyle = mark.color;
  context.fillStyle = mark.color;
  context.lineWidth = strokeBySize[mark.strokeSize] * Math.max(width, height) / 900;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (mark.kind === 'arrow') {
    drawCanvasArrow(context, scalePoint(mark.start, width, height), scalePoint(mark.end, width, height));
  } else if (mark.kind === 'pen') {
    context.beginPath();
    mark.points.forEach((point, index) => {
      const scaled = scalePoint(point, width, height);
      if (index === 0) context.moveTo(scaled.x, scaled.y);
      else context.lineTo(scaled.x, scaled.y);
    });
    context.stroke();
  } else if (mark.kind === 'rect' || mark.kind === 'ellipse') {
    const bounds = normalizedBounds(scalePoint(mark.start, width, height), scalePoint(mark.end, width, height));
    if (mark.kind === 'ellipse') {
      context.beginPath();
      context.ellipse(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, bounds.width / 2, bounds.height / 2, 0, 0, Math.PI * 2);
      context.stroke();
    } else {
      context.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
    }
  } else if (mark.text.trim()) {
    drawAnnotationLabel(context, mark.text, mark.point.x * width, mark.point.y * height, width, height, mark.color);
  }

  context.restore();
}

function drawCanvasArrow(context: CanvasRenderingContext2D, start: Point, end: Point): void {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const headLength = Math.max(14, context.lineWidth * 4);

  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();

  context.beginPath();
  context.moveTo(end.x, end.y);
  context.lineTo(end.x - headLength * Math.cos(angle - Math.PI / 6), end.y - headLength * Math.sin(angle - Math.PI / 6));
  context.lineTo(end.x - headLength * Math.cos(angle + Math.PI / 6), end.y - headLength * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fill();
}

function drawAnnotationLabel(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  color: string,
): void {
  const lines = wrapText(text, Math.max(12, Math.floor(width / 26)));
  const fontSize = Math.max(18, Math.min(34, width / 28));
  const paddingX = fontSize * 0.5;
  const paddingY = fontSize * 0.36;
  const lineHeight = fontSize * 1.24;
  context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
  const boxWidth = Math.min(width * 0.48, Math.max(...lines.map((line) => context.measureText(line).width), fontSize * 5) + paddingX * 2);
  const boxHeight = lines.length * lineHeight + paddingY * 2;
  const left = clamp(x, 8, width - boxWidth - 8);
  const top = clamp(y, 8, height - boxHeight - 8);

  context.save();
  context.font = `700 ${fontSize}px Inter, Arial, sans-serif`;
  context.lineWidth = Math.max(3, fontSize * 0.12);
  context.strokeStyle = 'rgba(255,255,255,0.92)';
  context.fillStyle = color;
  lines.forEach((line, index) => {
    const textX = left + paddingX;
    const textY = top + paddingY + fontSize + index * lineHeight;
    context.strokeText(line, textX, textY);
    context.fillText(line, textX, textY);
  });
  context.restore();
}

function readImageDisplayMetrics(
  stage: HTMLDivElement | null,
  image: HTMLImageElement | null,
): ImageDisplayMetrics | null {
  if (!stage || !image || !image.naturalWidth || !image.naturalHeight) return null;

  const stageRect = stage.getBoundingClientRect();
  const imageRatio = image.naturalWidth / image.naturalHeight;
  const stageRatio = stageRect.width / stageRect.height;
  let displayWidth = stageRect.width;
  let displayHeight = stageRect.height;

  if (stageRatio > imageRatio) {
    displayHeight = stageRect.height;
    displayWidth = displayHeight * imageRatio;
  } else {
    displayWidth = stageRect.width;
    displayHeight = displayWidth / imageRatio;
  }

  return {
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    displayLeft: stageRect.left + (stageRect.width - displayWidth) / 2,
    displayTop: stageRect.top + (stageRect.height - displayHeight) / 2,
    displayWidth,
    displayHeight,
  };
}

function transformImageDisplayMetrics(
  metrics: ImageDisplayMetrics,
  zoom: number,
  pan: Point,
): ImageDisplayMetrics {
  return {
    ...metrics,
    displayLeft: metrics.displayLeft + pan.x,
    displayTop: metrics.displayTop + pan.y,
    displayWidth: metrics.displayWidth * zoom,
    displayHeight: metrics.displayHeight * zoom,
  };
}

function clampImageViewPan(metrics: ImageDisplayMetrics, zoom: number, pan: Point, stage: HTMLDivElement | null): Point {
  if (zoom <= 1) return { x: 0, y: 0 };

  const stageRect = stage?.getBoundingClientRect();
  const bounds = stageRect
    ? { left: stageRect.left, right: stageRect.right, top: stageRect.top, bottom: stageRect.bottom }
    : {
        left: metrics.displayLeft,
        right: metrics.displayLeft + metrics.displayWidth,
        top: metrics.displayTop,
        bottom: metrics.displayTop + metrics.displayHeight,
      };
  const width = metrics.displayWidth * zoom;
  const height = metrics.displayHeight * zoom;
  return {
    x: clampAxisPan(pan.x, bounds.left, bounds.right, metrics.displayLeft, width),
    y: clampAxisPan(pan.y, bounds.top, bounds.bottom, metrics.displayTop, height),
  };
}

function clampAxisPan(pan: number, stageStart: number, stageEnd: number, baseStart: number, scaledSize: number): number {
  const min = stageEnd - baseStart - scaledSize;
  const max = stageStart - baseStart;
  if (min <= max) return clamp(pan, min, max);
  return (stageStart + stageEnd) / 2 - (baseStart + scaledSize / 2);
}

function marksToInstruction(marks: AnnotationMark[]): string {
  return marks
    .filter((mark): mark is TextMark => mark.kind === 'text' && mark.text.trim().length > 0)
    .map((mark, index) => `${index + 1}. ${mark.text.trim()}`)
    .join('\n');
}

function mouseStagePoint(event: MouseEvent, metrics: ImageDisplayMetrics): Point | null {
  const x = (event.clientX - metrics.displayLeft) / metrics.displayWidth;
  const y = (event.clientY - metrics.displayTop) / metrics.displayHeight;
  if (x < 0 || x > 1 || y < 0 || y > 1) return null;
  return { x, y };
}

function stageCenterX(stage: HTMLDivElement | null): number {
  const rect = stage?.getBoundingClientRect();
  return rect ? rect.left + rect.width / 2 : 0;
}

function stageCenterY(stage: HTMLDivElement | null): number {
  const rect = stage?.getBoundingClientRect();
  return rect ? rect.top + rect.height / 2 : 0;
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

function isAnnotationLabelInput(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement && target.classList.contains('annotation-label-input');
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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', () => reject(new Error('Could not load annotation source image.')));
    image.src = src;
  });
}

function normalizedBounds(start: Point, end: Point): { x: number; y: number; width: number; height: number } {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

function addPoint(point: Point, dx: number, dy: number): Point {
  return { x: point.x + dx, y: point.y + dy };
}

function clampPoint(point: Point): Point {
  return { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
}

function scalePoint(point: Point, width: number, height: number): Point {
  return { x: point.x * width, y: point.y * height };
}

function diamondPath(point: Point, radius: number): string {
  return [
    `M ${point.x} ${point.y - radius}`,
    `L ${point.x + radius} ${point.y}`,
    `L ${point.x} ${point.y + radius}`,
    `L ${point.x - radius} ${point.y}`,
    'Z',
  ].join(' ');
}

function defaultArrowEnd(start: Point): Point {
  return clampPoint({ x: start.x + 0.16, y: start.y - 0.08 });
}

function distance(left: Point, right: Point): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function distanceToSegment(point: Point, start: Point, end: Point): number {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) return distance(point, start);
  const t = clamp(((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared, 0, 1);
  return distance(point, {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  });
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function wrapText(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if (`${current} ${word}`.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}

function roundRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
  context.closePath();
}
