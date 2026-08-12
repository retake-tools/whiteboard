import {
  restoreExecutionConfiguration,
  type RestoreExecutionConfigurationResult,
} from '../../core/restoreExecutionConfiguration';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardExecutionConfigurationCommandsV1 {
  restore(input: { executionId: string }): Promise<{
    committed: boolean;
    result: RestoreExecutionConfigurationResult;
  }>;
}

export function createWhiteboardExecutionConfigurationCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardExecutionConfigurationCommandsV1 {
  return Object.freeze({
    async restore(input: { executionId: string }) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        const result = restoreExecutionConfiguration(snapshot, input.executionId);
        return { changed: result.restored, result };
      });
      return {
        committed: transaction.committed,
        result: transaction.result,
      };
    },
  });
}
