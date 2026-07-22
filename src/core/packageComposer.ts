import { capabilityDefinitionFor } from './capabilityRegistry';
import {
  resolvePackageEntryPoint,
  type ResolvedPackageEntryPointTarget,
} from './packageRegistry';
import type { AssetRecord, BlockRecord, BoardSnapshot } from './types';
import { workflowDefinitionFor } from './workflowRegistry';

export type PackageComposerMention =
  | { blockId: string; kind: 'block'; slotId: string }
  | { assetId: string; kind: 'asset'; slotId: string };

export interface PackageComposerInvocation {
  entrypointId: string;
  instruction: string;
  mentions: PackageComposerMention[];
}

export type PackageComposerMentionOption = PackageComposerMention & {
  artifactType?: string;
  dataType: 'document' | 'text';
  description: string;
  label: string;
  mentionId: string;
  slotCardinality: 'many' | 'one' | 'optional';
};

export interface ResolvedPackageComposerInvocation {
  instructionSlotId?: string;
  invocation: PackageComposerInvocation;
  target: ResolvedPackageEntryPointTarget;
}

export function resolvePackageComposerInvocation(
  snapshot: BoardSnapshot,
  invocation: PackageComposerInvocation,
): ResolvedPackageComposerInvocation {
  const instruction = invocation.instruction.trim();
  const resolution = resolvePackageEntryPoint({ entrypointId: invocation.entrypointId });
  if (resolution.status !== 'resolved') {
    throw new Error(`Package Composer EntryPoint could not be resolved: ${invocation.entrypointId} (${resolution.status})`);
  }
  const options = listPackageComposerMentionOptions(snapshot, invocation.entrypointId);
  const optionIds = new Set(options.map((option) => option.mentionId));
  const mentionIds = invocation.mentions.map(packageComposerMentionId);
  if (mentionIds.length !== new Set(mentionIds).size) throw new Error('Package Composer mention is duplicated.');
  const sourceIds = invocation.mentions.map((mention) => mention.kind === 'block'
    ? `block:${mention.blockId}`
    : `asset:${mention.assetId}`);
  if (sourceIds.length !== new Set(sourceIds).size) {
    throw new Error('Package Composer source cannot bind multiple input slots.');
  }
  for (const mentionId of mentionIds) {
    if (!optionIds.has(mentionId)) throw new Error(`Package Composer mention is incompatible: ${mentionId}`);
  }
  const inputSlots = inputSlotsForTarget(resolution.target);
  for (const slot of inputSlots) {
    const count = invocation.mentions.filter((mention) => mention.slotId === slot.slotId).length;
    if (slot.cardinality !== 'many' && count > 1) {
      throw new Error(`Package Composer input slot accepts one value: ${slot.slotId}`);
    }
  }
  const instructionSlotId = instruction
    ? instructionSlotFor(inputSlots, invocation.mentions)
    : undefined;
  if (instruction && !instructionSlotId) {
    throw new Error('Package Composer instruction has no compatible input slot.');
  }
  if (!instruction && invocation.mentions.length === 0) {
    throw new Error('Package Composer requires text or an @ mention.');
  }
  return {
    target: resolution.target,
    invocation: { ...invocation, instruction, mentions: structuredClone(invocation.mentions) },
    instructionSlotId,
  };
}

export function listPackageComposerMentionOptions(
  snapshot: BoardSnapshot,
  entrypointId: string,
): PackageComposerMentionOption[] {
  const resolution = resolvePackageEntryPoint({ entrypointId });
  if (resolution.status !== 'resolved') return [];
  const slots = inputSlotsForTarget(resolution.target);
  const blockOptions = snapshot.blocks.flatMap((block) => mentionOptionsForBlock(snapshot, block, slots));
  const assetOptions = snapshot.assets.flatMap((asset) => mentionOptionsForAsset(snapshot, asset, slots));
  return [...blockOptions, ...assetOptions];
}

export function packageComposerMentionId(mention: PackageComposerMention): string {
  return mention.kind === 'block'
    ? `block:${mention.blockId}:${mention.slotId}`
    : `asset:${mention.assetId}:${mention.slotId}`;
}

type ComposerInputSlot = {
  artifactTypes: string[];
  cardinality: 'many' | 'one' | 'optional';
  dataTypes: Array<'document' | 'text'>;
  required: boolean;
  slotId: string;
};

function inputSlotsForTarget(target: ResolvedPackageEntryPointTarget): ComposerInputSlot[] {
  if (target.kind === 'skill') {
    return capabilityDefinitionFor(target.capabilityLock.capabilityId).inputSlots.map((slot) => ({
      artifactTypes: slot.artifactTypes,
      cardinality: slot.cardinality,
      dataTypes: slot.dataTypes.filter((type): type is 'document' | 'text' => type === 'document' || type === 'text'),
      required: slot.required,
      slotId: slot.slotId,
    })).filter((slot) => slot.dataTypes.length > 0);
  }
  return workflowDefinitionFor(target.workflowDefinitionLock.workflowDefinitionId).inputSlots.map((slot) => ({
    artifactTypes: slot.artifactTypes,
    cardinality: 'one',
    dataTypes: slot.dataTypes,
    required: slot.required,
    slotId: slot.slotId,
  }));
}

function instructionSlotFor(slots: ComposerInputSlot[], mentions: PackageComposerMention[]): string | undefined {
  const occupied = new Set(mentions.map((mention) => mention.slotId));
  return slots.find((slot) => slot.required && !occupied.has(slot.slotId))?.slotId
    ?? slots.find((slot) => !slot.required && (slot.cardinality === 'many' || !occupied.has(slot.slotId)))?.slotId;
}

function mentionOptionsForBlock(
  snapshot: BoardSnapshot,
  block: BlockRecord,
  slots: ComposerInputSlot[],
): PackageComposerMentionOption[] {
  if (block.type !== 'text' && block.type !== 'document') return [];
  const dataType = block.type;
  const artifactType = artifactTypeForBlock(snapshot, block);
  return slots.filter((slot) => compatibleSlot(slot, dataType, artifactType)).map((slot) => ({
    kind: 'block',
    blockId: block.blockId,
    slotId: slot.slotId,
    mentionId: `block:${block.blockId}:${slot.slotId}`,
    label: stringValue(block.data.title) ?? `${block.type} ${block.blockId.slice(-6)}`,
    description: block.type === 'document' ? 'Document Block' : 'Text Block',
    dataType,
    artifactType,
    slotCardinality: slot.cardinality,
  }));
}

function mentionOptionsForAsset(
  snapshot: BoardSnapshot,
  asset: AssetRecord,
  slots: ComposerInputSlot[],
): PackageComposerMentionOption[] {
  if (asset.kind !== 'document') return [];
  const artifactType = artifactTypeForAsset(snapshot, asset);
  return slots.filter((slot) => compatibleSlot(slot, 'document', artifactType)).map((slot) => ({
    kind: 'asset',
    assetId: asset.assetId,
    slotId: slot.slotId,
    mentionId: `asset:${asset.assetId}:${slot.slotId}`,
    label: `Document ${asset.assetId.slice(-6)}`,
    description: 'Document Asset',
    dataType: 'document',
    artifactType,
    slotCardinality: slot.cardinality,
  }));
}

function compatibleSlot(
  slot: Pick<ComposerInputSlot, 'artifactTypes' | 'dataTypes'>,
  dataType: 'document' | 'text',
  artifactType?: string,
): boolean {
  if (!slot.dataTypes.includes(dataType)) return false;
  return !artifactType || slot.artifactTypes.length === 0 || slot.artifactTypes.includes(artifactType);
}

function artifactTypeForBlock(snapshot: BoardSnapshot, block: BlockRecord): string | undefined {
  const documentKind = stringValue(block.data.documentKind);
  if (documentKind && documentKind !== 'general' && documentKind !== 'markdown_document') return documentKind;
  return artifactTypeForExecutionOutput(snapshot, stringValue(block.data.sourceExecutionId), block.blockId, undefined);
}

function artifactTypeForAsset(snapshot: BoardSnapshot, asset: AssetRecord): string | undefined {
  return artifactTypeForExecutionOutput(snapshot, asset.sourceExecutionId, undefined, asset.assetId);
}

function artifactTypeForExecutionOutput(
  snapshot: BoardSnapshot,
  executionId: string | undefined,
  blockId: string | undefined,
  assetId: string | undefined,
): string | undefined {
  const execution = executionId
    ? snapshot.executions.find((candidate) => candidate.executionId === executionId)
    : undefined;
  if (!execution) return undefined;
  const definition = capabilityDefinitionFor(execution.capabilityId);
  const index = blockId
    ? execution.outputBlockIds.indexOf(blockId)
    : assetId
      ? execution.outputAssetIds.indexOf(assetId)
      : -1;
  return definition.outputSlots[Math.max(0, index)]?.artifactType ?? definition.outputSlots[0]?.artifactType;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
