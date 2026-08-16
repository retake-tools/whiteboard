import { executionSourceLineage } from '../core/executionLineage';
import type { BlockRecord, BoardSnapshot, ExecutionRecord } from '../core/types';

export type ImageEditorOrigin =
  | 'canvas-toolbar'
  | 'execution-inspector'
  | 'history'
  | 'image-focus'
  | 'image-inspector';

export interface ImageEditorSession {
  readonly origin: ImageEditorOrigin;
  readonly phase: 'opening' | 'restoring' | 'visible';
  readonly returnSelectedBlockIds: readonly string[];
  readonly sourceBlockId: string;
  readonly startedAt: number;
}

export function startImageEditorSession(input: {
  origin: ImageEditorOrigin;
  returnSelectedBlockIds?: readonly string[];
  sourceBlockId: string;
  startedAt?: number;
}): ImageEditorSession {
  return Object.freeze({
    origin: input.origin,
    phase: 'opening',
    returnSelectedBlockIds: Object.freeze([
      ...(input.returnSelectedBlockIds ?? [input.sourceBlockId]),
    ]),
    sourceBlockId: input.sourceBlockId,
    startedAt: input.startedAt ?? Date.now(),
  });
}

export function imageEditorPanelVisibilityChanged(
  session: ImageEditorSession | undefined,
  visible: boolean,
): ImageEditorSession | undefined {
  if (!session) return undefined;
  if (visible) {
    return session.phase === 'visible'
      ? session
      : Object.freeze({ ...session, phase: 'visible' as const });
  }
  return session.phase === 'visible'
    ? Object.freeze({ ...session, phase: 'restoring' as const })
    : session;
}

export function imageEditorOpeningExpired(
  session: ImageEditorSession | undefined,
  now = Date.now(),
  timeoutMs = 4_000,
): boolean {
  return Boolean(
    session?.phase === 'opening'
    && now - session.startedAt >= timeoutMs,
  );
}

export function resolveImageEditorInspectorBlock(
  snapshot: BoardSnapshot,
  triggerBlockId: string,
): BlockRecord | undefined {
  const triggerBlock = snapshot.blocks.find((block) => block.blockId === triggerBlockId);
  if (!triggerBlock) return undefined;
  if (triggerBlock.type === 'image') return triggerBlock;

  const execution = latestImageEditorExecution(snapshot, triggerBlock);
  if (!execution) return undefined;
  const sourceBlock = executionSourceLineage(snapshot, execution).sourceBlock;
  if (sourceBlock?.type === 'image') return sourceBlock;

  return execution.inputBlockIds
    .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
    .find((block): block is BlockRecord => block?.type === 'image');
}

function latestImageEditorExecution(
  snapshot: BoardSnapshot,
  triggerBlock: BlockRecord,
): ExecutionRecord | undefined {
  const sourceExecutionId = typeof triggerBlock.data.sourceExecutionId === 'string'
    ? triggerBlock.data.sourceExecutionId
    : undefined;
  for (let index = snapshot.executions.length - 1; index >= 0; index -= 1) {
    const execution = snapshot.executions[index];
    if (
      execution.executionId === sourceExecutionId
      || execution.outputBlockIds.includes(triggerBlock.blockId)
      || execution.params?.operationBlockId === triggerBlock.blockId
    ) return execution;
  }
  return undefined;
}
