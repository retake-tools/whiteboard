import { createBlockRecord, touchBoard } from './blockFactory';
import { expandGroupToContents } from './grouping';
import { createId } from './id';
import {
  createDraftTextToImageOperation,
  type ImageGenerationParams,
} from './imageOperations';
import {
  packageComposerMentionId,
  type PackageComposerMention,
  type PackageComposerMentionOption,
} from './packageComposer';
import type {
  BlockRecord,
  BoardSnapshot,
  ExecutionInputRole,
} from './types';

export type ComposerMode = 'agent' | 'image' | 'video';

export type ImageComposerReferenceRole = Extract<
  ExecutionInputRole,
  | 'character_reference'
  | 'composition_reference'
  | 'environment_reference'
  | 'general_reference'
  | 'object_reference'
  | 'pose_reference'
  | 'style_reference'
>;

export interface ImageComposerReference {
  mention: PackageComposerMention;
  role: ImageComposerReferenceRole;
}

export interface ImageComposerDraftInput {
  connectionId: string;
  generationParams?: ImageGenerationParams;
  instruction: string;
  operationTitle: string;
  references: ImageComposerReference[];
  slotBlockId?: string;
  textBlockPlaceholder?: string;
  textBlockTitle: string;
}

export interface ImageComposerDraftResult {
  operationBlock: BlockRecord;
  referenceBlockIds: string[];
  textBlock: BlockRecord;
}

export const imageComposerReferenceRoles: ImageComposerReferenceRole[] = [
  'general_reference',
  'character_reference',
  'style_reference',
  'composition_reference',
  'pose_reference',
  'object_reference',
  'environment_reference',
];

export const imageComposerAspectRatios = [
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
] as const;

export const imageComposerResolutions = ['1K', '2K', '4K'] as const;

export type ImageComposerAspectRatio = typeof imageComposerAspectRatios[number];
export type ImageComposerResolution = typeof imageComposerResolutions[number];

export function defaultImageComposerGenerationParams(): ImageGenerationParams {
  return imageComposerGenerationParams({
    aspectRatioPreset: '9:16',
    targetResolution: '2K',
    variationCount: 1,
  });
}

export function imageComposerGenerationParams(
  input: ImageGenerationParams | undefined,
): ImageGenerationParams {
  const aspectRatioPreset = imageComposerAspectRatios.includes(
    input?.aspectRatioPreset as ImageComposerAspectRatio,
  )
    ? input?.aspectRatioPreset as ImageComposerAspectRatio
    : '9:16';
  const targetResolution = imageComposerResolutions.includes(
    input?.targetResolution as ImageComposerResolution,
  )
    ? input?.targetResolution as ImageComposerResolution
    : '2K';
  const variationCount = Math.min(4, Math.max(1, Math.round(input?.variationCount ?? 1)));
  const targetAspectRatio = imageComposerAspectRatioForPreset(aspectRatioPreset);
  const maxSide = imageComposerResolutionMaxSide(targetResolution);
  const { targetWidth, targetHeight } = imageComposerDimensionsForAspectRatio(targetAspectRatio, maxSide);
  return {
    aspectRatioPreset,
    targetAspectRatio,
    targetHeight,
    targetResolution,
    targetWidth,
    variationCount,
  };
}

export function listImageComposerReferenceOptions(
  snapshot: BoardSnapshot,
): PackageComposerMentionOption[] {
  const representedAssetIds = new Set(snapshot.blocks.flatMap((block) => (
    block.type === 'image' && typeof block.data.assetId === 'string'
      ? [block.data.assetId]
      : []
  )));
  const blockOptions = snapshot.blocks.flatMap((block): PackageComposerMentionOption[] => {
    if (block.type !== 'image' || typeof block.data.assetId !== 'string') return [];
    const asset = snapshot.assets.find((candidate) => candidate.assetId === block.data.assetId);
    if (!asset || asset.projectId !== snapshot.project.projectId || asset.kind !== 'image') return [];
    return [{
      kind: 'block',
      blockId: block.blockId,
      slotId: 'references',
      mentionId: `block:${block.blockId}:references`,
      label: stringValue(block.data.title) ?? `Image ${block.blockId.slice(-6)}`,
      description: 'Image Block',
      dataType: 'image',
      slotCardinality: 'many',
    }];
  });
  const assetOptions = snapshot.assets.flatMap((asset): PackageComposerMentionOption[] => {
    if (
      asset.projectId !== snapshot.project.projectId
      || asset.kind !== 'image'
      || representedAssetIds.has(asset.assetId)
    ) return [];
    return [{
      kind: 'asset',
      assetId: asset.assetId,
      slotId: 'references',
      mentionId: `asset:${asset.assetId}:references`,
      label: `Image ${asset.assetId.slice(-6)}`,
      description: 'Image Asset',
      dataType: 'image',
      slotCardinality: 'many',
    }];
  });
  return [...blockOptions, ...assetOptions];
}

export function createImageComposerDraft(
  snapshot: BoardSnapshot,
  input: ImageComposerDraftInput,
): ImageComposerDraftResult {
  const instruction = input.instruction.trim();
  if (!instruction) throw new Error('Image Composer requires an instruction.');
  if (!input.connectionId.trim()) throw new Error('Image Composer requires a Connection.');
  const mentionIds = input.references.map(({ mention }) => packageComposerMentionId(mention));
  if (mentionIds.length !== new Set(mentionIds).size) {
    throw new Error('Image Composer reference is duplicated.');
  }
  const sourceIds = input.references.map(({ mention }) => validateReferenceMention(snapshot, mention));
  if (sourceIds.length !== new Set(sourceIds).size) {
    throw new Error('Image Composer source is duplicated.');
  }
  for (const reference of input.references) {
    if (reference.mention.slotId !== 'references') {
      throw new Error('Image Composer reference slot is invalid.');
    }
    if (!imageComposerReferenceRoles.includes(reference.role)) {
      throw new Error('Image Composer reference role is invalid.');
    }
  }
  const outputSlot = input.slotBlockId
    ? snapshot.blocks.find((block) => block.blockId === input.slotBlockId)
    : undefined;
  if (
    input.slotBlockId
    && (!outputSlot || outputSlot.type !== 'image' || outputSlot.data.assetId)
  ) {
    throw new Error('Image Composer output slot is invalid.');
  }

  const result = createDraftTextToImageOperation(snapshot, {
    generationParams: imageComposerGenerationParams(input.generationParams),
    operationTitle: input.operationTitle,
    slotBlockId: input.slotBlockId,
    textBlockTitle: input.textBlockTitle,
    textBlockBody: instruction,
    textBlockPlaceholder: input.textBlockPlaceholder,
  });
  result.operationBlock.data.connectionId = input.connectionId;

  const referenceBlockIds = input.references.map((reference, index) => {
    const block = resolveReferenceBlock(snapshot, result.operationBlock, reference.mention, index);
    ensureImageComposerEdge(snapshot, block.blockId, result.operationBlock.blockId, 'execution_input', reference.role);
    return block.blockId;
  });
  if (outputSlot) {
    ensureImageComposerEdge(snapshot, result.operationBlock.blockId, outputSlot.blockId, 'execution_output');
  }
  if (result.operationBlock.parentGroupId) {
    expandGroupToContents(snapshot, result.operationBlock.parentGroupId);
  }
  touchBoard(snapshot);
  return {
    ...result,
    referenceBlockIds,
  };
}

function validateReferenceMention(
  snapshot: BoardSnapshot,
  mention: PackageComposerMention,
): string {
  if (mention.kind === 'asset') {
    const asset = snapshot.assets.find((candidate) => candidate.assetId === mention.assetId);
    if (!asset || asset.projectId !== snapshot.project.projectId || asset.kind !== 'image') {
      throw new Error(`Image Composer Asset reference is invalid: ${mention.assetId}`);
    }
    return `asset:${asset.assetId}`;
  }
  const block = snapshot.blocks.find((candidate) => candidate.blockId === mention.blockId);
  if (block?.type !== 'image' || typeof block.data.assetId !== 'string') {
    throw new Error(`Image Composer Block reference is invalid: ${mention.blockId}`);
  }
  const asset = snapshot.assets.find((candidate) => candidate.assetId === block.data.assetId);
  if (!asset || asset.projectId !== snapshot.project.projectId || asset.kind !== 'image') {
    throw new Error(`Image Composer Block reference asset is invalid: ${mention.blockId}`);
  }
  return `asset:${asset.assetId}`;
}

function resolveReferenceBlock(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  mention: PackageComposerMention,
  index: number,
): BlockRecord {
  if (mention.kind === 'block') {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === mention.blockId);
    if (block?.type !== 'image' || typeof block.data.assetId !== 'string') {
      throw new Error(`Image Composer Block reference is invalid: ${mention.blockId}`);
    }
    const asset = snapshot.assets.find((candidate) => candidate.assetId === block.data.assetId);
    if (!asset || asset.projectId !== snapshot.project.projectId || asset.kind !== 'image') {
      throw new Error(`Image Composer Block reference asset is invalid: ${mention.blockId}`);
    }
    return block;
  }
  const asset = snapshot.assets.find((candidate) => candidate.assetId === mention.assetId);
  if (!asset || asset.projectId !== snapshot.project.projectId || asset.kind !== 'image') {
    throw new Error(`Image Composer Asset reference is invalid: ${mention.assetId}`);
  }
  const block = createBlockRecord(snapshot, 'image');
  block.position = {
    x: operationBlock.position.x,
    y: operationBlock.position.y - (index + 1) * (block.size.height + 28),
  };
  block.parentGroupId = operationBlock.parentGroupId;
  block.data = {
    ...block.data,
    title: `Reference ${index + 1}`,
    assetId: asset.assetId,
    composerSourceAssetId: asset.assetId,
    previewUrl: asset.previewUrl,
  };
  snapshot.blocks.push(block);
  return block;
}

function ensureImageComposerEdge(
  snapshot: BoardSnapshot,
  sourceBlockId: string,
  targetBlockId: string,
  kind: 'execution_input' | 'execution_output',
  inputRole?: ExecutionInputRole,
): void {
  const existing = snapshot.edges.find((edge) => (
    edge.sourceBlockId === sourceBlockId
    && edge.targetBlockId === targetBlockId
    && edge.kind === kind
  ));
  if (existing) {
    if (inputRole) existing.inputRole = inputRole;
    return;
  }
  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId,
    targetBlockId,
    kind,
    inputRole,
  });
}

export function imageComposerAspectRatioForPreset(preset: ImageComposerAspectRatio): number {
  const [width, height] = preset.split(':').map(Number);
  return width / height;
}

export function imageComposerDimensionsForAspectRatio(aspectRatio: number, maxSide: number): {
  targetHeight: number;
  targetWidth: number;
} {
  if (aspectRatio >= 1) {
    return {
      targetWidth: maxSide,
      targetHeight: even(Math.round(maxSide / aspectRatio)),
    };
  }
  return {
    targetWidth: even(Math.round(maxSide * aspectRatio)),
    targetHeight: maxSide,
  };
}

export function imageComposerResolutionMaxSide(resolution: ImageComposerResolution): number {
  if (resolution === '1K') return 1024;
  if (resolution === '4K') return 4096;
  return 2048;
}

function even(value: number): number {
  return Math.max(2, value - value % 2);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
