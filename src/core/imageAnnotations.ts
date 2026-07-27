export const annotationColorOptions = [
  { name: 'red', value: '#dc2626' },
  { name: 'yellow', value: '#facc15' },
  { name: 'green', value: '#22c55e' },
  { name: 'blue', value: '#2563eb' },
  { name: 'purple', value: '#a855f7' },
] as const;

export type AnnotationColor = (typeof annotationColorOptions)[number]['value'];
export type AnnotationMarkKind = 'marker' | 'arrow' | 'pen' | 'brush' | 'rect' | 'ellipse';
export type AnnotationStrokeSize = 'xs' | 's' | 'm' | 'l' | 'xl';

export interface AnnotationPoint {
  x: number;
  y: number;
}

interface BaseAnnotationMark {
  id: string;
  kind: AnnotationMarkKind;
  color: AnnotationColor;
  strokeSize: AnnotationStrokeSize;
  intent: string;
}

export interface MarkerAnnotationMark extends BaseAnnotationMark {
  kind: 'marker';
  point: AnnotationPoint;
}

export interface ArrowAnnotationMark extends BaseAnnotationMark {
  kind: 'arrow';
  start: AnnotationPoint;
  end: AnnotationPoint;
}

export interface PenAnnotationMark extends BaseAnnotationMark {
  kind: 'pen';
  points: AnnotationPoint[];
}

export interface BrushAnnotationMark extends BaseAnnotationMark {
  kind: 'brush';
  points: AnnotationPoint[];
}

export interface RectAnnotationMark extends BaseAnnotationMark {
  kind: 'rect';
  start: AnnotationPoint;
  end: AnnotationPoint;
}

export interface EllipseAnnotationMark extends BaseAnnotationMark {
  kind: 'ellipse';
  start: AnnotationPoint;
  end: AnnotationPoint;
}

export type AnnotationMark =
  | MarkerAnnotationMark
  | ArrowAnnotationMark
  | PenAnnotationMark
  | BrushAnnotationMark
  | RectAnnotationMark
  | EllipseAnnotationMark;

export interface AnnotationManifest {
  schemaVersion: 1;
  compositeAssetId?: string;
  globalInstruction: string;
  marks: AnnotationMark[];
}

export interface AnnotationDraft {
  schemaVersion: 1;
  sourceAssetId: string;
  globalInstruction: string;
  marks: AnnotationMark[];
  updatedAt: string;
}
