import type { ReactElement } from 'react';
import type { ProjectWorkflowRevisionV1 } from '../core/workflowAuthoringContracts';
import { useI18n } from '../i18n';

export function WorkflowDesignRevisionList({
  onProjectRevision,
  revisions,
}: {
  onProjectRevision: (revision: ProjectWorkflowRevisionV1) => void;
  revisions: ProjectWorkflowRevisionV1[];
}): ReactElement {
  const { t } = useI18n();
  return (
    <>
      <header><strong>{t('workflowAuthoring.published')}</strong><small>{revisions.length}</small></header>
      {revisions.map((revision) => (
        <div key={revision.revisionId} className="workflow-design-revision">
          <strong>{revision.definition.name}</strong>
          <small>{revision.definition.version}</small>
          <button type="button" onClick={() => onProjectRevision(revision)}>
            {t('workflowAuthoring.projectToBoard')}
          </button>
        </div>
      ))}
    </>
  );
}
