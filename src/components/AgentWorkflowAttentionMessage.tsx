import { CircleAlert, MapPin, RefreshCw } from 'lucide-react';
import { useState, type ReactElement } from 'react';
import type {
  AgentRunAttentionReason,
  AgentRunIntervention,
} from '../core/agentRunIntervention';
import { useI18n } from '../i18n';

export function AgentWorkflowAttentionMessage({
  agentRunId,
  intervention,
  onLocateBlock,
  onPrepareWorkflowReview,
  onRequestAgentHelp,
  onRetryAgentRun,
  canRetry,
  retryResultCount,
}: {
  agentRunId: string;
  intervention: AgentRunIntervention;
  onLocateBlock: (blockId: string) => void;
  onPrepareWorkflowReview: (stepRunId: string) => void | Promise<void>;
  onRequestAgentHelp: () => void;
  onRetryAgentRun: (agentRunId: string, retryExecutionId?: string) => void | Promise<void>;
  canRetry: boolean;
  retryResultCount?: number;
}): ReactElement {
  const { t } = useI18n();
  const [isResolving, setIsResolving] = useState(false);

  async function retryAndContinue(): Promise<void> {
    if (!canRetry || isResolving) return;
    setIsResolving(true);
    try {
      await onRetryAgentRun(agentRunId, intervention.retryExecutionId);
    } finally {
      setIsResolving(false);
    }
  }

  async function prepareReview(): Promise<void> {
    if (!intervention.prepareReviewStepRunId || isResolving) return;
    setIsResolving(true);
    try {
      await onPrepareWorkflowReview(intervention.prepareReviewStepRunId);
    } finally {
      setIsResolving(false);
    }
  }

  return (
    <article
      className="agent-workflow-attention-message"
      role="group"
      aria-label={t('agentWorkspace.workflowAttentionHeader')}
    >
      <span className="agent-workflow-step-avatar" aria-hidden="true">
        <CircleAlert size={15} />
      </span>
      <div className="agent-workflow-step-message-body">
        <header>
          <span>{t('agentWorkspace.workflowAttentionHeader')}</span>
          <small>{t('agentWorkspace.workflowAttentionWaiting')}</small>
        </header>
        <strong>{intervention.attentionReason === 'review_not_ready'
          ? t('agentWorkspace.workflowApprovalFinalTitle')
          : intervention.targetLabel ?? t('agentWorkspace.intervention.attention.title')}</strong>
        <p>{t(workflowAttentionBodyKey(intervention.attentionReason))}</p>
        <div className="agent-workflow-step-actions">
          {intervention.prepareReviewStepRunId ? (
            <button
              type="button"
              className="is-primary"
              disabled={isResolving}
              onClick={() => void prepareReview()}
            >
              <RefreshCw size={14} />
              {t(isResolving
                ? 'agentWorkspace.workflowAttentionPreparingReview'
                : 'agentWorkspace.workflowAttentionPrepareReview')}
            </button>
          ) : canRetry ? (
            <button
              type="button"
              className="is-primary"
              disabled={isResolving}
              onClick={() => void retryAndContinue()}
            >
              <RefreshCw size={14} />
              {isResolving
                ? t('agentWorkspace.workflowAttentionRetrying')
                : retryResultCount
                  ? t('agentWorkspace.workflowAttentionRetryResults')
                    .replace('{count}', String(retryResultCount))
                  : t('agentWorkspace.workflowAttentionRetry')}
            </button>
          ) : (
            <button
              type="button"
              className="is-primary"
              onClick={onRequestAgentHelp}
            >
              <RefreshCw size={14} />
              {t('agentWorkspace.workflowAttentionAskAgent')}
            </button>
          )}
          {intervention.locateBlockId ? (
            <button
              type="button"
              disabled={isResolving}
              onClick={() => onLocateBlock(intervention.locateBlockId!)}
            >
              <MapPin size={14} />
              {t('agentWorkspace.workflowLocateStep')}
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function workflowAttentionBodyKey(reason?: AgentRunAttentionReason) {
  if (reason === 'execution_missing') {
    return 'agentWorkspace.workflowAttentionBodyExecutionMissing' as const;
  }
  if (reason === 'execution_failed') {
    return 'agentWorkspace.workflowAttentionBodyExecutionFailed' as const;
  }
  if (reason === 'outdated') {
    return 'agentWorkspace.workflowAttentionBodyOutdated' as const;
  }
  if (reason === 'review_not_ready') {
    return 'agentWorkspace.workflowAttentionBodyReviewNotReady' as const;
  }
  if (reason === 'retired_definition') {
    return 'agentWorkspace.workflowAttentionBodyRetiredDefinition' as const;
  }
  return 'agentWorkspace.workflowAttentionBody' as const;
}
