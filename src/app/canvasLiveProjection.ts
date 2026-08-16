import type { RetakeNode } from '../canvas/reactFlowTypes';

export function retainFlowNodeMeasurements(
  projectedNodes: readonly RetakeNode[],
  currentNodes: readonly RetakeNode[],
): RetakeNode[] {
  const measuredById = new Map(currentNodes.flatMap((node) => {
    const { height, width } = node.measured ?? {};
    return height !== undefined && width !== undefined
      ? [[node.id, { height, width }] as const]
      : [];
  }));

  return projectedNodes.map((node) => {
    const measured = measuredById.get(node.id);
    return measured ? { ...node, measured } : node;
  });
}

export function flowNodeLayoutSignature(
  nodes: readonly RetakeNode[],
): string {
  return nodes.map((node) => [
    node.id,
    node.type ?? '',
    node.parentId ?? '',
    node.initialWidth ?? node.width ?? node.style?.width ?? '',
    node.initialHeight ?? node.height ?? node.style?.height ?? '',
  ].join(':')).join('\u0000');
}
