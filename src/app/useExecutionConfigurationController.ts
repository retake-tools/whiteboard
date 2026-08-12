import type { RefObject } from 'react';
import type { OperationToast } from '../components/OperationFeedback';
import type { BoardSnapshot } from '../core/types';
import type { useI18n } from '../i18n';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';

interface ExecutionConfigurationControllerOptions {
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: {
      history?: boolean;
      shouldKeepHistory?: (result: Result) => boolean;
      syncFlow?: boolean;
    },
  ) => Promise<Result>;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
}

export function useExecutionConfigurationController({
  setOperationToast,
  setSelectedBlock,
  runProductCommand,
  snapshotRef,
  t,
}: ExecutionConfigurationControllerOptions): {
  restoreConfigurationVersion(executionId: string): Promise<void>;
} {
  async function restoreConfigurationVersion(executionId: string): Promise<void> {
    if (!runProductCommand) {
      throw new Error('Whiteboard Execution configuration command facade is unavailable.');
    }
    const { result } = await runProductCommand(
      (commands) => commands.executionConfiguration.restore({ executionId }),
      {
        history: true,
        shouldKeepHistory: (outcome) => outcome.committed,
      },
    );
    if (!result.restored || !result.operationBlockId) {
      setOperationToast({
        id: `configuration-restore:${executionId}`,
        title: t('feedback.configurationRestoreUnavailable'),
        body: result.missingAssetIds.length
          ? `${t('feedback.configurationRestoreMissingAssets')} ${result.missingAssetIds.join(', ')}`
          : undefined,
        tone: 'error',
      });
      return;
    }
    setSelectedBlock(snapshotRef.current, result.operationBlockId);
    setOperationToast({
      id: `configuration-restored:${executionId}`,
      title: t('feedback.configurationRestored'),
    });
  }

  return { restoreConfigurationVersion };
}
