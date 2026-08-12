import type { ProjectArtifactLibraryItem } from '../../core/artifactContracts';
import { insertArtifactReference } from '../../core/artifactLibrary';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardArtifactCommandsV1 {
  insertReference(input: {
    fallbackPosition: { x: number; y: number };
    item: ProjectArtifactLibraryItem;
    targetOperationId?: string;
    targetSlotId?: string;
  }): Promise<{
    blockId: string;
    boundToOperation: boolean;
  }>;
}

export function createWhiteboardArtifactCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardArtifactCommandsV1 {
  return Object.freeze({
    async insertReference(
      input: Parameters<WhiteboardArtifactCommandsV1['insertReference']>[0],
    ) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const targetOperation = input.targetOperationId
          ? snapshot.blocks.find(
              (block) => block.blockId === input.targetOperationId && block.type === 'operation',
            )
          : undefined;
        if (input.targetOperationId && !targetOperation) {
          throw new Error('Artifact target Operation is no longer available.');
        }
        const boundToOperation = Boolean(targetOperation && input.targetSlotId);
        const block = insertArtifactReference(snapshot, {
          item: input.item,
          position: targetOperation
            ? { x: targetOperation.position.x - 360, y: targetOperation.position.y }
            : input.fallbackPosition,
          targetOperationId: boundToOperation ? targetOperation?.blockId : undefined,
          targetSlotId: boundToOperation ? input.targetSlotId : undefined,
        });
        return { blockId: block.blockId, boundToOperation };
      });
      return transaction.result;
    },
  });
}
