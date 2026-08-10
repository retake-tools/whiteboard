import { ArrowUpRight, CircleCheck, TriangleAlert } from 'lucide-react';
import type { ReactElement } from 'react';
import type { WorkflowAuthoringChecklistItemV1 } from '../core/workflowAuthoringGraph';
import { useI18n } from '../i18n';

export function WorkflowDesignValidationChecklist({
  items,
  onLocateStep,
}: {
  items: WorkflowAuthoringChecklistItemV1[];
  onLocateStep: (stepId: string) => void;
}): ReactElement {
  const { t } = useI18n();

  return (
    <details className="workflow-design-checklist" open={items.length > 0}>
      <summary>
        {items.length > 0 ? <TriangleAlert size={13} /> : <CircleCheck size={13} />}
        <strong>{t('workflowAuthoring.validationChecklist')}</strong>
        <small>{items.length}</small>
      </summary>
      {items.length > 0 ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${item.issue}:${index}`}>
              {item.stepId ? (
                <button type="button" onClick={() => {
                  if (item.stepId) onLocateStep(item.stepId);
                }}>
                  <span>
                    <strong>{item.stepId}</strong>
                    <small>{item.issue}</small>
                  </span>
                  <ArrowUpRight size={13} />
                </button>
              ) : (
                <span>
                  <strong>{t('workflowAuthoring.workflowScope')}</strong>
                  <small>{item.issue}</small>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('workflowAuthoring.noValidationIssues')}</p>
      )}
    </details>
  );
}
