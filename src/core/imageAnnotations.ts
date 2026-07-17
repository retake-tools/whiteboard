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

export type AnnotationDraftContent = Pick<AnnotationManifest, 'globalInstruction' | 'marks' | 'schemaVersion'>;

export function annotationDraftHasContent(draft: AnnotationDraftContent): boolean {
  return Boolean(draft.globalInstruction.trim() || draft.marks.length);
}

export function annotationDraftMatches(
  draft: AnnotationDraft | undefined,
  sourceAssetId: string | undefined,
): draft is AnnotationDraft {
  return Boolean(draft && sourceAssetId && draft.sourceAssetId === sourceAssetId);
}

export function annotationDraftContentEquals(
  draft: AnnotationDraft | undefined,
  content: AnnotationDraftContent,
): boolean {
  return Boolean(
    draft &&
    draft.globalInstruction === content.globalInstruction &&
    JSON.stringify(draft.marks) === JSON.stringify(content.marks)
  );
}

export function annotationManifestFromDraft(draft: AnnotationDraftContent): AnnotationManifest {
  return {
    schemaVersion: 1,
    globalInstruction: draft.globalInstruction,
    marks: structuredClone(draft.marks),
  };
}

const markPrefixes = {
  marker: 'M',
  arrow: 'A',
  pen: 'S',
  brush: 'B',
  rect: 'R',
  ellipse: 'C',
} satisfies Record<AnnotationMarkKind, string>;

const markDescriptions = {
  marker: 'numbered point marker',
  arrow: 'directional arrow',
  pen: 'freehand line or outline',
  brush: 'semi-transparent brushed region',
  rect: 'rectangle',
  ellipse: 'ellipse',
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
  return mark.intent.trim();
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
    return `- ${mark.id}: ${annotationColorName(mark.color)} ${annotationMarkDescription(mark)}. ${intent || fallback}`;
  });
  const globalInstruction = manifest.globalInstruction.trim();
  const hasDirectionalArrow = manifest.marks.some((mark) => mark.kind === 'arrow');

  return [
    'Edit the clean source image using the visible annotations in the annotated composite as spatial references.',
    markLines.length ? '' : undefined,
    markLines.length ? 'Annotation legend:' : undefined,
    ...markLines,
    markLines.length ? '' : undefined,
    markLines.length
      ? 'Annotation colors identify marks only. Do not use a mark color as the requested output color unless its instruction explicitly says so.'
      : undefined,
    hasDirectionalArrow
      ? 'For directional arrows, the tail is the start and the arrowhead is the destination or direction. Use the mark instruction to decide whether the arrow means move, point, extend, connect, or orient.'
      : undefined,
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
