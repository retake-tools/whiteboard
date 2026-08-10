import { fitGroupToChildren, groupContentOrigin } from './grouping';
import { nowIso } from './id';
import type { BlockRecord, BoardSnapshot } from './types';

const inputColumnGap = 72;
const resultColumnGap = 120;
const rowGap = 80;
const stackGap = 24;
const minimumLayoutWidth = 900;
const defaultGroupRightPadding = 28;
const workflowRoutingRightPadding = 72;

interface WorkflowLayoutStep {
  inputs: BlockRecord[];
  operation: BlockRecord;
  outputs: BlockRecord[];
  stepId: string;
}

/**
 * Lays out every Workflow Step as one stable left-to-right row: inputs on the
 * left, the Operation in the middle, and outputs on the right. Steps advance
 * vertically, so the progressive Board projection can hide future rows without
 * changing the position of anything the user has already seen.
 */
export function arrangeWorkflowGroup(snapshot: BoardSnapshot, groupId: string): boolean {
  const group = snapshot.blocks.find(
    (block) => block.blockId === groupId
      && block.type === 'group'
      && block.data.groupKind === 'workflow',
  );
  if (!group) return false;

  const children = snapshot.blocks.filter((block) => block.parentGroupId === groupId);
  const steps = workflowLayoutSteps(snapshot, children);
  if (steps.length === 0) return false;

  const assignedIds = new Set(
    steps.flatMap((step) => [
      step.operation.blockId,
      ...step.inputs.map((block) => block.blockId),
      ...step.outputs.map((block) => block.blockId),
    ]),
  );
  const unassigned = children.filter((block) => !assignedIds.has(block.blockId));
  // The Group owns the layout anchor. Runtime output adoption can temporarily
  // create or resize a child away from the existing rows; deriving the origin
  // from that child would teleport a Group that the user already positioned.
  const origin = groupContentOrigin(group);
  const maximumInputWidth = maximumStackWidth(steps.map((step) => step.inputs));
  const maximumOutputWidth = maximumStackWidth(steps.map((step) => step.outputs));
  const maximumOperationWidth = Math.max(...steps.map((step) => step.operation.size.width));
  const inputColumnWidth = Math.max(maximumInputWidth, 280);
  const outputColumnWidth = Math.max(maximumOutputWidth, 280);
  const operationX = origin.x + inputColumnWidth + inputColumnGap;
  const outputX = operationX + maximumOperationWidth + resultColumnGap;
  const layoutWidth = Math.max(
    minimumLayoutWidth,
    inputColumnWidth + inputColumnGap + maximumOperationWidth + resultColumnGap + outputColumnWidth,
  );

  let rowY = origin.y;
  steps.forEach((step) => {
    const inputSize = stackSize(step.inputs);
    const outputSize = stackSize(step.outputs);
    const rowHeight = Math.max(step.operation.size.height, inputSize.height, outputSize.height);

    positionStack(step.inputs, origin.x, rowY + (rowHeight - inputSize.height) / 2);
    positionBlock(
      step.operation,
      operationX,
      rowY + (rowHeight - step.operation.size.height) / 2,
    );
    positionStack(step.outputs, outputX, rowY + (rowHeight - outputSize.height) / 2);
    rowY += rowHeight + rowGap;
  });

  if (unassigned.length > 0) {
    positionUnassignedBlocks(unassigned, origin.x, rowY, layoutWidth);
  }
  group.data.workflowAutoLayout = 'step_rows';
  fitGroupToChildren(snapshot, groupId);
  ensureWorkflowGroupRoutingBounds(snapshot, groupId);
  return true;
}

export function ensureWorkflowGroupRoutingBounds(
  snapshot: BoardSnapshot,
  groupId: string,
): boolean {
  const group = snapshot.blocks.find(
    (block) => block.blockId === groupId
      && block.type === 'group'
      && block.data.groupKind === 'workflow'
      && block.data.workflowAutoLayout === 'step_rows',
  );
  if (!group) return false;
  const children = snapshot.blocks.filter((block) => block.parentGroupId === groupId);
  const rightPadding = workflowGroupProjectedRightPadding(snapshot, groupId);
  if (rightPadding === defaultGroupRightPadding || children.length === 0) return false;
  const maximumChildRight = Math.max(
    ...children.map((block) => block.position.x + block.size.width),
  );
  const requiredRight = maximumChildRight + rightPadding;
  const currentRight = group.position.x + group.size.width;
  if (currentRight >= requiredRight) return false;
  group.size.width = requiredRight - group.position.x;
  group.updatedAt = nowIso();
  return true;
}

export function workflowGroupProjectedRightPadding(
  snapshot: BoardSnapshot,
  groupId: string,
): number {
  const children = snapshot.blocks.filter((block) => block.parentGroupId === groupId);
  const childById = new Map(children.map((block) => [block.blockId, block]));
  const hasRightRoutedDependency = snapshot.edges.some((edge) => {
    if (edge.kind !== 'execution_input') return false;
    const source = childById.get(edge.sourceBlockId);
    const target = childById.get(edge.targetBlockId);
    if (!source || target?.type !== 'operation') return false;
    const sourceStepId = source.data.workflowStepId;
    const targetStepId = target.data.workflowStepId;
    return source.type !== 'image'
      && source.type !== 'video'
      && typeof sourceStepId === 'string'
      && typeof targetStepId === 'string'
      && sourceStepId !== targetStepId;
  });
  return hasRightRoutedDependency
    ? workflowRoutingRightPadding
    : defaultGroupRightPadding;
}

export function refreshWorkflowGroupLayoutForBlock(
  snapshot: BoardSnapshot,
  block: BlockRecord,
): boolean {
  if (!block.parentGroupId) return false;
  const group = snapshot.blocks.find(
    (candidate) => candidate.blockId === block.parentGroupId && candidate.type === 'group',
  );
  if (
    group?.data.workflowAutoLayout !== 'snake_rows'
    && group?.data.workflowAutoLayout !== 'step_rows'
  ) return false;
  return arrangeWorkflowGroup(snapshot, group.blockId);
}

function workflowLayoutSteps(
  snapshot: BoardSnapshot,
  children: readonly BlockRecord[],
): WorkflowLayoutStep[] {
  const operations = children.filter(
    (block) => block.type === 'operation' && typeof block.data.workflowStepId === 'string',
  );
  const operationByStepId = new Map(
    operations.map((operation) => [String(operation.data.workflowStepId), operation]),
  );
  const childById = new Map(children.map((block) => [block.blockId, block]));
  const dependencies = new Map<string, Set<string>>(
    [...operationByStepId.keys()].map((stepId) => [stepId, new Set<string>()]),
  );
  for (const edge of snapshot.edges) {
    if (edge.kind !== 'execution_input') continue;
    const target = childById.get(edge.targetBlockId);
    const source = childById.get(edge.sourceBlockId);
    if (target?.type !== 'operation' || !source) continue;
    const targetStepId = typeof target.data.workflowStepId === 'string'
      ? target.data.workflowStepId
      : undefined;
    const sourceStepId = typeof source.data.workflowStepId === 'string'
      ? source.data.workflowStepId
      : undefined;
    if (targetStepId && sourceStepId && sourceStepId !== targetStepId) {
      dependencies.get(targetStepId)?.add(sourceStepId);
    }
  }

  const orderedStepIds = topologicalStepIds(operationByStepId, dependencies);
  return orderedStepIds.flatMap((stepId): WorkflowLayoutStep[] => {
    const operation = operationByStepId.get(stepId);
    if (!operation) return [];
    const inputs = children.filter((block) => (
      typeof block.data.workflowInputSlotId === 'string'
      && snapshot.edges.some((edge) => (
        edge.kind === 'execution_input'
        && edge.sourceBlockId === block.blockId
        && edge.targetBlockId === operation.blockId
      ))
    ));
    const outputs = children.filter((block) => (
      block.blockId !== operation.blockId
      && block.data.workflowStepId === stepId
      && (
        block.data.operationBlockId === operation.blockId
        || snapshot.edges.some((edge) => (
          edge.kind === 'execution_output'
          && edge.sourceBlockId === operation.blockId
          && edge.targetBlockId === block.blockId
        ))
      )
    ));
    return [{ inputs, operation, outputs, stepId }];
  });
}

function topologicalStepIds(
  operationByStepId: ReadonlyMap<string, BlockRecord>,
  dependencies: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const remaining = new Set(operationByStepId.keys());
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const ready = [...remaining].filter((stepId) => (
      [...(dependencies.get(stepId) ?? [])].every((dependency) => !remaining.has(dependency))
    ));
    const batch = (ready.length > 0 ? ready : [...remaining]).sort((left, right) => {
      const leftBlock = operationByStepId.get(left)!;
      const rightBlock = operationByStepId.get(right)!;
      return leftBlock.position.x - rightBlock.position.x
        || leftBlock.position.y - rightBlock.position.y
        || left.localeCompare(right);
    });
    for (const stepId of batch) {
      ordered.push(stepId);
      remaining.delete(stepId);
    }
  }
  return ordered;
}

function maximumStackWidth(stacks: readonly BlockRecord[][]): number {
  return Math.max(0, ...stacks.flatMap((blocks) => blocks.map((block) => block.size.width)));
}

function stackSize(blocks: readonly BlockRecord[]): { height: number; width: number } {
  return {
    height: blocks.reduce(
      (height, block, index) => height + block.size.height + (index > 0 ? stackGap : 0),
      0,
    ),
    width: Math.max(0, ...blocks.map((block) => block.size.width)),
  };
}

function positionStack(
  blocks: readonly BlockRecord[],
  x: number,
  y: number,
): void {
  let cursorY = y;
  for (const block of blocks) {
    positionBlock(block, x, cursorY);
    cursorY += block.size.height + stackGap;
  }
}

function positionBlock(
  block: BlockRecord,
  x: number,
  y: number,
): void {
  block.position = { x, y };
  block.data.workflowFlowDirection = 'forward';
}

function positionUnassignedBlocks(
  blocks: readonly BlockRecord[],
  x: number,
  y: number,
  layoutWidth: number,
): void {
  let cursorX = x;
  let cursorY = y;
  let rowHeight = 0;
  for (const block of blocks) {
    if (cursorX > x && cursorX + block.size.width > x + layoutWidth) {
      cursorX = x;
      cursorY += rowHeight + rowGap;
      rowHeight = 0;
    }
    block.position = { x: cursorX, y: cursorY };
    delete block.data.workflowFlowDirection;
    cursorX += block.size.width + inputColumnGap;
    rowHeight = Math.max(rowHeight, block.size.height);
  }
}
