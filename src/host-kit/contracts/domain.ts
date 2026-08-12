import type {
  AssetRecord,
  BlockRecord,
  BoardSnapshot,
  ExecutionRecord,
  WorkspaceSummary,
} from '../../core/types';

/** Canonical Retake facts exposed to every Canvas Host through immutable reads. */
export type CanvasHostAssetRecordV1 = AssetRecord;
export type CanvasHostBlockRecordV1 = BlockRecord;
export type CanvasHostBoardSnapshotV1 = BoardSnapshot;
export type CanvasHostExecutionRecordV1 = ExecutionRecord;
export type CanvasHostWorkspaceSummaryV1 = WorkspaceSummary;

