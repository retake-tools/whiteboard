import type { DeepReadonly } from './readonly';
import type {
  CanvasHostAssetRecordV1,
  CanvasHostBoardSnapshotV1,
  CanvasHostWorkspaceSummaryV1,
} from './domain';

export interface CanvasHostScopeV1 {
  readonly boardId: string;
  readonly projectId: string;
}

export interface HostBoardRevisionV1 extends CanvasHostScopeV1 {
  readonly updatedAt: string;
}

export interface HostStorageSaveInputV1 {
  readonly expectedRevision?: HostBoardRevisionV1;
  readonly snapshot: DeepReadonly<CanvasHostBoardSnapshotV1>;
}

export interface HostPersistAssetOptionsV1 {
  /** Optional original name used by byte-backed adapters when choosing a safe storage filename. */
  readonly fileName?: string;
}

/**
 * Durable infrastructure boundary. Adapters may use local files, a remote API,
 * or memory, but they must return canonical Retake records.
 */
export interface HostStorageAdapterV1 {
  readonly adapterVersion: 1;
  listWorkspace(): Promise<CanvasHostWorkspaceSummaryV1>;
  loadBoard(scope: CanvasHostScopeV1): Promise<CanvasHostBoardSnapshotV1>;
  saveBoard(input: HostStorageSaveInputV1): Promise<CanvasHostBoardSnapshotV1>;
  persistAsset(
    asset: DeepReadonly<CanvasHostAssetRecordV1>,
    options?: HostPersistAssetOptionsV1,
  ): Promise<CanvasHostAssetRecordV1>;
}
