import { MiniMap, useReactFlow, type NodeMouseHandler } from '@xyflow/react';
import type { ReactElement } from 'react';
import { nodeColor } from '../core/flowProjection';
import type { RetakeEdge, RetakeNode } from '../core/types';

interface CanvasMiniMapProps {
  onSelectBlock: (blockId: string) => void;
}

export function CanvasMiniMap({ onSelectBlock }: CanvasMiniMapProps): ReactElement {
  const reactFlow = useReactFlow<RetakeNode, RetakeEdge>();

  const handleNodeClick: NodeMouseHandler<RetakeNode> = (_event, node) => {
    onSelectBlock(node.id);
    void reactFlow.fitView({
      nodes: [{ id: node.id }],
      padding: 0.45,
      duration: 320,
      maxZoom: 1.15,
    });
  };

  return (
    <MiniMap<RetakeNode>
      className="canvas-minimap"
      position="bottom-right"
      pannable
      zoomable
      nodeColor={nodeColor}
      nodeStrokeWidth={2}
      onNodeClick={handleNodeClick}
    />
  );
}
