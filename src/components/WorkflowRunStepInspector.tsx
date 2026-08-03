import { ArrowUpRight, Bot, Play, RotateCcw } from 'lucide-react';
import type { ReactElement, ReactNode } from 'react';
import type { BoardSnapshot, ExecutionRecord } from '../core/types';
import type { WorkflowWorkspaceGraphNodeView } from '../core/workflowWorkspaceGraph';
import type { WorkflowStepRunStatus } from '../core/workflowRuntimeContracts';
import { useI18n, type TranslationKey } from '../i18n';

export function WorkflowRunStepInspector({
  canRunToStep,
  node,
  onLocate,
  onRunToStep,
  snapshot,
}: {
  canRunToStep: boolean;
  node: WorkflowWorkspaceGraphNodeView;
  onLocate: () => void;
  onRunToStep: () => void;
  snapshot: BoardSnapshot;
}): ReactElement {
  const { t } = useI18n();
  const stepRun = (snapshot.workflowStepRuns ?? []).find(
    (record) => record.stepRunId === node.step.stepRunId,
  );
  const executionById = new Map(
    snapshot.executions.map((execution) => [execution.executionId, execution]),
  );
  const executions = stepRun?.executionIds.flatMap((executionId) => {
    const execution = executionById.get(executionId);
    return execution ? [execution] : [];
  }) ?? [];
  const lastExecution = [...executions].sort(
    (left, right) => right.startedAt.localeCompare(left.startedAt),
  )[0];
  const unavailableExecution = !lastExecution
    ? [...node.executions].reverse()[0]
    : undefined;

  return (
    <div className="workflow-workspace-inspector-content">
      <div className="workflow-workspace-inspector-title">
        <small>{node.step.stepId}</small>
        <strong>{node.step.label}</strong>
        <span>{t(stepStatusKey(node.step.status))}</span>
      </div>

      <InspectorSection title={t('workflowInspector.status')}>
        <InspectorFact label={t('workflowWorkspace.capability')} value={node.capabilityId} />
        <InspectorFact label={t('workflowWorkspace.skill')} value={node.skillId} />
        <InspectorFact
          label={t('workflowInspector.freshness')}
          value={node.step.freshness === 'current'
            ? t('workflowInspector.current')
            : t('workflowRuntime.outdated')}
        />
        <InspectorFact
          label={t('workflowWorkspace.dependencies')}
          value={node.dependsOnStepIds.join(', ') || t('workflowWorkspace.noDependencies')}
        />
        {node.gates.length > 0 ? (
          <ul className="workflow-step-contract-list">
            {node.gates.map((gate) => (
              <li key={gate.gateId}>
                <strong>{gate.label}</strong>
                <small>{gate.status} · {gate.subjectLabel}</small>
              </li>
            ))}
          </ul>
        ) : null}
        {stepRun?.error ? <p className="workflow-step-run-error">{stepRun.error}</p> : null}
      </InspectorSection>

      <InspectorSection title={t('workflowInspector.inputs')}>
        {stepRun && stepRun.resolvedInputBindings.length > 0 ? (
          <ul className="workflow-step-contract-list">
            {stepRun.resolvedInputBindings.map((binding) => (
              <li key={binding.inputSlotId}>
                <strong>{binding.inputSlotId}</strong>
                <small>
                  {bindingSourceLabel(binding.source)} · {binding.values.length} {t('workflowInspector.values')}
                </small>
                <small>{bindingValueKinds(binding.values)}</small>
              </li>
            ))}
          </ul>
        ) : <p>{t('workflowInspector.noInputs')}</p>}
      </InspectorSection>

      <InspectorSection title={t('workflowInspector.outputs')}>
        {stepRun && (
          stepRun.outputSlotIds.length > 0
          || stepRun.outputArtifactBindings.length > 0
        ) ? (
          <ul className="workflow-step-contract-list">
            {stepRun.outputSlotIds.map((outputSlotId) => {
              const artifacts = stepRun.outputArtifactBindings.filter(
                (binding) => binding.outputSlotId === outputSlotId,
              );
              return (
                <li key={outputSlotId}>
                  <strong>{outputSlotId}</strong>
                  <small>{artifacts.length > 0
                    ? artifacts.map((artifact) => (
                      `${artifact.artifactType} · ${artifact.artifactRevisionId}`
                    )).join('\n')
                    : t('workflowInspector.noExecution')}</small>
                </li>
              );
            })}
          </ul>
        ) : <p>{t('workflowInspector.noOutputs')}</p>}
      </InspectorSection>

      <InspectorSection title={t('workflowInspector.lastRun')}>
        {lastExecution ? (
          <>
            <InspectorFact label={t('workflowInspector.status')} value={lastExecution.status} />
            <InspectorFact
              label={t('workflowInspector.providerModel')}
              value={executionRouteLabel(lastExecution)}
            />
            <InspectorFact
              label={t('workflowInspector.duration')}
              value={executionDuration(lastExecution)}
            />
            {lastExecution.errorMessage ? (
              <InspectorFact label={t('workflowInspector.error')} value={lastExecution.errorMessage} />
            ) : null}
            <small className="workflow-step-execution-id">{lastExecution.executionId}</small>
          </>
        ) : unavailableExecution ? (
          <InspectorFact
            label={t('workflowInspector.status')}
            value={`${unavailableExecution.status} · ${unavailableExecution.executionId}`}
          />
        ) : <p>{t('workflowInspector.noExecution')}</p>}
      </InspectorSection>

      <InspectorSection title={t('workflowInspector.actions')}>
        <button
          type="button"
          className="workflow-workspace-step-action"
          disabled={!canRunToStep}
          onClick={onRunToStep}
        >
          <Bot size={14} />
          {t('workflowWorkspace.runToStep')}
        </button>
        <small className="workflow-step-action-hint">
          {t('workflowWorkspace.runToStepHint')}
        </small>
        <button
          type="button"
          className="workflow-workspace-step-action is-secondary"
          disabled
          title={t('workflowWorkspace.readyStepUnavailable')}
        >
          <Play size={14} />
          {t('workflowWorkspace.runReadyStep')}
        </button>
        <small className="workflow-step-action-hint">
          {t('workflowWorkspace.readyStepUnavailable')}
        </small>
        <button
          type="button"
          className="workflow-workspace-step-action is-secondary"
          disabled
          title={t('workflowWorkspace.replayUnavailable')}
        >
          <RotateCcw size={14} />
          {t('workflowWorkspace.rerunLastInputs')}
        </button>
        <small className="workflow-step-action-hint">
          {t('workflowWorkspace.replayUnavailable')}
        </small>
        <button
          type="button"
          className="workflow-workspace-locate"
          onClick={onLocate}
        >
          {t('workflowWorkspace.locateOnBoard')}<ArrowUpRight size={14} />
        </button>
      </InspectorSection>
    </div>
  );
}

function InspectorSection({
  children,
  title,
}: {
  children: ReactNode;
  title: string;
}): ReactElement {
  return (
    <section className="workflow-step-inspector-section">
      <header><strong>{title}</strong></header>
      <div>{children}</div>
    </section>
  );
}

function InspectorFact({ label, value }: { label: string; value: string }): ReactElement {
  return <dl><dt>{label}</dt><dd>{value}</dd></dl>;
}

function bindingSourceLabel(
  source: NonNullable<BoardSnapshot['workflowStepRuns']>[number]['resolvedInputBindings'][number]['source'],
): string {
  return source.kind === 'workflow_input'
    ? `Workflow · ${source.slotId}`
    : `${source.stepId} · ${source.outputSlotId}`;
}

function bindingValueKinds(
  values: NonNullable<BoardSnapshot['workflowStepRuns']>[number]['resolvedInputBindings'][number]['values'],
): string {
  return [...new Set(values.map((value) => value.kind))].join(', ') || '—';
}

function executionRouteLabel(execution: ExecutionRecord): string {
  const provider = execution.provider ?? execution.adapterSnapshot?.provider;
  const model = execution.model ?? execution.adapterSnapshot?.model;
  if (provider && model) return `${provider} · ${model}`;
  return provider
    ?? model
    ?? execution.connectionId
    ?? execution.adapterSnapshot?.routeKind
    ?? execution.adapter;
}

function executionDuration(execution: ExecutionRecord): string {
  if (!execution.completedAt) return '—';
  const duration = Date.parse(execution.completedAt) - Date.parse(execution.startedAt);
  if (!Number.isFinite(duration) || duration < 0) return '—';
  if (duration < 1000) return `${duration} ms`;
  return `${(duration / 1000).toFixed(duration < 10_000 ? 1 : 0)} s`;
}

function stepStatusKey(status: WorkflowStepRunStatus): TranslationKey {
  return `workflowRuntime.stepStatus.${status}`;
}
