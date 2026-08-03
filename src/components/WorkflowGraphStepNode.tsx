import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo, type ReactElement } from 'react';
import type { WorkflowWorkspaceGraphNodeView } from '../core/workflowWorkspaceGraph';
import type { WorkflowStepRunStatus } from '../core/workflowRuntimeContracts';
import { useI18n, type TranslationKey } from '../i18n';
import { WorkflowStepCard, type WorkflowStepCardTone } from './WorkflowStepCard';

export interface WorkflowGraphStepNodeData extends Record<string, unknown> {
  view: WorkflowWorkspaceGraphNodeView;
}

export type WorkflowGraphStepNodeType = Node<
  WorkflowGraphStepNodeData,
  'workflowStep'
>;

export const WorkflowGraphStepNode = memo(function WorkflowGraphStepNode({
  data,
  selected,
}: NodeProps<WorkflowGraphStepNodeType>): ReactElement {
  const { t } = useI18n();
  const { view } = data;
  const attentionCount = view.gates.filter((gate) => (
    gate.status === 'waiting_approval' || gate.status === 'not_ready'
  )).length + (view.step.freshness === 'outdated' ? 1 : 0);
  return (
    <div
      className={`workflow-step-node-shell workflow-graph-step is-${view.step.role}`}
      aria-label={`${view.step.label}: ${t(stepStatusKey(view.step.status))}`}
    >
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <WorkflowStepCard
        attentionLabel={attentionCount > 0
          ? `${attentionCount} ${t('workflowInspector.attention')}`
          : undefined}
        behaviorLabel={view.skillLabel}
        eyebrow={`${t(`agentWorkspace.workflowStepRole.${view.step.role}`)} · ${view.step.stepId}`}
        identifier={view.capabilityLabel}
        inputSummary={`${view.resolvedInputCount}/${view.inputSlotCount} ${t('workflowInspector.inputs')}`}
        mode="run"
        outputSummary={view.outputTypes.join(', ') || t('workflowInspector.noOutputs')}
        selected={selected}
        statusLabel={t(stepStatusKey(view.step.status))}
        statusTone={stepStatusTone(view.step.status)}
        title={view.step.label}
      />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});

function stepStatusTone(
  status: WorkflowStepRunStatus,
): WorkflowStepCardTone {
  if (status === 'succeeded' || status === 'skipped') return 'success';
  if (status === 'failed' || status === 'canceled') return 'danger';
  if (
    status === 'running'
    || status === 'queued'
    || status === 'ready'
  ) return 'working';
  if (
    status === 'waiting_input'
    || status === 'waiting_selection'
    || status === 'blocked'
  ) return 'attention';
  return 'neutral';
}

function stepStatusKey(status: WorkflowStepRunStatus): TranslationKey {
  return `workflowRuntime.stepStatus.${status}`;
}
