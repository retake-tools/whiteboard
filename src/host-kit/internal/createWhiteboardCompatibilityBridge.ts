import type { AssetRecord, BoardSnapshot } from '../../core/types';
import type {
  DeepReadonly,
  HostBoardRevisionV1,
  HostPersistAssetOptionsV1,
} from '../contracts';
import {
  assertNewAsset,
  assertPersistedAsset,
  assertScope,
  assertSnapshotIdentity,
  immutableValue,
  revisionFor,
  scopeFor,
  touch,
} from '../application/canvasHostSupport';
import type { WhiteboardCanvasHostBridge } from './whiteboardCompatibility';

interface WhiteboardCompatibilityBridgeState {
  current(): BoardSnapshot;
  durableRevision(): HostBoardRevisionV1;
  persistAsset(
    asset: DeepReadonly<AssetRecord>,
    options?: HostPersistAssetOptionsV1,
  ): Promise<AssetRecord>;
  publish(snapshot: BoardSnapshot): void;
  requireActive(): void;
  saveStaged(
    snapshot: BoardSnapshot,
    expectedRevision: HostBoardRevisionV1 | undefined,
  ): Promise<BoardSnapshot>;
  serialize<Result>(operation: () => Promise<Result>): Promise<Result>;
  setDurableRevision(revision: HostBoardRevisionV1): void;
}

export function createWhiteboardCompatibilityBridge(
  state: WhiteboardCompatibilityBridgeState,
): WhiteboardCanvasHostBridge {
  return {
    async executeConditionalProductTransaction(operation) {
      return state.serialize(async () => {
        state.requireActive();
        const expectedRevision = state.durableRevision();
        const staged = structuredClone(state.current());
        const { changed, result } = operation(staged);
        assertSnapshotIdentity(staged);
        assertScope(staged, scopeFor(state.current()));
        if (!changed) {
          return {
            committed: false,
            result,
            snapshot: structuredClone(state.current()),
          };
        }
        touch(staged);
        const saved = await state.saveStaged(staged, expectedRevision);
        return {
          committed: true,
          result,
          snapshot: structuredClone(saved),
        };
      });
    },
    async executeProductTransaction(operation) {
      return state.serialize(async () => {
        state.requireActive();
        const expectedRevision = state.durableRevision();
        const staged = structuredClone(state.current());
        const result = operation(staged);
        assertSnapshotIdentity(staged);
        assertScope(staged, scopeFor(state.current()));
        touch(staged);
        const saved = await state.saveStaged(staged, expectedRevision);
        return {
          result,
          snapshot: structuredClone(saved),
        };
      });
    },
    async persistProductAsset(input) {
      return state.serialize(async () => {
        state.requireActive();
        const current = state.current();
        assertScope(current, input.scope);
        const asset = structuredClone(input.asset);
        if (asset.projectId !== input.scope.projectId) {
          throw new Error('Product Asset belongs to another Project.');
        }
        assertNewAsset(current, asset);
        const persisted = await state.persistAsset(
          immutableValue(asset),
          input.options,
        );
        assertPersistedAsset(asset, persisted);
        assertNewAsset(state.current(), persisted);
        return structuredClone(persisted);
      });
    },
    async persistSnapshot(snapshot) {
      return state.serialize(async () => {
        state.requireActive();
        assertSnapshotIdentity(snapshot);
        assertScope(snapshot, scopeFor(state.current()));
        return state.saveStaged(
          structuredClone(snapshot),
          state.durableRevision(),
        );
      });
    },
    replaceSnapshot(snapshot, options = {}) {
      state.requireActive();
      assertSnapshotIdentity(snapshot);
      assertScope(snapshot, scopeFor(state.current()));
      state.publish(snapshot);
      if (options.durable) state.setDurableRevision(revisionFor(snapshot));
      return structuredClone(snapshot);
    },
  };
}
