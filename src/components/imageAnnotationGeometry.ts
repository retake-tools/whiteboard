import type {
  AnnotationMark,
  AnnotationPoint,
  AnnotationStrokeSize,
} from '../core/imageAnnotations';

export interface ImageDisplayMetrics {
  naturalWidth: number;
  naturalHeight: number;
  stageLeft: number;
  stageTop: number;
  stageRight: number;
  stageBottom: number;
  displayLeft: number;
  displayTop: number;
  displayWidth: number;
  displayHeight: number;
}

export const strokeBySize = {
  xs: 0.8,
  s: 1.2,
  m: 1.8,
  l: 2.8,
  xl: 4,
} satisfies Record<AnnotationStrokeSize, number>;

export function annotationBrushStrokeWidthPixels(
  strokeSize: AnnotationStrokeSize,
  imageWidth: number,
  imageHeight: number,
): number {
  return strokeBySize[strokeSize] * 9 * Math.max(imageWidth, imageHeight) / 900;
}

export function annotationMarkAnchor(mark: AnnotationMark): AnnotationPoint {
  if (mark.kind === 'marker') return mark.point;
  if (mark.kind === 'arrow') return mark.start;
  if (mark.kind === 'pen' || mark.kind === 'brush') return mark.points[0] ?? { x: 0.5, y: 0.5 };
  const bounds = normalizedBounds(mark.start, mark.end);
  return { x: bounds.x, y: bounds.y };
}

export function annotationMarkFocusPoint(mark: AnnotationMark): AnnotationPoint {
  if (mark.kind === 'marker') return mark.point;
  if (mark.kind === 'arrow' || mark.kind === 'rect' || mark.kind === 'ellipse') {
    return {
      x: (mark.start.x + mark.end.x) / 2,
      y: (mark.start.y + mark.end.y) / 2,
    };
  }
  if (!mark.points.length) return { x: 0.5, y: 0.5 };
  const bounds = mark.points.reduce(
    (current, point) => ({
      minX: Math.min(current.minX, point.x),
      minY: Math.min(current.minY, point.y),
      maxX: Math.max(current.maxX, point.x),
      maxY: Math.max(current.maxY, point.y),
    }),
    { minX: mark.points[0].x, minY: mark.points[0].y, maxX: mark.points[0].x, maxY: mark.points[0].y },
  );
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function translateAnnotationMark(
  mark: AnnotationMark,
  dx: number,
  dy: number,
): AnnotationMark {
  if (mark.kind === 'arrow' || mark.kind === 'rect' || mark.kind === 'ellipse') {
    return {
      ...mark,
      start: clampPoint(addPoint(mark.start, dx, dy)),
      end: clampPoint(addPoint(mark.end, dx, dy)),
    };
  }
  if (mark.kind === 'pen' || mark.kind === 'brush') {
    return { ...mark, points: mark.points.map((point) => clampPoint(addPoint(point, dx, dy))) };
  }
  return { ...mark, point: clampPoint(addPoint(mark.point, dx, dy)) };
}

export function hitTestAnnotationMark(
  marks: AnnotationMark[],
  point: AnnotationPoint,
): AnnotationMark | undefined {
  return [...marks].reverse().find((mark) => {
    if (mark.kind === 'marker') return distance(mark.point, point) < 0.06;
    if (mark.kind === 'pen' || mark.kind === 'brush') {
      return mark.points.some((candidate) => distance(candidate, point) < (mark.kind === 'brush' ? 0.07 : 0.04));
    }
    if (mark.kind === 'arrow') return distanceToSegment(point, mark.start, mark.end) < 0.04;
    const bounds = normalizedBounds(mark.start, mark.end);
    if (mark.kind === 'rect') return distanceToRectBorder(point, bounds) < 0.04;
    return distanceToEllipseBorder(point, bounds) < 0.04;
  });
}

export function readImageDisplayMetrics(
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
    stageLeft: stageRect.left,
    stageTop: stageRect.top,
    stageRight: stageRect.right,
    stageBottom: stageRect.bottom,
    displayLeft: stageRect.left + (stageRect.width - displayWidth) / 2,
    displayTop: stageRect.top + (stageRect.height - displayHeight) / 2,
    displayWidth,
    displayHeight,
  };
}

export function transformImageDisplayMetrics(
  metrics: ImageDisplayMetrics,
  zoom: number,
  pan: AnnotationPoint,
): ImageDisplayMetrics {
  return {
    ...metrics,
    displayLeft: metrics.displayLeft + pan.x,
    displayTop: metrics.displayTop + pan.y,
    displayWidth: metrics.displayWidth * zoom,
    displayHeight: metrics.displayHeight * zoom,
  };
}

export function clampImageViewPan(
  metrics: ImageDisplayMetrics,
  zoom: number,
  pan: AnnotationPoint,
): AnnotationPoint {
  if (zoom <= 1) return { x: 0, y: 0 };

  const width = metrics.displayWidth * zoom;
  const height = metrics.displayHeight * zoom;
  return {
    x: clampAxisPan(pan.x, metrics.stageLeft, metrics.stageRight, metrics.displayLeft, width),
    y: clampAxisPan(pan.y, metrics.stageTop, metrics.stageBottom, metrics.displayTop, height),
  };
}

export function metricsStageCenterX(metrics: ImageDisplayMetrics | null): number {
  return metrics ? (metrics.stageLeft + metrics.stageRight) / 2 : 0;
}

export function metricsStageCenterY(metrics: ImageDisplayMetrics | null): number {
  return metrics ? (metrics.stageTop + metrics.stageBottom) / 2 : 0;
}

export function normalizedBounds(
  start: AnnotationPoint,
  end: AnnotationPoint,
): { x: number; y: number; width: number; height: number } {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function clampPoint(point: AnnotationPoint): AnnotationPoint {
  return { x: clamp(point.x, 0, 1), y: clamp(point.y, 0, 1) };
}

export function defaultArrowEnd(start: AnnotationPoint): AnnotationPoint {
  return clampPoint({ x: start.x + 0.16, y: start.y - 0.08 });
}

export function distance(left: AnnotationPoint, right: AnnotationPoint): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function addPoint(point: AnnotationPoint, dx: number, dy: number): AnnotationPoint {
  return { x: point.x + dx, y: point.y + dy };
}

function clampAxisPan(
  pan: number,
  stageStart: number,
  stageEnd: number,
  baseStart: number,
  scaledSize: number,
): number {
  const min = stageEnd - baseStart - scaledSize;
  const max = stageStart - baseStart;
  if (min <= max) return clamp(pan, min, max);
  return (stageStart + stageEnd) / 2 - (baseStart + scaledSize / 2);
}

function distanceToSegment(
  point: AnnotationPoint,
  start: AnnotationPoint,
  end: AnnotationPoint,
): number {
  const lengthSquared = (end.x - start.x) ** 2 + (end.y - start.y) ** 2;
  if (lengthSquared === 0) return distance(point, start);
  const t = clamp(
    ((point.x - start.x) * (end.x - start.x) + (point.y - start.y) * (end.y - start.y)) / lengthSquared,
    0,
    1,
  );
  return distance(point, {
    x: start.x + t * (end.x - start.x),
    y: start.y + t * (end.y - start.y),
  });
}

function distanceToRectBorder(
  point: AnnotationPoint,
  bounds: { x: number; y: number; width: number; height: number },
): number {
  const topLeft = { x: bounds.x, y: bounds.y };
  const topRight = { x: bounds.x + bounds.width, y: bounds.y };
  const bottomLeft = { x: bounds.x, y: bounds.y + bounds.height };
  const bottomRight = { x: bounds.x + bounds.width, y: bounds.y + bounds.height };
  return Math.min(
    distanceToSegment(point, topLeft, topRight),
    distanceToSegment(point, topRight, bottomRight),
    distanceToSegment(point, bottomRight, bottomLeft),
    distanceToSegment(point, bottomLeft, topLeft),
  );
}

function distanceToEllipseBorder(
  point: AnnotationPoint,
  bounds: { x: number; y: number; width: number; height: number },
): number {
  const radiusX = Math.max(bounds.width / 2, Number.EPSILON);
  const radiusY = Math.max(bounds.height / 2, Number.EPSILON);
  const centerX = bounds.x + radiusX;
  const centerY = bounds.y + radiusY;
  const normalizedRadius = Math.hypot((point.x - centerX) / radiusX, (point.y - centerY) / radiusY);
  return Math.abs(normalizedRadius - 1) * Math.min(radiusX, radiusY);
}
