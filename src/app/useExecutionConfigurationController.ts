import type { RefObject } from 'react';
import type { OperationToast } from '../components/OperationFeedback';
import { restoreExecutionConfiguration } from '../core/restoreExecutionConfiguration';
import type { BoardSnapshot } from '../core/types';
import type { useI18n } from '../i18n';

interface ExecutionConfigurationControllerOptions {
  setOperationToast: (toast: OperationToast | undefined) => void;
  setSelectedBlock: (snapshot: BoardSnapshot, blockId: string) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useExecutionConfigurationController({
  setOperationToast,
  setSelectedBlock,
  snapshotRef,
  t,
  updateSnapshot,
}: ExecutionConfigurationControllerOptions): {
  restoreConfigurationVersion(executionId: string): void;
} {
  function restoreConfigurationVersion(executionId: string): void {
    const candidate = structuredClone(snapshotRef.current);
    const result = restoreExecutionConfiguration(candidate, executionId);
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
    const nextSnapshot = updateSnapshot(
      () => candidate,
      { persist: true, history: true },
    );
    setSelectedBlock(nextSnapshot, result.operationBlockId);
    setOperationToast({
      id: `configuration-restored:${executionId}`,
      title: t('feedback.configurationRestored'),
    });
  }

  return { restoreConfigurationVersion };
}
