import type { RetakeNode } from '../canvas/reactFlowTypes';
import type { AssetRecord, BlockRecord, BlockType, BoardSnapshot } from '../core/types';
import { schemaForCapability } from '../core/capabilities';
import {
  type ImageGenerationParams,
  type SwitchableOperationMode,
} from '../core/imageOperations';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';
import { imageGenerateCapabilityId } from '../core/imageGenerateContracts';

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

export function absoluteFlowNodeBounds(
  flowNodes: readonly RetakeNode[],
  block: BlockRecord,
): { height: number; width: number; x: number; y: number } | undefined {
  const node = flowNodes.find((candidate) => candidate.id === block.blockId);
  if (!node) return undefined;
  const position = absoluteFlowNodePositions(flowNodes).get(node.id);
  if (!position) return undefined;
  return { ...position, ...flowNodeSize(node, block) };
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
        '.operation-reference-inputs',
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
  return Boolean(target.closest(
    'input, textarea, select, [contenteditable="true"], [data-retake-plugin-ui]',
  ));
}

export function operationModeFromBlock(
  block: BlockRecord,
  snapshot?: BoardSnapshot,
): SwitchableOperationMode {
  if (block.data.capabilityId === imageGenerateCapabilityId) {
    const hasSourceImage = snapshot
      ? snapshot.edges.some((edge) => (
          edge.kind === 'execution_input'
          && edge.targetBlockId === block.blockId
          && edge.inputSlotId === 'source_image'
        ))
      : block.data.operationHasSourceImage === true;
    return hasSourceImage ? 'image_to_image' : 'text_to_image';
  }
  if (block.data.operationMode === 'text_to_image' || block.data.operationMode === 'generate_image') return 'text_to_image';
  if (block.data.operationMode === 'image_to_image' || block.data.operationMode === 'quick_edit' || block.data.operationMode === 'create_similar') {
    return 'image_to_image';
  }
  return 'text_to_image';
}

export function capabilityIdForOperationMode(operation: SwitchableOperationMode): string {
  void operation;
  return imageGenerateCapabilityId;
}

export function operationAllowsInputType(
  operationBlock: BlockRecord,
  type: Extract<BlockType, 'image' | 'text' | 'video'>,
): boolean {
  const capabilityId =
    typeof operationBlock.data.capabilityId === 'string' ? operationBlock.data.capabilityId : imageGenerateCapabilityId;
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
