import { ArrowUpRight, CircleStop, Pause, Play, Workflow } from 'lucide-react';
import type { ReactElement } from 'react';
import type { AgentRunRecord } from '../core/agentRuntimeContracts';
import type {
  WorkflowRunExperienceItemView,
  WorkflowRunExperienceView,
} from '../core/workflowRunExperience';
import { useI18n } from '../i18n';

export function AgentWorkflowRunNavigator({
  activeAgentRun,
  experience,
  onCancelAgentRun,
  onOpenWorkflowRun,
  onPauseAgentRun,
  onResumeAgentRun,
  onSelectWorkflowRun,
  selectedWorkflowRunId,
  taskSummary,
}: {
  activeAgentRun?: AgentRunRecord;
  experience: WorkflowRunExperienceView;
  onCancelAgentRun: (agentRunId: string) => void;
  onOpenWorkflowRun: (workflowRunId: string) => void;
  onPauseAgentRun: (agentRunId: string) => void;
  onResumeAgentRun: (agentRunId: string) => void;
  onSelectWorkflowRun: (workflowRunId: string) => void;
  selectedWorkflowRunId: string;
  taskSummary?: string;
}): ReactElement | null {
  const { t } = useI18n();
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
  const attachedAgentRun = selectedRun.isActiveAgentRunTarget
    ? activeAgentRun
    : undefined;
  const isTerminalAgentRun = attachedAgentRun
    ? ['succeeded', 'failed', 'canceled'].includes(attachedAgentRun.status)
    : true;

  return (
    <section className="agent-workflow-runs" aria-label={t('agentWorkspace.workflowRuns')}>
      <div className="agent-workflow-run-identity">
        <span className="agent-workflow-run-icon"><Workflow size={14} /></span>
        <div>
          <strong>{selectedRun.label}</strong>
          <small title={taskSummary}>
            {selectedRun.isActiveAgentRunTarget
              ? taskSummary ?? t('agentWorkspace.workflowTaskFallback')
              : isTerminalWorkflowRun(selectedRun)
                ? t('agentWorkspace.workflowHistory')
                : t('agentWorkspace.workflowBoardRun')}
          </small>
        </div>
      </div>
      <div className="agent-workflow-run-actions">
        {attachedAgentRun ? (
          attachedAgentRun.status === 'paused' ? (
            <button
              type="button"
              aria-label={t('agentRuntime.resume')}
              title={t('agentRuntime.resume')}
              onClick={() => onResumeAgentRun(attachedAgentRun.agentRunId)}
            >
              <Play size={13} />
            </button>
          ) : (
            <button
              type="button"
              aria-label={t('agentRuntime.pause')}
              title={t('agentRuntime.pause')}
              disabled={isTerminalAgentRun}
              onClick={() => onPauseAgentRun(attachedAgentRun.agentRunId)}
            >
              <Pause size={13} />
            </button>
          )
        ) : null}
        {attachedAgentRun ? (
          <button
            type="button"
            aria-label={t('agentRuntime.cancel')}
            title={t('agentRuntime.cancel')}
            disabled={isTerminalAgentRun}
            onClick={() => onCancelAgentRun(attachedAgentRun.agentRunId)}
          >
            <CircleStop size={13} />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`${t('workflowWorkspace.open')}: ${selectedRun.label}`}
          title={t('workflowWorkspace.open')}
          onClick={() => onOpenWorkflowRun(selectedRun.workflowRunId)}
        >
          <ArrowUpRight size={14} />
        </button>
      </div>
      {experience.runs.length > 1 ? (
        <select
          aria-label={t('agentWorkspace.workflowViewing')}
          value={selectedRun.workflowRunId}
          onChange={(event) => onSelectWorkflowRun(event.currentTarget.value)}
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
    </section>
  );
}

function workflowRunStatusKey(status: WorkflowRunExperienceItemView['status']) {
  return `workflowRuntime.runStatus.${status}` as const;
}

function isTerminalWorkflowRun(run: WorkflowRunExperienceItemView): boolean {
  return run.status === 'canceled' || run.status === 'failed' || run.status === 'succeeded';
}
