import type {
  AnnotationManifest,
  AnnotationMark,
  AnnotationPoint,
  AnnotationStrokeSize,
} from './imageAnnotations';

export interface NormalizedImageBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface BaseAnnotationEditControl {
  markId: string;
  sourceKind: AnnotationMark['kind'];
}

export interface PointAnnotationEditControl extends BaseAnnotationEditControl {
  controlType: 'point';
  point: AnnotationPoint;
}

export interface VectorAnnotationEditControl extends BaseAnnotationEditControl {
  controlType: 'vector';
  start: AnnotationPoint;
  end: AnnotationPoint;
  delta: AnnotationPoint;
}

export interface RegionAnnotationEditControl extends BaseAnnotationEditControl {
  controlType: 'region';
  shape: 'brush' | 'ellipse' | 'path' | 'rectangle';
  bounds: NormalizedImageBounds;
  center: AnnotationPoint;
  points?: AnnotationPoint[];
  strokeSize?: AnnotationStrokeSize;
}

export type AnnotationEditControl =
  | PointAnnotationEditControl
  | VectorAnnotationEditControl
  | RegionAnnotationEditControl;

export interface AnnotationEditControlManifest {
  schemaVersion: 1;
  coordinateSpace: 'normalized_source_image';
  controls: AnnotationEditControl[];
}

/**
 * Builds the provider-neutral spatial contract consumed by prompt compilers and
 * future image-edit adapters. Coordinates are normalized to the clean source
 * image: x grows left-to-right and y grows top-to-bottom.
 */
export function annotationEditControlsFromManifest(
  manifest: AnnotationManifest,
): AnnotationEditControlManifest {
  return {
    schemaVersion: 1,
    coordinateSpace: 'normalized_source_image',
    controls: manifest.marks.map(annotationEditControlFromMark),
  };
}

export function readAnnotationEditControlManifest(
  value: unknown,
): AnnotationEditControlManifest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    candidate.coordinateSpace !== 'normalized_source_image' ||
    !Array.isArray(candidate.controls) ||
    !candidate.controls.every(isAnnotationEditControl)
  ) {
    return undefined;
  }
  return structuredClone(candidate) as unknown as AnnotationEditControlManifest;
}

export function annotationEditControlDescription(control: AnnotationEditControl): string {
  if (control.controlType === 'point') {
    return `point ${formatPoint(control.point)}`;
  }
  if (control.controlType === 'vector') {
    return [
      `start ${formatPoint(control.start)}`,
      `end ${formatPoint(control.end)}`,
      `delta (${formatSignedPercent(control.delta.x)} x, ${formatSignedPercent(control.delta.y)} y)`,
    ].join('; ');
  }
  return [
    `${control.shape} region`,
    `center ${formatPoint(control.center)}`,
    `bounds left ${formatPercent(control.bounds.x)}, top ${formatPercent(control.bounds.y)}, ` +
      `width ${formatPercent(control.bounds.width)}, height ${formatPercent(control.bounds.height)}`,
  ].join('; ');
}

function annotationEditControlFromMark(mark: AnnotationMark): AnnotationEditControl {
  if (mark.kind === 'marker') {
    return {
      markId: mark.id,
      sourceKind: mark.kind,
      controlType: 'point',
      point: clonePoint(mark.point),
    };
  }
  if (mark.kind === 'arrow') {
    return {
      markId: mark.id,
      sourceKind: mark.kind,
      controlType: 'vector',
      start: clonePoint(mark.start),
      end: clonePoint(mark.end),
      delta: {
        x: roundNormalized(mark.end.x - mark.start.x),
        y: roundNormalized(mark.end.y - mark.start.y),
      },
    };
  }
  if (mark.kind === 'rect' || mark.kind === 'ellipse') {
    const bounds = normalizedBounds(mark.start, mark.end);
    return {
      markId: mark.id,
      sourceKind: mark.kind,
      controlType: 'region',
      shape: mark.kind === 'rect' ? 'rectangle' : 'ellipse',
      bounds,
      center: boundsCenter(bounds),
    };
  }

  const points = mark.points.map(clonePoint);
  const bounds = boundsForPoints(points);
  return {
    markId: mark.id,
    sourceKind: mark.kind,
    controlType: 'region',
    shape: mark.kind === 'brush' ? 'brush' : 'path',
    bounds,
    center: boundsCenter(bounds),
    points,
    strokeSize: mark.strokeSize,
  };
}

function isAnnotationEditControl(value: unknown): value is AnnotationEditControl {
  if (!value || typeof value !== 'object') return false;
  const control = value as Record<string, unknown>;
  if (
    typeof control.markId !== 'string' ||
    typeof control.sourceKind !== 'string' ||
    !['marker', 'arrow', 'pen', 'brush', 'rect', 'ellipse'].includes(control.sourceKind)
  ) return false;
  if (control.controlType === 'point') return control.sourceKind === 'marker' && isPoint(control.point);
  if (control.controlType === 'vector') {
    return control.sourceKind === 'arrow' && isPoint(control.start) && isPoint(control.end) &&
      isVector(control.delta) && vectorMatchesEndpoints(control);
  }
  if (control.controlType !== 'region') return false;
  if (!['pen', 'brush', 'rect', 'ellipse'].includes(control.sourceKind)) return false;
  const expectedShape = {
    pen: 'path',
    brush: 'brush',
    rect: 'rectangle',
    ellipse: 'ellipse',
  }[control.sourceKind];
  if (control.shape !== expectedShape) return false;
  if (!isBounds(control.bounds) || !isPoint(control.center)) return false;
  if (control.sourceKind === 'pen' || control.sourceKind === 'brush') {
    return Array.isArray(control.points) && control.points.every((point) => isPoint(point)) &&
      ['xs', 's', 'm', 'l', 'xl'].includes(String(control.strokeSize));
  }
  return control.points === undefined && control.strokeSize === undefined;
}

function isBounds(value: unknown): value is NormalizedImageBounds {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as Record<string, unknown>;
  return isNormalized(bounds.x) && isNormalized(bounds.y) &&
    isNormalized(bounds.width) && isNormalized(bounds.height) &&
    bounds.x + bounds.width <= 1.000001 && bounds.y + bounds.height <= 1.000001;
}

function isPoint(value: unknown): value is AnnotationPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Record<string, unknown>;
  if (typeof point.x !== 'number' || !Number.isFinite(point.x)) return false;
  if (typeof point.y !== 'number' || !Number.isFinite(point.y)) return false;
  return isNormalized(point.x) && isNormalized(point.y);
}

function isVector(value: unknown): value is AnnotationPoint {
  if (!value || typeof value !== 'object') return false;
  const vector = value as Record<string, unknown>;
  return typeof vector.x === 'number' && Number.isFinite(vector.x) && vector.x >= -1 && vector.x <= 1 &&
    typeof vector.y === 'number' && Number.isFinite(vector.y) && vector.y >= -1 && vector.y <= 1;
}

function vectorMatchesEndpoints(control: Record<string, unknown>): boolean {
  const start = control.start as AnnotationPoint;
  const end = control.end as AnnotationPoint;
  const delta = control.delta as AnnotationPoint;
  return Math.abs(delta.x - roundNormalized(end.x - start.x)) < 0.000001 &&
    Math.abs(delta.y - roundNormalized(end.y - start.y)) < 0.000001;
}

function isNormalized(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function normalizedBounds(start: AnnotationPoint, end: AnnotationPoint): NormalizedImageBounds {
  return {
    x: roundNormalized(Math.min(start.x, end.x)),
    y: roundNormalized(Math.min(start.y, end.y)),
    width: roundNormalized(Math.abs(end.x - start.x)),
    height: roundNormalized(Math.abs(end.y - start.y)),
  };
}

function boundsForPoints(points: AnnotationPoint[]): NormalizedImageBounds {
  if (!points.length) return { x: 0.5, y: 0.5, width: 0, height: 0 };
  let minX = points[0].x;
  let minY = points[0].y;
  let maxX = points[0].x;
  let maxY = points[0].y;
  for (const point of points.slice(1)) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return {
    x: roundNormalized(minX),
    y: roundNormalized(minY),
    width: roundNormalized(maxX - minX),
    height: roundNormalized(maxY - minY),
  };
}

function boundsCenter(bounds: NormalizedImageBounds): AnnotationPoint {
  return {
    x: roundNormalized(bounds.x + bounds.width / 2),
    y: roundNormalized(bounds.y + bounds.height / 2),
  };
}

function clonePoint(point: AnnotationPoint): AnnotationPoint {
  return { x: point.x, y: point.y };
}

function roundNormalized(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function formatPoint(point: AnnotationPoint): string {
  return `(x ${formatPercent(point.x)}, y ${formatPercent(point.y)})`;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatSignedPercent(value: number): string {
  const percent = (value * 100).toFixed(1);
  return `${value >= 0 ? '+' : ''}${percent}%`;
}
