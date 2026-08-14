import { touchBoard } from './blockFactory';
import { createId, nowIso } from './id';
import type {
  AssetRecord,
  BlockRecord,
  BoardHistoryEvent,
  BoardSnapshot,
  ExecutionOutputSelectionRecord,
  ExecutionRecord,
} from './types';

export interface SelectedExecutionOutput {
  asset: AssetRecord;
  block: BlockRecord;
  execution: ExecutionRecord;
  selection: ExecutionOutputSelectionRecord;
}

export function executionOutputSelection(
  snapshot: BoardSnapshot,
  executionId: string,
): ExecutionOutputSelectionRecord | undefined {
  return snapshot.executionOutputSelections?.find(
    (selection) => selection.executionId === executionId,
  );
}

export function selectedExecutionOutput(
  snapshot: BoardSnapshot,
  executionId: string,
): SelectedExecutionOutput | undefined {
  const selection = executionOutputSelection(snapshot, executionId);
  return selection ? resolveSelectedExecutionOutput(snapshot, selection) : undefined;
}

function resolveSelectedExecutionOutput(
  snapshot: BoardSnapshot,
  selection: ExecutionOutputSelectionRecord,
): SelectedExecutionOutput | undefined {
  const execution = snapshot.executions.find(
    (candidate) => candidate.executionId === selection.executionId,
  );
  if (!execution || !executionMatchesBoard(snapshot, execution)) return undefined;
  const block = snapshot.blocks.find(
    (candidate) => candidate.blockId === selection.selectedBlockId,
  );
  const asset = snapshot.assets.find(
    (candidate) => candidate.assetId === selection.selectedAssetId,
  );
  if (!block || !asset || !isExactExecutionOutput(execution, block, asset)) return undefined;
  return { asset, block, execution, selection };
}

export function selectExecutionOutput(
  snapshot: BoardSnapshot,
  input: {
    assetId: string;
    blockId: string;
    executionId: string;
    expectedSelectionVersion: number;
    selectedBy?: ExecutionOutputSelectionRecord['selectedBy'];
  },
): { changed: boolean; selection: ExecutionOutputSelectionRecord } {
  const execution = snapshot.executions.find(
    (candidate) => candidate.executionId === input.executionId,
  );
  if (!execution) throw new Error(`Execution not found: ${input.executionId}`);
  if (!executionMatchesBoard(snapshot, execution)) {
    throw new Error(`Execution scope does not match the Board: ${input.executionId}`);
  }
  const current = executionOutputSelection(snapshot, execution.executionId);
  const currentVersion = current?.recordVersion ?? 0;
  if (currentVersion !== input.expectedSelectionVersion) {
    throw new Error(`Execution output selection version conflict: ${execution.executionId}`);
  }
  const block = snapshot.blocks.find((candidate) => candidate.blockId === input.blockId);
  const asset = snapshot.assets.find((candidate) => candidate.assetId === input.assetId);
  if (!block || !asset || !isExactExecutionOutput(execution, block, asset)) {
    throw new Error(`Asset and Block are not an exact output of this Execution: ${execution.executionId}`);
  }
  if (
    current?.selectedAssetId === asset.assetId
    && current.selectedBlockId === block.blockId
  ) {
    return { changed: false, selection: current };
  }

  const selectedAt = nowIso();
  const selection: ExecutionOutputSelectionRecord = {
    executionId: execution.executionId,
    recordVersion: currentVersion + 1,
    selectedAssetId: asset.assetId,
    selectedAt,
    selectedBlockId: block.blockId,
    selectedBy: input.selectedBy ?? 'user',
  };
  snapshot.executionOutputSelections = [
    ...(snapshot.executionOutputSelections ?? []).filter(
      (candidate) => candidate.executionId !== execution.executionId,
    ),
    selection,
  ];
  const historyEvent: BoardHistoryEvent = {
    actor: selection.selectedBy,
    assetIds: [asset.assetId],
    blockIds: [block.blockId],
    createdAt: selectedAt,
    detail: {
      previousSelectedAssetId: current?.selectedAssetId,
      previousSelectedBlockId: current?.selectedBlockId,
      selectionVersion: selection.recordVersion,
    },
    eventId: createId('history'),
    executionId: execution.executionId,
    summary: `Output selected: ${block.data.title}`,
    type: 'output_selected',
  };
  snapshot.historyEvents = [historyEvent, ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);
  return { changed: true, selection };
}

export function pruneInvalidExecutionOutputSelections(snapshot: BoardSnapshot): void {
  const validByExecutionId = new Map<string, ExecutionOutputSelectionRecord>();
  for (const selection of snapshot.executionOutputSelections ?? []) {
    if (!resolveSelectedExecutionOutput(snapshot, selection)) continue;
    const current = validByExecutionId.get(selection.executionId);
    if (!current || current.recordVersion < selection.recordVersion) {
      validByExecutionId.set(selection.executionId, selection);
    }
  }
  snapshot.executionOutputSelections = [...validByExecutionId.values()];
}

function executionMatchesBoard(snapshot: BoardSnapshot, execution: ExecutionRecord): boolean {
  return execution.projectId === snapshot.project.projectId
    && execution.boardId === snapshot.board.boardId;
}

function isExactExecutionOutput(
  execution: ExecutionRecord,
  block: BlockRecord,
  asset: AssetRecord,
): boolean {
  return block.boardId === execution.boardId
    && asset.projectId === execution.projectId
    && block.data.assetId === asset.assetId
    && execution.outputBlockIds.includes(block.blockId)
    && execution.outputAssetIds.includes(asset.assetId);
}
