import { getAssetPreviewUrl } from './assetStore';
import { operationReadinessFor } from './capabilities';
import { capabilityDefinitionFor } from './capabilityRegistry';
import {
  blockLockedByGroup,
  blockManagedByWorkflowGroup,
  descendantBlockIds,
  groupAncestorIds,
  groupMediaItems,
  groupMinimumDimensions,
  groupSelectionScopeBlockIds,
  groupStructureLocked,
  workflowGroupForBlock,
} from './grouping';
import {
  configurationChangeKinds,
  configurationChanges,
  currentOperationConfiguration,
  executionConfiguration,
  executionVersionFor,
  latestStartedExecutionForOperation,
  previousExecutionFor,
  queuedOperationConfigurationIsStale,
} from './executionConfiguration';
import type {
  BoardSnapshot,
  GroupColor,
  OperationReferenceInputPresentation,
} from './types';
import type { RetakeEdge, RetakeNode } from '../canvas/reactFlowTypes';
import { sourceImageAspectRatio } from './operationAspectRatio';
import { workflowStepRuntimeForOperation } from './workflowRuntime';
import type { CanvasProjectionMode } from './canvasProjectionViewState';
import { imageGenerateCapabilityId } from './imageGenerateContracts';
import { MarkerType } from '@xyflow/react';
import { routeWorkflowEdges } from './workflowEdgeRouting';
import { workflowGroupProjectedRightPadding } from './workflowGroupLayout';
import { resolveWorkflowInputBlock } from './workflowInputResolution';

const imageGenerateOperationBaseHeight = 190;
const operationReferenceSectionExpansion = 56;
const operationReadinessSectionExpansion = 50;
const workflowResultSummaryHeight = 76;
const workflowResultSummaryWidth = 240;

const groupFillColors: Record<GroupColor, string> = {
  transparent: '#f8fafc',
  neutral: '#cbd5e1',
  blue: '#93c5fd',
  green: '#86efac',
  yellow: '#fde68a',
  rose: '#fda4af',
};

const groupStrokeColors: Record<GroupColor, string> = {
  transparent: '#cbd5e1',
  neutral: '#64748b',
  blue: '#3b82f6',
  green: '#22c55e',
  yellow: '#eab308',
  rose: '#f43f5e',
};

export function createFlowNodes(
  snapshot: BoardSnapshot,
  options: {
    collapsedGroupIds?: string[];
    dropDetachGroupId?: string;
    dropTargetGroupId?: string;
    selectedBlockIds?: string[];
    selectedOperationBlockId?: string;
    projectionMode?: CanvasProjectionMode;
    textBlockDrafts?: ReadonlyMap<string, string>;
  } = {},
): RetakeNode[] {
  const collapsedGroupIds = new Set(options.collapsedGroupIds ?? []);
  const hiddenBlockIds = new Set(descendantBlockIds(snapshot, [...collapsedGroupIds]));
  const selectedBlockIds = new Set(options.selectedBlockIds ?? []);
  const creativeProjection = creativeProjectionFor(
    snapshot,
    options.projectionMode ?? 'creative',
    options.selectedBlockIds ?? [],
  );
  const selectionScopeBlockIds = new Set(groupSelectionScopeBlockIds(snapshot, options.selectedBlockIds ?? []));
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const readinessSnapshot = options.textBlockDrafts?.size
    ? {
        ...snapshot,
        blocks: snapshot.blocks.map((block) => {
          const draftBody = block.type === 'text' ? options.textBlockDrafts?.get(block.blockId) : undefined;
          return draftBody === undefined
            ? block
            : { ...block, data: { ...block.data, body: draftBody } };
        }),
      }
    : snapshot;
  const readinessByOperationId = new Map(
    snapshot.blocks
      .filter((block) => block.type === 'operation')
      .map((block) => [block.blockId, operationReadinessFor(readinessSnapshot, block)] as const),
  );
  const workflowStepRuntimeByOperationId = new Map(
    (readinessSnapshot.workflowStepRuns ?? []).flatMap((step) => {
      const view = workflowStepRuntimeForOperation(readinessSnapshot, step.operationBlockId);
      return view ? [[step.operationBlockId, view] as const] : [];
    }),
  );
  const operationChangesById = new Map(
    readinessSnapshot.blocks
      .filter((block) => block.type === 'operation')
      .flatMap((block) => {
        const comparisonExecution = latestStartedExecutionForOperation(readinessSnapshot, block.blockId);
        if (!comparisonExecution) return [];
        const changes = configurationChanges(
          executionConfiguration(comparisonExecution),
          currentOperationConfiguration(readinessSnapshot, block),
        );
        return [[block.blockId, changes] as const];
      }),
  );
  const executionMetadataById = new Map(
    snapshot.executions.map((execution) => {
      const previousExecution = previousExecutionFor(snapshot, execution);
      const changes = previousExecution
        ? configurationChanges(executionConfiguration(previousExecution), executionConfiguration(execution))
        : [];
      return [execution.executionId, {
        changeCount: changes.length,
        changeKinds: configurationChangeKinds(changes),
        status: execution.status,
        version: executionVersionFor(snapshot, execution),
      }] as const;
    }),
  );
  const executionById = new Map(snapshot.executions.map((execution) => [execution.executionId, execution]));
  const latestExecutionIdByOperationId = latestExecutionIdsByOperation(snapshot);
  const executionOutputBlockIds = new Set(
    snapshot.executions.flatMap((execution) => execution.outputBlockIds),
  );
  const projectedWorkflowGroupSizeById = (options.projectionMode ?? 'creative') === 'creative'
    ? projectedWorkflowGroupSizes(snapshot, creativeProjection)
    : new Map<string, { height: number; width: number }>();
  const orderedBlocks = snapshot.blocks.filter(
    (block) =>
      !hiddenBlockIds.has(block.blockId)
      && !creativeProjection.hiddenBlockIds.has(block.blockId),
  ).sort((left, right) => {
    const depthDifference = groupAncestorIds(snapshot, left.blockId).length - groupAncestorIds(snapshot, right.blockId).length;
    if (depthDifference !== 0) return depthDifference;
    if (left.type === 'group' && right.type !== 'group') return -1;
    if (left.type !== 'group' && right.type === 'group') return 1;
    return left.zIndex - right.zIndex;
  });

  return orderedBlocks.map((block) => {
    const parent = block.parentGroupId ? blockById.get(block.parentGroupId) : undefined;
    const workflowManaged = blockManagedByWorkflowGroup(snapshot, block.blockId);
    const groupMinimum = block.type === 'group' ? groupMinimumDimensions(snapshot, block.blockId) : undefined;
    const projectedWorkflowGroupSize = block.type === 'group'
      ? projectedWorkflowGroupSizeById.get(block.blockId)
      : undefined;
    const isCollapsed = block.type === 'group' && collapsedGroupIds.has(block.blockId);
    const contentLocked = blockLockedByGroup(snapshot, block.blockId);
    const operationReadiness = readinessByOperationId.get(block.blockId);
    const workflowStepRuntime = workflowStepRuntimeByOperationId.get(block.blockId);
    const operationCanRun = operationReadiness
      ? operationReadiness.canRun && (!workflowStepRuntime || workflowStepRuntime.canStart)
      : undefined;
    const runtimeDependencyPending = workflowStepRuntime
      && (workflowStepRuntime.status === 'pending' || workflowStepRuntime.status === 'blocked');
    const operationReadinessIssues = runtimeDependencyPending
      ? ['workflow_step_not_ready' as const]
      : operationReadiness?.issues.length
        ? operationReadiness.issues
        : workflowStepRuntime && !workflowStepRuntime.canStart
          ? ['workflow_step_not_ready' as const]
          : [];
    const operationReferenceInputs = block.type === 'operation'
      ? operationReferenceInputsFor(snapshot, block)
      : [];
    const operationChanges = operationChangesById.get(block.blockId) ?? [];
    const latestOperationExecution = block.type === 'operation'
      ? latestStartedExecutionForOperation(readinessSnapshot, block.blockId)
      : undefined;
    const compactOperation = creativeProjection.compactOperationIds.has(block.blockId);
    const workflowResultSummary = creativeProjection.summaryBlockIds.has(block.blockId);
    const projectedPosition = compactOperation
      ? compactOperationPosition(snapshot, block, creativeProjection.summaryBlockIds)
      : block.position;
    const groupExecutionMetadata = typeof block.data.groupExecutionId === 'string'
      ? executionMetadataById.get(block.data.groupExecutionId)
      : undefined;
    const sourceExecution = typeof block.data.sourceExecutionId === 'string'
      ? executionById.get(block.data.sourceExecutionId)
      : undefined;
    const operationBlockId = typeof sourceExecution?.params?.operationBlockId === 'string'
      ? sourceExecution.params.operationBlockId
      : undefined;
    const workflowHistoricalResult = Boolean(
      workflowManaged
      && operationBlockId
      && latestExecutionIdByOperationId.get(operationBlockId) !== sourceExecution?.executionId,
    );
    const groupDescendantIds = block.type === 'group' ? descendantBlockIds(snapshot, [block.blockId]) : [];
    const groupDescendants = block.type === 'group'
      ? groupDescendantIds.map((blockId) => blockById.get(blockId)).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      : [];
    const projectedWidth = isCollapsed
      ? 260
      : compactOperation
        ? 36
        : workflowResultSummary
          ? workflowResultSummaryWidth
          : projectedWorkflowGroupSize?.width ?? block.size.width;
    const projectedHeight = isCollapsed
      ? 88
      : compactOperation
        ? 36
        : workflowResultSummary
          ? workflowResultSummaryHeight
          : projectedWorkflowGroupSize?.height
            ?? projectedBlockHeight(block, operationReferenceInputs.length, operationReadinessIssues.length > 0);
    return ({
    id: block.blockId,
    type: block.type,
    position: parent
      ? { x: projectedPosition.x - parent.position.x, y: projectedPosition.y - parent.position.y }
      : projectedPosition,
    parentId: parent?.blockId,
    extent: parent?.type === 'group'
      && (
        parent.data.groupKind === 'workflow'
        || blockManagedByWorkflowGroup(snapshot, parent.blockId)
      )
      ? 'parent'
      : undefined,
    zIndex: block.zIndex,
    data: {
      ...block.data,
      groupMemberCount: block.type === 'group'
        ? descendantBlockIds(snapshot, [block.blockId]).filter(
            (blockId) => !creativeProjection.hiddenBlockIds.has(blockId),
          ).length
        : undefined,
      groupCollapsed: isCollapsed,
      groupContentLocked: contentLocked,
      groupDropDetach: block.blockId === options.dropDetachGroupId,
      groupDropTarget: block.blockId === options.dropTargetGroupId,
      groupFailedCount: block.type === 'group'
        ? groupDescendants.filter((descendant) => descendant.data.status === 'failed').length
        : undefined,
      groupMediaCount: block.type === 'group' ? groupMediaItems(snapshot, block.blockId).length : undefined,
      groupMinHeight: projectedWorkflowGroupSize?.height ?? groupMinimum?.height,
      groupMinWidth: projectedWorkflowGroupSize?.width ?? groupMinimum?.width,
      groupRunningCount: block.type === 'group'
        ? groupDescendants.filter((descendant) => descendant.data.status === 'running').length
        : undefined,
      groupScopeSelected: selectionScopeBlockIds.has(block.blockId) && !selectedBlockIds.has(block.blockId),
      groupStructureLocked: block.type === 'group'
        ? groupStructureLocked(snapshot, block.blockId)
        : undefined,
      executionChangeCount: groupExecutionMetadata?.changeCount,
      executionChangeKinds: groupExecutionMetadata?.changeKinds,
      executionAdapter: sourceExecution?.adapter,
      executionDetailsAvailable:
        Boolean(sourceExecution)
        || executionOutputBlockIds.has(block.blockId),
      executionTriggerMode: sourceExecution?.triggerMode,
      executionVersion: groupExecutionMetadata?.version,
      executionStatus: groupExecutionMetadata?.status,
      operationReferenceInputs: block.type === 'operation'
        ? operationReferenceInputs
        : undefined,
      operationCanRun,
      operationCompact: compactOperation,
      operationCompactResultCount: compactOperation
        ? operationResultCount(snapshot, block.blockId, latestOperationExecution?.outputBlockIds)
        : undefined,
      operationChangeCount: operationChanges.length,
      operationChangeKinds: configurationChangeKinds(operationChanges),
      operationQueuedConfigurationStale:
        block.type === 'operation' ? queuedOperationConfigurationIsStale(readinessSnapshot, block) : undefined,
      operationReadinessIssues,
      operationHasSourceImage:
        block.type === 'operation'
          ? snapshot.edges.some((edge) => (
              edge.kind === 'execution_input'
              && edge.targetBlockId === block.blockId
              && edge.inputSlotId === 'source_image'
            ))
          : undefined,
      operationSourceAspectRatio:
        block.type === 'operation' ? sourceImageAspectRatio(readinessSnapshot, block.blockId) : undefined,
      workflowStepRunFreshness: workflowStepRuntime?.freshness,
      workflowStepRunStatus: workflowStepRuntime?.status,
      workflowResultSummary,
      workflowHistoricalResult,
      annotatedCompositePreviewUrl:
        block.type === 'operation'
          ? getAssetPreviewUrl(snapshot.assets, block.data.annotatedCompositeAssetId)
          : undefined,
      annotationMarkCount:
        block.type === 'operation' ? annotationMarkCount(block.data.annotationManifest) : undefined,
      previewUrl: getAssetPreviewUrl(snapshot.assets, block.data.assetId),
      resultRetryMode:
        block.type === 'image' && block.data.status === 'failed' && !block.data.assetId
          ? sourceExecution?.adapter === 'mcp_agent'
            ? 'codex_prompt'
            : sourceExecution?.adapter === 'direct_api' || sourceExecution?.adapter === 'codex_app_server'
              ? 'direct_retry'
              : undefined
          : undefined,
    },
    // React Flow does not treat CSS dimensions as initialized dimensions. Remote
    // snapshots replace controlled node objects while executions are running, so
    // provide the known projection size up front instead of hiding every node
    // until ResizeObserver has measured the replacement objects again.
    initialWidth: projectedWidth,
    initialHeight: projectedHeight,
    style: {
      width: projectedWidth,
      height: projectedHeight,
    },
    connectable: !contentLocked && !workflowManaged,
    deletable:
      !contentLocked &&
      !workflowManaged &&
      !(block.type === 'group' && (block.data.groupContentsLocked || block.data.groupPositionLocked)),
    draggable: !contentLocked && !(block.type === 'group' && block.data.groupPositionLocked),
    });
  });
}

function latestExecutionIdsByOperation(snapshot: BoardSnapshot): Map<string, string> {
  const latest = new Map<string, { executionId: string; startedAt: string }>();
  for (const execution of snapshot.executions) {
    const operationBlockId = typeof execution.params?.operationBlockId === 'string'
      ? execution.params.operationBlockId
      : undefined;
    if (!operationBlockId) continue;
    const current = latest.get(operationBlockId);
    if (!current || Date.parse(execution.startedAt) >= Date.parse(current.startedAt)) {
      latest.set(operationBlockId, {
        executionId: execution.executionId,
        startedAt: execution.startedAt,
      });
    }
  }
  return new Map([...latest].map(([operationBlockId, execution]) => (
    [operationBlockId, execution.executionId]
  )));
}

function projectedBlockHeight(
  block: BoardSnapshot['blocks'][number],
  operationReferenceCount: number,
  hasReadinessIssue: boolean,
): number {
  if (block.type !== 'operation' || block.data.capabilityId !== imageGenerateCapabilityId) {
    return block.size.height;
  }
  const showReadinessIssue = hasReadinessIssue
    && block.data.status !== 'queued'
    && block.data.status !== 'running';
  const minimumHeight = imageGenerateOperationBaseHeight
    + (operationReferenceCount > 0 ? operationReferenceSectionExpansion : 0)
    + (showReadinessIssue ? operationReadinessSectionExpansion : 0);
  return Math.max(block.size.height, minimumHeight);
}

function operationResultCount(
  snapshot: BoardSnapshot,
  operationBlockId: string,
  latestOutputBlockIds: string[] | undefined,
): number {
  if (latestOutputBlockIds?.length) return latestOutputBlockIds.length;
  return new Set(snapshot.edges.flatMap((edge) => (
    edge.kind === 'execution_output' && edge.sourceBlockId === operationBlockId
      ? [edge.targetBlockId]
      : []
  ))).size;
}

function compactOperationPosition(
  snapshot: BoardSnapshot,
  operation: BoardSnapshot['blocks'][number],
  summaryBlockIds: ReadonlySet<string> = new Set(),
): { x: number; y: number } {
  const outputBlocks = snapshot.edges.flatMap((edge) => {
    if (edge.kind !== 'execution_output' || edge.sourceBlockId !== operation.blockId) return [];
    const output = snapshot.blocks.find((block) => block.blockId === edge.targetBlockId);
    return output ? [output] : [];
  }).sort((left, right) => left.position.x - right.position.x || left.position.y - right.position.y);
  const firstOutput = outputBlocks[0];
  if (firstOutput) {
    return {
      x: firstOutput.position.x - 56,
      y: firstOutput.position.y
        + (summaryBlockIds.has(firstOutput.blockId)
          ? workflowResultSummaryHeight
          : firstOutput.size.height) / 2
        - 18,
    };
  }
  return {
    x: operation.position.x + operation.size.width - 36,
    y: operation.position.y + operation.size.height / 2 - 18,
  };
}

function annotationMarkCount(manifest: unknown): number | undefined {
  if (!manifest || typeof manifest !== 'object' || !('marks' in manifest)) return undefined;
  const marks = manifest.marks;
  return Array.isArray(marks) ? marks.length : undefined;
}

export function createFlowEdges(
  snapshot: BoardSnapshot,
  options: {
    collapsedGroupIds?: string[];
    projectionMode?: CanvasProjectionMode;
    selectedBlockIds?: string[];
  } = {},
): RetakeEdge[] {
  const selectedBlockIds = new Set(groupSelectionScopeBlockIds(snapshot, options.selectedBlockIds ?? []));
  const collapsedGroupIds = new Set(options.collapsedGroupIds ?? []);
  const creativeProjection = creativeProjectionFor(
    snapshot,
    options.projectionMode ?? 'creative',
    options.selectedBlockIds ?? [],
  );
  const projectedEdges = new Map<string, RetakeEdge>();
  for (const edge of snapshot.edges) {
    if (
      creativeProjection.hiddenBlockIds.has(edge.sourceBlockId)
      || creativeProjection.hiddenBlockIds.has(edge.targetBlockId)
    ) continue;
    const source = visibleEdgeEndpoint(snapshot, edge.sourceBlockId, collapsedGroupIds);
    const target = visibleEdgeEndpoint(snapshot, edge.targetBlockId, collapsedGroupIds);
    if (source === target) continue;
    const isProxy = source !== edge.sourceBlockId || target !== edge.targetBlockId;
    const key = isProxy
      ? `${source}:${target}:${edge.kind}:${edge.inputSlotId ?? ''}`
      : edge.edgeId;
    const existing = projectedEdges.get(key);
    if (existing) {
      existing.data?.proxyEdgeIds?.push(edge.edgeId);
      continue;
    }
    const selected = selectedBlockIds.has(edge.sourceBlockId) || selectedBlockIds.has(edge.targetBlockId);
    const workflowManaged = blockManagedByWorkflowGroup(snapshot, edge.sourceBlockId)
      || blockManagedByWorkflowGroup(snapshot, edge.targetBlockId);
    const targetBlock = snapshot.blocks.find((block) => block.blockId === edge.targetBlockId);
    const resultCount = edge.kind === 'execution_output' && typeof targetBlock?.data.resultCount === 'number'
      ? targetBlock.data.resultCount
      : undefined;
    const resultIndex = resultCount && typeof targetBlock?.data.resultIndex === 'number'
      ? targetBlock.data.resultIndex
      : undefined;
    projectedEdges.set(key, {
      id: isProxy ? `collapsed:${key}` : edge.edgeId,
      source,
      target,
      type: workflowManaged
        ? 'workflow'
        : resultCount && resultCount > 1
          ? 'executionOutput'
          : 'default',
      className: [
        selected ? 'is-connected-to-selection' : '',
        isProxy ? 'is-collapsed-group-proxy' : '',
        workflowManaged ? 'is-workflow-edge' : '',
        workflowManaged ? `is-${edge.kind.replace('_', '-')}` : '',
      ]
        .filter(Boolean)
        .join(' ') || undefined,
      markerEnd: workflowManaged ? { type: MarkerType.ArrowClosed } : undefined,
      data: {
        inputSlotId: edge.inputSlotId,
        kind: edge.kind,
        proxyEdgeIds: isProxy ? [edge.edgeId] : undefined,
        referenceIntent: edge.referenceIntent,
        resultCount,
        resultHeight: resultCount ? targetBlock?.size.height : undefined,
        resultIndex,
      },
      label: isProxy ? undefined : edgeLabelFor(snapshot, edge),
      deletable:
        !isProxy &&
        !blockLockedByGroup(snapshot, edge.sourceBlockId) &&
        !blockLockedByGroup(snapshot, edge.targetBlockId),
      selectable: !isProxy,
    });
  }
  return routeWorkflowEdges(snapshot, [...projectedEdges.values()]);
}

function operationReferenceInputsFor(
  snapshot: BoardSnapshot,
  operation: BoardSnapshot['blocks'][number],
): OperationReferenceInputPresentation[] {
  if (operation.type !== 'operation') return [];
  const capabilityId = typeof operation.data.capabilityId === 'string'
    ? operation.data.capabilityId
    : 'image.generate';
  let definition: ReturnType<typeof capabilityDefinitionFor> | undefined;
  try {
    definition = capabilityDefinitionFor(capabilityId);
  } catch {
    definition = undefined;
  }
  const slotById = new Map(
    definition?.inputSlots.map((slot) => [slot.slotId, slot]) ?? [],
  );
  const editable = operation.data.status !== 'queued'
    && operation.data.status !== 'running'
    && !blockLockedByGroup(snapshot, operation.blockId);
  return snapshot.edges.flatMap((edge) => {
    if (
      edge.kind !== 'execution_input'
      || edge.targetBlockId !== operation.blockId
    ) return [];
    const projectedBlock = snapshot.blocks.find(
      (candidate) => candidate.blockId === edge.sourceBlockId,
    );
    if (projectedBlock?.type !== 'image') return [];
    const block = resolveWorkflowInputBlock(
      snapshot,
      operation.blockId,
      edge.inputSlotId,
      projectedBlock,
    );
    const semanticRole = edge.inputSlotId
      ? slotById.get(edge.inputSlotId)?.semanticRole
      : undefined;
    const bindingKind = semanticRole === 'source'
      ? 'source'
      : semanticRole === 'reference' || semanticRole === 'general_reference'
        ? 'reference'
        : 'slot';
    return [{
      bindingKind,
      blockId: block.blockId,
      edgeId: edge.edgeId,
      editable: editable && !blockLockedByGroup(snapshot, block.blockId),
      inputSlotId: edge.inputSlotId,
      previewUrl: getAssetPreviewUrl(snapshot.assets, block.data.assetId),
      ...(edge.referenceIntent
        ? { referenceIntent: structuredClone(edge.referenceIntent) }
        : {}),
      title: block.data.title,
    } satisfies OperationReferenceInputPresentation];
  });
}

function creativeProjectionFor(
  snapshot: BoardSnapshot,
  projectionMode: CanvasProjectionMode,
  _selectedBlockIds: readonly string[],
): {
  compactOperationIds: Set<string>;
  hiddenBlockIds: Set<string>;
  summaryBlockIds: Set<string>;
} {
  if (projectionMode !== 'creative') {
    return {
      compactOperationIds: new Set(),
      hiddenBlockIds: new Set(),
      summaryBlockIds: new Set(),
    };
  }
  const hiddenFutureOperationIds = new Set(
    snapshot.blocks.flatMap((block) => {
      if (block.type !== 'operation') return [];
      const runtime = workflowStepRuntimeForOperation(snapshot, block.blockId);
      return (
        runtime && (runtime.status === 'pending' || runtime.status === 'blocked')
      ) || (
        !runtime && unstartedWorkflowOperationHasUpstreamStep(snapshot, block.blockId)
      )
        ? [block.blockId]
        : [];
    }),
  );
  const hiddenFutureOutputIds = new Set(
    snapshot.edges.flatMap((edge) => (
      edge.kind === 'execution_output'
      && hiddenFutureOperationIds.has(edge.sourceBlockId)
        ? [edge.targetBlockId]
        : []
    )),
  );
  const compactOperationIds = new Set<string>();
  return {
    // Completion never changes a Board's presentation density implicitly.
    // Workflow Steps and ordinary image Operations both stay fully readable;
    // compact presentation is a deliberate user or Workspace concern.
    compactOperationIds,
    hiddenBlockIds: new Set([
      ...hiddenFutureOperationIds,
      ...hiddenFutureOutputIds,
    ]),
    summaryBlockIds: new Set(),
  };
}

function unstartedWorkflowOperationHasUpstreamStep(
  snapshot: BoardSnapshot,
  operationBlockId: string,
): boolean {
  const operation = snapshot.blocks.find(
    (block) => block.blockId === operationBlockId && block.type === 'operation',
  );
  if (!operation) return false;
  const group = workflowGroupForBlock(snapshot, operation.blockId);
  if (!group || group.data.groupKind !== 'workflow') return false;
  const stepId = typeof operation.data.workflowStepId === 'string'
    ? operation.data.workflowStepId
    : undefined;
  if (!stepId) return false;
  return snapshot.edges.some((edge) => {
    if (edge.kind !== 'execution_input' || edge.targetBlockId !== operation.blockId) return false;
    const source = snapshot.blocks.find((block) => block.blockId === edge.sourceBlockId);
    const sourceStepId = source && typeof source.data.workflowStepId === 'string'
      ? source.data.workflowStepId
      : undefined;
    return Boolean(
      source
      && source.parentGroupId === group.blockId
      && sourceStepId
      && sourceStepId !== stepId,
    );
  });
}

function projectedWorkflowGroupSizes(
  snapshot: BoardSnapshot,
  creativeProjection: ReturnType<typeof creativeProjectionFor>,
): Map<string, { height: number; width: number }> {
  const sizes = new Map<string, { height: number; width: number }>();
  const workflowGroups = snapshot.blocks.filter(
    (block) => block.type === 'group' && block.data.groupKind === 'workflow',
  );
  for (const group of workflowGroups) {
    const visibleChildren = snapshot.blocks.filter(
      (block) => block.parentGroupId === group.blockId
        && !creativeProjection.hiddenBlockIds.has(block.blockId),
    );
    if (visibleChildren.length === 0) {
      sizes.set(group.blockId, { height: 180, width: 260 });
      continue;
    }
    const maxX = Math.max(...visibleChildren.map((child) => {
      const position = creativeProjection.compactOperationIds.has(child.blockId)
        ? compactOperationPosition(snapshot, child, creativeProjection.summaryBlockIds)
        : child.position;
      const width = creativeProjection.compactOperationIds.has(child.blockId)
        ? 36
        : creativeProjection.summaryBlockIds.has(child.blockId)
          ? workflowResultSummaryWidth
          : child.size.width;
      return position.x + width;
    }));
    const maxY = Math.max(...visibleChildren.map((child) => {
      const position = creativeProjection.compactOperationIds.has(child.blockId)
        ? compactOperationPosition(snapshot, child, creativeProjection.summaryBlockIds)
        : child.position;
      const height = creativeProjection.compactOperationIds.has(child.blockId)
        ? 36
        : creativeProjection.summaryBlockIds.has(child.blockId)
          ? workflowResultSummaryHeight
          : child.size.height;
      return position.y + height;
    }));
    sizes.set(group.blockId, {
      height: Math.max(180, maxY - group.position.y + 28),
      width: Math.max(
        260,
        maxX - group.position.x + workflowGroupProjectedRightPadding(snapshot, group.blockId),
      ),
    });
  }
  return sizes;
}

function visibleEdgeEndpoint(snapshot: BoardSnapshot, blockId: string, collapsedGroupIds: Set<string>): string {
  const collapsedAncestors = groupAncestorIds(snapshot, blockId).filter((groupId) => collapsedGroupIds.has(groupId));
  return collapsedAncestors.at(-1) ?? blockId;
}

function edgeLabelFor(snapshot: BoardSnapshot, edge: BoardSnapshot['edges'][number]): string | undefined {
  if (edge.kind !== 'execution_input') return undefined;

  const sourceBlock = snapshot.blocks.find((block) => block.blockId === edge.sourceBlockId);
  if (sourceBlock?.type !== 'image') return undefined;

  const imageInputEdges = snapshot.edges.filter((candidate) => {
    if (candidate.kind !== 'execution_input' || candidate.targetBlockId !== edge.targetBlockId) return false;
    return snapshot.blocks.find((block) => block.blockId === candidate.sourceBlockId)?.type === 'image';
  });
  if (imageInputEdges.length < 2) return undefined;

  const index = imageInputEdges.findIndex((candidate) => candidate.edgeId === edge.edgeId);
  const title = typeof sourceBlock.data.title === 'string' ? sourceBlock.data.title.trim() : '';
  if (title && !genericImageTitle(title)) return title;
  return `Image ${index + 1}`;
}

function genericImageTitle(title: string): boolean {
  return ['image block', 'source', '图片块', '源图'].includes(title.toLowerCase());
}

export function nodeColor(node: RetakeNode): string {
  if (node.type === 'image') return '#60a5fa';
  if (node.type === 'video') return '#f97316';
  if (node.type === 'operation') return '#14b8a6';
  if (node.type === 'group') return groupFillColors[groupColorForNode(node)];
  return '#64748b';
}

export function nodeStrokeColor(node: RetakeNode): string {
  if (node.type === 'group') return groupStrokeColors[groupColorForNode(node)];
  return '#ffffff';
}

function groupColorForNode(node: RetakeNode): GroupColor {
  const color = node.data.groupColor;
  return color && color in groupFillColors ? color : 'neutral';
}
