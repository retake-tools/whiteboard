import type { ReactElement } from 'react';
import type { WorkflowDefinition } from '../core/workflowRegistry';
import { useI18n } from '../i18n';

export function WorkflowDesignMetadata({
  collapsed,
  definition,
  onChange,
}: {
  collapsed: boolean;
  definition: WorkflowDefinition;
  onChange: (definition: WorkflowDefinition) => void;
}): ReactElement {
  const { t } = useI18n();
  return (
    <details
      key={collapsed ? 'collapsed' : 'expanded'}
      className="workflow-design-metadata"
      open={!collapsed}
    >
      <summary>{t('workflowInspector.workflowMetadata')}</summary>
      <div>
        <label>
          <span>{t('workflowAuthoring.name')}</span>
          <input
            name="workflow-name"
            value={definition.name}
            onChange={(event) => onChange({ ...definition, name: event.target.value })}
          />
        </label>
        <label>
          <span>{t('workflowAuthoring.description')}</span>
          <textarea
            name="workflow-description"
            value={definition.description}
            onChange={(event) => onChange({ ...definition, description: event.target.value })}
          />
        </label>
        <label>
          <span>{t('workflowAuthoring.version')}</span>
          <input
            name="workflow-version"
            value={definition.version}
            onChange={(event) => onChange({ ...definition, version: event.target.value })}
          />
        </label>
      </div>
    </details>
  );
}
