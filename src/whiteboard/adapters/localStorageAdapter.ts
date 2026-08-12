import { createAssetFromDataUrl } from '../../core/assetStore';
import {
  loadBoardSnapshot,
  loadWorkspaceSummary,
  saveBoardSnapshot,
} from '../../core/boardStore';
import type { AssetRecord, BoardSnapshot } from '../../core/types';
import type {
  CanvasHostScopeV1,
  DeepReadonly,
  HostPersistAssetOptionsV1,
  HostStorageAdapterV1,
  HostStorageSaveInputV1,
} from '../../host-kit';

export function createWhiteboardLocalStorageAdapter(
  initialSnapshot?: BoardSnapshot,
): HostStorageAdapterV1 {
  let cachedInitial = initialSnapshot ? structuredClone(initialSnapshot) : undefined;
  return Object.freeze({
    adapterVersion: 1,
    listWorkspace: loadWorkspaceSummary,
    async loadBoard(scope: CanvasHostScopeV1) {
      if (
        cachedInitial?.project.projectId === scope.projectId
        && cachedInitial.board.boardId === scope.boardId
      ) {
        const snapshot = cachedInitial;
        cachedInitial = undefined;
        return snapshot;
      }
      return loadBoardSnapshot(scope);
    },
    async persistAsset(
      asset: DeepReadonly<AssetRecord>,
      options?: HostPersistAssetOptionsV1,
    ) {
      if (!asset.previewUrl.startsWith('data:')) return structuredClone(asset);
      return createAssetFromDataUrl({
        dataUrl: asset.previewUrl,
        deferSnapshotRegistration: true,
        fileName: options?.fileName,
        height: asset.height,
        projectId: asset.projectId,
        sourceExecutionId: asset.sourceExecutionId,
        width: asset.width,
      });
    },
    async saveBoard(input: HostStorageSaveInputV1) {
      const snapshot = structuredClone(input.snapshot) as BoardSnapshot;
      await saveBoardSnapshot(snapshot, {
        expectedUpdatedAt: input.expectedRevision?.updatedAt,
      });
      return loadBoardSnapshot({
        boardId: snapshot.board.boardId,
        projectId: snapshot.project.projectId,
      });
    },
  });
}
