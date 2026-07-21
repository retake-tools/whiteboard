import type { AdapterDefinition, CapabilityDefinition } from './capabilityContracts';
import { definitionForLegacyCapability } from './legacyCapabilityAdapter';

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

export function capabilityDefinitionFor(capabilityId: string): CapabilityDefinition {
  if (capabilityId === videoGenerateCapabilityDefinition.capabilityId) return videoGenerateCapabilityDefinition;
  return definitionForLegacyCapability(capabilityId);
}
