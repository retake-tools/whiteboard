import { Check, CircleAlert, CircleStop, MapPin, MessageSquareText } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import type { AgentRunIntervention } from '../core/agentRunIntervention';
import type { WorkflowApprovalDecisionValue } from '../core/workflowGateContracts';
import { useI18n } from '../i18n';

export function AgentWorkflowApprovalMessage({
  agentRunId,
  intervention,
  onCancelAgentRun,
  onDecideWorkflowApproval,
  onLocateBlock,
}: {
  agentRunId: string;
  intervention: AgentRunIntervention;
  onCancelAgentRun: (agentRunId: string) => void;
  onDecideWorkflowApproval: (
    approvalRequestId: string,
    expectedApprovalRequestVersion: number,
    decision: WorkflowApprovalDecisionValue,
  ) => void | Promise<void>;
  onLocateBlock: (blockId: string) => void;
}): ReactElement {
  const { t } = useI18n();
  const [pendingAction, setPendingAction] = useState('');
  const canDecide = Boolean(
    intervention.approvalRequestId
    && intervention.expectedApprovalRequestVersion !== undefined,
  );

  async function decide(decision: WorkflowApprovalDecisionValue): Promise<void> {
    if (!canDecide || pendingAction) return;
    setPendingAction(decision);
    try {
      await onDecideWorkflowApproval(
        intervention.approvalRequestId!,
        intervention.expectedApprovalRequestVersion!,
        decision,
      );
    } finally {
      setPendingAction('');
    }
  }

  return (
    <article className="agent-workflow-approval-message" role="group" aria-label={t('agentWorkspace.workflowApprovalHeader')}>
      <span className="agent-workflow-step-avatar" aria-hidden="true">
        <CircleAlert size={15} />
      </span>
      <div className="agent-workflow-step-message-body">
        <header>
          <span>{t('agentWorkspace.workflowApprovalHeader')}</span>
          <small>{t('agentWorkspace.workflowApprovalWaiting')}</small>
        </header>
        <strong>{intervention.approvalCompletesWorkflow
          ? t('agentWorkspace.workflowApprovalFinalTitle')
          : intervention.targetLabel ?? t('agentWorkspace.intervention.approval.title')}</strong>
        <p>{t('agentWorkspace.workflowApprovalBody')}</p>
        {intervention.reviewChecklist?.length ? (
          <div className="agent-workflow-approval-checklist">
            <span><MessageSquareText size={13} />{t('agentWorkspace.workflowApprovalChecklist')}</span>
            <ul>
              {intervention.reviewChecklist.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </div>
        ) : null}
        <div className="agent-workflow-step-actions">
          <button
            type="button"
            className="is-primary"
            disabled={!canDecide || Boolean(pendingAction)}
            onClick={() => void decide('approve')}
          >
            <Check size={14} />
            {t(intervention.approvalCompletesWorkflow
              ? 'agentWorkspace.workflowApprovalApproveComplete'
              : 'agentWorkspace.workflowApprovalApproveContinue')}
          </button>
          <button
            type="button"
            disabled={!canDecide || Boolean(pendingAction)}
            onClick={() => void decide('reject')}
          >
            <MessageSquareText size={14} />
            {t('agentWorkspace.workflowApprovalRevise')}
          </button>
          {intervention.locateBlockId ? (
            <button
              type="button"
              disabled={Boolean(pendingAction)}
              onClick={() => onLocateBlock(intervention.locateBlockId!)}
            >
              <MapPin size={14} />
              {t('agentWorkspace.workflowApprovalLocate')}
            </button>
          ) : null}
          <button
            type="button"
            disabled={Boolean(pendingAction)}
            onClick={() => onCancelAgentRun(agentRunId)}
          >
            <CircleStop size={14} />
            {t('agentWorkspace.workflowApprovalCancel')}
          </button>
        </div>
      </div>
    </article>
  );
}
