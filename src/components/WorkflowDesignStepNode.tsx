import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { memo, type ReactElement } from 'react';
import type { WorkflowAuthoringGraphNodeV1 } from '../core/workflowAuthoringGraph';
import { useI18n } from '../i18n';
import { WorkflowStepCard } from './WorkflowStepCard';

export interface WorkflowDesignStepNodeData extends Record<string, unknown> {
  addAfterLabel: string;
  onAddAfter: () => void;
  view: WorkflowAuthoringGraphNodeV1;
}

export type WorkflowDesignStepNodeType = Node<
  WorkflowDesignStepNodeData,
  'workflowDesignStep'
>;

export const WorkflowDesignStepNode = memo(function WorkflowDesignStepNode({
  data,
  selected,
}: NodeProps<WorkflowDesignStepNodeType>): ReactElement {
  const { t } = useI18n();
  const { view } = data;
  return (
    <div className="workflow-step-node-shell workflow-design-step">
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <WorkflowStepCard
        action={<button
          type="button"
          className="workflow-design-node-add nodrag nopan"
          aria-label={data.addAfterLabel}
          onClick={(event) => {
            event.stopPropagation();
            data.onAddAfter();
          }}
        >
          <Plus size={12} />
        </button>}
        attentionLabel={view.issueCount > 0
          ? `${view.issueCount} ${t('workflowAuthoring.issues')}`
          : undefined}
        behaviorLabel={view.skillLabel}
        eyebrow={`${view.optional ? t('workflowAuthoring.optional') : t('workflowInspector.step')} · ${view.stageId}`}
        identifier={view.stepId}
        inputSummary={`${view.boundInputCount}/${view.inputSlotCount} ${t('workflowInspector.inputs')}`}
        mode="design"
        outputSummary={view.outputTypes.join(', ') || t('workflowInspector.noOutputs')}
        selected={selected}
        statusLabel={view.issueCount > 0
          ? t('workflowInspector.needsConfiguration')
          : t('workflowAuthoring.valid')}
        statusTone={view.issueCount > 0 ? 'attention' : 'success'}
        title={view.capabilityLabel}
      />
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
});
