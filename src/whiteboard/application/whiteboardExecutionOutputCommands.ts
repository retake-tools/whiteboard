import { selectExecutionOutput } from '../../core/executionOutputSelection';
import type { ExecutionOutputSelectionRecord } from '../../core/types';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardExecutionOutputCommandsV1 {
  select(input: {
    assetId: string;
    blockId: string;
    executionId: string;
    expectedSelectionVersion: number;
  }): Promise<{
    changed: boolean;
    selection: ExecutionOutputSelectionRecord;
  }>;
}

export function createWhiteboardExecutionOutputCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardExecutionOutputCommandsV1 {
  return Object.freeze({
    async select(input: Parameters<WhiteboardExecutionOutputCommandsV1['select']>[0]) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        const result = selectExecutionOutput(snapshot, input);
        return { changed: result.changed, result };
      });
      return transaction.result;
    },
  });
}
