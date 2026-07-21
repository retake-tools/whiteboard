import type { AdapterKind, BlockRecord, BoardSnapshot, ExecutionInputRole, OperationReadinessIssue } from './types';
import { inputRoleDefinition } from './inputRoles';

export type CapabilityInputRole = ExecutionInputRole;
export type CapabilityInputSource = 'block' | 'generated_asset' | 'inline';
export type CapabilityInputType = 'image' | 'text' | 'video';
export type CapabilityOutputType = 'image' | 'text' | 'video';
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
  supportedAdapters: AdapterKind[];
}

const capabilitySchemas: Record<string, CapabilitySchema> = {
  'text.generate': {
    capabilityId: 'text.generate',
    defaultAdapter: 'direct_api',
    displayNameKey: 'operation.generateText.title',
    inputContracts: [{ type: 'text', required: true, source: 'block', min: 1, max: 1 }],
    outputContracts: [{ type: 'text' }],
    paramsSchema: {},
    promptSource: 'block',
    supportedAdapters: ['direct_api', 'mcp_agent', 'cli_agent', 'manual_import'],
  },
  'image.text_to_image': {
    capabilityId: 'image.text_to_image',
    defaultAdapter: 'mcp_agent',
    displayNameKey: 'operation.generateImage.title',
    inputContracts: [
      { type: 'text', required: true, source: 'block' },
      {
        type: 'image',
        required: false,
        source: 'block',
        min: 0,
        max: 'many',
        roles: [
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
  'image.image_to_image': {
    capabilityId: 'image.image_to_image',
    defaultAdapter: 'mcp_agent',
    displayNameKey: 'operation.quickEdit.title',
    inputContracts: [
      { type: 'text', required: true, source: 'block' },
      {
        type: 'image',
        required: true,
        source: 'block',
        min: 1,
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
        requiredRoles: ['source'],
      },
    ],
    outputContracts: [{ type: 'image' }],
    paramsSchema: { aspectRatio: true, count: true, model: true, resolution: true },
    promptSource: 'block',
    supportedAdapters: ['mcp_agent', 'direct_api', 'cli_agent', 'manual_import', 'mock'],
  },
  'image.annotation_edit': {
    capabilityId: 'image.annotation_edit',
    defaultAdapter: 'mcp_agent',
    displayNameKey: 'operation.annotationEdit.title',
    inputContracts: [
      { type: 'image', required: true, source: 'block', role: 'source', min: 1, max: 1 },
      { type: 'text', required: true, source: 'inline' },
      { type: 'image', required: true, source: 'generated_asset', role: 'annotated_composite', min: 1, max: 1 },
    ],
    outputContracts: [{ type: 'image' }],
    paramsSchema: { count: true },
    promptSource: 'inline',
    supportedAdapters: ['mcp_agent', 'direct_api', 'cli_agent', 'manual_import'],
  },
  'image.local_adjust': {
    capabilityId: 'image.local_adjust',
    defaultAdapter: 'local_canvas',
    displayNameKey: 'context.adjust',
    inputContracts: [{ type: 'image', required: true, source: 'block', role: 'source', min: 1, max: 1 }],
    outputContracts: [{ type: 'image' }],
    paramsSchema: {},
    promptSource: 'inline',
    supportedAdapters: ['local_canvas'],
  },
  'image.local_crop': {
    capabilityId: 'image.local_crop',
    defaultAdapter: 'manual_import',
    displayNameKey: 'context.crop',
    inputContracts: [{ type: 'image', required: true, source: 'block', role: 'source', min: 1, max: 1 }],
    outputContracts: [{ type: 'image' }],
    paramsSchema: { aspectRatio: true },
    promptSource: 'inline',
    supportedAdapters: ['manual_import', 'mock'],
  },
  'image.local_expand': {
    capabilityId: 'image.local_expand',
    defaultAdapter: 'manual_import',
    displayNameKey: 'context.expand',
    inputContracts: [{ type: 'image', required: true, source: 'block', role: 'source', min: 1, max: 1 }],
    outputContracts: [{ type: 'image' }],
    paramsSchema: { aspectRatio: true, resolution: true },
    promptSource: 'inline',
    supportedAdapters: ['manual_import', 'mock'],
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
  return capabilitySchemas[capabilityId] ?? capabilitySchemas['image.text_to_image'];
}

export function isLocalCanvasCapability(capabilityId: unknown): boolean {
  return typeof capabilityId === 'string' && capabilitySchemas[capabilityId]?.defaultAdapter === 'local_canvas';
}

export function capabilityForImageOperation(
  operation: 'create_similar' | 'generate_image' | 'image_to_image' | 'quick_edit' | 'text_to_image',
): string {
  if (operation === 'generate_image' || operation === 'text_to_image') return 'image.text_to_image';
  return 'image.image_to_image';
}

export function connectedInputBlocks(snapshot: BoardSnapshot, operationBlockId: string): BlockRecord[] {
  const sourceBlockIds = snapshot.edges
    .filter((edge) => edge.targetBlockId === operationBlockId && edge.kind === 'execution_input')
    .map((edge) => edge.sourceBlockId);
  return sourceBlockIds
    .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
    .filter((block): block is BlockRecord => Boolean(block));
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
      : 'image.text_to_image';
  const schema = schemaForCapability(capabilityId);
  const inputEdges = snapshot.edges.filter(
    (edge) => edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input',
  );
  const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const inputBlocks = inputEdges
    .map((edge) => blockById.get(edge.sourceBlockId))
    .filter((block): block is BlockRecord => Boolean(block));
  const issues = new Set<OperationReadinessIssue>();

  for (const contract of schema.inputContracts) {
    if (!contract.required || contract.source !== 'block') continue;
    const matchingBlocks = inputBlocks.filter((block) => block.type === contract.type);
    const min = contract.min ?? 1;
    if (matchingBlocks.length < min) {
      issues.add(contract.type === 'text' ? 'text_input_missing' : 'image_input_missing');
      continue;
    }
    if (contract.type === 'text' && !promptTextFromInputs(matchingBlocks)) issues.add('prompt_empty');
    if (contract.type === 'image') {
      const assetBackedBlocks = matchingBlocks.filter((block) => typeof block.data.assetId === 'string');
      if (assetBackedBlocks.length < min) issues.add('image_asset_missing');
      const requiredRoles = [contract.role, ...(contract.requiredRoles ?? [])].filter(
        (role): role is ExecutionInputRole => Boolean(role),
      );
      for (const requiredRole of requiredRoles) {
        const hasRole = inputEdges.some((edge) => {
          const block = blockById.get(edge.sourceBlockId);
          return edge.inputRole === requiredRole && block?.type === 'image' && typeof block.data.assetId === 'string';
        });
        if (!hasRole) issues.add(requiredRole === 'source' ? 'source_image_missing' : 'image_role_missing');
      }
    }
  }

  for (const edge of inputEdges) {
    const block = blockById.get(edge.sourceBlockId);
    if (block?.type !== 'image' || typeof block.data.assetId !== 'string') continue;
    if (executionInputRoleOptionsFor(block, operationBlock).length > 0 && !edge.inputRole) {
      issues.add('image_role_missing');
    }
  }

  return { canRun: issues.size === 0, issues: [...issues] };
}

export function operationReadinessMessageKey(issue: OperationReadinessIssue) {
  if (issue === 'text_input_missing') return 'operationToolbar.textInputMissing' as const;
  if (issue === 'prompt_empty') return 'feedback.promptRequiredBody' as const;
  if (issue === 'image_input_missing') return 'operationToolbar.imageInputMissing' as const;
  if (issue === 'image_asset_missing') return 'operationToolbar.imageAssetMissing' as const;
  if (issue === 'image_role_missing') return 'operationInputRole.required' as const;
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
    const matchingBlocks = inputBlocks.filter((block) => block.type === contract.type);
    const min = contract.min ?? 1;
    if (matchingBlocks.length < min) {
      missingRequiredTypes.push(contract.type);
    }
  }

  return {
    hasImageAssetInput: inputBlocks.some((block) => block.type === 'image' && typeof block.data.assetId === 'string'),
    hasImageInput: inputBlocks.some((block) => block.type === 'image'),
    hasTextInput: Boolean(promptTextFromInputs(inputBlocks)),
    missingRequiredTypes,
  };
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

export function executionInputRoleOptionsFor(
  sourceBlock: BlockRecord,
  operationBlock: BlockRecord,
): ExecutionInputRole[] {
  if (operationBlock.type === 'video') {
    if (sourceBlock.type !== 'image') return [];
    return [
      'first_frame',
      'last_frame',
      'character_reference',
      'environment_reference',
      'general_reference',
    ];
  }
  if (operationBlock.type !== 'operation') return [];

  const capabilityId =
    typeof operationBlock.data.capabilityId === 'string' ? operationBlock.data.capabilityId : 'image.text_to_image';
  const schema = schemaForCapability(capabilityId);
  const roles = schema.inputContracts
    .filter((contract) => contract.source === 'block' && contract.type === sourceBlock.type)
    .flatMap((contract) => {
      if (contract.role) return [contract.role];
      return contract.roles ?? [];
    });

  return Array.from(new Set(roles));
}

export function disabledExecutionInputRolesFor(
  snapshot: BoardSnapshot,
  sourceBlock: BlockRecord,
  operationBlock: BlockRecord,
  currentEdgeId?: string,
): ExecutionInputRole[] {
  return executionInputRoleOptionsFor(sourceBlock, operationBlock).filter((role) => {
    const maxCount = inputRoleDefinition(role).maxCount;
    if (maxCount === 'many') return false;
    const assignedCount = snapshot.edges.filter(
      (edge) =>
        edge.edgeId !== currentEdgeId &&
        edge.kind === 'execution_input' &&
        edge.targetBlockId === operationBlock.blockId &&
        edge.inputRole === role,
    ).length;
    return assignedCount >= maxCount;
  });
}
