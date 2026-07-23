import type {
  BlockRecord,
  BoardEdgeRecord,
  BoardSnapshot,
  BlockType,
  ConnectionKind,
  ExecutionInputRole,
} from './types';
import { defaultGenerationProfileId } from './generationProfiles';
import { displaySlotSizeForGenerationParams, type ImageGenerationParams } from './imageOperations';
import { isExecutionInputRole } from './inputRoles';
import { fitImageBlockSize, imageResultColumnGap } from './blockSizing';
import { ensureExecutionResultGroups, repairGroupRelationships } from './grouping';
import type { ChangeProposalCommand } from './agentSessionContracts';

type LegacyBlockType = BlockType | 'task' | 'frame';
type LegacyConnectionKind = ConnectionKind | 'reference' | 'derived_from';
type LegacyBlockRecord = Omit<BlockRecord, 'type'> & { type: LegacyBlockType };
type LegacyEdgeRecord = Omit<BoardEdgeRecord, 'kind'> & { kind: LegacyConnectionKind };
type LegacyBoardSnapshot = Omit<BoardSnapshot, 'blocks' | 'edges'> & {
  blocks: LegacyBlockRecord[];
  edges: LegacyEdgeRecord[];
  viewport?: unknown;
};

export function migrateBoardSnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  const legacy = snapshot as LegacyBoardSnapshot;
  const { viewport: _legacyViewport, ...snapshotWithoutLegacyViewport } = legacy;
  const removedBlockIds = new Set<string>();
  const migratedBlocks = legacy.blocks.flatMap((block): BlockRecord[] => {
    if (block.type === 'frame' || block.type === 'task') {
      removedBlockIds.add(block.blockId);
      return [];
    }

    return [
      {
        ...block,
        type: block.type,
        size: block.type === 'operation' ? operationBlockSize(block) : block.size,
        data: migrateBlockData(block.type, block),
      },
    ];
  });

  const migratedEdges = legacy.edges.flatMap((edge): BoardEdgeRecord[] => {
    if (removedBlockIds.has(edge.sourceBlockId) || removedBlockIds.has(edge.targetBlockId)) {
      return [];
    }

    if (edge.kind === 'visual_note' || edge.kind === 'execution_input' || edge.kind === 'execution_output') {
      return [
        {
          ...(edge as BoardEdgeRecord),
          inputRole: isExecutionInputRole(edge.inputRole) ? edge.inputRole : undefined,
        },
      ];
    }

    return [];
  });

  const promptMigratedBlocks = migrateOperationPromptTextBlocks(migratedBlocks, migratedEdges);
  const validBlockIds = new Set(promptMigratedBlocks.map((block) => block.blockId));
  const migratedExecutions = legacy.executions.map((execution) => ({
    ...execution,
    inputBlockIds: execution.inputBlockIds.filter((blockId) => validBlockIds.has(blockId)),
    outputBlockIds: execution.outputBlockIds.filter((blockId) => validBlockIds.has(blockId)),
  }));

  const repairedBlocks = repairImageAssetBlockSizes(
    repairExecutionResultBatches(
      repairLinearImageToImageDrafts(promptMigratedBlocks, migratedEdges),
      legacy.executions,
    ),
    legacy.assets,
  );

  const migratedSnapshot: BoardSnapshot = {
    ...snapshotWithoutLegacyViewport,
    blocks: repairedBlocks,
    edges: migratedEdges,
    executions: migratedExecutions,
    agentRuns: (legacy.agentRuns ?? []).map((run) => ({
      ...run,
      permissions: run.permissions ?? {
        allowedToolPermissions: ['retake.read', 'retake.execute_capability'],
        canCreateBlocks: false,
        canDeleteAssets: false,
        canInstallPackages: false,
        canModifyWorkflow: false,
      },
    })),
    agentSessions: legacy.agentSessions ?? [],
    agentMessages: legacy.agentMessages ?? [],
    agentRuntimeBindings: legacy.agentRuntimeBindings ?? [],
    agentRuntimeEvents: legacy.agentRuntimeEvents ?? [],
    changeProposals: (legacy.changeProposals ?? []).map((proposal) => ({
      ...proposal,
      proposedCommand: migrateChangeProposalCommand(proposal.proposedCommand),
    })),
    changeDecisions: legacy.changeDecisions ?? [],
    workflowRuns: (legacy.workflowRuns ?? []).map((run) => ({
      ...run,
      gateDefinitionLocks: run.gateDefinitionLocks ?? [],
      gateEvaluationIds: run.gateEvaluationIds ?? [],
      inputBindings: (run.inputBindings ?? []).map((binding) => {
        const legacyBinding = binding as typeof binding & { blockId?: string };
        return {
          workflowInputSlotId: binding.workflowInputSlotId,
          values: binding.values ?? (legacyBinding.blockId
            ? [{ kind: 'block' as const, blockId: legacyBinding.blockId }]
            : []),
        };
      }),
      outputSlotLocks: run.outputSlotLocks ?? [],
    })),
    workflowStepRuns: (legacy.workflowStepRuns ?? []).map((step) => ({
      ...step,
      acceptedOutputAssetIds: step.acceptedOutputAssetIds ?? [],
      outputArtifactBindings: step.outputArtifactBindings ?? [],
      outputSlotIds: step.outputSlotIds ?? [],
      outputAcceptancePolicy: step.outputAcceptancePolicy ?? 'automatic',
      resolvedInputBindings: (step.resolvedInputBindings ?? []).map((binding) => {
        const legacyBinding = binding as typeof binding & { blockId?: string };
        return {
          inputSlotId: binding.inputSlotId,
          source: binding.source,
          values: binding.values ?? (legacyBinding.blockId
            ? [{ kind: 'block' as const, blockId: legacyBinding.blockId }]
            : []),
        };
      }),
    })),
    workflowGateEvaluations: legacy.workflowGateEvaluations ?? [],
    workflowApprovalRequests: legacy.workflowApprovalRequests ?? [],
    workflowApprovalDecisions: legacy.workflowApprovalDecisions ?? [],
  };
  repairGroupRelationships(migratedSnapshot);
  ensureExecutionResultGroups(migratedSnapshot);
  if ((legacy.groupMigrationVersion ?? 0) < 1) migratedSnapshot.groupMigrationVersion = 1;
  return migratedSnapshot;
}

function migrateChangeProposalCommand(
  command: ChangeProposalCommand | undefined,
): ChangeProposalCommand {
  if (!command) {
    return {
      kind: 'unsupported',
      reason: 'Legacy Proposal has no registered Application Service command.',
    };
  }
  if (command.kind !== 'package_entrypoint.instantiate') return command;
  return {
    ...command,
    invocation: {
      ...command.invocation,
      inlineValues: command.invocation.inlineValues ?? [],
      parameters: command.invocation.parameters ?? {},
    },
  };
}

function repairImageAssetBlockSizes(
  blocks: BlockRecord[],
  assets: BoardSnapshot['assets'],
): BlockRecord[] {
  const imageDimensionsByAssetId = new Map(
    assets.flatMap((asset) =>
      asset.kind === 'image' && asset.width && asset.height
        ? [[asset.assetId, { width: asset.width, height: asset.height }] as const]
        : [],
    ),
  );

  return blocks.map((block) => {
    if (block.type !== 'image' || typeof block.data.assetId !== 'string') return block;
    const dimensions = imageDimensionsByAssetId.get(block.data.assetId);
    if (!dimensions) return block;
    const targetSize = fitImageBlockSize(dimensions.width, dimensions.height);
    if (block.size.width === targetSize.width && block.size.height === targetSize.height) return block;
    return { ...block, size: targetSize };
  });
}

function repairExecutionResultBatches(
  blocks: BlockRecord[],
  executions: BoardSnapshot['executions'],
): BlockRecord[] {
  const nextBlocks = blocks.map((block) => ({ ...block, position: { ...block.position }, size: { ...block.size } }));
  const blockById = new Map(nextBlocks.map((block) => [block.blockId, block]));

  for (const execution of executions) {
    if (execution.outputBlockIds.length < 2) continue;
    const outputBlocks = execution.outputBlockIds
      .map((blockId) => blockById.get(blockId))
      .filter((block): block is BlockRecord => block?.type === 'image');
    if (outputBlocks.length < 2) continue;

    const generation = execution.params?.generation;
    const generationParams: ImageGenerationParams | undefined =
      generation && typeof generation === 'object'
        ? {
            targetAspectRatio:
              typeof (generation as Record<string, unknown>).targetAspectRatio === 'number'
                ? (generation as Record<string, number>).targetAspectRatio
                : undefined,
          }
        : undefined;
    const targetSize = displaySlotSizeForGenerationParams(generationParams, outputBlocks[0].size);
    const needsRepair = outputBlocks.some(
      (block) => block.size.width !== targetSize.width || block.size.height !== targetSize.height,
    ) || outputBlocksOverlap(outputBlocks);
    if (!needsRepair) continue;

    const baseX = Math.min(...outputBlocks.map((block) => block.position.x));
    const baseY = Math.min(...outputBlocks.map((block) => block.position.y));
    outputBlocks.forEach((block, index) => {
      block.position = { x: baseX + index * (targetSize.width + imageResultColumnGap), y: baseY };
      block.size = { ...targetSize };
    });
  }

  return nextBlocks;
}

function outputBlocksOverlap(blocks: BlockRecord[]): boolean {
  return blocks.some((block, index) =>
    blocks.slice(index + 1).some(
      (other) =>
        block.position.x < other.position.x + other.size.width &&
        block.position.x + block.size.width > other.position.x &&
        block.position.y < other.position.y + other.size.height &&
        block.position.y + block.size.height > other.position.y,
    ),
  );
}

function migrateOperationPromptTextBlocks(
  blocks: BlockRecord[],
  edges: BoardEdgeRecord[],
): BlockRecord[] {
  const operationInputTextIds = new Set(
    edges
      .filter((edge) => edge.kind === 'execution_input')
      .filter((edge) => blocks.find((block) => block.blockId === edge.targetBlockId)?.type === 'operation')
      .filter((edge) => blocks.find((block) => block.blockId === edge.sourceBlockId)?.type === 'text')
      .map((edge) => edge.sourceBlockId),
  );

  return blocks.map((block) => {
    if (!operationInputTextIds.has(block.blockId)) return block;
    const data = { ...block.data, promptRole: 'operation_prompt' };
    if (isLegacyOperationPromptBody(data.body)) {
      data.body = '';
    }
    return {
      ...block,
      data,
    };
  });
}

function isLegacyOperationPromptBody(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return new Set([
    'Create similar image',
    'Generate image from prompt',
    'Quick edit image',
    '快捷编辑图片',
    '根据 prompt 生成图片',
    '生成同款图片',
  ]).has(value.trim());
}

function repairLinearImageToImageDrafts(
  blocks: BlockRecord[],
  edges: BoardEdgeRecord[],
): BlockRecord[] {
  const nextBlocks = blocks.map((block) => ({ ...block, position: { ...block.position } }));
  const blockById = new Map(nextBlocks.map((block) => [block.blockId, block]));

  for (const operationBlock of nextBlocks) {
    if (operationBlock.type !== 'operation') continue;
    if (
      operationBlock.data.operationMode !== 'image_to_image' &&
      operationBlock.data.operationMode !== 'quick_edit' &&
      operationBlock.data.operationMode !== 'create_similar'
    ) {
      continue;
    }
    if (operationBlock.data.workflowLayout === 'branch_lanes') continue;
    if (operationBlock.data.sourceExecutionId) continue;
    if (edges.some((edge) => edge.sourceBlockId === operationBlock.blockId && edge.kind === 'execution_output')) continue;

    const inputEdges = edges.filter(
      (edge) => edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input',
    );
    const imageBlock = inputEdges
      .map((edge) => blockById.get(edge.sourceBlockId))
      .find((block): block is BlockRecord => block?.type === 'image');
    const textBlock = inputEdges
      .map((edge) => blockById.get(edge.sourceBlockId))
      .find((block): block is BlockRecord => block?.type === 'text');
    if (!imageBlock || !textBlock) continue;
    if (
      imageBlock.parentGroupId !== textBlock.parentGroupId ||
      imageBlock.parentGroupId !== operationBlock.parentGroupId
    ) {
      continue;
    }
    if (imageToImageDraftLayoutIsValid(imageBlock, textBlock, operationBlock)) continue;

    const originalCenter = groupCenter([imageBlock, textBlock, operationBlock]);
    const inputColumnX = Math.min(imageBlock.position.x, textBlock.position.x);
    const inputColumnY = Math.min(imageBlock.position.y, textBlock.position.y);
    const inputColumnWidth = Math.max(imageBlock.size.width, textBlock.size.width);
    const textY = inputColumnY + imageBlock.size.height + 64;
    const inputColumnBottom = Math.max(
      inputColumnY + imageBlock.size.height,
      textY + textBlock.size.height,
    );

    imageBlock.position = {
      x: inputColumnX,
      y: inputColumnY,
    };
    textBlock.position = {
      x: inputColumnX,
      y: textY,
    };
    operationBlock.position = {
      x: inputColumnX + inputColumnWidth + 100,
      y: inputColumnY + Math.max(0, inputColumnBottom - inputColumnY - operationBlock.size.height) / 2,
    };

    const nextCenter = groupCenter([imageBlock, textBlock, operationBlock]);
    const deltaX = originalCenter.x - nextCenter.x;
    const deltaY = originalCenter.y - nextCenter.y;
    for (const block of [imageBlock, textBlock, operationBlock]) {
      block.position = {
        x: block.position.x + deltaX,
        y: block.position.y + deltaY,
      };
    }
  }

  return nextBlocks;
}

function imageToImageDraftLayoutIsValid(
  imageBlock: BlockRecord,
  textBlock: BlockRecord,
  operationBlock: BlockRecord,
): boolean {
  const inputColumnWidth = Math.max(imageBlock.size.width, textBlock.size.width);
  const imageTop = imageBlock.position.y;
  const textTop = textBlock.position.y;
  const expectedTextTop = imageTop + imageBlock.size.height + 64;
  const expectedOperationX = imageBlock.position.x + inputColumnWidth + 100;
  const inputBottom = Math.max(imageBlock.position.y + imageBlock.size.height, textTop + textBlock.size.height);
  const expectedOperationY = imageTop + Math.max(0, inputBottom - imageTop - operationBlock.size.height) / 2;

  return (
    Math.abs(textBlock.position.x - imageBlock.position.x) < 2 &&
    Math.abs(textTop - expectedTextTop) < 2 &&
    Math.abs(operationBlock.position.x - expectedOperationX) < 2 &&
    Math.abs(operationBlock.position.y - expectedOperationY) < 2
  );
}

function groupCenter(blocks: BlockRecord[]): { x: number; y: number } {
  const minX = blocks.reduce((min, block) => Math.min(min, block.position.x), Number.POSITIVE_INFINITY);
  const minY = blocks.reduce((min, block) => Math.min(min, block.position.y), Number.POSITIVE_INFINITY);
  const maxX = blocks.reduce(
    (max, block) => Math.max(max, block.position.x + block.size.width),
    Number.NEGATIVE_INFINITY,
  );
  const maxY = blocks.reduce(
    (max, block) => Math.max(max, block.position.y + block.size.height),
    Number.NEGATIVE_INFINITY,
  );
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

function operationBlockSize(block: LegacyBlockRecord): BlockRecord['size'] {
  void block;
  return { width: 320, height: 190 };
}

function migrateBlockData(type: BlockType, block: LegacyBlockRecord): BlockRecord['data'] {
  if (type === 'image' && block.data.status === 'failed' && !block.data.assetId) {
    const { statusVisualDismissed: _dismissed, ...data } = block.data;
    return data;
  }
  if (type === 'group') {
    return {
      ...block.data,
      title: block.data.title || 'Group',
      groupColor: block.data.groupColor ?? 'neutral',
      groupKind: block.data.groupKind ?? 'manual',
      groupLayoutMode: block.data.groupLayoutMode ?? 'free',
    };
  }
  if (type !== 'operation') return block.data;

  return {
    ...block.data,
    title: block.data.title || 'Operation',
    body: block.data.body || 'Configure inputs and run this operation.',
    status: block.data.sourceExecutionId ? block.data.status : undefined,
    capabilityId:
      typeof block.data.capabilityId === 'string' ? block.data.capabilityId : 'image.text_to_image',
    generationProfileId:
      typeof block.data.generationProfileId === 'string'
        ? block.data.generationProfileId
        : defaultGenerationProfileId,
    operationMode: migrateOperationMode(block),
  };
}

function migrateOperationMode(block: LegacyBlockRecord): string {
  const value = block.data.operationMode;
  if (value === 'text_to_image' || value === 'image_to_image') return value;
  if (value === 'generate_image') return 'text_to_image';
  if (value === 'quick_edit' || value === 'create_similar') return 'image_to_image';

  if (block.data.capabilityId === 'image.text_to_image' || block.data.capabilityId === 'image.generate') {
    return 'text_to_image';
  }
  if (block.data.capabilityId === 'image.generate.similar') return 'image_to_image';
  if (block.data.capabilityId === 'image.image_to_image' || block.data.capabilityId === 'image.edit') {
    return 'image_to_image';
  }

  return 'text_to_image';
}
