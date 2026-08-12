import type { RetakeEdge } from '../canvas/reactFlowTypes';
import type { BoardSnapshot } from './types';

const workflowTargetTopHandleId = 'workflow-target-top';
const workflowSourceBottomHandleId = 'workflow-source-bottom';

/**
 * Adds visual-only routing metadata to projected Workflow edges. Canonical
 * Board edges remain untouched; this only keeps fan-out and cross-row
 * dependencies legible in the snake-row canvas projection.
 */
export function routeWorkflowEdges(
  snapshot: BoardSnapshot,
  edges: RetakeEdge[],
): RetakeEdge[] {
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const workflowEdges = edges.filter((edge) => edge.type === 'workflow');
  const fanoutBySource = groupedEdges(workflowEdges, (edge) => edge.source);
  const faninByTarget = groupedEdges(workflowEdges, (edge) => edge.target);
  const longEdgesByLane = new Map<string, RetakeEdge[]>();

  for (const edge of workflowEdges) {
    const source = blockById.get(edge.source);
    const target = blockById.get(edge.target);
    if (!source || !target || source.parentGroupId !== target.parentGroupId) continue;
    const group = source.parentGroupId ? blockById.get(source.parentGroupId) : undefined;
    if (
      group?.type !== 'group'
      || group.data.workflowAutoLayout !== 'snake_rows'
      || edge.data?.kind !== 'execution_input'
    ) continue;
    const sourceStepId = typeof source.data.workflowStepId === 'string'
      ? source.data.workflowStepId
      : undefined;
    const targetStepId = typeof target.data.workflowStepId === 'string'
      ? target.data.workflowStepId
      : undefined;
    if (!sourceStepId || !targetStepId || sourceStepId === targetStepId) continue;
    const stepOrder = workflowStepOrder(snapshot, group.blockId);
    const sourceIndex = stepOrder.get(sourceStepId);
    const targetIndex = stepOrder.get(targetStepId);
    if (sourceIndex === undefined || targetIndex === undefined || Math.abs(sourceIndex - targetIndex) <= 1) continue;
    const side = source.data.workflowFlowDirection === 'reverse' ? 'left' : 'right';
    const laneKey = `${group.blockId}:${side}`;
    const lanes = longEdgesByLane.get(laneKey) ?? [];
    lanes.push(edge);
    longEdgesByLane.set(laneKey, lanes);
  }

  for (const lanes of longEdgesByLane.values()) {
    lanes.sort(compareProjectedEdges);
  }

  return edges.map((edge) => {
    if (edge.type !== 'workflow') return edge;
    const source = blockById.get(edge.source);
    const target = blockById.get(edge.target);
    const group = source?.parentGroupId && source.parentGroupId === target?.parentGroupId
      ? blockById.get(source.parentGroupId)
      : undefined;
    const sourceStepId = typeof source?.data.workflowStepId === 'string'
      ? source.data.workflowStepId
      : undefined;
    const targetStepId = typeof target?.data.workflowStepId === 'string'
      ? target.data.workflowStepId
      : undefined;
    const stepDependency = group?.type === 'group'
      && group.data.workflowAutoLayout === 'step_rows'
      && edge.data?.kind === 'execution_input'
      && Boolean(sourceStepId && targetStepId && sourceStepId !== targetStepId);
    const resultFanout = group?.type === 'group'
      && group.data.workflowAutoLayout === 'step_rows'
      && edge.data?.kind === 'execution_output'
      && source?.type === 'operation'
      && Boolean(sourceStepId && sourceStepId === targetStepId);
    const bottomRoutedStepDependency = stepDependency
      && (source?.type === 'image' || source?.type === 'video');
    const fanout = fanoutBySource.get(edge.source) ?? [edge];
    const fanin = faninByTarget.get(edge.target) ?? [edge];
    const side = source?.data.workflowFlowDirection === 'reverse' ? 'left' : 'right';
    const lanes = group ? longEdgesByLane.get(`${group.blockId}:${side}`) : undefined;
    const laneIndex = lanes?.findIndex((candidate) => candidate.id === edge.id) ?? -1;
    const longDependency = laneIndex >= 0 && group?.type === 'group';
    return {
      ...edge,
      ...(longDependency || stepDependency ? { targetHandle: workflowTargetTopHandleId } : {}),
      ...(bottomRoutedStepDependency ? { sourceHandle: workflowSourceBottomHandleId } : {}),
      data: {
        ...edge.data!,
        workflowFanoutCount: fanout.length,
        workflowFanoutIndex: fanout.findIndex((candidate) => candidate.id === edge.id),
        workflowFaninCount: fanin.length,
        workflowFaninIndex: fanin.findIndex((candidate) => candidate.id === edge.id),
        workflowHistoricalResult: resultFanout
          ? isHistoricalWorkflowResult(snapshot, source, target)
          : false,
        ...(longDependency ? {
          workflowGutterX: side === 'left'
            ? group.position.x + 10 + laneIndex * 8
            : group.position.x + group.size.width - 10 - laneIndex * 8,
          workflowRouteKind: 'long_dependency' as const,
        } : stepDependency ? {
          workflowRouteKind: 'step_dependency' as const,
        } : resultFanout ? {
          workflowRouteKind: 'result_fanout' as const,
        } : {
          workflowRouteKind: 'standard' as const,
        }),
      },
    };
  });
}

function isHistoricalWorkflowResult(
  snapshot: BoardSnapshot,
  source: BoardSnapshot['blocks'][number],
  target: BoardSnapshot['blocks'][number] | undefined,
): boolean {
  const sourceExecutionId = typeof target?.data.sourceExecutionId === 'string'
    ? target.data.sourceExecutionId
    : undefined;
  if (!sourceExecutionId) return false;
  const executions = snapshot.executions.filter(
    (execution) => execution.params?.operationBlockId === source.blockId,
  );
  const latest = executions.reduce<(typeof executions)[number] | undefined>((current, execution) => {
    if (!current) return execution;
    const currentTime = Date.parse(current.startedAt);
    const executionTime = Date.parse(execution.startedAt);
    return executionTime >= currentTime ? execution : current;
  }, undefined);
  return Boolean(latest && latest.executionId !== sourceExecutionId);
}

export function workflowLongDependencyPath(input: {
  gutterX: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}): string {
  const approachY = input.targetY - 34;
  return roundedOrthogonalPath([
    [input.sourceX, input.sourceY],
    [input.gutterX, input.sourceY],
    [input.gutterX, approachY],
    [input.targetX, approachY],
    [input.targetX, input.targetY],
  ]);
}

function workflowStepOrder(snapshot: BoardSnapshot, groupId: string): Map<string, number> {
  const ordered = snapshot.blocks.filter((block) => (
    block.parentGroupId === groupId
    && block.type === 'operation'
    && typeof block.data.workflowStepId === 'string'
  )).sort((left, right) => (
    left.position.y - right.position.y
    || left.position.x - right.position.x
    || left.blockId.localeCompare(right.blockId)
  ));
  return new Map(ordered.map((block, index) => [String(block.data.workflowStepId), index]));
}

function groupedEdges(
  edges: readonly RetakeEdge[],
  keyFor: (edge: RetakeEdge) => string,
): Map<string, RetakeEdge[]> {
  const grouped = new Map<string, RetakeEdge[]>();
  for (const edge of edges) {
    const key = keyFor(edge);
    const group = grouped.get(key) ?? [];
    group.push(edge);
    grouped.set(key, group);
  }
  for (const group of grouped.values()) group.sort(compareProjectedEdges);
  return grouped;
}

function compareProjectedEdges(left: RetakeEdge, right: RetakeEdge): number {
  return left.target.localeCompare(right.target) || left.id.localeCompare(right.id);
}

function roundedOrthogonalPath(points: Array<[number, number]>, radius = 10): string {
  const normalized = points.filter((point, index) => {
    const previous = points[index - 1];
    return !previous || point[0] !== previous[0] || point[1] !== previous[1];
  });
  const first = normalized[0];
  if (!first) return '';
  let path = `M ${first[0]} ${first[1]}`;
  for (let index = 1; index < normalized.length; index += 1) {
    const current = normalized[index]!;
    const next = normalized[index + 1];
    if (!next) {
      path += ` L ${current[0]} ${current[1]}`;
      continue;
    }
    const previous = normalized[index - 1]!;
    const incoming = Math.hypot(current[0] - previous[0], current[1] - previous[1]);
    const outgoing = Math.hypot(next[0] - current[0], next[1] - current[1]);
    const corner = Math.min(radius, incoming / 2, outgoing / 2);
    const before = pointToward(current, previous, corner);
    const after = pointToward(current, next, corner);
    path += ` L ${before[0]} ${before[1]} Q ${current[0]} ${current[1]} ${after[0]} ${after[1]}`;
  }
  return path;
}

function pointToward(
  from: [number, number],
  to: [number, number],
  distance: number,
): [number, number] {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!length) return from;
  return [
    from[0] + ((to[0] - from[0]) / length) * distance,
    from[1] + ((to[1] - from[1]) / length) * distance,
  ];
}
