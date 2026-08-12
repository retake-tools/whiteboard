import { createBlankBoardSnapshot } from '../../core/application/createBlankBoardSnapshot';
import type { CanvasHostBoardSnapshotV1 } from '../contracts';

export interface CreateCanvasHostBoardSnapshotInputV1 {
  readonly boardId?: string;
  readonly boardName: string;
  readonly projectId?: string;
  readonly projectName: string;
}

/** Creates the canonical initial Snapshot required by a new Canvas Host. */
export function createCanvasHostBoardSnapshot(
  input: CreateCanvasHostBoardSnapshotInputV1,
): CanvasHostBoardSnapshotV1 {
  return createBlankBoardSnapshot(input);
}

