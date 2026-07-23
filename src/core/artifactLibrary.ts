import type {
  ProjectArtifactLibraryItem,
} from './artifactContracts';
import type {
  CapabilityDataType,
  CapabilityInputSlotDefinition,
  CapabilityBindingValue,
} from './capabilityContracts';
import { capabilityDefinitionFor } from './capabilityRegistry';
import { createBlockRecord, touchBoard } from './blockFactory';
import { createId, nowIso } from './id';
import type {
  AssetKind,
  BlockRecord,
  BlockType,
  BoardSnapshot,
  ExecutionInputRole,
} from './types';

export interface ArtifactPromotionOption {
  artifactType: string;
  dataKinds: AssetKind[];
}

export interface InsertArtifactReferenceInput {
  item: ProjectArtifactLibraryItem;
  position: { x: number; y: number };
  targetOperationId?: string;
  targetSlotId?: string;
}

export const artifactPromotionOptions: ArtifactPromotionOption[] = [
  { artifactType: 'character_reference', dataKinds: ['image'] },
  { artifactType: 'scene_reference', dataKinds: ['image'] },
  { artifactType: 'prop_reference', dataKinds: ['image'] },
  { artifactType: 'style_reference', dataKinds: ['image'] },
  { artifactType: 'creative_brief', dataKinds: ['document'] },
  { artifactType: 'screenplay_master', dataKinds: ['document'] },
  { artifactType: 'character_bible', dataKinds: ['document'] },
  { artifactType: 'scene_bible', dataKinds: ['document'] },
  { artifactType: 'storyboard_plan', dataKinds: ['document'] },
  { artifactType: 'video_clip', dataKinds: ['video'] },
  { artifactType: 'voice_reference', dataKinds: ['audio'] },
];

export function promotionOptionsForAssetKind(kind: AssetKind): ArtifactPromotionOption[] {
  return artifactPromotionOptions.filter((option) => option.dataKinds.includes(kind));
}

export function artifactSemanticKey(artifactType: string, name: string): string {
  const normalizedName = name
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  if (!normalizedName) throw new Error('Artifact name must contain a letter or number.');
  return `${artifactType}:${normalizedName}`;
}

export function artifactDisplayName(semanticKey: string): string {
  const value = semanticKey.includes(':')
    ? semanticKey.slice(semanticKey.indexOf(':') + 1)
    : semanticKey;
  return value.replace(/[-_]+/g, ' ').trim() || semanticKey;
}

export function compatibleArtifactInputSlots(
  snapshot: BoardSnapshot,
  operation: BlockRecord | undefined,
  item: ProjectArtifactLibraryItem,
): CapabilityInputSlotDefinition[] {
  if (
    !operation
    || operation.type !== 'operation'
    || typeof operation.data.capabilityId !== 'string'
    || typeof operation.data.workflowProjectionId === 'string'
    || operation.data.status === 'queued'
    || operation.data.status === 'running'
  ) return [];
  const dataTypes = dataTypesForAssetKind(item.primaryAsset.kind);
  const definition = capabilityDefinitionFor(operation.data.capabilityId);
  const assignedSlotIds = new Set(
    snapshot.edges
      .filter(
        (edge) => edge.kind === 'execution_input' && edge.targetBlockId === operation.blockId,
      )
      .flatMap((edge) => {
        if (edge.inputSlotId) return [edge.inputSlotId];
        const matchingSlot = definition.inputSlots.find(
          (slot) => inputRoleMatchesSemanticRole(edge.inputRole, slot.semanticRole),
        );
        return matchingSlot ? [matchingSlot.slotId] : [];
      }),
  );
  return definition.inputSlots.filter((slot) => {
    if (!slot.bindingKinds.includes('artifact_revision')) return false;
    if (!slot.dataTypes.some((dataType) => dataTypes.includes(dataType))) return false;
    if (
      slot.artifactTypes.length > 0
      && !slot.artifactTypes.includes(item.artifact.artifactType)
    ) return false;
    return slot.cardinality === 'many' || !assignedSlotIds.has(slot.slotId);
  });
}

export function insertArtifactReference(
  snapshot: BoardSnapshot,
  input: InsertArtifactReferenceInput,
): BlockRecord {
  const blockType = blockTypeForAssetKind(input.item.primaryAsset.kind);
  if (!blockType) {
    throw new Error(`Artifact Asset kind cannot be projected to the canvas yet: ${input.item.primaryAsset.kind}`);
  }
  const targetOperation = input.targetOperationId
    ? snapshot.blocks.find((block) => block.blockId === input.targetOperationId)
    : undefined;
  const targetSlot = input.targetSlotId && targetOperation
    ? compatibleArtifactInputSlots(snapshot, targetOperation, input.item)
      .find((slot) => slot.slotId === input.targetSlotId)
    : undefined;
  if (input.targetOperationId && (!targetOperation || !targetSlot)) {
    throw new Error('Artifact target Operation Slot is no longer compatible or available.');
  }

  if (!snapshot.assets.some((asset) => asset.assetId === input.item.primaryAsset.assetId)) {
    snapshot.assets.push(structuredClone(input.item.primaryAsset));
  }
  const block = createBlockRecord(snapshot, blockType);
  block.position = input.position;
  block.data = {
    ...block.data,
    artifactId: input.item.artifact.artifactId,
    artifactRevisionId: input.item.currentRevision.artifactRevisionId,
    assetId: input.item.primaryAsset.assetId,
    documentKind: blockType === 'document'
      ? input.item.artifact.artifactType
      : block.data.documentKind,
    title: artifactDisplayName(input.item.artifact.semanticKey),
  };
  snapshot.blocks.push(block);

  if (targetOperation && targetSlot) {
    snapshot.edges.push({
      edgeId: createId('edge'),
      inputRole: inputRoleForSlot(targetSlot.semanticRole),
      inputSlotId: targetSlot.slotId,
      kind: 'execution_input',
      sourceBlockId: block.blockId,
      targetBlockId: targetOperation.blockId,
    });
  }
  block.updatedAt = nowIso();
  touchBoard(snapshot);
  return block;
}

export function capabilityBindingValueForBlock(block: BlockRecord): CapabilityBindingValue {
  if (typeof block.data.artifactRevisionId === 'string') {
    return {
      artifactRevisionId: block.data.artifactRevisionId,
      blockId: block.blockId,
      kind: 'artifact_revision',
    };
  }
  if (typeof block.data.assetId === 'string') {
    return {
      assetId: block.data.assetId,
      blockId: block.blockId,
      kind: 'asset',
    };
  }
  return { blockId: block.blockId, kind: 'block' };
}

export function assetIdsForBindingValue(
  snapshot: BoardSnapshot,
  value: CapabilityBindingValue,
): string[] {
  if (value.kind === 'asset') return [value.assetId];
  if (value.kind !== 'artifact_revision' || !value.blockId) return [];
  const block = snapshot.blocks.find((candidate) => candidate.blockId === value.blockId);
  return typeof block?.data.assetId === 'string' ? [block.data.assetId] : [];
}

function dataTypesForAssetKind(kind: AssetKind): CapabilityDataType[] {
  if (kind === 'document') return ['document', 'text'];
  if (kind === 'other') return ['structured_data'];
  return [kind] as const;
}

function blockTypeForAssetKind(kind: AssetKind): BlockType | undefined {
  if (kind === 'image' || kind === 'video' || kind === 'document') return kind;
  return undefined;
}

function inputRoleForSlot(semanticRole: string): ExecutionInputRole | undefined {
  if (semanticRole === 'source') return 'source';
  if (semanticRole === 'first_frame') return 'first_frame';
  if (semanticRole === 'last_frame') return 'last_frame';
  if (semanticRole === 'character_reference') return 'character_reference';
  if (semanticRole === 'scene_reference') return 'environment_reference';
  if (semanticRole === 'style_reference') return 'style_reference';
  if (semanticRole === 'reference') return 'general_reference';
  return undefined;
}

function inputRoleMatchesSemanticRole(
  inputRole: ExecutionInputRole | undefined,
  semanticRole: string,
): boolean {
  if (!inputRole) return false;
  if (inputRole === 'environment_reference') return semanticRole === 'scene_reference';
  if (inputRole === 'general_reference') {
    return semanticRole === 'reference' || semanticRole === 'general_reference';
  }
  return inputRole === semanticRole;
}
