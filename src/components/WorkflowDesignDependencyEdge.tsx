import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  type Edge,
  type EdgeProps,
} from '@xyflow/react';
import { Plus } from 'lucide-react';
import type { ReactElement } from 'react';

export interface WorkflowDesignDependencyEdgeData extends Record<string, unknown> {
  insertLabel: string;
  onInsert: () => void;
}

export type WorkflowDesignDependencyEdgeType = Edge<
  WorkflowDesignDependencyEdgeData,
  'workflowDesignDependency'
>;

export function WorkflowDesignDependencyEdge({
  data,
  id,
  markerEnd,
  sourceX,
  sourceY,
  sourcePosition,
  style,
  targetX,
  targetY,
  targetPosition,
}: EdgeProps<WorkflowDesignDependencyEdgeType>): ReactElement {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });
  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <button
          type="button"
          className="workflow-design-edge-add nodrag nopan"
          aria-label={data?.insertLabel}
          style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
          onClick={(event) => {
            event.stopPropagation();
            data?.onInsert();
          }}
        >
          <Plus size={12} />
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
