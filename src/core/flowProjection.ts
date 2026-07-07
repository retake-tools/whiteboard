import type { Node } from '@xyflow/react';
import { getAssetPreviewUrl } from './assetStore';
import type { BoardSnapshot, RetakeEdge, RetakeNode } from './types';

export function createFlowNodes(snapshot: BoardSnapshot): RetakeNode[] {
  return snapshot.blocks.map((block) => ({
    id: block.blockId,
    type: block.type,
    position: block.position,
    zIndex: block.zIndex,
    data: {
      ...block.data,
      previewUrl: getAssetPreviewUrl(snapshot.assets, block.data.assetId),
    },
    style: {
      width: block.size.width,
      height: block.size.height,
    },
    draggable: block.type !== 'frame',
  }));
}

export function createFlowEdges(snapshot: BoardSnapshot): RetakeEdge[] {
  return snapshot.edges.map((edge) => ({
    id: edge.edgeId,
    source: edge.sourceBlockId,
    target: edge.targetBlockId,
    type: 'smoothstep',
    label: edge.kind,
    data: { kind: edge.kind },
  }));
}

export function nodeColor(node: Node): string {
  if (node.type === 'image') return '#60a5fa';
  if (node.type === 'video') return '#f97316';
  if (node.type === 'task') return '#14b8a6';
  if (node.type === 'frame') return '#d1d5db';
  return '#64748b';
}
