import type { AdapterKind, BlockRecord, BoardSnapshot, OperationReadinessIssue } from './types';
import {
  normalizeStoryboardUnitId,
  storyboardSheetCapabilityId,
} from './storyboardSheetContracts';
import {
  generationPreparationCapabilityId,
  normalizeGenerationPreparationParameters,
  normalizeGenerationReferenceManifest,
} from './generationPreparationContracts';
import {
  domainVideoGenerationCapabilityId,
  normalizeDomainVideoGenerationParameters,
} from './domainVideoGenerationContracts';
import { pluginCapabilityDefinitionFor } from './pluginCapabilityDefinitions';
import type {
  CapabilityBindingValue,
  CapabilityDefinition,
} from './capabilityContracts';
import {
  imageGenerateCapabilityDefinition,
  imageGenerateCapabilityId,
} from './imageGenerateContracts';
import { resolveWorkflowInputBlock } from './workflowInputResolution';

export type CapabilityInputRole =
  | 'annotated_composite'
  | 'character_reference'
  | 'composition_reference'
  | 'control_image'
  | 'depth_map'
  | 'edge_map'
  | 'environment_reference'
  | 'first_frame'
  | 'general_reference'
  | 'inpaint_mask'
  | 'last_frame'
  | 'object_reference'
  | 'pose_reference'
  | 'source'
  | 'style_reference';
export type CapabilityInputSource = 'block' | 'generated_asset' | 'inline';
export type CapabilityInputType = 'image' | 'text' | 'video';
export type CapabilityOutputType = 'document' | 'image' | 'text' | 'video';
export type PromptSource = 'block' | 'inline';

export interface CapabilityInputContract {
  type: CapabilityInputType;
  required: boolean;
  source?: CapabilityInputSource;
  role?: CapabilityInputRole;
  roles?: CapabilityInputRole[];
  requiredRoles?: CapabilityInputRole[];
  min?: number;
  max?: number | 'many';
}

export interface CapabilityOutputContract {
  type: CapabilityOutputType;
}

export interface CapabilityParamSchema {
  aspectRatio?: boolean;
  count?: boolean;
  duration?: boolean;
  model?: boolean;
  motion?: boolean;
  resolution?: boolean;
  strength?: boolean;
}

export interface CapabilitySchema {
  capabilityId: string;
  defaultAdapter: AdapterKind;
  displayNameKey: string;
  inputContracts: CapabilityInputContract[];
  outputContracts: CapabilityOutputContract[];
  paramsSchema: CapabilityParamSchema;
  promptSource: PromptSource;
  requiredInputSlotIds?: string[];
  supportedAdapters: AdapterKind[];
}

const capabilitySchemas: Record<string, CapabilitySchema> = {
  'text.generate': {
    capabilityId: 'text.generate',
    defaultAdapter: 'direct_api',
    displayNameKey: 'operation.generateText.title',
    inputContracts: [{ type: 'text', required: true, source: 'block', min: 1, max: 1 }],
    outputContracts: [{ type: 'document' }],
    paramsSchema: {},
    promptSource: 'block',
    supportedAdapters: ['direct_api', 'mcp_agent', 'cli_agent', 'manual_import'],
  },
  'story.screenplay.generate': {
    capabilityId: 'story.screenplay.generate',
    defaultAdapter: 'direct_api',
    displayNameKey: 'operation.generateScreenplay.title',
    inputContracts: [{ type: 'text', required: true, source: 'block', min: 1, max: 'many' }],
    outputContracts: [{ type: 'document' }],
    paramsSchema: {},
    promptSource: 'block',
    supportedAdapters: ['direct_api', 'mcp_agent', 'cli_agent', 'manual_import'],
  },
  'story.screenplay.normalize': {
    capabilityId: 'story.screenplay.normalize',
    defaultAdapter: 'direct_api',
    displayNameKey: 'operation.organizeScreenplay.title',
    inputContracts: [{ type: 'text', required: true, source: 'block', min: 1, max: 'many' }],
    outputContracts: [{ type: 'document' }],
    paramsSchema: {},
    promptSource: 'block',
    supportedAdapters: ['direct_api', 'mcp_agent', 'cli_agent', 'manual_import'],
  },
  'design.character.define': {
    capabilityId: 'design.character.define',
    defaultAdapter: 'direct_api',
    displayNameKey: 'operation.defineCharacter.title',
    inputContracts: [{ type: 'text', required: true, source: 'block', min: 1, max: 'many' }],
    outputContracts: [{ type: 'document' }],
    paramsSchema: {},
    promptSource: 'block',
    supportedAdapters: ['direct_api', 'mcp_agent', 'cli_agent', 'manual_import'],
  },
  'design.scene.define': {
    capabilityId: 'design.scene.define',
    defaultAdapter: 'direct_api',
    displayNameKey: 'operation.defineScene.title',
    inputContracts: [{ type: 'text', required: true, source: 'block', min: 1, max: 'many' }],
    outputContracts: [{ type: 'document' }],
    paramsSchema: {},
    promptSource: 'block',
    supportedAdapters: ['direct_api', 'mcp_agent', 'cli_agent', 'manual_import'],
  },
  'previs.storyboard.plan': {
    capabilityId: 'previs.storyboard.plan',
    defaultAdapter: 'direct_api',
    displayNameKey: 'operation.generateStoryboardPlan.title',
    inputContracts: [{ type: 'text', required: true, source: 'block', min: 3, max: 'many' }],
    outputContracts: [{ type: 'document' }],
    paramsSchema: {},
    promptSource: 'block',
    requiredInputSlotIds: ['screenplay', 'character_bible', 'scene_bible'],
    supportedAdapters: ['direct_api', 'mcp_agent', 'cli_agent', 'manual_import'],
  },
  'previs.storyboard_sheet.generate': {
    capabilityId: 'previs.storyboard_sheet.generate',
    defaultAdapter: 'mcp_agent',
    displayNameKey: 'operation.generateStoryboardSheet.title',
    inputContracts: [],
    outputContracts: [{ type: 'image' }],
    paramsSchema: { count: true },
    promptSource: 'inline',
    requiredInputSlotIds: ['storyboard_plan', 'unit_id'],
    supportedAdapters: ['mcp_agent', 'direct_api', 'manual_import'],
  },
  'generation.video_package.prepare': {
    capabilityId: 'generation.video_package.prepare',
    defaultAdapter: 'mcp_agent',
    displayNameKey: 'operation.prepareGenerationPackage.title',
    inputContracts: [],
    outputContracts: [{ type: 'document' }],
    paramsSchema: {},
    promptSource: 'inline',
    requiredInputSlotIds: [
      'storyboard_plan',
      'storyboard_sheet',
      'unit_id',
      'reference_manifest',
    ],
    supportedAdapters: ['mcp_agent'],
  },
  'generation.video.generate': {
    capabilityId: 'generation.video.generate',
    defaultAdapter: 'direct_api',
    displayNameKey: 'operation.generateDomainVideo.title',
    inputContracts: [],
    outputContracts: [{ type: 'video' }],
    paramsSchema: { count: true },
    promptSource: 'inline',
    requiredInputSlotIds: ['generation_package'],
    supportedAdapters: ['direct_api', 'cli_agent', 'mock'],
  },
  [imageGenerateCapabilityId]: {
    capabilityId: imageGenerateCapabilityId,
    defaultAdapter: 'mcp_agent',
    displayNameKey: 'operation.generateImage.title',
    inputContracts: [
      { type: 'text', required: true, source: 'block', min: 1, max: 1 },
      {
        type: 'image',
        required: false,
        source: 'block',
        min: 0,
        max: 'many',
        roles: [
          'source',
          'character_reference',
          'style_reference',
          'composition_reference',
          'pose_reference',
          'object_reference',
          'environment_reference',
          'general_reference',
        ],
      },
    ],
    outputContracts: [{ type: 'image' }],
    paramsSchema: { aspectRatio: true, count: true, model: true, resolution: true },
    promptSource: 'block',
    supportedAdapters: ['mcp_agent', 'direct_api', 'cli_agent', 'manual_import', 'mock'],
  },
  'video.first_last_frame_to_video': {
    capabilityId: 'video.first_last_frame_to_video',
    defaultAdapter: 'mcp_agent',
    displayNameKey: 'toolbar.firstLastFrameVideo',
    inputContracts: [
      { type: 'text', required: true, source: 'block' },
      { type: 'image', required: true, source: 'block', role: 'first_frame', min: 1, max: 1 },
      { type: 'image', required: true, source: 'block', role: 'last_frame', min: 1, max: 1 },
    ],
    outputContracts: [{ type: 'video' }],
    paramsSchema: { duration: true, model: true, motion: true, resolution: true },
    promptSource: 'block',
    supportedAdapters: ['mcp_agent', 'direct_api', 'cli_agent', 'manual_import', 'mock'],
  },
};

export function schemaForCapability(capabilityId: string): CapabilitySchema {
  return capabilitySchemas[capabilityId] ?? capabilitySchemas[imageGenerateCapabilityId];
}

export function capabilityForImageOperation(
  operation: 'create_similar' | 'generate_image' | 'image_to_image' | 'quick_edit' | 'text_to_image',
): string {
  void operation;
  return imageGenerateCapabilityId;
}

export function connectedInputBlocks(snapshot: BoardSnapshot, operationBlockId: string): BlockRecord[] {
  const inputEdges = snapshot.edges
    .filter((edge) => edge.targetBlockId === operationBlockId && edge.kind === 'execution_input')
  return inputEdges.flatMap((edge) => {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === edge.sourceBlockId);
    return block
      ? [resolveWorkflowInputBlock(snapshot, operationBlockId, edge.inputSlotId, block)]
      : [];
  });
}

export interface OperationInputState {
  hasImageAssetInput: boolean;
  hasImageInput: boolean;
  hasTextInput: boolean;
  missingRequiredTypes: CapabilityInputType[];
}

export interface OperationReadiness {
  canRun: boolean;
  issues: OperationReadinessIssue[];
}

export function operationReadinessFor(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
): OperationReadiness {
  if (operationBlock.type !== 'operation') return { canRun: false, issues: [] };
  const capabilityId =
    typeof operationBlock.data.capabilityId === 'string'
      ? operationBlock.data.capabilityId
      : imageGenerateCapabilityId;
  const schema = schemaForCapability(capabilityId);
  const inputEdges = snapshot.edges.filter(
    (edge) => edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input',
  );
  const inputBlocks = inputEdges
    .flatMap((edge) => {
      const block = snapshot.blocks.find((candidate) => candidate.blockId === edge.sourceBlockId);
      return block
        ? [resolveWorkflowInputBlock(snapshot, operationBlock.blockId, edge.inputSlotId, block)]
        : [];
    });
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  for (const block of inputBlocks) blockById.set(block.blockId, block);
  const issues = new Set<OperationReadinessIssue>();

  if (capabilityId === storyboardSheetCapabilityId) {
    const planEdge = inputEdges.find((edge) => edge.inputSlotId === 'storyboard_plan');
    const planBlock = planEdge ? blockById.get(planEdge.sourceBlockId) : undefined;
    if (planBlock?.type !== 'document') issues.add('text_input_missing');
    else if (typeof planBlock.data.assetId !== 'string') issues.add('prompt_empty');
    try {
      normalizeStoryboardUnitId(operationBlock.data.storyboardUnitId);
    } catch {
      issues.add('prompt_empty');
    }
    const missingReferenceAsset = inputEdges.some((edge) => {
      if (edge.inputSlotId !== 'references') return false;
      const block = blockById.get(edge.sourceBlockId);
      return block?.type !== 'image' || typeof block.data.assetId !== 'string';
    });
    if (missingReferenceAsset) issues.add('image_asset_missing');
    return { canRun: issues.size === 0, issues: [...issues] };
  }
  if (capabilityId === generationPreparationCapabilityId) {
    const planEdge = inputEdges.find((edge) => edge.inputSlotId === 'storyboard_plan');
    const planBlock = planEdge ? blockById.get(planEdge.sourceBlockId) : undefined;
    if (planBlock?.type !== 'document') issues.add('text_input_missing');
    else if (typeof planBlock.data.assetId !== 'string') issues.add('prompt_empty');

    const sheetEdge = inputEdges.find((edge) => edge.inputSlotId === 'storyboard_sheet');
    const sheetBlock = sheetEdge ? blockById.get(sheetEdge.sourceBlockId) : undefined;
    const sheetRevisionId = typeof sheetBlock?.data.artifactRevisionId === 'string'
      ? sheetBlock.data.artifactRevisionId
      : undefined;
    if (sheetBlock?.type !== 'image') issues.add('image_input_missing');
    else if (typeof sheetBlock.data.assetId !== 'string' || !sheetRevisionId) {
      issues.add('image_asset_missing');
    }
    if (
      sheetRevisionId
      && !(snapshot.workflowGateEvaluations ?? []).some((evaluation) => (
        evaluation.gateId === 'storyboard_sheet_review'
        && evaluation.subjectArtifactRevisionId === sheetRevisionId
        && evaluation.status === 'passed'
        && evaluation.freshness === 'current'
      ))
    ) issues.add('workflow_step_not_ready');

    if (
      typeof operationBlock.data.generationUnitId !== 'string'
      || !operationBlock.data.generationUnitId.trim()
    ) issues.add('prompt_empty');
    try {
      normalizeGenerationPreparationParameters(
        objectRecord(operationBlock.data.generationPreparationParameters),
      );
      const manifest = normalizeGenerationReferenceManifest(
        operationBlock.data.generationReferenceManifest,
      );
      const referenceIdentities = new Set(inputEdges
        .filter((edge) => edge.inputSlotId === 'references')
        .flatMap((edge) => {
          const block = blockById.get(edge.sourceBlockId);
          if (block?.type !== 'image' || typeof block.data.assetId !== 'string') {
            issues.add('image_asset_missing');
            return [];
          }
          return [
            `asset:${block.data.assetId}`,
            ...(typeof block.data.artifactRevisionId === 'string'
              ? [`artifact_revision:${block.data.artifactRevisionId}`]
              : []),
          ];
        }));
      if (manifest.items.some((item) => (
        item.required
        && (!item.bindingIdentity || !referenceIdentities.has(item.bindingIdentity))
      ))) issues.add('image_asset_missing');
    } catch {
      issues.add('prompt_empty');
    }
    return { canRun: issues.size === 0, issues: [...issues] };
  }
  if (capabilityId === domainVideoGenerationCapabilityId) {
    const packageEdge = inputEdges.find((edge) => edge.inputSlotId === 'generation_package');
    const packageBlock = packageEdge ? blockById.get(packageEdge.sourceBlockId) : undefined;
    if (packageBlock?.type !== 'document') {
      issues.add('text_input_missing');
    } else if (
      packageBlock.data.artifactType !== 'video_generation_package'
      || typeof packageBlock.data.artifactRevisionId !== 'string'
      || typeof packageBlock.data.assetId !== 'string'
    ) {
      issues.add('prompt_empty');
    }
    try {
      normalizeDomainVideoGenerationParameters(
        objectRecord(operationBlock.data.domainVideoGenerationParameters),
      );
    } catch {
      issues.add('prompt_empty');
    }
    return { canRun: issues.size === 0, issues: [...issues] };
  }
  if (capabilityId === imageGenerateCapabilityId) {
    if (operationBlock.data.operationContractMigrationIssue === 'legacy_image_generate_input_mismatch') {
      return { canRun: false, issues: ['input_contract_migration_required'] };
    }
    return imageGenerateOperationReadiness(inputEdges, blockById);
  }
  const pluginDefinition = pluginCapabilityDefinitionFor(capabilityId);
  if (pluginDefinition) {
    return pluginOperationReadiness(
      operationBlock,
      pluginDefinition,
      inputEdges,
      blockById,
    );
  }

  for (const slotId of schema.requiredInputSlotIds ?? []) {
    const edge = inputEdges.find((candidate) => candidate.inputSlotId === slotId);
    const block = edge ? blockById.get(edge.sourceBlockId) : undefined;
    if (!block || !inputBlockMatchesContract(block, 'text', capabilityId)) {
      issues.add('text_input_missing');
      continue;
    }
    if (!textualInputReady([block], capabilityId)) issues.add('prompt_empty');
  }

  for (const contract of schema.inputContracts) {
    if (!contract.required || contract.source !== 'block') continue;
    const matchingBlocks = inputBlocks.filter((block) => inputBlockMatchesContract(block, contract.type, capabilityId));
    const min = contract.min ?? 1;
    if (matchingBlocks.length < min) {
      issues.add(contract.type === 'text' ? 'text_input_missing' : 'image_input_missing');
      continue;
    }
    if (contract.type === 'text' && !textualInputReady(matchingBlocks, capabilityId)) issues.add('prompt_empty');
    if (contract.type === 'image') {
      const assetBackedBlocks = matchingBlocks.filter((block) => typeof block.data.assetId === 'string');
      if (assetBackedBlocks.length < min) issues.add('image_asset_missing');
      if (
        contract.requiredRoles?.includes('source')
        && !inputEdges.some((edge) => {
          const block = blockById.get(edge.sourceBlockId);
          return edge.inputSlotId === 'source_image'
            && block?.type === 'image'
            && typeof block.data.assetId === 'string';
        })
      ) issues.add('source_image_missing');
    }
  }

  for (const edge of inputEdges) {
    const block = blockById.get(edge.sourceBlockId);
    if (block?.type !== 'image' || typeof block.data.assetId !== 'string') continue;
    if (compatibleInputSlotIdsFor(block, operationBlock).length > 0 && !edge.inputSlotId) {
      issues.add('image_binding_missing');
    }
  }

  return { canRun: issues.size === 0, issues: [...issues] };
}

function imageGenerateOperationReadiness(
  inputEdges: BoardSnapshot['edges'],
  blockById: Map<string, BlockRecord>,
): OperationReadiness {
  const issues = new Set<OperationReadinessIssue>();
  const promptEdges = inputEdges.filter((edge) => edge.inputSlotId === 'prompt');
  const promptBlocks = promptEdges
    .map((edge) => blockById.get(edge.sourceBlockId))
    .filter((block): block is BlockRecord => Boolean(block));
  if (
    promptEdges.length !== 1
    || (promptBlocks[0]?.type !== 'text' && promptBlocks[0]?.type !== 'document')
  ) {
    issues.add('text_input_missing');
  } else if (
    promptBlocks[0]?.type === 'text'
      ? !promptTextFromInputs(promptBlocks)
      : typeof promptBlocks[0]?.data.assetId !== 'string'
  ) {
    issues.add('prompt_empty');
  }

  const sourceEdges = inputEdges.filter((edge) => edge.inputSlotId === 'source_image');
  if (sourceEdges.length > 1) issues.add('image_binding_missing');
  for (const edge of inputEdges) {
    const block = blockById.get(edge.sourceBlockId);
    if (block?.type === 'text' || block?.type === 'document') {
      if (edge.inputSlotId !== 'prompt') issues.add('image_binding_missing');
      continue;
    }
    if (block?.type !== 'image') {
      issues.add('image_binding_missing');
      continue;
    }
    if (edge.inputSlotId !== 'source_image' && edge.inputSlotId !== 'references') {
      issues.add('image_binding_missing');
      continue;
    }
    if (typeof block.data.assetId !== 'string') issues.add('image_asset_missing');
    if (edge.inputSlotId === 'source_image' && edge.referenceIntent) {
      issues.add('image_binding_missing');
    }
  }
  return { canRun: issues.size === 0, issues: [...issues] };
}

function pluginOperationReadiness(
  operationBlock: BlockRecord,
  definition: CapabilityDefinition,
  inputEdges: BoardSnapshot['edges'],
  blockById: Map<string, BlockRecord>,
): OperationReadiness {
  const issues = new Set<OperationReadinessIssue>();
  const projectedBindings = Array.isArray(operationBlock.data.workflowInputBindings)
    ? operationBlock.data.workflowInputBindings
    : [];
  for (const slot of definition.inputSlots) {
    if (!slot.required) continue;
    const edgeBlocks = inputEdges
      .filter((edge) => edge.inputSlotId === slot.slotId)
      .map((edge) => blockById.get(edge.sourceBlockId))
      .filter((block): block is BlockRecord => Boolean(block));
    const projectedValues = projectedBindings
      .filter((binding): binding is {
        inputSlotId: string;
        values: CapabilityBindingValue[];
      } => (
        Boolean(binding)
        && typeof binding === 'object'
        && !Array.isArray(binding)
        && (binding as { inputSlotId?: unknown }).inputSlotId === slot.slotId
        && Array.isArray((binding as { values?: unknown }).values)
      ))
      .flatMap((binding) => binding.values);
    const hasInlineValue = projectedValues.some((value) => (
      value.kind === 'inline'
      && value.value !== undefined
      && value.value !== null
      && (typeof value.value !== 'string' || value.value.trim().length > 0)
    ));
    if (edgeBlocks.length === 0 && !hasInlineValue) {
      issues.add(readinessIssueForDataTypes(slot.dataTypes));
      continue;
    }
    if (slot.dataTypes.includes('text')) {
      const textBlocks = edgeBlocks.filter(
        (block) => block.type === 'text' || block.type === 'document',
      );
      if (textBlocks.length === 0 && !hasInlineValue) {
        issues.add('text_input_missing');
      } else if (
        !hasInlineValue
        && !textBlocks.some((block) => (
          block.type === 'text'
            ? typeof block.data.body === 'string' && block.data.body.trim().length > 0
            : typeof block.data.assetId === 'string'
        ))
      ) {
        issues.add('prompt_empty');
      }
    }
    if (slot.dataTypes.includes('image')) {
      const imageBlocks = edgeBlocks.filter((block) => block.type === 'image');
      if (imageBlocks.length === 0) issues.add('image_input_missing');
      else if (!imageBlocks.some((block) => typeof block.data.assetId === 'string')) {
        issues.add('image_asset_missing');
      }
    }
    if (slot.dataTypes.includes('video')) {
      const videoBlocks = edgeBlocks.filter((block) => block.type === 'video');
      if (videoBlocks.length === 0) issues.add('image_input_missing');
      else if (!videoBlocks.some((block) => typeof block.data.assetId === 'string')) {
        issues.add('image_asset_missing');
      }
    }
  }
  return { canRun: issues.size === 0, issues: [...issues] };
}

function readinessIssueForDataTypes(
  dataTypes: CapabilityDefinition['inputSlots'][number]['dataTypes'],
): OperationReadinessIssue {
  if (dataTypes.includes('text') || dataTypes.includes('document')) {
    return 'text_input_missing';
  }
  return 'image_input_missing';
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function operationReadinessMessageKey(issue: OperationReadinessIssue) {
  if (issue === 'text_input_missing') return 'operationToolbar.textInputMissing' as const;
  if (issue === 'prompt_empty') return 'feedback.promptRequiredBody' as const;
  if (issue === 'workflow_step_not_ready') return 'workflowRuntime.stepNotReady' as const;
  if (issue === 'image_input_missing') return 'operationToolbar.imageInputMissing' as const;
  if (issue === 'image_asset_missing') return 'operationToolbar.imageAssetMissing' as const;
  if (issue === 'image_binding_missing') return 'operationReference.bindingRequired' as const;
  if (issue === 'input_contract_migration_required') return 'operationToolbar.inputContractMigrationRequired' as const;
  return 'operationToolbar.sourceImageMissing' as const;
}

export function operationInputStateForCapability(
  inputBlocks: BlockRecord[],
  capabilityId: string,
): OperationInputState {
  const schema = schemaForCapability(capabilityId);
  const missingRequiredTypes: CapabilityInputType[] = [];

  for (const contract of schema.inputContracts) {
    if (!contract.required || contract.source !== 'block') continue;
    const matchingBlocks = inputBlocks.filter((block) => inputBlockMatchesContract(block, contract.type, capabilityId));
    const min = contract.min ?? 1;
    if (matchingBlocks.length < min) {
      missingRequiredTypes.push(contract.type);
    }
  }

  return {
    hasImageAssetInput: inputBlocks.some((block) => block.type === 'image' && typeof block.data.assetId === 'string'),
    hasImageInput: inputBlocks.some((block) => block.type === 'image'),
    hasTextInput: textualInputReady(inputBlocks, capabilityId),
    missingRequiredTypes,
  };
}

export function nextRequiredInputSlotId(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
): string | undefined {
  const capabilityId = typeof operationBlock.data.capabilityId === 'string'
    ? operationBlock.data.capabilityId
    : imageGenerateCapabilityId;
  const requiredSlotIds = schemaForCapability(capabilityId).requiredInputSlotIds ?? [];
  const assignedSlotIds = new Set(snapshot.edges
    .filter((edge) => edge.kind === 'execution_input' && edge.targetBlockId === operationBlock.blockId)
    .map((edge) => edge.inputSlotId)
    .filter((slotId): slotId is string => Boolean(slotId)));
  return requiredSlotIds.find((slotId) => !assignedSlotIds.has(slotId));
}

function inputBlockMatchesContract(
  block: BlockRecord,
  contractType: CapabilityInputType,
  capabilityId: string,
): boolean {
  if (contractType === 'text' && acceptsDocumentAsTextInput(capabilityId)) {
    return block.type === 'text' || block.type === 'document';
  }
  return block.type === contractType;
}

function textualInputReady(blocks: BlockRecord[], capabilityId: string): boolean {
  if (promptTextFromInputs(blocks)) return true;
  return acceptsDocumentAsTextInput(capabilityId) && blocks.some(
    (block) => block.type === 'document' && typeof block.data.assetId === 'string',
  );
}

function acceptsDocumentAsTextInput(capabilityId: string): boolean {
  const schema = capabilitySchemas[capabilityId];
  return Boolean(
    schema?.inputContracts.some((contract) => contract.type === 'text')
    && schema.outputContracts.some((contract) => contract.type === 'document'),
  );
}

export function promptTextFromInputs(inputBlocks: BlockRecord[]): string | undefined {
  const textBlock = inputBlocks.find((block) => block.type === 'text');
  const body = typeof textBlock?.data.body === 'string' ? textBlock.data.body.trim() : '';
  return body || undefined;
}

export function imageInputBlocks(inputBlocks: BlockRecord[]): BlockRecord[] {
  return inputBlocks.filter((block) => block.type === 'image');
}

export function firstTextInputBlock(inputBlocks: BlockRecord[]): BlockRecord | undefined {
  return inputBlocks.find((block) => block.type === 'text');
}

export function compatibleInputSlotIdsFor(
  sourceBlock: BlockRecord,
  operationBlock: BlockRecord,
): string[] {
  if (operationBlock.type === 'video') {
    if (sourceBlock.type !== 'image') return [];
    return [
      'first_frame',
      'last_frame',
      'references',
    ];
  }
  if (operationBlock.type !== 'operation') return [];

  const capabilityId =
    typeof operationBlock.data.capabilityId === 'string' ? operationBlock.data.capabilityId : imageGenerateCapabilityId;
  if (capabilityId === storyboardSheetCapabilityId) return [];
  const pluginDefinition = pluginCapabilityDefinitionFor(capabilityId);
  if (pluginDefinition) {
    return pluginDefinition.inputSlots
      .filter((slot) => slot.dataTypes.some(
        (dataType) => dataType === sourceBlock.type,
      ))
      .map((slot) => slot.slotId);
  }
  if (capabilityId === imageGenerateCapabilityId) {
    if (sourceBlock.type !== 'text' && sourceBlock.type !== 'image') return [];
    const sourceDataType = sourceBlock.type;
    return imageGenerateCapabilityDefinition.inputSlots
      .filter((slot) => slot.bindingKinds.includes('block') && slot.dataTypes.includes(sourceDataType))
      .map((slot) => slot.slotId);
  }
  const schema = schemaForCapability(capabilityId);
  const slotIds = schema.inputContracts
    .filter((contract) => contract.source === 'block' && contract.type === sourceBlock.type)
    .flatMap((contract) => {
      if (contract.type === 'text') return ['prompt'];
      if (contract.type === 'video') return [contract.role ?? 'source_video'];
      if (contract.requiredRoles?.includes('source')) return ['source_image', 'references'];
      if (contract.role) return [contract.role];
      if (contract.roles?.length) return ['references'];
      return ['images'];
    });

  return Array.from(new Set(slotIds));
}

export function disabledInputSlotIdsFor(
  snapshot: BoardSnapshot,
  sourceBlock: BlockRecord,
  operationBlock: BlockRecord,
  currentEdgeId?: string,
): string[] {
  return compatibleInputSlotIdsFor(sourceBlock, operationBlock).filter((slotId) => {
    const cardinality = inputSlotCardinality(operationBlock, slotId);
    if (cardinality === 'many') return false;
    const assignedCount = snapshot.edges.filter(
      (edge) =>
        edge.edgeId !== currentEdgeId &&
        edge.kind === 'execution_input' &&
        edge.targetBlockId === operationBlock.blockId &&
        edge.inputSlotId === slotId,
    ).length;
    return assignedCount >= 1;
  });
}

export function suggestedInputSlotId(
  snapshot: BoardSnapshot,
  sourceBlock: BlockRecord,
  operationBlock: BlockRecord,
  currentEdgeId?: string,
): string | undefined {
  const compatible = compatibleInputSlotIdsFor(sourceBlock, operationBlock);
  const disabled = new Set(disabledInputSlotIdsFor(
    snapshot,
    sourceBlock,
    operationBlock,
    currentEdgeId,
  ));
  const available = compatible.filter((slotId) => !disabled.has(slotId));
  if (available.length === 1) return available[0];
  if (sourceBlock.type === 'image' && available.includes('references')) {
    return available.includes('source_image') ? undefined : 'references';
  }
  return available[0];
}

function inputSlotCardinality(
  operationBlock: BlockRecord,
  slotId: string,
): CapabilityDefinition['inputSlots'][number]['cardinality'] {
  if (operationBlock.type === 'video') {
    return slotId === 'references' ? 'many' : 'one';
  }
  const capabilityId = typeof operationBlock.data.capabilityId === 'string'
    ? operationBlock.data.capabilityId
    : imageGenerateCapabilityId;
  const pluginDefinition = pluginCapabilityDefinitionFor(capabilityId);
  const pluginSlot = pluginDefinition?.inputSlots.find((slot) => slot.slotId === slotId);
  if (pluginSlot) return pluginSlot.cardinality;
  if (capabilityId === imageGenerateCapabilityId) {
    return imageGenerateCapabilityDefinition.inputSlots.find((slot) => slot.slotId === slotId)?.cardinality ?? 'one';
  }
  if (slotId === 'references') return 'many';
  return 'one';
}
