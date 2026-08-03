import { ArrowRight, CircleAlert } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';

export type WorkflowStepCardTone = 'attention' | 'danger' | 'neutral' | 'success' | 'working';

export function WorkflowStepCard({
  action,
  attentionLabel,
  behaviorLabel,
  eyebrow,
  identifier,
  inputSummary,
  mode,
  outputSummary,
  selected,
  statusLabel,
  statusTone,
  title,
}: {
  action?: ReactNode;
  attentionLabel?: string;
  behaviorLabel: string;
  eyebrow: string;
  identifier: string;
  inputSummary: string;
  mode: 'design' | 'run';
  outputSummary: string;
  selected: boolean;
  statusLabel: string;
  statusTone: WorkflowStepCardTone;
  title: string;
}): ReactElement {
  return (
    <article className={`workflow-step-card is-${mode} is-${statusTone}${selected ? ' is-selected' : ''}`}>
      <header>
        <span>{eyebrow}</span>
        <strong>{statusLabel}</strong>
      </header>
      <div className="workflow-step-card-title">
        <strong title={title}>{title}</strong>
        {attentionLabel ? (
          <span className="workflow-step-card-attention">
            <CircleAlert size={12} />{attentionLabel}
          </span>
        ) : null}
      </div>
      <small title={identifier}>{identifier}</small>
      <div className="workflow-step-card-typed" aria-label={`${inputSummary} → ${outputSummary}`}>
        <span>{inputSummary}</span>
        <ArrowRight size={11} />
        <span>{outputSummary}</span>
      </div>
      <footer>
        <span title={behaviorLabel}>{behaviorLabel}</span>
        {action}
      </footer>
    </article>
  );
}
