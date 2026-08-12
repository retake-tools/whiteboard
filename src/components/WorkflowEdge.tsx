import { BaseEdge, BezierEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import type { ReactElement } from 'react';
import { workflowLongDependencyPath } from '../core/workflowEdgeRouting';
import type { RetakeEdge } from '../canvas/reactFlowTypes';

export function WorkflowEdge(props: EdgeProps<RetakeEdge>): ReactElement {
  if (props.data?.workflowRouteKind === 'result_fanout') {
    return (
      <BezierEdge
        {...props}
        style={{
          ...props.style,
          ...(props.data.workflowHistoricalResult ? { opacity: 0.28 } : {}),
        }}
      />
    );
  }
  const fanoutCount = props.data?.workflowFanoutCount ?? 1;
  const fanoutIndex = props.data?.workflowFanoutIndex ?? 0;
  const faninCount = props.data?.workflowFaninCount ?? 1;
  const faninIndex = props.data?.workflowFaninIndex ?? 0;
  const branchIndex = Math.max(fanoutIndex, faninIndex);
  const branchCount = Math.max(fanoutCount, faninCount);
  const offset = 24 + (branchCount > 1 ? branchIndex * 12 : 0);
  const longDependency = props.data?.workflowRouteKind === 'long_dependency'
    && typeof props.data.workflowGutterX === 'number';
  const [smoothPath, smoothLabelX, smoothLabelY] = getSmoothStepPath({
    borderRadius: 12,
    offset,
    sourcePosition: props.sourcePosition,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetPosition: props.targetPosition,
    targetX: props.targetX,
    targetY: props.targetY,
  });
  const path = longDependency
    ? workflowLongDependencyPath({
        gutterX: props.data!.workflowGutterX!,
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        targetX: props.targetX,
        targetY: props.targetY,
      })
    : smoothPath;
  return (
    <BaseEdge
      id={props.id}
      interactionWidth={props.interactionWidth}
      label={props.label}
      labelBgBorderRadius={4}
      labelBgPadding={[4, 2]}
      labelShowBg={Boolean(props.label)}
      labelX={longDependency ? props.targetX : smoothLabelX}
      labelY={longDependency ? props.targetY - 18 : smoothLabelY}
      markerEnd={props.markerEnd}
      markerStart={props.markerStart}
      path={path}
      style={props.style}
    />
  );
}
