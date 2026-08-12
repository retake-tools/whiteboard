import { createId, nowIso } from '../../core/id';
import { blockLockedByGroup } from '../../core/grouping';
import { fitImageBlockSize } from '../../core/imageFile';
import type {
  AssetRecord,
  BlockRecord,
  BoardHistoryEvent,
  BoardSnapshot,
  ExecutionRecord,
  ExecutionStatus,
} from '../../core/types';
import type {
  CanvasHostScopeV1,
  DeepReadonly,
  HostBoardRevisionV1,
} from '../contracts';

export function immutableSnapshot(snapshot: BoardSnapshot): DeepReadonly<BoardSnapshot> {
  return immutableValue(snapshot);
}

export function immutableValue<Value>(value: Value): DeepReadonly<Value> {
  return deepFreeze(structuredClone(value)) as DeepReadonly<Value>;
}

function deepFreeze<Value>(value: Value): Value {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function touch(snapshot: BoardSnapshot): void {
  const currentTime = Date.parse(snapshot.board.updatedAt);
  const now = Date.parse(nowIso());
  const updatedAt = new Date(Math.max(now, currentTime + 1)).toISOString();
  snapshot.board.updatedAt = updatedAt;
  snapshot.project.updatedAt = updatedAt;
}

export function revisionFor(snapshot: BoardSnapshot): HostBoardRevisionV1 {
  return {
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
    updatedAt: snapshot.board.updatedAt,
  };
}

export function scopeFor(snapshot: BoardSnapshot): CanvasHostScopeV1 {
  return {
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
  };
}

export function runtimeDemand(snapshot: BoardSnapshot) {
  return {
    boardBound: true,
    hasBlocks: snapshot.blocks.length > 0,
    hasOperationBlocks: snapshot.blocks.some((block) => block.type === 'operation'),
    managerOpen: false,
    selectedBlockCount: 0,
  } as const;
}

export function assertScope(snapshot: BoardSnapshot, scope: CanvasHostScopeV1): void {
  if (
    snapshot.project.projectId !== scope.projectId
    || snapshot.board.boardId !== scope.boardId
  ) {
    throw new Error('Storage Adapter returned a Board outside the requested scope.');
  }
}

export function assertSnapshotIdentity(snapshot: BoardSnapshot): void {
  if (snapshot.project.projectId !== snapshot.board.projectId) {
    throw new Error('Storage Adapter returned a Board with inconsistent Project identity.');
  }
}

export function assertNewAsset(snapshot: BoardSnapshot, asset: AssetRecord): void {
  if (snapshot.assets.some((candidate) => candidate.assetId === asset.assetId)) {
    throw new Error(`Asset already exists: ${asset.assetId}.`);
  }
}

export function assertPersistedAsset(
  expected: AssetRecord,
  actual: AssetRecord,
  requestedAssetId?: string,
): void {
  if (
    expected.projectId !== actual.projectId
    || expected.kind !== actual.kind
    || (requestedAssetId !== undefined && requestedAssetId !== actual.assetId)
  ) {
    throw new Error('Storage Adapter changed Asset identity while persisting it.');
  }
}

export function attachAssetToBlock(
  snapshot: BoardSnapshot,
  blockId: string,
  asset: AssetRecord,
  options: { fileName?: string } = {},
): string | undefined {
  const block = requireBlock(snapshot, blockId);
  if (blockLockedByGroup(snapshot, blockId)) {
    throw new Error(`Block is locked by its Group: ${blockId}.`);
  }
  const expectedKind = block.type === 'document'
    ? 'document'
    : block.type === 'image'
      ? 'image'
      : block.type === 'video'
        ? 'video'
        : undefined;
  if (!expectedKind || expectedKind !== asset.kind) {
    throw new Error(`Asset kind ${asset.kind} is not compatible with ${block.type} Block.`);
  }
  const previousAssetId = typeof block.data.assetId === 'string'
    ? block.data.assetId
    : undefined;
  block.data.assetId = asset.assetId;
  block.data.previewUrl = asset.previewUrl;
  if (options.fileName !== undefined && block.type === 'image') {
    block.data.title = options.fileName || block.data.title;
    block.data.body = undefined;
    delete block.data.annotationDraft;
    block.size = fitImageBlockSize(asset.width, asset.height);
  }
  block.updatedAt = nowIso();
  return previousAssetId;
}

export function requireBlock(snapshot: BoardSnapshot, blockId: string): BlockRecord {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  if (!block) throw new Error(`Block not found: ${blockId}.`);
  return block;
}

export function assertKnownIds(
  snapshot: BoardSnapshot,
  blockIds: readonly string[],
  assetIds: readonly string[],
): void {
  for (const blockId of blockIds) requireBlock(snapshot, blockId);
  for (const assetId of assetIds) {
    if (!snapshot.assets.some((asset) => asset.assetId === assetId)) {
      throw new Error(`Asset not found: ${assetId}.`);
    }
  }
}

export function assertExecutionTransition(
  current: ExecutionStatus,
  next: ExecutionStatus,
): void {
  if (current === next) return;
  const allowed: Record<ExecutionStatus, readonly ExecutionStatus[]> = {
    canceled: [],
    failed: [],
    queued: ['running', 'failed', 'canceled'],
    running: ['succeeded', 'failed', 'canceled'],
    succeeded: [],
  };
  if (!allowed[current].includes(next)) {
    throw new Error(`Invalid Execution transition: ${current} -> ${next}.`);
  }
}

export function isTerminal(status: ExecutionStatus): boolean {
  return status === 'canceled' || status === 'failed' || status === 'succeeded';
}

export function appendExecutionHistory(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
): void {
  const type = execution.status === 'running'
    ? 'execution_started'
    : execution.status === 'succeeded'
      ? 'execution_succeeded'
      : execution.status === 'failed'
        ? 'execution_failed'
        : execution.status === 'canceled'
          ? 'execution_canceled'
          : undefined;
  if (!type) return;
  appendHistory(snapshot, {
    actor: 'system',
    assetIds: execution.outputAssetIds,
    blockIds: execution.outputBlockIds,
    executionId: execution.executionId,
    summary: `Execution ${execution.status}`,
    type,
  });
}

export function appendHistory(
  snapshot: BoardSnapshot,
  event: Omit<BoardHistoryEvent, 'createdAt' | 'eventId'>,
): void {
  snapshot.historyEvents = [{
    ...event,
    createdAt: nowIso(),
    eventId: createId('history'),
  }, ...(snapshot.historyEvents ?? [])].slice(0, 200);
}

export function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}
