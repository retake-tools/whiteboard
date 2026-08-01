import type { CapabilityDefinition } from './capabilityContracts';
import { capabilityDefinitionFor } from './capabilityRegistry';
import type { ImageGenerationParams } from './imageOperations';
import type { PackageComposerMention } from './packageComposer';
import type {
  ImageReferenceBindingKind,
  ReferenceIntentV1,
} from './referenceIntent';
import { imageGenerateCapabilityId } from './imageGenerateContracts';

export type CreativeRequestMediaKind = 'image' | 'video';

export type CreativeRequestCapabilityId =
  | typeof imageGenerateCapabilityId
  | 'video.generate';

export interface CreativeRequestExplicitBinding {
  inputSlotId: string;
  referenceIntent?: ReferenceIntentV1;
}

export interface CreativeRequestReferenceInput {
  explicitBinding?: CreativeRequestExplicitBinding;
  mention: PackageComposerMention;
  mentionId: string;
}

export interface CreativeRequestCompileInput {
  boardId: string;
  explicitParameters: Record<string, unknown>;
  instruction: string;
  mediaKind: CreativeRequestMediaKind;
  projectId: string;
  references: CreativeRequestReferenceInput[];
}

export interface CompiledCreativeRequestReference {
  assetId: string;
  blockId?: string;
  inputSlotId: string;
  mentionId: string;
  referenceIntent?: ReferenceIntentV1;
}

export interface CreativeRequestUnresolvedItem {
  code: 'semantic_mapping_unavailable' | 'unsupported_input_slot';
  message: string;
  mentionId?: string;
}

export interface CompiledCreativeRequest {
  schemaVersion: 1;
  capabilityId: CreativeRequestCapabilityId;
  compiler: {
    kind: 'ai' | 'deterministic';
    model?: string;
    version: '2';
  };
  mediaKind: CreativeRequestMediaKind;
  parameters: Record<string, unknown>;
  prompt: string;
  references: CompiledCreativeRequestReference[];
  unresolved: CreativeRequestUnresolvedItem[];
}

export interface CompiledImageComposerInput {
  capabilityId: typeof imageGenerateCapabilityId;
  generationParams: ImageGenerationParams;
  instruction: string;
  references: Array<{
    bindingKind: ImageReferenceBindingKind;
    inputSlotId: string;
    mention: PackageComposerMention;
    referenceIntent?: ReferenceIntentV1;
  }>;
}

export interface CreativeRequestInputSlot {
  cardinality: 'many' | 'one' | 'optional';
  inputSlotId: string;
  semanticRole: string;
}

export function creativeRequestInputSlotsFor(
  mediaKind: CreativeRequestMediaKind,
): CreativeRequestInputSlot[] {
  const definitions = capabilitiesFor(mediaKind).map(capabilityDefinitionFor);
  const unique = new Map<string, CreativeRequestInputSlot>();
  for (const definition of definitions) {
    for (const slot of imageInputSlots(definition)) {
      unique.set(slot.slotId, {
        cardinality: slot.cardinality,
        inputSlotId: slot.slotId,
        semanticRole: slot.semanticRole,
      });
    }
  }
  return [...unique.values()];
}

export function imageComposerInputFromCompiledRequest(
  compiled: CompiledCreativeRequest,
  references: readonly CreativeRequestReferenceInput[],
  generationParams: ImageGenerationParams,
): CompiledImageComposerInput {
  if (
    compiled.mediaKind !== 'image'
    || compiled.capabilityId !== imageGenerateCapabilityId
  ) {
    throw new Error('Compiled request is not an image request.');
  }
  const definition = capabilityDefinitionFor(compiled.capabilityId);
  const sourceSlotId = sourceImageSlot(definition)?.slotId;
  const referenceSlotId = generalReferenceSlot(definition)?.slotId;
  const mentionsById = new Map(
    references.map((reference) => [reference.mentionId, reference.mention]),
  );
  return {
    capabilityId: compiled.capabilityId,
    generationParams,
    instruction: compiled.prompt,
    references: compiled.references.map((reference) => {
      const mention = mentionsById.get(reference.mentionId);
      const bindingKind = reference.inputSlotId === sourceSlotId
        ? 'source'
        : reference.inputSlotId === referenceSlotId
          ? 'reference'
          : undefined;
      if (!mention || !bindingKind) {
        throw new Error('Compiled image reference cannot be resolved.');
      }
      return {
        bindingKind,
        inputSlotId: reference.inputSlotId,
        mention: withReferenceSlot(mention),
        ...(reference.referenceIntent
          ? { referenceIntent: structuredClone(reference.referenceIntent) }
          : {}),
      };
    }),
  };
}

export function withReferenceSlot(
  mention: PackageComposerMention,
): PackageComposerMention {
  return mention.kind === 'block'
    ? { blockId: mention.blockId, kind: 'block', slotId: 'references' }
    : { assetId: mention.assetId, kind: 'asset', slotId: 'references' };
}

export function capabilitiesFor(
  mediaKind: CreativeRequestMediaKind,
): CreativeRequestCapabilityId[] {
  return mediaKind === 'image'
    ? [imageGenerateCapabilityId]
    : ['video.generate'];
}

export function sourceImageSlot(
  definition: CapabilityDefinition,
) {
  return imageInputSlots(definition).find(
    (slot) => slot.semanticRole === 'source',
  );
}

export function generalReferenceSlot(
  definition: CapabilityDefinition,
) {
  return imageInputSlots(definition).find(
    (slot) => slot.semanticRole === 'reference'
      || slot.semanticRole === 'general_reference',
  );
}

export function imageInputSlots(
  definition: CapabilityDefinition,
) {
  return definition.inputSlots.filter((slot) => slot.dataTypes.includes('image'));
}
