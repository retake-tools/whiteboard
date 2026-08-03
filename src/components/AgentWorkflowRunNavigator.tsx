import { Activity, ArrowUpRight, Workflow } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { AgentRunRecord } from '../core/agentRuntimeContracts';
import type { BoardSnapshot } from '../core/types';
import {
  workflowRunExperienceFor,
  type WorkflowRunExperienceItemView,
} from '../core/workflowRunExperience';
import { useI18n } from '../i18n';

export function AgentWorkflowRunNavigator({
  activeAgentRun,
  onOpenWorkflowRun,
  snapshot,
}: {
  activeAgentRun?: AgentRunRecord;
  onOpenWorkflowRun: (workflowRunId: string) => void;
  snapshot: BoardSnapshot;
}): ReactElement | null {
  const { t } = useI18n();
  const experience = useMemo(
    () => workflowRunExperienceFor(snapshot, activeAgentRun),
    [activeAgentRun, snapshot],
  );
  const [selectedWorkflowRunId, setSelectedWorkflowRunId] = useState(
    experience.defaultWorkflowRunId ?? '',
  );

  useEffect(() => {
    setSelectedWorkflowRunId(experience.defaultWorkflowRunId ?? '');
  }, [activeAgentRun?.agentRunId]);

  const selectedRun = experience.runs.find(
    (run) => run.workflowRunId === selectedWorkflowRunId,
  ) ?? experience.runs[0];
  if (!selectedRun) return null;
  const progress = selectedRun.totalStepCount > 0
    ? Math.round(
      (selectedRun.completedStepCount / selectedRun.totalStepCount) * 100,
    )
    : 0;
  const currentSteps = selectedRun.steps.filter((step) => step.role === 'current');
  const nextSteps = selectedRun.steps.filter((step) => step.role === 'next');
  const visibleSteps = currentSteps.length > 0 ? currentSteps : nextSteps;
  const visibleStepLabel = visibleSteps[0]
    ? `${visibleSteps[0].label}${visibleSteps.length > 1 ? ` +${visibleSteps.length - 1}` : ''}`
    : undefined;
  const visibleStepKind = currentSteps.length > 0
    ? t('agentWorkspace.workflowCurrent')
    : t('agentWorkspace.workflowNext');

  return (
    <section className="agent-workflow-runs" aria-label={t('agentWorkspace.workflowRuns')}>
      <div className="agent-workflow-run-identity">
        <span className="agent-workflow-run-icon"><Workflow size={14} /></span>
        <div>
          <strong>{selectedRun.label}</strong>
          <small>
            {selectedRun.isActiveAgentRunTarget ? <Activity size={11} /> : null}
            {selectedRun.isActiveAgentRunTarget
              ? t('agentWorkspace.workflowAttached')
              : isTerminalWorkflowRun(selectedRun)
                ? t('agentWorkspace.workflowHistory')
                : t('agentWorkspace.workflowBoardRun')}
          </small>
        </div>
      </div>
      {experience.runs.length > 1 ? (
        <select
          aria-label={t('agentWorkspace.workflowViewing')}
          value={selectedRun.workflowRunId}
          onChange={(event) => setSelectedWorkflowRunId(event.currentTarget.value)}
        >
          {experience.runs.map((run) => (
            <option key={run.workflowRunId} value={run.workflowRunId}>
              {run.label} · {t(workflowRunStatusKey(run.status))}
            </option>
          ))}
        </select>
      ) : null}
      <div className="agent-workflow-run-compact-progress">
        <span
          role="progressbar"
          aria-label={t('agentWorkspace.workflowProgress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <i style={{ width: `${progress}%` }} />
        </span>
        <small>
          {selectedRun.completedStepCount}/{selectedRun.totalStepCount}
          {' · '}{t(workflowRunStatusKey(selectedRun.status))}
        </small>
        {visibleStepLabel ? (
          <strong className="agent-workflow-run-current-step" title={visibleStepLabel}>
            {visibleStepKind} · {visibleStepLabel}
          </strong>
        ) : null}
      </div>
      <div className="agent-workflow-run-compact-facts">
        <span>{t('agentWorkspace.workflowCurrent')} {selectedRun.currentStepCount}</span>
        <span>{t('agentWorkspace.workflowNext')} {selectedRun.nextStepCount}</span>
        {selectedRun.blockedStepCount + selectedRun.gateWaitingCount > 0 ? (
          <span className="is-attention">
            {t('agentWorkspace.workflowAttention')}{' '}
            {selectedRun.blockedStepCount + selectedRun.gateWaitingCount}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        className="agent-workflow-run-open"
        aria-label={`${t('workflowWorkspace.open')}: ${selectedRun.label}`}
        title={t('workflowWorkspace.open')}
        onClick={() => onOpenWorkflowRun(selectedRun.workflowRunId)}
      >
        <ArrowUpRight size={14} />
      </button>
    </section>
  );
}

function workflowRunStatusKey(status: WorkflowRunExperienceItemView['status']) {
  return `workflowRuntime.runStatus.${status}` as const;
}

function isTerminalWorkflowRun(run: WorkflowRunExperienceItemView): boolean {
  return run.status === 'canceled' || run.status === 'failed' || run.status === 'succeeded';
}
