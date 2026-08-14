import type { OperationToast } from '../components/OperationFeedback';
import type { useI18n } from '../i18n';
import type { RunProductCommand } from './useBoardSession';

interface ExecutionOutputSelectionControllerOptions {
  runProductCommand?: RunProductCommand;
  setOperationToast: (toast: OperationToast | undefined) => void;
  t: ReturnType<typeof useI18n>['t'];
}

export function useExecutionOutputSelectionController(
  options: ExecutionOutputSelectionControllerOptions,
) {
  const { runProductCommand, setOperationToast, t } = options;

  async function selectOutput(input: {
    assetId: string;
    blockId: string;
    executionId: string;
    expectedSelectionVersion: number;
  }): Promise<void> {
    try {
      const result = await requireProductCommands(runProductCommand)(
        (commands) => commands.executionOutput.select(input),
        {
          history: true,
          shouldKeepHistory: (selection) => selection.changed,
        },
      );
      if (!result.changed) return;
      setOperationToast({
        body: t('outputSelection.selectedBody'),
        id: `execution-output-selection:${input.executionId}:${input.assetId}`,
        title: t('outputSelection.selected'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        body: error instanceof Error ? error.message : undefined,
        id: `execution-output-selection:${input.executionId}:${input.assetId}`,
        title: t('outputSelection.failed'),
        tone: 'error',
      });
    }
  }

  return { selectOutput };
}

function requireProductCommands(
  runProductCommand: ExecutionOutputSelectionControllerOptions['runProductCommand'],
): NonNullable<ExecutionOutputSelectionControllerOptions['runProductCommand']> {
  if (!runProductCommand) {
    throw new Error('Whiteboard product command facade is unavailable.');
  }
  return runProductCommand;
}
