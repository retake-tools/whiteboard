import type { AdapterDefinition, CapabilityDefinition } from './capabilityContracts';
import { definitionForLegacyCapability } from './legacyCapabilityAdapter';

export const textGenerateCapabilityDefinition: CapabilityDefinition = definitionForLegacyCapability('text.generate');

export const screenplayGenerateCapabilityDefinition: CapabilityDefinition = {
  schemaVersion: 1,
  capabilityId: 'story.screenplay.generate',
  version: '0.1.0',
  definitionHash: 'sha256:retake-story-screenplay-generate-v1',
  category: 'story_development',
  displayName: 'Generate screenplay',
  inputSlots: [
    {
      slotId: 'brief',
      semanticRole: 'creative_brief',
      dataTypes: ['text', 'document'],
      artifactTypes: ['creative_brief'],
      cardinality: 'one',
      required: true,
      bindingKinds: ['inline', 'block', 'asset', 'artifact_revision'],
    },
    {
      slotId: 'references',
      semanticRole: 'reference',
      dataTypes: ['text', 'document'],
      artifactTypes: ['reference'],
      cardinality: 'many',
      required: false,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
  ],
  outputSlots: [{
    slotId: 'screenplay',
    semanticRole: 'screenplay',
    dataType: 'document',
    artifactType: 'screenplay_master',
    schemaRef: 'retake.screenplay-markdown/v1',
    cardinality: 'one',
    projectionBlockTypes: ['document'],
  }],
  runtimeRequirements: ['text_generation', 'durable_asset_output'],
  supportedAdapterClasses: ['text.document', 'agent_runtime.text'],
};

export const screenplayNormalizeCapabilityDefinition: CapabilityDefinition = {
  schemaVersion: 1,
  capabilityId: 'story.screenplay.normalize',
  version: '0.1.0',
  definitionHash: 'sha256:retake-story-screenplay-normalize-v1',
  category: 'story_development',
  displayName: 'Organize screenplay',
  inputSlots: [
    {
      slotId: 'source_screenplay',
      semanticRole: 'source_screenplay',
      dataTypes: ['text', 'document'],
      artifactTypes: ['screenplay_master'],
      cardinality: 'one',
      required: true,
      bindingKinds: ['inline', 'block', 'asset', 'artifact_revision'],
    },
    {
      slotId: 'normalization_instruction',
      semanticRole: 'instruction',
      dataTypes: ['text', 'document'],
      artifactTypes: [],
      cardinality: 'optional',
      required: false,
      bindingKinds: ['inline', 'block', 'asset', 'artifact_revision'],
    },
  ],
  outputSlots: [{
    slotId: 'screenplay',
    semanticRole: 'screenplay',
    dataType: 'document',
    artifactType: 'screenplay_master',
    schemaRef: 'retake.screenplay-markdown/v1',
    cardinality: 'one',
    projectionBlockTypes: ['document'],
  }],
  runtimeRequirements: ['text_generation', 'durable_asset_output'],
  supportedAdapterClasses: ['text.document', 'agent_runtime.text'],
};

export const characterBibleCapabilityDefinition: CapabilityDefinition = {
  schemaVersion: 1,
  capabilityId: 'design.character.define',
  version: '0.1.0',
  definitionHash: 'sha256:retake-design-character-define-v1',
  category: 'production_design',
  displayName: 'Define characters',
  inputSlots: [
    {
      slotId: 'screenplay',
      semanticRole: 'screenplay',
      dataTypes: ['text', 'document'],
      artifactTypes: ['screenplay_master'],
      cardinality: 'one',
      required: true,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
    {
      slotId: 'references',
      semanticRole: 'reference',
      dataTypes: ['text', 'document'],
      artifactTypes: ['character_reference', 'reference'],
      cardinality: 'many',
      required: false,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
  ],
  outputSlots: [{
    slotId: 'character_bible',
    semanticRole: 'character_bible',
    dataType: 'document',
    artifactType: 'character_bible',
    schemaRef: 'retake.character-bible-markdown/v1',
    cardinality: 'one',
    projectionBlockTypes: ['document'],
  }],
  runtimeRequirements: ['text_generation', 'durable_asset_output'],
  supportedAdapterClasses: ['text.document', 'agent_runtime.text'],
};

export const sceneBibleCapabilityDefinition: CapabilityDefinition = {
  schemaVersion: 1,
  capabilityId: 'design.scene.define',
  version: '0.1.0',
  definitionHash: 'sha256:retake-design-scene-define-v1',
  category: 'production_design',
  displayName: 'Define scenes',
  inputSlots: [
    {
      slotId: 'screenplay',
      semanticRole: 'screenplay',
      dataTypes: ['text', 'document'],
      artifactTypes: ['screenplay_master'],
      cardinality: 'one',
      required: true,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
    {
      slotId: 'references',
      semanticRole: 'reference',
      dataTypes: ['text', 'document'],
      artifactTypes: ['scene_reference', 'reference'],
      cardinality: 'many',
      required: false,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
  ],
  outputSlots: [{
    slotId: 'scene_bible',
    semanticRole: 'scene_bible',
    dataType: 'document',
    artifactType: 'scene_bible',
    schemaRef: 'retake.scene-bible-markdown/v1',
    cardinality: 'one',
    projectionBlockTypes: ['document'],
  }],
  runtimeRequirements: ['text_generation', 'durable_asset_output'],
  supportedAdapterClasses: ['text.document', 'agent_runtime.text'],
};

const canonicalCapabilityDefinitions = [
  textGenerateCapabilityDefinition,
  screenplayGenerateCapabilityDefinition,
  screenplayNormalizeCapabilityDefinition,
  characterBibleCapabilityDefinition,
  sceneBibleCapabilityDefinition,
] as const;

export const textDocumentCapabilityIds = canonicalCapabilityDefinitions
  .filter((definition) => definition.outputSlots.some((slot) => slot.dataType === 'document'))
  .filter((definition) => definition.supportedAdapterClasses.some(
    (adapterClass) => adapterClass === 'text.generate' || adapterClass === 'text.document' || adapterClass === 'agent_runtime.text',
  ))
  .map((definition) => definition.capabilityId);

export const aiSdkTextAdapterDefinition: AdapterDefinition = {
  schemaVersion: 1,
  adapterId: 'retake.text.ai-sdk',
  version: '0.2.0',
  definitionHash: 'sha256:retake-text-ai-sdk-v1',
  adapterClass: 'text.document',
  routeKind: 'direct_api',
  supportedCapabilityIds: textDocumentCapabilityIds,
  inputProfiles: [
    { profileId: 'text_prompt', requiredSlots: ['prompt'], optionalSlots: [] },
    { profileId: 'screenplay_from_brief', requiredSlots: ['brief'], optionalSlots: ['references'] },
    { profileId: 'screenplay_normalize', requiredSlots: ['source_screenplay'], optionalSlots: ['normalization_instruction'] },
    { profileId: 'character_bible_from_screenplay', requiredSlots: ['screenplay'], optionalSlots: ['references'] },
    { profileId: 'scene_bible_from_screenplay', requiredSlots: ['screenplay'], optionalSlots: ['references'] },
  ],
  constraints: {
    outputCount: { min: 1, max: 1 },
    durableAssetOutput: true,
    outputMimeType: 'text/markdown',
  },
  credentialRefType: 'provider_api_key',
  availability: 'installed',
};

export const codexAppServerTextAdapterDefinition: AdapterDefinition = {
  schemaVersion: 1,
  adapterId: 'retake.text.codex-app-server',
  version: '0.2.0',
  definitionHash: 'sha256:retake-text-codex-app-server-v1',
  adapterClass: 'agent_runtime.text',
  routeKind: 'codex_app_server',
  provider: 'codex',
  supportedCapabilityIds: textDocumentCapabilityIds,
  inputProfiles: [
    { profileId: 'text_prompt', requiredSlots: ['prompt'], optionalSlots: [] },
    { profileId: 'screenplay_from_brief', requiredSlots: ['brief'], optionalSlots: ['references'] },
    { profileId: 'screenplay_normalize', requiredSlots: ['source_screenplay'], optionalSlots: ['normalization_instruction'] },
    { profileId: 'character_bible_from_screenplay', requiredSlots: ['screenplay'], optionalSlots: ['references'] },
    { profileId: 'scene_bible_from_screenplay', requiredSlots: ['screenplay'], optionalSlots: ['references'] },
  ],
  constraints: {
    outputCount: { min: 1, max: 1 },
    durableAssetOutput: true,
    outputMimeType: 'text/markdown',
    streamedText: true,
  },
  availability: 'installed',
};

export const codexAppServerImageAdapterDefinition: AdapterDefinition = {
  schemaVersion: 1,
  adapterId: 'retake.image.codex-app-server',
  version: '0.1.0',
  definitionHash: 'sha256:retake-image-codex-app-server-v0',
  adapterClass: 'agent_runtime.media',
  routeKind: 'codex_app_server',
  provider: 'codex',
  supportedCapabilityIds: ['image.text_to_image', 'image.image_to_image', 'image.annotation_edit'],
  inputProfiles: [
    {
      profileId: 'codex_image_generation',
      requiredSlots: ['prompt'],
      optionalSlots: ['references'],
    },
    {
      profileId: 'codex_image_edit',
      requiredSlots: ['prompt', 'source_image'],
      optionalSlots: ['references'],
    },
    {
      profileId: 'codex_annotation_edit',
      requiredSlots: ['prompt', 'source_image'],
      optionalSlots: ['references'],
    },
  ],
  constraints: {
    outputCount: { min: 1, max: 4 },
    durableAssetOutput: true,
    builtInTool: 'imagegen',
  },
  availability: 'installed',
};

export const videoGenerateCapabilityDefinition: CapabilityDefinition = {
  schemaVersion: 1,
  capabilityId: 'video.generate',
  version: '0.1.0',
  definitionHash: 'sha256:retake-video-generate-v0',
  category: 'video_generation',
  displayName: 'Generate video',
  inputSlots: [
    {
      slotId: 'prompt',
      semanticRole: 'prompt',
      dataTypes: ['text', 'document'],
      artifactTypes: [],
      cardinality: 'one',
      required: true,
      bindingKinds: ['inline', 'block', 'asset', 'artifact_revision'],
    },
    {
      slotId: 'first_frame',
      semanticRole: 'first_frame',
      dataTypes: ['image'],
      artifactTypes: ['image', 'character_reference', 'scene_reference'],
      cardinality: 'optional',
      required: false,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
    {
      slotId: 'last_frame',
      semanticRole: 'last_frame',
      dataTypes: ['image'],
      artifactTypes: ['image', 'character_reference', 'scene_reference'],
      cardinality: 'optional',
      required: false,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
    {
      slotId: 'character_references',
      semanticRole: 'character_reference',
      dataTypes: ['image'],
      artifactTypes: ['character_reference'],
      cardinality: 'many',
      required: false,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
    {
      slotId: 'scene_references',
      semanticRole: 'scene_reference',
      dataTypes: ['image'],
      artifactTypes: ['scene_reference'],
      cardinality: 'many',
      required: false,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
    {
      slotId: 'general_references',
      semanticRole: 'general_reference',
      dataTypes: ['image', 'video', 'audio'],
      artifactTypes: [],
      cardinality: 'many',
      required: false,
      bindingKinds: ['block', 'asset', 'artifact_revision'],
    },
  ],
  outputSlots: [
    {
      slotId: 'videos',
      semanticRole: 'generated_video',
      dataType: 'video',
      artifactType: 'video_clip',
      schemaRef: 'retake.video-set/v1',
      cardinality: 'many',
      projectionBlockTypes: ['video'],
    },
  ],
  parametersSchemaRef: 'retake.params.video.generate/v1',
  runtimeRequirements: ['video_generation', 'durable_asset_output'],
  supportedAdapterClasses: ['video.generate', 'agent_runtime.video'],
};

export const mockVideoAdapterDefinition: AdapterDefinition = {
  schemaVersion: 1,
  adapterId: 'retake.video.mock',
  version: '0.1.0',
  definitionHash: 'sha256:retake-video-mock-v0',
  adapterClass: 'video.generate',
  routeKind: 'local',
  provider: 'retake-mock',
  model: 'contract-placeholder',
  supportedCapabilityIds: ['video.generate'],
  inputProfiles: [
    {
      profileId: 'flexible_video_input',
      requiredSlots: ['prompt'],
      optionalSlots: [
        'first_frame',
        'last_frame',
        'character_references',
        'scene_references',
        'general_references',
      ],
    },
  ],
  constraints: {
    durationRangeSeconds: { min: 4, max: 15 },
    outputCount: { min: 1, max: 4 },
    mockOnly: true,
  },
  availability: 'installed',
};

export const seedanceModelArkAdapterDefinition: AdapterDefinition = {
  schemaVersion: 1,
  adapterId: 'retake.video.seedance-modelark',
  version: '0.1.0',
  definitionHash: 'sha256:retake-video-seedance-modelark-v0',
  adapterClass: 'video.generate',
  routeKind: 'direct_api',
  provider: 'byteplus-modelark',
  model: 'dreamina-seedance-2-0-260128',
  supportedCapabilityIds: ['video.generate'],
  inputProfiles: [
    {
      profileId: 'seedance_2_multimodal_video',
      requiredSlots: ['prompt'],
      optionalSlots: [
        'first_frame',
        'last_frame',
        'character_references',
        'scene_references',
        'general_references',
      ],
    },
  ],
  constraints: {
    durationRangeSeconds: { min: 4, max: 15 },
    outputCount: { min: 1, max: 4 },
    imageReferenceCount: { min: 0, max: 9 },
    asynchronous: true,
    cancellation: 'queued_only',
    durableAssetOutput: true,
  },
  credentialRefType: 'modelark_api_key',
  availability: 'installed',
};

export const dreaminaCliAdapterDefinition: AdapterDefinition = {
  schemaVersion: 1,
  adapterId: 'retake.video.dreamina-cli',
  version: '0.1.0',
  definitionHash: 'sha256:retake-video-dreamina-cli-v0',
  adapterClass: 'video.generate',
  routeKind: 'provider_cli',
  provider: 'dreamina',
  model: 'seedance2.0_vip',
  supportedCapabilityIds: ['video.generate'],
  inputProfiles: [
    {
      profileId: 'dreamina_cli_video',
      requiredSlots: ['prompt'],
      optionalSlots: [
        'first_frame',
        'last_frame',
        'character_references',
        'scene_references',
        'general_references',
      ],
    },
  ],
  constraints: {
    durationRangeSeconds: { min: 4, max: 15 },
    outputCount: { min: 1, max: 4 },
    imageReferenceCount: { min: 0, max: 9 },
    asynchronous: true,
    cancellation: 'local_only',
    durableAssetOutput: true,
    allowedExecutableRef: 'dreamina',
    allowedSubcommands: ['text2video', 'image2video', 'frames2video', 'multimodal2video', 'query_result'],
  },
  executionBinding: {
    pluginId: 'retake.video.dreamina-cli',
    executableRef: 'dreamina',
    transport: 'stdio_json',
  },
  credentialRefType: 'dreamina_oauth_session',
  availability: 'installed',
};

export const volcengineArkSeedreamImageAdapterDefinition: AdapterDefinition = {
  schemaVersion: 1,
  adapterId: 'retake.image.volcengine-ark-seedream',
  version: '0.1.0',
  definitionHash: 'sha256:retake-image-volcengine-ark-seedream-v0',
  adapterClass: 'image.generate',
  routeKind: 'direct_api',
  provider: 'volcengine-ark',
  model: 'doubao-seedream-5-0-260128',
  supportedCapabilityIds: ['image.text_to_image', 'image.image_to_image'],
  inputProfiles: [
    {
      profileId: 'seedream_text_to_image',
      requiredSlots: ['prompt'],
      optionalSlots: ['references'],
    },
    {
      profileId: 'seedream_image_to_image',
      requiredSlots: ['prompt', 'source_image'],
      optionalSlots: ['references'],
    },
  ],
  constraints: {
    outputCount: { min: 1, max: 4 },
    referenceImageCount: { min: 0, max: 10 },
    resolutions: ['1K', '2K', '4K'],
    sequentialImageGeneration: false,
    durableAssetOutput: true,
  },
  credentialRefType: 'volcengine_ark_api_key',
  availability: 'installed',
};

export function capabilityDefinitionFor(capabilityId: string): CapabilityDefinition {
  const canonicalDefinition = canonicalCapabilityDefinitions.find(
    (definition) => definition.capabilityId === capabilityId,
  );
  if (canonicalDefinition) return canonicalDefinition;
  if (capabilityId === videoGenerateCapabilityDefinition.capabilityId) return videoGenerateCapabilityDefinition;
  return definitionForLegacyCapability(capabilityId);
}

export function isTextDocumentCapability(capabilityId: string): boolean {
  try {
    const definition = capabilityDefinitionFor(capabilityId);
    return definition.outputSlots.some((slot) => slot.dataType === 'document')
      && definition.supportedAdapterClasses.some(
        (adapterClass) => adapterClass === 'text.generate' || adapterClass === 'text.document' || adapterClass === 'agent_runtime.text',
      );
  } catch {
    return false;
  }
}
