import type { ImageGenerationParams } from './imageOperations';
import type { PackageComposerMention } from './packageComposer';
import type { ExecutionInputRole } from './types';
import { schemaForCapability } from './capabilities';
import { capabilityDefinitionFor } from './capabilityRegistry';

export type CreativeRequestMediaKind = 'image' | 'video';

export type CreativeRequestCapabilityId =
  | 'image.image_to_image'
  | 'image.text_to_image'
  | 'video.generate';

export type CreativeRequestReferenceRole = Extract<
  ExecutionInputRole,
  | 'character_reference'
  | 'composition_reference'
  | 'environment_reference'
  | 'first_frame'
  | 'general_reference'
  | 'last_frame'
  | 'object_reference'
  | 'pose_reference'
  | 'source'
  | 'style_reference'
>;

export interface CreativeRequestReferenceInput {
  explicitRole?: CreativeRequestReferenceRole;
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
  mentionId: string;
  purpose?: string;
  role: CreativeRequestReferenceRole;
}

export interface CreativeRequestUnresolvedItem {
  code: 'semantic_mapping_unavailable' | 'unsupported_semantic_role';
  message: string;
  mentionId?: string;
}

export interface CompiledCreativeRequest {
  schemaVersion: 1;
  capabilityId: CreativeRequestCapabilityId;
  compiler: {
    kind: 'ai' | 'deterministic';
    model?: string;
    version: '1';
  };
  mediaKind: CreativeRequestMediaKind;
  parameters: Record<string, unknown>;
  prompt: string;
  references: CompiledCreativeRequestReference[];
  unresolved: CreativeRequestUnresolvedItem[];
}

export interface CompiledImageComposerInput {
  capabilityId: Extract<
    CreativeRequestCapabilityId,
    'image.image_to_image' | 'image.text_to_image'
  >;
  generationParams: ImageGenerationParams;
  instruction: string;
  references: Array<{
    mention: PackageComposerMention;
    purpose?: string;
    role: Extract<
      CreativeRequestReferenceRole,
      | 'character_reference'
      | 'composition_reference'
      | 'environment_reference'
      | 'general_reference'
      | 'object_reference'
      | 'pose_reference'
      | 'source'
      | 'style_reference'
    >;
  }>;
}

export const imageCreativeRequestRoles = declaredImageRoles();

export const videoCreativeRequestRoles = declaredVideoRoles();

export function creativeRequestRolesFor(
  mediaKind: CreativeRequestMediaKind,
): CreativeRequestReferenceRole[] {
  return mediaKind === 'image'
    ? [...imageCreativeRequestRoles]
    : [...videoCreativeRequestRoles];
}

export function imageComposerInputFromCompiledRequest(
  compiled: CompiledCreativeRequest,
  references: readonly CreativeRequestReferenceInput[],
  generationParams: ImageGenerationParams,
): CompiledImageComposerInput {
  if (
    compiled.mediaKind !== 'image'
    || (
      compiled.capabilityId !== 'image.text_to_image'
      && compiled.capabilityId !== 'image.image_to_image'
    )
  ) {
    throw new Error('Compiled request is not an image request.');
  }
  const mentionsById = new Map(
    references.map((reference) => [reference.mentionId, reference.mention]),
  );
  return {
    capabilityId: compiled.capabilityId,
    generationParams,
    instruction: compiled.prompt,
    references: compiled.references.map((reference) => {
      const mention = mentionsById.get(reference.mentionId);
      if (!mention || !imageCreativeRequestRoles.includes(reference.role)) {
        throw new Error('Compiled image reference cannot be resolved.');
      }
      return {
        mention: withReferenceSlot(mention),
        role: reference.role as CompiledImageComposerInput['references'][number]['role'],
        ...(reference.purpose ? { purpose: reference.purpose } : {}),
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

function declaredImageRoles(): CreativeRequestReferenceRole[] {
  const declared = [
    schemaForCapability('image.text_to_image'),
    schemaForCapability('image.image_to_image'),
  ].flatMap((schema) => schema.inputContracts.flatMap((contract) => [
    ...(contract.role ? [contract.role] : []),
    ...(contract.roles ?? []),
  ]));
  return uniqueCreativeRoles(declared);
}

function declaredVideoRoles(): CreativeRequestReferenceRole[] {
  const declared = capabilityDefinitionFor('video.generate').inputSlots
    .filter((slot) => slot.dataTypes.includes('image'))
    .map((slot) => (
      slot.semanticRole === 'scene_reference'
        ? 'environment_reference'
        : slot.semanticRole
    ));
  return uniqueCreativeRoles(declared);
}

function uniqueCreativeRoles(roles: readonly string[]): CreativeRequestReferenceRole[] {
  const supported = new Set<CreativeRequestReferenceRole>([
    'character_reference',
    'composition_reference',
    'environment_reference',
    'first_frame',
    'general_reference',
    'last_frame',
    'object_reference',
    'pose_reference',
    'source',
    'style_reference',
  ]);
  return [...new Set(roles.filter(
    (role): role is CreativeRequestReferenceRole => supported.has(
      role as CreativeRequestReferenceRole,
    ),
  ))];
}
