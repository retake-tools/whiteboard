import { CircleCheck, PlayCircle } from 'lucide-react';
import type { ReactElement } from 'react';
import type { ProjectedWorkflowRevisionResult } from '../app/useWorkflowDraftController';
import { useI18n } from '../i18n';

export function WorkflowDesignProjectionResult({
  onCreateWorkflowRun,
  projection,
}: {
  onCreateWorkflowRun: (groupBlockId: string) => void;
  projection: ProjectedWorkflowRevisionResult;
}): ReactElement {
  const { t } = useI18n();
  return (
    <section className="workflow-design-projection-result" aria-live="polite">
      <header>
        <CircleCheck size={14} />
        <strong>{t('workflowAuthoring.projectionReady')}</strong>
      </header>
      <small>{t('workflowAuthoring.projectionDoesNotRun')}</small>
      <code>{projection.groupBlockId}</code>
      <button type="button" onClick={() => onCreateWorkflowRun(projection.groupBlockId)}>
        <PlayCircle size={14} />
        {t('workflowRuntime.create')}
      </button>
    </section>
  );
}
