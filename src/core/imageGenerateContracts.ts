import type { CapabilityDefinition } from './capabilityContracts';

export const imageGenerateCapabilityId = 'image.generate';
export const imageGenerateCapabilityVersion = '0.1.0';
export const imageGenerateDefinitionHash = 'sha256:retake-image-generate-v1';
export const imageGenerateParametersSchemaRef = 'retake.params.image.generate/v1';

export const imageGenerateAspectRatioPresets = [
  'source',
  '1:1',
  '16:9',
  '9:16',
  '4:3',
  '3:4',
  '3:2',
  '2:3',
] as const;

export const imageGenerateResolutionPresets = ['1K', '2K', '4K'] as const;

export type ImageGenerateAspectRatioPreset = typeof imageGenerateAspectRatioPresets[number];
export type ImageGenerateResolutionPreset = typeof imageGenerateResolutionPresets[number];

export interface ImageGenerateParametersV1 {
  aspectRatioPreset?: ImageGenerateAspectRatioPreset;
  model?: string;
  targetAspectRatio?: number;
  targetHeight?: number;
  targetResolution?: ImageGenerateResolutionPreset;
  targetWidth?: number;
  variationCount?: number;
}

export const imageGenerateCapabilityDefinition: CapabilityDefinition = {
  schemaVersion: 1,
  capabilityId: imageGenerateCapabilityId,
  version: imageGenerateCapabilityVersion,
  definitionHash: imageGenerateDefinitionHash,
  category: 'image_generation',
  displayName: 'Generate image',
  inputSlots: [
    {
      slotId: 'prompt',
      semanticRole: 'prompt',
      dataTypes: ['text'],
      artifactTypes: [],
      cardinality: 'one',
      required: true,
      bindingKinds: ['inline', 'block'],
    },
    {
      slotId: 'source_image',
      semanticRole: 'source',
      dataTypes: ['image'],
      artifactTypes: ['image'],
      cardinality: 'optional',
      required: false,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
    {
      slotId: 'references',
      semanticRole: 'reference',
      dataTypes: ['image'],
      artifactTypes: [],
      cardinality: 'many',
      required: false,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
  ],
  outputSlots: [{
    slotId: 'images',
    semanticRole: 'generated_images',
    dataType: 'image',
    artifactType: 'image',
    schemaRef: 'retake.image-set/v1',
    cardinality: 'many',
    projectionBlockTypes: ['image'],
  }],
  parametersSchemaRef: imageGenerateParametersSchemaRef,
  runtimeRequirements: [
    'image_generation',
    'optional_source_image',
    'ordered_reference_images',
    'multi_candidate_output',
    'durable_asset_output',
  ],
  supportedAdapterClasses: ['image.generate', 'agent_runtime.media', 'manual.import'],
};

export function validateImageGenerateParametersV1(input: unknown): string[] {
  if (!isRecord(input)) return ['parameters must be an object'];
  const issues: string[] = [];
  const allowedKeys = new Set<keyof ImageGenerateParametersV1>([
    'aspectRatioPreset',
    'model',
    'targetAspectRatio',
    'targetHeight',
    'targetResolution',
    'targetWidth',
    'variationCount',
  ]);
  for (const key of Object.keys(input)) {
    if (!allowedKeys.has(key as keyof ImageGenerateParametersV1)) {
      issues.push(`unknown parameter: ${key}`);
    }
  }
  if (
    input.aspectRatioPreset !== undefined
    && !imageGenerateAspectRatioPresets.includes(input.aspectRatioPreset as ImageGenerateAspectRatioPreset)
  ) {
    issues.push('aspectRatioPreset is not supported');
  }
  if (input.targetResolution !== undefined
    && !imageGenerateResolutionPresets.includes(input.targetResolution as ImageGenerateResolutionPreset)) {
    issues.push('targetResolution is not supported');
  }
  if (input.model !== undefined && (typeof input.model !== 'string' || !input.model.trim())) {
    issues.push('model must be a non-empty string');
  }
  if (input.targetAspectRatio !== undefined && !isPositiveNumber(input.targetAspectRatio)) {
    issues.push('targetAspectRatio must be a positive number');
  }
  if (input.targetWidth !== undefined && !isPositiveInteger(input.targetWidth)) {
    issues.push('targetWidth must be a positive integer');
  }
  if (input.targetHeight !== undefined && !isPositiveInteger(input.targetHeight)) {
    issues.push('targetHeight must be a positive integer');
  }
  if ((input.targetWidth === undefined) !== (input.targetHeight === undefined)) {
    issues.push('targetWidth and targetHeight must be provided together');
  }
  if (
    input.variationCount !== undefined
    && !isIntegerInRange(input.variationCount, 1, 4)
  ) {
    issues.push('variationCount must be an integer from 1 to 4');
  }
  return issues;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isIntegerInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= minimum
    && value <= maximum;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
