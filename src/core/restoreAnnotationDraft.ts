import { touchBoard } from './blockFactory';
import { annotationColorOptions, type AnnotationManifest, type AnnotationMark } from './imageAnnotations';
import { createId, nowIso } from './id';
import { executionSourceLineage } from './executionLineage';
import type { BlockRecord, BoardHistoryEvent, BoardSnapshot, ExecutionRecord } from './types';

export type AnnotationDraftRestoreState =
  | 'available'
  | 'manifest_missing'
  | 'source_missing'
  | 'source_replaced';

export interface AnnotationDraftRestoreContext {
  manifest?: AnnotationManifest;
  sourceBlock?: BlockRecord;
  sourceAssetId?: string;
  state: AnnotationDraftRestoreState;
}

export interface RestoreAnnotationDraftResult extends AnnotationDraftRestoreContext {
  restored: boolean;
}

const annotationKinds = new Set(['marker', 'arrow', 'pen', 'brush', 'rect', 'ellipse']);
const annotationColors = new Set(annotationColorOptions.map((option) => option.value));
const strokeSizes = new Set(['xs', 's', 'm', 'l', 'xl']);

export function annotationDraftRestoreContext(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
): AnnotationDraftRestoreContext {
  if (execution.capabilityId !== 'image.annotation_edit') return { state: 'manifest_missing' };
  const operationBlockId = typeof execution.params?.operationBlockId === 'string'
    ? execution.params.operationBlockId
    : undefined;
  const operationBlock = snapshot.blocks.find(
    (block) => block.blockId === operationBlockId && block.type === 'operation',
  );
  const historyEvent = snapshot.historyEvents?.find(
    (event) => event.executionId === execution.executionId && event.type === 'operation_created',
  );
  const manifest = readAnnotationManifest(execution.params?.annotationManifest) ??
    readAnnotationManifest(operationBlock?.data.annotationManifest) ??
    readAnnotationManifest(historyEvent?.detail?.annotationManifest);
  if (!manifest) return { state: 'manifest_missing' };

  const { sourceBlock } = executionSourceLineage(snapshot, execution);
  if (!sourceBlock) return { manifest, state: 'source_missing' };

  const sourceAssetId = historicalSourceAssetId(snapshot, execution, sourceBlock.blockId);
  const currentAssetId = typeof sourceBlock.data.assetId === 'string' ? sourceBlock.data.assetId : undefined;
  if (!sourceAssetId || currentAssetId !== sourceAssetId) {
    return { manifest, sourceAssetId, sourceBlock, state: 'source_replaced' };
  }
  return { manifest, sourceAssetId, sourceBlock, state: 'available' };
}

export function restoreExecutionAnnotationDraft(
  snapshot: BoardSnapshot,
  executionId: string,
): RestoreAnnotationDraftResult {
  const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
  if (!execution) return { restored: false, state: 'manifest_missing' };

  const context = annotationDraftRestoreContext(snapshot, execution);
  if (context.state !== 'available' || !context.manifest || !context.sourceBlock || !context.sourceAssetId) {
    return { ...context, restored: false };
  }

  const updatedAt = nowIso();
  context.sourceBlock.data = {
    ...context.sourceBlock.data,
    annotationDraft: {
      schemaVersion: 1,
      sourceAssetId: context.sourceAssetId,
      globalInstruction: context.manifest.globalInstruction,
      marks: structuredClone(context.manifest.marks),
      updatedAt,
    },
  };
  context.sourceBlock.updatedAt = updatedAt;

  const historyEvent: BoardHistoryEvent = {
    eventId: createId('history'),
    type: 'annotation_draft_restored',
    createdAt: updatedAt,
    actor: 'user',
    executionId,
    blockIds: [context.sourceBlock.blockId],
    assetIds: [context.sourceAssetId],
    summary: 'Restored annotation draft',
    detail: {
      markCount: context.manifest.marks.length,
      sourceBlockId: context.sourceBlock.blockId,
    },
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);
  return { ...context, restored: true };
}

function historicalSourceAssetId(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  sourceBlockId: string,
): string | undefined {
  if (Array.isArray(execution.params?.inputBindings)) {
    const sourceBinding = execution.params.inputBindings.find((binding) => {
      if (!binding || typeof binding !== 'object') return false;
      const candidate = binding as Record<string, unknown>;
      return candidate.blockId === sourceBlockId && candidate.inputRole === 'source';
    }) as Record<string, unknown> | undefined;
    if (typeof sourceBinding?.assetId === 'string') return sourceBinding.assetId;
  }

  const configurationInput = execution.configuration?.imageInputs.find(
    (input) => input.blockId === sourceBlockId && (input.inputRole === 'source' || !input.inputRole),
  );
  if (configurationInput?.assetId) return configurationInput.assetId;

  const operationBlockId = typeof execution.params?.operationBlockId === 'string'
    ? execution.params.operationBlockId
    : undefined;
  const operationBlock = snapshot.blocks.find(
    (block) => block.blockId === operationBlockId && block.type === 'operation',
  );
  return typeof operationBlock?.data.sourceAssetId === 'string'
    ? operationBlock.data.sourceAssetId
    : execution.inputAssetIds?.[0];
}

function readAnnotationManifest(value: unknown): AnnotationManifest | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.globalInstruction !== 'string' ||
    !Array.isArray(candidate.marks) ||
    !candidate.marks.every(isAnnotationMark)
  ) {
    return undefined;
  }
  return structuredClone(candidate) as unknown as AnnotationManifest;
}

function isAnnotationMark(value: unknown): value is AnnotationMark {
  if (!value || typeof value !== 'object') return false;
  const mark = value as Record<string, unknown>;
  if (
    typeof mark.id !== 'string' ||
    typeof mark.kind !== 'string' ||
    !annotationKinds.has(mark.kind) ||
    typeof mark.color !== 'string' ||
    !annotationColors.has(mark.color as never) ||
    typeof mark.strokeSize !== 'string' ||
    !strokeSizes.has(mark.strokeSize) ||
    typeof mark.intent !== 'string'
  ) {
    return false;
  }
  if (mark.kind === 'marker') return isPoint(mark.point);
  if (mark.kind === 'arrow' || mark.kind === 'rect' || mark.kind === 'ellipse') {
    return isPoint(mark.start) && isPoint(mark.end);
  }
  if (mark.kind === 'pen' || mark.kind === 'brush') {
    return Array.isArray(mark.points) && mark.points.every(isPoint);
  }
  return false;
}

function isPoint(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === 'number' && Number.isFinite(point.x) &&
    typeof point.y === 'number' && Number.isFinite(point.y);
}
