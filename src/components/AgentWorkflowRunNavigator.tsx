import { Activity, ChevronDown, MapPin, Workflow } from 'lucide-react';
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
  onLocateBlock,
  snapshot,
}: {
  activeAgentRun?: AgentRunRecord;
  onLocateBlock: (blockId: string) => void;
  snapshot: BoardSnapshot;
}): ReactElement | null {
  const { locale, t } = useI18n();
  const experience = useMemo(
    () => workflowRunExperienceFor(snapshot, activeAgentRun),
    [activeAgentRun, snapshot],
  );
  const [expanded, setExpanded] = useState(false);
  const [selectedWorkflowRunId, setSelectedWorkflowRunId] = useState(
    experience.defaultWorkflowRunId ?? '',
  );

  useEffect(() => {
    setSelectedWorkflowRunId(experience.defaultWorkflowRunId ?? '');
  }, [activeAgentRun?.agentRunId]);

  useEffect(() => {
    if (experience.runs.some((run) => run.workflowRunId === selectedWorkflowRunId)) return;
    setSelectedWorkflowRunId(experience.defaultWorkflowRunId ?? '');
  }, [experience.defaultWorkflowRunId, experience.runs, selectedWorkflowRunId]);

  if (experience.runs.length === 0) return null;
  const selectedRun = experience.runs.find(
    (run) => run.workflowRunId === selectedWorkflowRunId,
  ) ?? experience.runs[0];
  const progress = selectedRun.totalStepCount > 0
    ? Math.round((selectedRun.completedStepCount / selectedRun.totalStepCount) * 100)
    : 0;

  return (
    <section className={`agent-workflow-runs${expanded ? ' is-expanded' : ''}`}>
      <button
        type="button"
        className="agent-workflow-runs-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="agent-workflow-runs-title">
          <Workflow size={14} />
          <strong>{t('agentWorkspace.workflowRuns')}</strong>
          <small>{experience.runs.length}</small>
        </span>
        <span className="agent-workflow-runs-counts">
          {experience.activeCount > 0 ? (
            <small>
              {t('agentWorkspace.workflowActive')} {experience.activeCount}
            </small>
          ) : null}
          {experience.attentionCount > 0 ? (
            <small className="is-attention">
              {t('agentWorkspace.workflowAttention')} {experience.attentionCount}
            </small>
          ) : null}
          <ChevronDown size={14} />
        </span>
      </button>
      <div className="agent-workflow-run-summary">
        <label>
          <span>{t('agentWorkspace.workflowViewing')}</span>
          <select
            value={selectedRun.workflowRunId}
            onChange={(event) => setSelectedWorkflowRunId(event.currentTarget.value)}
          >
            {experience.runs.map((run) => (
              <option key={run.workflowRunId} value={run.workflowRunId}>
                {run.label} · {t(workflowRunStatusKey(run.status))}
              </option>
            ))}
          </select>
        </label>
        <div className="agent-workflow-run-progress-row">
          <span>
            {selectedRun.isActiveAgentRunTarget ? <Activity size={12} /> : null}
            {selectedRun.isActiveAgentRunTarget
              ? t('agentWorkspace.workflowAttached')
              : isTerminalWorkflowRun(selectedRun)
                ? t('agentWorkspace.workflowHistory')
                : t('agentWorkspace.workflowBoardRun')}
          </span>
          <strong>{selectedRun.completedStepCount}/{selectedRun.totalStepCount}</strong>
        </div>
        <div
          className="agent-workflow-run-progress"
          role="progressbar"
          aria-label={t('agentWorkspace.workflowProgress')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="agent-workflow-run-facts">
          <span>{t('agentWorkspace.workflowCurrent')} {selectedRun.currentStepCount}</span>
          <span>{t('agentWorkspace.workflowNext')} {selectedRun.nextStepCount}</span>
          <span className={selectedRun.blockedStepCount > 0 ? 'is-attention' : undefined}>
            {t('agentWorkspace.workflowBlocked')} {selectedRun.blockedStepCount}
          </span>
        </div>
      </div>
      {expanded ? (
        <div className="agent-workflow-run-details">
          <div className="agent-workflow-run-metrics">
            <Metric label={t('agentWorkspace.workflowExecutions')} value={selectedRun.executionCount} />
            <Metric label={t('agentWorkspace.workflowArtifacts')} value={selectedRun.artifactRevisionCount} />
            <Metric label={t('agentWorkspace.workflowGates')} value={selectedRun.gateCount} />
            <Metric label={t('agentWorkspace.workflowGateWaiting')} value={selectedRun.gateWaitingCount} attention={selectedRun.gateWaitingCount > 0} />
          </div>
          <ol className="agent-workflow-step-list">
            {selectedRun.steps.map((step) => (
              <li key={step.stepRunId} className={`is-${step.role}`}>
                <span className="agent-workflow-step-marker" aria-hidden="true" />
                <div>
                  <strong>{step.label}</strong>
                  <small>
                    {t(workflowStepRoleKey(step.role))} · {t(workflowStepStatusKey(step.status))}
                    {step.freshness === 'outdated' ? ` · ${t('workflowRuntime.outdated')}` : ''}
                  </small>
                </div>
                <button
                  type="button"
                  title={t('agentWorkspace.locateIntervention')}
                  aria-label={`${t('agentWorkspace.locateIntervention')}: ${step.label}`}
                  onClick={() => onLocateBlock(step.operationBlockId)}
                >
                  <MapPin size={13} />
                </button>
              </li>
            ))}
          </ol>
          <small className="agent-workflow-run-updated">
            {t('agentWorkspace.workflowUpdated')} {formatUpdatedAt(selectedRun, locale)}
          </small>
        </div>
      ) : null}
    </section>
  );
}

function Metric({
  attention = false,
  label,
  value,
}: {
  attention?: boolean;
  label: string;
  value: number;
}): ReactElement {
  return (
    <span className={attention ? 'is-attention' : undefined}>
      <strong>{value}</strong>
      <small>{label}</small>
    </span>
  );
}

function formatUpdatedAt(run: WorkflowRunExperienceItemView, locale: 'en' | 'zh'): string {
  const value = new Date(run.updatedAt);
  if (Number.isNaN(value.getTime())) return run.updatedAt;
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value);
}

function workflowRunStatusKey(status: WorkflowRunExperienceItemView['status']) {
  return `workflowRuntime.runStatus.${status}` as const;
}

function workflowStepStatusKey(status: WorkflowRunExperienceItemView['steps'][number]['status']) {
  return `workflowRuntime.stepStatus.${status}` as const;
}

function workflowStepRoleKey(role: WorkflowRunExperienceItemView['steps'][number]['role']) {
  return `agentWorkspace.workflowStepRole.${role}` as const;
}

function isTerminalWorkflowRun(run: WorkflowRunExperienceItemView): boolean {
  return run.status === 'canceled' || run.status === 'failed' || run.status === 'succeeded';
}
