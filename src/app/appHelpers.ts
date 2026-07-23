import type { AssetRecord, BlockRecord, BlockType, BoardSnapshot, RetakeNode } from '../core/types';
import { arraysEqual } from '../core/listUtils';
import {
  disabledExecutionInputRolesFor,
  executionInputRoleOptionsFor,
  schemaForCapability,
} from '../core/capabilities';
import {
  displaySlotSizeForGenerationParams,
  type ImageGenerationParams,
  type SwitchableOperationMode,
} from '../core/imageOperations';
import { nowIso } from '../core/id';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';

export function absoluteFlowNodePositions(flowNodes: readonly RetakeNode[]): Map<string, { x: number; y: number }> {
  const nodeById = new Map(flowNodes.map((node) => [node.id, node]));
  const positions = new Map<string, { x: number; y: number }>();
  const resolving = new Set<string>();

  function resolve(node: RetakeNode): { x: number; y: number } {
    const cached = positions.get(node.id);
    if (cached) return cached;
    if (resolving.has(node.id)) return { ...node.position };
    resolving.add(node.id);
    const parent = node.parentId ? nodeById.get(node.parentId) : undefined;
    const parentPosition = parent ? resolve(parent) : { x: 0, y: 0 };
    const absolute = { x: parentPosition.x + node.position.x, y: parentPosition.y + node.position.y };
    resolving.delete(node.id);
    positions.set(node.id, absolute);
    return absolute;
  }

  for (const node of flowNodes) resolve(node);
  return positions;
}

export function flowNodeSize(node: RetakeNode | undefined, block: BlockRecord): { height: number; width: number } {
  return {
    width: node?.measured?.width ?? block.size.width,
    height: node?.measured?.height ?? block.size.height,
  };
}

export function downloadAsset(asset: AssetRecord, title?: unknown): void {
  const link = document.createElement('a');
  link.href = asset.previewUrl;
  link.download = assetFileName(asset, title);
  document.body.append(link);
  link.click();
  link.remove();
}

export function generationParamsFromBlock(block: BlockRecord | undefined): ImageGenerationParams | undefined {
  const value = block?.data.generationParams;
  if (!isRecord(value)) return undefined;

  return {
    aspectRatioPreset: typeof value.aspectRatioPreset === 'string' ? value.aspectRatioPreset : undefined,
    durationSeconds: finiteNumber(value.durationSeconds),
    model: typeof value.model === 'string' && value.model !== 'codex-mcp' ? value.model : undefined,
    motion: typeof value.motion === 'string' ? value.motion : undefined,
    strength: finiteNumber(value.strength),
    targetAspectRatio: finiteNumber(value.targetAspectRatio),
    targetHeight: finiteNumber(value.targetHeight),
    targetResolution: typeof value.targetResolution === 'string' ? value.targetResolution : undefined,
    targetWidth: finiteNumber(value.targetWidth),
    variationCount: finiteNumber(value.variationCount),
  };
}

export function resizeEmptyOperationOutputSlot(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  generationParams: ImageGenerationParams,
): void {
  const outputBlockIds = new Set(
    snapshot.edges
      .filter((edge) => edge.sourceBlockId === operationBlock.blockId && edge.kind === 'execution_output')
      .map((edge) => edge.targetBlockId),
  );
  const updatedAt = nowIso();
  for (const outputBlock of snapshot.blocks) {
    if (!outputBlockIds.has(outputBlock.blockId) || outputBlock.type !== 'image' || outputBlock.data.assetId) continue;
    outputBlock.size = displaySlotSizeForGenerationParams(generationParams, outputBlock.size);
    outputBlock.updatedAt = updatedAt;
  }
}

export function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function selectedOperationBlockIdFor(snapshot: BoardSnapshot, blockIds: string[]): string | undefined {
  if (blockIds.length !== 1) return undefined;
  const selectedBlockId = blockIds[0];
  const selectedOperation = snapshot.blocks.find(
    (block) => block.blockId === selectedBlockId && (block.type === 'operation' || block.type === 'video'),
  );
  if (selectedOperation) return selectedOperation.blockId;
  return snapshot.edges.find(
    (edge) =>
      edge.sourceBlockId === selectedBlockId &&
      edge.kind === 'execution_input' &&
      snapshot.blocks.some(
        (block) => block.blockId === edge.targetBlockId && (block.type === 'operation' || block.type === 'video'),
      ),
  )?.targetBlockId;
}

export function isInteractiveNodeTarget(target: HTMLElement): boolean {
  return Boolean(
    target.closest(
      [
        'button',
        'input',
        'select',
        'textarea',
        '[role="menu"]',
        '.operation-param-popover',
        '.operation-input-quick-add',
        '.operation-input-role-control',
        '.block-heading-info-button',
      ].join(','),
    ),
  );
}

export function sameBlockSelection(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const rightIds = new Set(right);
  return left.every((blockId) => rightIds.has(blockId));
}

export function isEditableNodeTarget(target: HTMLElement): boolean {
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

export function applyOperationInputRoleBadges(
  nodes: RetakeNode[],
  snapshot: BoardSnapshot,
  selectedBlockIds: string[],
): RetakeNode[] {
  const selectedOperationBlockId = selectedOperationBlockIdFor(snapshot, selectedBlockIds);
  const selectedOperation = snapshot.blocks.find(
    (block) => block.blockId === selectedOperationBlockId && (block.type === 'operation' || block.type === 'video'),
  );
  const inputMetadataByBlockId = new Map(
    snapshot.edges
      .filter((edge) => edge.kind === 'execution_input' && edge.targetBlockId === selectedOperationBlockId)
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
          },
        ] as const];
      }),
  );

  let changed = false;
  const nextNodes = nodes.map((node) => {
    const nextMetadata = inputMetadataByBlockId.get(node.id);
    const nextEdgeId = nextMetadata?.edgeId;
    const nextRole = nextMetadata?.role;
    const nextRoleOptions = nextMetadata?.roleOptions;
    const nextDisabledRoleOptions = nextMetadata?.disabledRoleOptions;
    if (
      node.data.operationInputEdgeId === nextEdgeId &&
      node.data.operationInputRole === nextRole &&
      arraysEqual(node.data.operationInputRoleOptions ?? [], nextRoleOptions ?? []) &&
      arraysEqual(node.data.operationInputRoleDisabledOptions ?? [], nextDisabledRoleOptions ?? []) &&
      node.data.operationInputRolePending === Boolean(nextEdgeId && !nextRole)
    ) {
      return node;
    }

    changed = true;
    const nextData = { ...node.data };
    if (nextRole) {
      nextData.operationInputEdgeId = nextEdgeId;
      nextData.operationInputRole = nextRole;
      nextData.operationInputRoleOptions = nextRoleOptions;
      nextData.operationInputRoleDisabledOptions = nextDisabledRoleOptions;
      nextData.operationInputRolePending = false;
    } else if (nextEdgeId) {
      nextData.operationInputEdgeId = nextEdgeId;
      nextData.operationInputRoleOptions = nextRoleOptions;
      nextData.operationInputRoleDisabledOptions = nextDisabledRoleOptions;
      nextData.operationInputRolePending = true;
      delete nextData.operationInputRole;
    } else {
      delete nextData.operationInputEdgeId;
      delete nextData.operationInputRole;
      delete nextData.operationInputRoleDisabledOptions;
      delete nextData.operationInputRoleOptions;
      delete nextData.operationInputRolePending;
    }
    return { ...node, data: nextData };
  });

  return changed ? nextNodes : nodes;
}

export function operationModeFromBlock(block: BlockRecord): SwitchableOperationMode {
  if (block.data.operationMode === 'text_to_image' || block.data.operationMode === 'generate_image') return 'text_to_image';
  if (block.data.operationMode === 'image_to_image' || block.data.operationMode === 'quick_edit' || block.data.operationMode === 'create_similar') {
    return 'image_to_image';
  }
  if (block.data.capabilityId === 'image.image_to_image' || block.data.capabilityId === 'image.edit') return 'image_to_image';
  if (block.data.capabilityId === 'image.generate.similar') return 'image_to_image';
  return 'text_to_image';
}

export function capabilityIdForOperationMode(operation: SwitchableOperationMode): string {
  return operation === 'text_to_image' ? 'image.text_to_image' : 'image.image_to_image';
}

export function operationAllowsInputType(
  operationBlock: BlockRecord,
  type: Extract<BlockType, 'image' | 'text' | 'video'>,
): boolean {
  const capabilityId =
    typeof operationBlock.data.capabilityId === 'string' ? operationBlock.data.capabilityId : 'image.text_to_image';
  try {
    const definition = capabilityDefinitionFor(capabilityId);
    const dataType = type === 'text' ? 'text' : type;
    return definition.inputSlots.some((slot) => slot.bindingKinds.includes('block') && slot.dataTypes.includes(dataType));
  } catch {
    // Legacy schemas remain the fallback for older capabilities.
  }
  return schemaForCapability(capabilityId).inputContracts.some(
    (contract) => contract.source === 'block' && contract.type === type,
  );
}

export function isOlderSnapshot(candidate: BoardSnapshot, current: BoardSnapshot): boolean {
  if (candidate.project.projectId !== current.project.projectId || candidate.board.boardId !== current.board.boardId) {
    return false;
  }
  return timestampMs(candidate.board.updatedAt) < timestampMs(current.board.updatedAt);
}

function timestampMs(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assetFileName(asset: AssetRecord, title?: unknown): string {
  const urlName = asset.previewUrl.split('/').pop();
  const extension = urlName?.includes('.') ? `.${urlName.split('.').pop()}` : extensionForMime(asset.mimeType);
  const titleBase = typeof title === 'string' && title.trim() ? title.trim() : asset.assetId;
  const safeBase = titleBase
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${safeBase || asset.assetId}${extension}`;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/svg+xml') return '.svg';
  if (mimeType === 'video/mp4') return '.mp4';
  return '.bin';
}
