import { Hand, Sparkles } from 'lucide-react';
import type { ReactElement } from 'react';
import { useI18n } from '../i18n';
import { useUnifiedComposerDraft } from './UnifiedComposerProvider';

export function WorkflowExecutionModeControl(): ReactElement {
  const { t } = useI18n();
  const { setWorkflowExecutionMode, workflowExecutionMode } = useUnifiedComposerDraft();

  return (
    <div
      className="workflow-execution-mode"
      aria-label={t('skillComposer.workflowExecutionMode')}
      role="group"
    >
      <button
        type="button"
        aria-pressed={workflowExecutionMode === 'automatic'}
        className={workflowExecutionMode === 'automatic' ? 'is-selected' : undefined}
        onClick={() => setWorkflowExecutionMode('automatic')}
      >
        <Sparkles size={13} strokeWidth={1.75} />
        <span>{t('skillComposer.workflowAutomatic')}</span>
      </button>
      <button
        type="button"
        aria-pressed={workflowExecutionMode === 'manual'}
        className={workflowExecutionMode === 'manual' ? 'is-selected' : undefined}
        onClick={() => setWorkflowExecutionMode('manual')}
      >
        <Hand size={13} strokeWidth={1.75} />
        <span>{t('skillComposer.workflowManual')}</span>
      </button>
    </div>
  );
}
