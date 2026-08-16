import { useUpdateNodeInternals } from '@xyflow/react';
import { useEffect, useRef, type ReactElement } from 'react';
import type { RetakeNode } from '../canvas/reactFlowTypes';
import { flowNodeLayoutSignature } from '../app/canvasLiveProjection';

interface CanvasProjectionSynchronizerProps {
  nodes: readonly RetakeNode[];
}

export function CanvasProjectionSynchronizer({
  nodes,
}: CanvasProjectionSynchronizerProps): ReactElement | null {
  const updateNodeInternals = useUpdateNodeInternals();
  const previousLayoutSignatureRef = useRef<string | undefined>(undefined);
  const layoutSignature = flowNodeLayoutSignature(nodes);

  useEffect(() => {
    if (previousLayoutSignatureRef.current === layoutSignature) return;
    previousLayoutSignatureRef.current = layoutSignature;
    if (nodes.length > 0) {
      updateNodeInternals(nodes.map((node) => node.id));
    }
  }, [layoutSignature, nodes, updateNodeInternals]);

  return null;
}
