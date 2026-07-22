import type { OperationToast } from '../components/OperationFeedback';
import type { BoardSnapshot } from '../core/types';
import { createWorkflowRunForGroup } from '../core/workflowRuntime';
import type { useI18n } from '../i18n';

interface WorkflowRuntimeControllerOptions {
  setOperationToast: (toast: OperationToast | undefined) => void;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

export function useWorkflowRuntimeController(options: WorkflowRuntimeControllerOptions) {
  const { setOperationToast, t, updateSnapshot } = options;

  function createWorkflowRun(groupId: string): void {
    try {
      let workflowRunId = '';
      updateSnapshot((current) => {
        const view = createWorkflowRunForGroup(current, groupId);
        workflowRunId = view.record.workflowRunId;
        return current;
      }, { history: true, persist: true });
      setOperationToast({
        id: workflowRunId || `workflow-run:${groupId}`,
        title: t('workflowRuntime.created'),
        body: t('workflowRuntime.createdBody'),
        tone: 'success',
      });
    } catch (error) {
      setOperationToast({
        id: `workflow-run:${groupId}`,
        title: t('workflowRuntime.createFailed'),
        body: error instanceof Error ? error.message : undefined,
        tone: 'error',
      });
    }
  }

  return { createWorkflowRun };
}
