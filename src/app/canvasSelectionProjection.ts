import type { RetakeEdge, RetakeNode } from '../canvas/reactFlowTypes';
import { groupSelectionScopeBlockIds } from '../core/grouping';
import type { BoardSnapshot } from '../core/types';

const connectedSelectionClassName = 'is-connected-to-selection';

export function projectFlowNodeSelection(
  nodes: readonly RetakeNode[],
  snapshot: BoardSnapshot,
  selectedBlockIds: readonly string[],
): RetakeNode[] {
  const directSelection = new Set(selectedBlockIds);
  const selectionScope = new Set(
    groupSelectionScopeBlockIds(snapshot, selectedBlockIds),
  );

  return nodes.map((node) => {
    const selected = directSelection.has(node.id);
    const groupScopeSelected = selectionScope.has(node.id) && !selected;
    if (
      node.selected === selected
      && node.data.groupScopeSelected === groupScopeSelected
    ) return node;
    return {
      ...node,
      selected,
      data: {
        ...node.data,
        groupScopeSelected,
      },
    };
  });
}

export function projectFlowEdgeSelection(
  edges: readonly RetakeEdge[],
  snapshot: BoardSnapshot,
  selectedBlockIds: readonly string[],
): RetakeEdge[] {
  const selectionScope = new Set(
    groupSelectionScopeBlockIds(snapshot, selectedBlockIds),
  );
  const edgeById = new Map(snapshot.edges.map((edge) => [edge.edgeId, edge]));

  return edges.map((edge) => {
    const selected = edge.data?.proxyEdgeIds?.some((edgeId) => {
      const sourceEdge = edgeById.get(edgeId);
      return Boolean(
        sourceEdge
        && (
          selectionScope.has(sourceEdge.sourceBlockId)
          || selectionScope.has(sourceEdge.targetBlockId)
        )
      );
    }) ?? (
      selectionScope.has(edge.source)
      || selectionScope.has(edge.target)
    );
    const classNames = new Set((edge.className ?? '').split(/\s+/).filter(Boolean));
    const wasSelected = classNames.has(connectedSelectionClassName);
    if (selected === wasSelected) return edge;
    if (selected) classNames.add(connectedSelectionClassName);
    else classNames.delete(connectedSelectionClassName);
    return {
      ...edge,
      className: [...classNames].join(' ') || undefined,
    };
  });
}
