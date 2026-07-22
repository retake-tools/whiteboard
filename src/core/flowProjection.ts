import { getAssetPreviewUrl } from './assetStore';
import {
  disabledExecutionInputRolesFor,
  executionInputRoleOptionsFor,
  operationReadinessFor,
} from './capabilities';
import {
  blockLockedByGroup,
  descendantBlockIds,
  groupAncestorIds,
  groupMediaItems,
  groupMinimumDimensions,
  groupSelectionScopeBlockIds,
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
import type { BoardSnapshot, GroupColor, RetakeEdge, RetakeNode } from './types';
import { sourceImageAspectRatio } from './operationAspectRatio';
import { workflowStepRuntimeForOperation } from './workflowRuntime';

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
    textBlockDrafts?: ReadonlyMap<string, string>;
  } = {},
): RetakeNode[] {
  const collapsedGroupIds = new Set(options.collapsedGroupIds ?? []);
  const hiddenBlockIds = new Set(descendantBlockIds(snapshot, [...collapsedGroupIds]));
  const selectedBlockIds = new Set(options.selectedBlockIds ?? []);
  const selectionScopeBlockIds = new Set(groupSelectionScopeBlockIds(snapshot, options.selectedBlockIds ?? []));
  const selectedOperation = snapshot.blocks.find(
    (block) =>
      block.blockId === options.selectedOperationBlockId &&
      (block.type === 'operation' || block.type === 'video'),
  );
  const inputMetadataByBlockId = new Map(
    snapshot.edges
      .filter((edge) => edge.kind === 'execution_input' && edge.targetBlockId === options.selectedOperationBlockId)
      .flatMap((edge) => {
        const sourceBlock = snapshot.blocks.find((block) => block.blockId === edge.sourceBlockId);
        if (sourceBlock?.type !== 'image' || !selectedOperation) return [];
        return [[
          edge.sourceBlockId,
          {
            edgeId: edge.edgeId,
            role: edge.inputRole,
            roleOptions: executionInputRoleOptionsFor(sourceBlock, selectedOperation),
            disabledRoleOptions: disabledExecutionInputRolesFor(
              snapshot,
              sourceBlock,
              selectedOperation,
              edge.edgeId,
            ),
            locked:
              blockLockedByGroup(snapshot, sourceBlock.blockId) ||
              blockLockedByGroup(snapshot, selectedOperation.blockId),
          },
        ] as const];
      }),
  );

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
  const orderedBlocks = snapshot.blocks.filter((block) => !hiddenBlockIds.has(block.blockId)).sort((left, right) => {
    const depthDifference = groupAncestorIds(snapshot, left.blockId).length - groupAncestorIds(snapshot, right.blockId).length;
    if (depthDifference !== 0) return depthDifference;
    if (left.type === 'group' && right.type !== 'group') return -1;
    if (left.type !== 'group' && right.type === 'group') return 1;
    return left.zIndex - right.zIndex;
  });

  return orderedBlocks.map((block) => {
    const parent = block.parentGroupId ? blockById.get(block.parentGroupId) : undefined;
    const groupMinimum = block.type === 'group' ? groupMinimumDimensions(snapshot, block.blockId) : undefined;
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
    const operationChanges = operationChangesById.get(block.blockId) ?? [];
    const groupExecutionMetadata = typeof block.data.groupExecutionId === 'string'
      ? executionMetadataById.get(block.data.groupExecutionId)
      : undefined;
    const sourceExecution = typeof block.data.sourceExecutionId === 'string'
      ? executionById.get(block.data.sourceExecutionId)
      : undefined;
    const groupDescendantIds = block.type === 'group' ? descendantBlockIds(snapshot, [block.blockId]) : [];
    const groupDescendants = block.type === 'group'
      ? groupDescendantIds.map((blockId) => blockById.get(blockId)).filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      : [];
    return ({
    id: block.blockId,
    type: block.type,
    position: parent
      ? { x: block.position.x - parent.position.x, y: block.position.y - parent.position.y }
      : block.position,
    parentId: parent?.blockId,
    extent: undefined,
    zIndex: block.zIndex,
    data: {
      ...block.data,
      groupMemberCount: block.type === 'group' ? descendantBlockIds(snapshot, [block.blockId]).length : undefined,
      groupCollapsed: isCollapsed,
      groupContentLocked: contentLocked,
      groupDropDetach: block.blockId === options.dropDetachGroupId,
      groupDropTarget: block.blockId === options.dropTargetGroupId,
      groupFailedCount: block.type === 'group'
        ? groupDescendants.filter((descendant) => descendant.data.status === 'failed').length
        : undefined,
      groupMediaCount: block.type === 'group' ? groupMediaItems(snapshot, block.blockId).length : undefined,
      groupMinHeight: groupMinimum?.height,
      groupMinWidth: groupMinimum?.width,
      groupRunningCount: block.type === 'group'
        ? groupDescendants.filter((descendant) => descendant.data.status === 'running').length
        : undefined,
      groupScopeSelected: selectionScopeBlockIds.has(block.blockId) && !selectedBlockIds.has(block.blockId),
      executionChangeCount: groupExecutionMetadata?.changeCount,
      executionChangeKinds: groupExecutionMetadata?.changeKinds,
      executionAdapter: sourceExecution?.adapter,
      executionTriggerMode: sourceExecution?.triggerMode,
      executionVersion: groupExecutionMetadata?.version,
      executionStatus: groupExecutionMetadata?.status,
      operationInputEdgeId: inputMetadataByBlockId.get(block.blockId)?.edgeId,
      operationInputRole: inputMetadataByBlockId.get(block.blockId)?.role,
      operationInputRoleDisabledOptions: inputMetadataByBlockId.get(block.blockId)?.disabledRoleOptions,
      operationInputRoleLocked: inputMetadataByBlockId.get(block.blockId)?.locked,
      operationInputRoleOptions: inputMetadataByBlockId.get(block.blockId)?.roleOptions,
      operationInputRolePending:
        Boolean(inputMetadataByBlockId.get(block.blockId)?.edgeId) &&
        !inputMetadataByBlockId.get(block.blockId)?.role,
      operationCanRun,
      operationChangeCount: operationChanges.length,
      operationChangeKinds: configurationChangeKinds(operationChanges),
      operationQueuedConfigurationStale:
        block.type === 'operation' ? queuedOperationConfigurationIsStale(readinessSnapshot, block) : undefined,
      operationReadinessIssues,
      operationSourceAspectRatio:
        block.type === 'operation' ? sourceImageAspectRatio(readinessSnapshot, block.blockId) : undefined,
      workflowStepRunFreshness: workflowStepRuntime?.freshness,
      workflowStepRunStatus: workflowStepRuntime?.status,
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
    style: {
      width: isCollapsed ? 260 : block.size.width,
      height: isCollapsed ? 88 : block.size.height,
    },
    connectable: !contentLocked,
    deletable:
      !contentLocked &&
      !(block.type === 'group' && (block.data.groupContentsLocked || block.data.groupPositionLocked)),
    draggable: !contentLocked && !(block.type === 'group' && block.data.groupPositionLocked),
    });
  });
}

function annotationMarkCount(manifest: unknown): number | undefined {
  if (!manifest || typeof manifest !== 'object' || !('marks' in manifest)) return undefined;
  const marks = manifest.marks;
  return Array.isArray(marks) ? marks.length : undefined;
}

export function createFlowEdges(
  snapshot: BoardSnapshot,
  options: { collapsedGroupIds?: string[]; selectedBlockIds?: string[] } = {},
): RetakeEdge[] {
  const selectedBlockIds = new Set(groupSelectionScopeBlockIds(snapshot, options.selectedBlockIds ?? []));
  const collapsedGroupIds = new Set(options.collapsedGroupIds ?? []);
  const projectedEdges = new Map<string, RetakeEdge>();
  for (const edge of snapshot.edges) {
    const source = visibleEdgeEndpoint(snapshot, edge.sourceBlockId, collapsedGroupIds);
    const target = visibleEdgeEndpoint(snapshot, edge.targetBlockId, collapsedGroupIds);
    if (source === target) continue;
    const isProxy = source !== edge.sourceBlockId || target !== edge.targetBlockId;
    const key = isProxy
      ? `${source}:${target}:${edge.kind}:${edge.inputRole ?? ''}:${edge.inputSlotId ?? ''}`
      : edge.edgeId;
    const existing = projectedEdges.get(key);
    if (existing) {
      existing.data?.proxyEdgeIds?.push(edge.edgeId);
      continue;
    }
    const selected = selectedBlockIds.has(edge.sourceBlockId) || selectedBlockIds.has(edge.targetBlockId);
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
      type: resultCount && resultCount > 1 ? 'executionOutput' : 'default',
      className: [selected ? 'is-connected-to-selection' : '', isProxy ? 'is-collapsed-group-proxy' : '']
        .filter(Boolean)
        .join(' ') || undefined,
      data: {
        inputRole: edge.inputRole,
        inputSlotId: edge.inputSlotId,
        kind: edge.kind,
        proxyEdgeIds: isProxy ? [edge.edgeId] : undefined,
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
  return [...projectedEdges.values()];
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
