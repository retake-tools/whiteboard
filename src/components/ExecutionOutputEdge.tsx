import { BaseEdge, BezierEdge, useInternalNode, useStore, type EdgeProps } from '@xyflow/react';
import type { ReactElement } from 'react';
import {
  executionOutputEdgePath,
  shouldUseDirectExecutionOutputBezier,
  targetLeftClearance,
  type EdgeObstacleBounds,
} from '../core/executionOutputEdgePath';
import type { RetakeEdge, RetakeNode } from '../core/types';

export function ExecutionOutputEdge(props: EdgeProps<RetakeEdge>): ReactElement {
  const resultHeight = props.data?.resultHeight ?? 0;
  const targetNode = useInternalNode<RetakeNode>(props.target);
  const obstacles = useStore(
    (state) => [...state.nodeLookup.entries()].flatMap(([blockId, node]) => {
      if (blockId === props.source || blockId === props.target || node.type === 'group') return [];
      const width = node.measured.width ?? node.width ?? 0;
      const height = node.measured.height ?? node.height ?? 0;
      if (!width || !height) return [];
      return [{
        bottom: node.internals.positionAbsolute.y + height,
        left: node.internals.positionAbsolute.x,
        right: node.internals.positionAbsolute.x + width,
        top: node.internals.positionAbsolute.y,
      }];
    }),
    sameObstacleBounds,
  );
  const targetWidth = targetNode?.measured.width ?? targetNode?.width ?? 0;
  const targetHeight = targetNode?.measured.height ?? targetNode?.height ?? resultHeight;
  const targetBounds = targetNode && targetWidth && targetHeight
    ? {
        bottom: targetNode.internals.positionAbsolute.y + targetHeight,
        left: targetNode.internals.positionAbsolute.x,
        right: targetNode.internals.positionAbsolute.x + targetWidth,
        top: targetNode.internals.positionAbsolute.y,
      }
    : undefined;
  const targetLeftGap = targetBounds ? targetLeftClearance(targetBounds, obstacles) : undefined;
  if (shouldUseDirectExecutionOutputBezier({
    obstacles,
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    targetLeftGap,
    targetX: props.targetX,
    targetY: props.targetY,
  })) {
    return <BezierEdge {...props} />;
  }

  return (
    <BaseEdge
      id={props.id}
      interactionWidth={props.interactionWidth}
      markerEnd={props.markerEnd}
      markerStart={props.markerStart}
      path={executionOutputEdgePath({
        resultHeight,
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        targetX: props.targetX,
        targetY: props.targetY,
        targetLeftGap,
      })}
      style={props.style}
    />
  );
}

function sameObstacleBounds(left: EdgeObstacleBounds[], right: EdgeObstacleBounds[]): boolean {
  return left.length === right.length && left.every((bounds, index) => {
    const candidate = right[index];
    return candidate && bounds.bottom === candidate.bottom && bounds.left === candidate.left &&
      bounds.right === candidate.right && bounds.top === candidate.top;
  });
}
