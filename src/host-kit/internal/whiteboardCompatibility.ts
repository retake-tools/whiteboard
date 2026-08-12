import type { AssetRecord, BoardSnapshot } from '../../core/types';
import type {
  CanvasHostScopeV1,
  CanvasHostV1,
  HostPersistAssetOptionsV1,
} from '../contracts';

export interface WhiteboardCanvasHostBridge {
  executeConditionalProductTransaction<Result>(
    operation: (staged: BoardSnapshot) => {
      changed: boolean;
      result: Result;
    },
  ): Promise<{
    committed: boolean;
    result: Result;
    snapshot: BoardSnapshot;
  }>;
  executeProductTransaction<Result>(
    operation: (staged: BoardSnapshot) => Result,
  ): Promise<{ result: Result; snapshot: BoardSnapshot }>;
  persistProductAsset(input: {
    asset: AssetRecord;
    options?: HostPersistAssetOptionsV1;
    scope: CanvasHostScopeV1;
  }): Promise<AssetRecord>;
  persistSnapshot(snapshot: BoardSnapshot): Promise<BoardSnapshot>;
  replaceSnapshot(
    snapshot: BoardSnapshot,
    options?: { readonly durable?: boolean },
  ): BoardSnapshot;
}

const bridges = new WeakMap<CanvasHostV1, WhiteboardCanvasHostBridge>();

export function registerWhiteboardCanvasHostBridge(
  host: CanvasHostV1,
  bridge: WhiteboardCanvasHostBridge,
): void {
  bridges.set(host, bridge);
}

export function whiteboardCanvasHostBridge(host: CanvasHostV1): WhiteboardCanvasHostBridge {
  const bridge = bridges.get(host);
  if (!bridge) throw new Error('Whiteboard compatibility bridge is unavailable for this Canvas Host.');
  return bridge;
}
