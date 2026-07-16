export const annotationColorOptions = [
  { name: 'red', value: '#dc2626' },
  { name: 'yellow', value: '#facc15' },
  { name: 'green', value: '#22c55e' },
  { name: 'blue', value: '#2563eb' },
  { name: 'purple', value: '#a855f7' },
] as const;

export type AnnotationColor = (typeof annotationColorOptions)[number]['value'];
export type AnnotationMarkKind = 'marker' | 'arrow' | 'pen' | 'brush' | 'rect' | 'ellipse' | 'text';
export type AnnotationStrokeSize = 'xs' | 's' | 'm' | 'l' | 'xl';
export type AnnotationTextMode = 'annotation_note' | 'render_text';

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

export interface TextAnnotationMark extends BaseAnnotationMark {
  kind: 'text';
  point: AnnotationPoint;
  text: string;
  textMode: AnnotationTextMode;
}

export type AnnotationMark =
  | MarkerAnnotationMark
  | ArrowAnnotationMark
  | PenAnnotationMark
  | BrushAnnotationMark
  | RectAnnotationMark
  | EllipseAnnotationMark
  | TextAnnotationMark;

export interface AnnotationManifest {
  schemaVersion: 1;
  compositeAssetId?: string;
  globalInstruction: string;
  marks: AnnotationMark[];
}

const markPrefixes = {
  marker: 'M',
  arrow: 'A',
  pen: 'S',
  brush: 'B',
  rect: 'R',
  ellipse: 'C',
  text: 'T',
} satisfies Record<AnnotationMarkKind, string>;

const markDescriptions = {
  marker: 'numbered point marker',
  arrow: 'directional arrow',
  pen: 'freehand line or outline',
  brush: 'semi-transparent brushed region',
  rect: 'rectangle',
  ellipse: 'ellipse',
  text: 'text annotation',
} satisfies Record<AnnotationMarkKind, string>;

export function nextAnnotationMarkId(marks: AnnotationMark[], kind: AnnotationMarkKind): string {
  const prefix = markPrefixes[kind];
  const highest = marks.reduce((current, mark) => {
    if (!mark.id.startsWith(prefix)) return current;
    const suffix = Number.parseInt(mark.id.slice(prefix.length), 10);
    return Number.isFinite(suffix) ? Math.max(current, suffix) : current;
  }, 0);
  return `${prefix}${highest + 1}`;
}

export function annotationColorName(color: AnnotationColor): string {
  return annotationColorOptions.find((option) => option.value === color)?.name ?? color;
}

export function annotationMarkDescription(mark: AnnotationMark): string {
  return markDescriptions[mark.kind];
}

export function annotationMarkIntent(mark: AnnotationMark): string {
  const explicitIntent = mark.intent.trim();
  if (explicitIntent) return explicitIntent;
  if (mark.kind !== 'text' || !mark.text.trim()) return '';
  return mark.textMode === 'render_text'
    ? `Render this exact text in the final image: ${JSON.stringify(mark.text.trim())}`
    : mark.text.trim();
}

export function annotationMarksMissingIntent(manifest: AnnotationManifest): string[] {
  if (manifest.globalInstruction.trim()) return [];
  return manifest.marks
    .filter((mark) => !annotationMarkIntent(mark))
    .map((mark) => mark.id);
}

export function hasExecutableAnnotationIntent(manifest: AnnotationManifest): boolean {
  return Boolean(
    manifest.globalInstruction.trim() || manifest.marks.some((mark) => annotationMarkIntent(mark)),
  );
}

export function compileAnnotationInstruction(manifest: AnnotationManifest): string {
  const markLines = manifest.marks.map((mark) => {
    const intent = annotationMarkIntent(mark);
    const fallback = manifest.globalInstruction.trim()
      ? 'Apply the global instruction to this marked location.'
      : 'No edit instruction was provided for this mark.';
    const textMode = mark.kind === 'text' ? `, mode=${mark.textMode}` : '';
    return `- ${mark.id}: ${annotationColorName(mark.color)} ${annotationMarkDescription(mark)}${textMode}. ${intent || fallback}`;
  });
  const globalInstruction = manifest.globalInstruction.trim();

  return [
    'Edit the clean source image using the visible annotations in the annotated composite as spatial references.',
    markLines.length ? '' : undefined,
    markLines.length ? 'Annotation legend:' : undefined,
    ...markLines,
    globalInstruction ? '' : undefined,
    globalInstruction ? 'Global instruction:' : undefined,
    globalInstruction || undefined,
    '',
    'Preserve all unmarked content, subject identity, composition, camera, lighting, and style unless an instruction explicitly changes them.',
    'Return a clean final image without annotation IDs, markers, arrows, outlines, brush overlays, annotation notes, or editor UI.',
  ]
    .filter((line): line is string => typeof line === 'string')
    .join('\n');
}
