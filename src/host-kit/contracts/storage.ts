import type {
  AssetRecord,
  BoardSnapshot,
  WorkspaceSummary,
} from '../../core/types';
import type { DeepReadonly } from './readonly';

export interface CanvasHostScopeV1 {
  readonly boardId: string;
  readonly projectId: string;
}

export interface HostBoardRevisionV1 extends CanvasHostScopeV1 {
  readonly updatedAt: string;
}

export interface HostStorageSaveInputV1 {
  readonly expectedRevision?: HostBoardRevisionV1;
  readonly snapshot: DeepReadonly<BoardSnapshot>;
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
  listWorkspace(): Promise<WorkspaceSummary>;
  loadBoard(scope: CanvasHostScopeV1): Promise<BoardSnapshot>;
  saveBoard(input: HostStorageSaveInputV1): Promise<BoardSnapshot>;
  persistAsset(
    asset: DeepReadonly<AssetRecord>,
    options?: HostPersistAssetOptionsV1,
  ): Promise<AssetRecord>;
}
