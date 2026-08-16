import type { ProjectAssetCatalogItem } from '../../core/projectAssetCatalog';
import { insertProjectAssetReference } from '../../core/projectAssetCatalog';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardAssetCommandsV1 {
  insertReference(input: {
    item: ProjectAssetCatalogItem;
    position: { x: number; y: number };
  }): Promise<{ blockId: string }>;
}

export function createWhiteboardAssetCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardAssetCommandsV1 {
  return Object.freeze({
    async insertReference(input: Parameters<WhiteboardAssetCommandsV1['insertReference']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const block = insertProjectAssetReference(snapshot, input);
        return { blockId: block.blockId };
      });
      return transaction.result;
    },
  });
}
