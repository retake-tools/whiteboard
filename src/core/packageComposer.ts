import { capabilityDefinitionFor } from './capabilityRegistry';
import type { CapabilityCardinality, CapabilityDataType } from './capabilityContracts';
import {
  listPackageEntryPoints,
  resolvePackageEntryPoint,
  type ResolvedPackageEntryPointTarget,
} from './packageRegistry';
import type { AssetRecord, BlockRecord, BoardSnapshot } from './types';
import {
  normalizeStoryboardSheetGenerationParameters,
  storyboardSheetCapabilityId,
  storyboardSheetWorkflowId,
} from './storyboardSheetContracts';
import { workflowDefinitionFor } from './workflowRegistry';
import {
  generationPreparationCapabilityId,
  generationPreparationWorkflowId,
  normalizeGenerationPreparationParameters,
  normalizeGenerationReferenceManifest,
} from './generationPreparationContracts';
import type { CapabilityBindingKind } from './capabilityContracts';
import {
  domainVideoGenerationCapabilityId,
  domainVideoGenerationWorkflowId,
  normalizeDomainVideoGenerationParameters,
} from './domainVideoGenerationContracts';

export type PackageComposerMention =
  | { blockId: string; kind: 'block'; slotId: string }
  | { assetId: string; kind: 'asset'; slotId: string };

export interface PackageComposerInlineValue {
  kind: 'inline';
  slotId: string;
  value: unknown;
}

export interface PackageComposerInvocation {
  entrypointId: string;
  inlineValues?: PackageComposerInlineValue[];
  instruction: string;
  mentions: PackageComposerMention[];
  parameters?: Record<string, unknown>;
}

export interface PackageComposerParametersValue {
  kind: 'parameters';
  value: Record<string, unknown>;
}

export type PackageComposerMentionOption = PackageComposerMention & {
  artifactType?: string;
  dataType: Extract<CapabilityDataType, 'document' | 'image' | 'text'>;
  description: string;
  label: string;
  mentionId: string;
  slotCardinality: CapabilityCardinality;
};

export interface PackageComposerInlineInputOption {
  schemaRef: string;
  slotId: string;
}

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
  const inlineValues = invocation.inlineValues ?? [];
  const optionIds = new Set(options.map((option) => option.mentionId));
  const mentionIds = invocation.mentions.map(packageComposerMentionId);
  if (mentionIds.length !== new Set(mentionIds).size) throw new Error('Package Composer mention is duplicated.');
  const sourceIds = invocation.mentions.map((mention) => mention.kind === 'block'
    ? `block:${mention.blockId}`
    : `asset:${mention.assetId}`);
  if (sourceIds.length !== new Set(sourceIds).size) {
    throw new Error('Package Composer source cannot bind multiple input slots.');
  }
  const inlineSlotIds = inlineValues.map((value) => value.slotId);
  if (inlineSlotIds.length !== new Set(inlineSlotIds).size) {
    throw new Error('Package Composer inline input slot is duplicated.');
  }
  for (const mentionId of mentionIds) {
    if (!optionIds.has(mentionId)) throw new Error(`Package Composer mention is incompatible: ${mentionId}`);
  }
  const inputSlots = inputSlotsForTarget(resolution.target);
  for (const inlineValue of inlineValues) {
    const slot = inputSlots.find((candidate) => candidate.slotId === inlineValue.slotId);
    if (!slot || !slot.bindingKinds.includes('inline')) {
      throw new Error(`Package Composer inline input is incompatible: ${inlineValue.slotId}`);
    }
    if (slot.dataTypes.includes('text')) {
      if (typeof inlineValue.value !== 'string') {
        throw new Error(`Package Composer inline text input is invalid: ${inlineValue.slotId}`);
      }
      const value = inlineValue.value.trim();
      if (!value) throw new Error(`Package Composer inline input is empty: ${inlineValue.slotId}`);
      if ([...value].length > 64) throw new Error(`Package Composer inline input is too long: ${inlineValue.slotId}`);
    } else if (
      slot.dataTypes.includes('structured_data')
      && slot.schemaRef === 'retake.generation-reference-manifest/v1'
    ) {
      normalizeGenerationReferenceManifest(inlineValue.value);
    } else {
      throw new Error(`Package Composer inline input is incompatible: ${inlineValue.slotId}`);
    }
  }
  for (const slot of inputSlots) {
    const count = invocation.mentions.filter((mention) => mention.slotId === slot.slotId).length
      + inlineValues.filter((value) => value.slotId === slot.slotId).length;
    if (slot.cardinality !== 'many' && count > 1) {
      throw new Error(`Package Composer input slot accepts one value: ${slot.slotId}`);
    }
  }
  const instructionSlotId = instruction
    ? instructionSlotFor(inputSlots, invocation.mentions, inlineValues)
    : undefined;
  if (instruction && !instructionSlotId) {
    throw new Error('Package Composer instruction has no compatible input slot.');
  }
  if (!instruction && invocation.mentions.length === 0 && inlineValues.length === 0) {
    throw new Error('Package Composer requires text or an @ mention.');
  }
  const occupiedSlotIds = new Set([
    ...invocation.mentions.map((mention) => mention.slotId),
    ...inlineValues.map((value) => value.slotId),
    ...(instructionSlotId ? [instructionSlotId] : []),
  ]);
  const missingRequiredSlot = inputSlots.find((slot) => slot.required && !occupiedSlotIds.has(slot.slotId));
  if (missingRequiredSlot) {
    throw new Error(`Package Composer required input is missing: ${missingRequiredSlot.slotId}`);
  }
  const parameters = targetUsesStoryboardSheet(resolution.target)
    ? { ...normalizeStoryboardSheetGenerationParameters(invocation.parameters) }
    : targetUsesGenerationPreparation(resolution.target)
      ? { ...normalizeGenerationPreparationParameters(invocation.parameters) }
      : targetUsesDomainVideoGeneration(resolution.target)
        ? { ...normalizeDomainVideoGenerationParameters(invocation.parameters) }
      : structuredClone(invocation.parameters ?? {});
  return {
    target: resolution.target,
    invocation: {
      ...invocation,
      inlineValues: inlineValues.map((value) => ({
        ...value,
        value: typeof value.value === 'string'
          ? value.value.trim()
          : structuredClone(value.value),
      })),
      instruction,
      mentions: structuredClone(invocation.mentions),
      parameters,
    },
    instructionSlotId,
  };
}

export function listPackageComposerInlineInputOptions(
  entrypointId: string,
): PackageComposerInlineInputOption[] {
  const resolution = resolvePackageEntryPoint({ entrypointId });
  if (resolution.status !== 'resolved') return [];
  return inputSlotsForTarget(resolution.target).flatMap((slot) => (
    slot.schemaRef && slot.bindingKinds.includes('inline')
      ? [{ schemaRef: slot.schemaRef, slotId: slot.slotId }]
      : []
  ));
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

export function listGoalComposerMentionOptions(
  snapshot: BoardSnapshot,
): PackageComposerMentionOption[] {
  const optionsById = new Map<string, PackageComposerMentionOption>();
  for (const registration of listPackageEntryPoints()) {
    if (registration.entrypoint.kind !== 'workflow') continue;
    for (const option of listPackageComposerMentionOptions(
      snapshot,
      registration.entrypoint.entrypointId,
    )) {
      if (!optionsById.has(option.mentionId)) optionsById.set(option.mentionId, option);
    }
  }
  return [...optionsById.values()];
}

export function packageComposerMentionId(mention: PackageComposerMention): string {
  return mention.kind === 'block'
    ? `block:${mention.blockId}:${mention.slotId}`
    : `asset:${mention.assetId}:${mention.slotId}`;
}

export function packageComposerMentionBindingIdentity(
  snapshot: BoardSnapshot,
  mention: PackageComposerMention,
): `asset:${string}` | `artifact_revision:${string}` | undefined {
  if (mention.kind === 'asset') return `asset:${mention.assetId}`;
  const block = snapshot.blocks.find((candidate) => candidate.blockId === mention.blockId);
  if (typeof block?.data.artifactRevisionId === 'string') {
    return `artifact_revision:${block.data.artifactRevisionId}`;
  }
  return typeof block?.data.assetId === 'string'
    ? `asset:${block.data.assetId}`
    : undefined;
}

type ComposerInputSlot = {
  artifactTypes: string[];
  bindingKinds: CapabilityBindingKind[];
  cardinality: CapabilityCardinality;
  dataTypes: CapabilityDataType[];
  required: boolean;
  schemaRef?: string;
  slotId: string;
};

function inputSlotsForTarget(target: ResolvedPackageEntryPointTarget): ComposerInputSlot[] {
  if (target.kind === 'skill') {
    return capabilityDefinitionFor(target.capabilityLock.capabilityId).inputSlots.map((slot) => ({
      artifactTypes: slot.artifactTypes,
      bindingKinds: slot.bindingKinds,
      cardinality: slot.cardinality,
      dataTypes: slot.dataTypes,
      required: slot.required,
      schemaRef: slot.schemaRef,
      slotId: slot.slotId,
    }));
  }
  return workflowDefinitionFor(target.workflowDefinitionLock.workflowDefinitionId).inputSlots.map((slot) => ({
    artifactTypes: slot.artifactTypes,
    bindingKinds: slot.dataTypes.includes('structured_data')
      ? ['inline']
      : slot.artifactTypes.includes('storyboard_sheet')
        || slot.artifactTypes.includes('video_generation_package')
        ? ['artifact_revision']
        : ['inline', 'block', 'asset', 'artifact_revision'],
    cardinality: slot.cardinality,
    dataTypes: slot.dataTypes,
    required: slot.required,
    schemaRef: slot.schemaRef,
    slotId: slot.slotId,
  }));
}

function instructionSlotFor(
  slots: ComposerInputSlot[],
  mentions: PackageComposerMention[],
  inlineValues: PackageComposerInlineValue[],
): string | undefined {
  const occupied = new Set([
    ...mentions.map((mention) => mention.slotId),
    ...inlineValues.map((value) => value.slotId),
  ]);
  return slots.find((slot) => (
    slot.required
    && slot.dataTypes.some((type) => type === 'text' || type === 'document')
    && !occupied.has(slot.slotId)
  ))?.slotId
    ?? slots.find((slot) => (
      !slot.required
      && slot.dataTypes.some((type) => type === 'text' || type === 'document')
      && (slot.cardinality === 'many' || !occupied.has(slot.slotId))
    ))?.slotId;
}

function mentionOptionsForBlock(
  snapshot: BoardSnapshot,
  block: BlockRecord,
  slots: ComposerInputSlot[],
): PackageComposerMentionOption[] {
  if (block.type !== 'text' && block.type !== 'document' && block.type !== 'image') return [];
  const dataType = block.type;
  const artifactType = artifactTypeForBlock(snapshot, block);
  return slots.filter((slot) => (
    compatibleSlot(slot, dataType, artifactType)
    && (
      !slot.artifactTypes.includes('video_generation_package')
      || currentPassedGenerationPackageGate(snapshot, block)
    )
    && (
      slot.bindingKinds.includes('block')
      || (
        slot.bindingKinds.includes('artifact_revision')
        && typeof block.data.artifactRevisionId === 'string'
      )
    )
  )).map((slot) => ({
    kind: 'block',
    blockId: block.blockId,
    slotId: slot.slotId,
    mentionId: `block:${block.blockId}:${slot.slotId}`,
    label: stringValue(block.data.title) ?? `${block.type} ${block.blockId.slice(-6)}`,
    description: block.type === 'document'
      ? 'Document Block'
      : block.type === 'image'
        ? 'Image Block'
        : 'Text Block',
    dataType,
    artifactType,
    slotCardinality: slot.cardinality,
  }));
}

function currentPassedGenerationPackageGate(
  snapshot: BoardSnapshot,
  block: BlockRecord,
): boolean {
  const revisionId = stringValue(block.data.artifactRevisionId);
  return Boolean(
    revisionId
    && (snapshot.workflowGateEvaluations ?? []).some((evaluation) =>
      evaluation.gateId === 'generation_package_review'
      && evaluation.subjectArtifactRevisionId === revisionId
      && evaluation.status === 'passed'
      && evaluation.freshness === 'current',
    ),
  );
}

function mentionOptionsForAsset(
  snapshot: BoardSnapshot,
  asset: AssetRecord,
  slots: ComposerInputSlot[],
): PackageComposerMentionOption[] {
  if (asset.kind !== 'document' && asset.kind !== 'image') return [];
  const artifactType = artifactTypeForAsset(snapshot, asset);
  const dataType = asset.kind;
  return slots.filter((slot) => (
    slot.bindingKinds.includes('asset')
    && compatibleSlot(slot, dataType, artifactType)
  )).map((slot) => ({
    kind: 'asset',
    assetId: asset.assetId,
    slotId: slot.slotId,
    mentionId: `asset:${asset.assetId}:${slot.slotId}`,
    label: `${asset.kind === 'image' ? 'Image' : 'Document'} ${asset.assetId.slice(-6)}`,
    description: asset.kind === 'image' ? 'Image Asset' : 'Document Asset',
    dataType,
    artifactType,
    slotCardinality: slot.cardinality,
  }));
}

function compatibleSlot(
  slot: Pick<ComposerInputSlot, 'artifactTypes' | 'dataTypes'>,
  dataType: Extract<CapabilityDataType, 'document' | 'image' | 'text'>,
  artifactType?: string,
): boolean {
  if (!slot.dataTypes.includes(dataType)) return false;
  return !artifactType || slot.artifactTypes.length === 0 || slot.artifactTypes.includes(artifactType);
}

function artifactTypeForBlock(snapshot: BoardSnapshot, block: BlockRecord): string | undefined {
  const explicitArtifactType = stringValue(block.data.artifactType);
  if (explicitArtifactType) return explicitArtifactType;
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

function targetUsesStoryboardSheet(target: ResolvedPackageEntryPointTarget): boolean {
  return target.kind === 'skill'
    ? target.capabilityLock.capabilityId === storyboardSheetCapabilityId
    : target.workflowDefinitionLock.workflowDefinitionId === storyboardSheetWorkflowId;
}

function targetUsesGenerationPreparation(target: ResolvedPackageEntryPointTarget): boolean {
  return target.kind === 'skill'
    ? target.capabilityLock.capabilityId === generationPreparationCapabilityId
    : target.workflowDefinitionLock.workflowDefinitionId === generationPreparationWorkflowId;
}

function targetUsesDomainVideoGeneration(target: ResolvedPackageEntryPointTarget): boolean {
  return target.kind === 'skill'
    ? target.capabilityLock.capabilityId === domainVideoGenerationCapabilityId
    : target.workflowDefinitionLock.workflowDefinitionId === domainVideoGenerationWorkflowId;
}
