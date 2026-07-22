import assert from 'node:assert/strict';
import {
  validateAdapterDefinition,
  validateCapabilityDefinition,
  validateCapabilityExecutionRequest,
  type AdapterDefinition,
  type CapabilityDefinition,
  type CapabilityExecutionRequest,
  type ContractValidationIssue,
} from '../src/core/capabilityContracts';
import {
  aiSdkTextAdapterDefinition,
  characterBibleCapabilityDefinition,
  codexAppServerImageAdapterDefinition,
  codexAppServerTextAdapterDefinition,
  dreaminaCliAdapterDefinition,
  seedanceModelArkAdapterDefinition,
  screenplayGenerateCapabilityDefinition,
  screenplayNormalizeCapabilityDefinition,
  sceneBibleCapabilityDefinition,
  storyboardPlanCapabilityDefinition,
  videoGenerateCapabilityDefinition,
  volcengineArkSeedreamImageAdapterDefinition,
} from '../src/core/capabilityRegistry';
import { listPackageEntryPoints } from '../src/core/packageRegistry';
import { listSkills, skillsForCapability } from '../src/core/skillRegistry';
import { definitionForLegacyCapability } from '../src/core/legacyCapabilityAdapter';

const legacyCapabilityIds = [
  'text.generate',
  'image.text_to_image',
  'image.image_to_image',
  'image.annotation_edit',
  'image.local_adjust',
  'image.local_crop',
  'image.local_expand',
  'video.first_last_frame_to_video',
] as const;

const definitions = new Map<string, CapabilityDefinition>();

assertNoIssues(validateCapabilityDefinition(videoGenerateCapabilityDefinition), 'canonical video.generate definition');
assertNoIssues(validateCapabilityDefinition(screenplayGenerateCapabilityDefinition), 'canonical screenplay generate definition');
assertNoIssues(validateCapabilityDefinition(screenplayNormalizeCapabilityDefinition), 'canonical screenplay normalize definition');
assertNoIssues(validateCapabilityDefinition(characterBibleCapabilityDefinition), 'canonical character bible definition');
assertNoIssues(validateCapabilityDefinition(sceneBibleCapabilityDefinition), 'canonical scene bible definition');
assertNoIssues(validateCapabilityDefinition(storyboardPlanCapabilityDefinition), 'canonical storyboard plan definition');
assertNoIssues(validateAdapterDefinition(codexAppServerTextAdapterDefinition), 'Codex App Server text adapter');
assertNoIssues(validateAdapterDefinition(codexAppServerImageAdapterDefinition), 'Codex App Server image adapter');
assert.deepEqual(screenplayGenerateCapabilityDefinition.inputSlots.map((slot) => slot.slotId), ['brief', 'references']);
assert.deepEqual(screenplayNormalizeCapabilityDefinition.inputSlots.map((slot) => slot.slotId), ['source_screenplay', 'normalization_instruction']);
assert.deepEqual(characterBibleCapabilityDefinition.inputSlots.map((slot) => slot.slotId), ['screenplay', 'references']);
assert.deepEqual(sceneBibleCapabilityDefinition.inputSlots.map((slot) => slot.slotId), ['screenplay', 'references']);
assert.deepEqual(storyboardPlanCapabilityDefinition.inputSlots.map((slot) => slot.slotId), ['screenplay', 'character_bible', 'scene_bible', 'references']);
assert.equal(screenplayGenerateCapabilityDefinition.outputSlots[0]?.artifactType, 'screenplay_master');
assert.equal(characterBibleCapabilityDefinition.outputSlots[0]?.artifactType, 'character_bible');
assert.equal(sceneBibleCapabilityDefinition.outputSlots[0]?.artifactType, 'scene_bible');
assert.equal(storyboardPlanCapabilityDefinition.outputSlots[0]?.artifactType, 'storyboard_plan');
assert.deepEqual(listSkills().map((skill) => skill.skillId), [
  'retake.screenplay.from-brief',
  'retake.screenplay.normalize',
  'retake.character-bible.from-screenplay',
  'retake.scene-bible.from-screenplay',
  'retake.storyboard-plan.from-production-design',
]);
assert.deepEqual(skillsForCapability('story.screenplay.generate').map((skill) => skill.skillId), ['retake.screenplay.from-brief']);
assert.deepEqual(skillsForCapability('design.character.define').map((skill) => skill.skillId), ['retake.character-bible.from-screenplay']);
assert.deepEqual(skillsForCapability('design.scene.define').map((skill) => skill.skillId), ['retake.scene-bible.from-screenplay']);
assert.deepEqual(skillsForCapability('previs.storyboard.plan').map((skill) => skill.skillId), ['retake.storyboard-plan.from-production-design']);
assert.deepEqual(listPackageEntryPoints()
  .map(({ entrypoint }) => entrypoint)
  .filter((entrypoint) => entrypoint.kind === 'skill')
  .map((entrypoint) => [entrypoint.kind, entrypoint.entrypointId]), [
  ['skill', 'skill:retake.screenplay.from-brief'],
  ['skill', 'skill:retake.screenplay.normalize'],
  ['skill', 'skill:retake.character-bible.from-screenplay'],
  ['skill', 'skill:retake.scene-bible.from-screenplay'],
  ['skill', 'skill:retake.storyboard-plan.from-production-design'],
]);

for (const capabilityId of legacyCapabilityIds) {
  const definition = definitionForLegacyCapability(capabilityId);
  assertNoIssues(validateCapabilityDefinition(definition), `legacy definition ${capabilityId}`);
  definitions.set(capabilityId, definition);
}

const textToImage = requiredDefinition('image.text_to_image');
assert.deepEqual(textToImage.inputSlots.map((slot) => slot.slotId), ['prompt', 'references']);
assert.equal(requiredSlot(textToImage, 'prompt').cardinality, 'one');
assert.equal(requiredSlot(textToImage, 'references').cardinality, 'many');
assert.equal(requiredOutputSlot(textToImage, 'images').cardinality, 'many');

const textGenerate = requiredDefinition('text.generate');
assert.deepEqual(textGenerate.inputSlots.map((slot) => slot.slotId), ['prompt']);
assert.deepEqual(textGenerate.outputSlots.map((slot) => slot.slotId), ['documents']);
assert.equal(requiredOutputSlot(textGenerate, 'documents').artifactType, 'markdown_document');
assert.equal(requiredOutputSlot(textGenerate, 'documents').dataType, 'document');
assert.deepEqual(requiredOutputSlot(textGenerate, 'documents').projectionBlockTypes, ['document']);
assert.deepEqual(textGenerate.supportedAdapterClasses, ['text.generate', 'agent_runtime.text', 'manual.import']);

const imageToImage = requiredDefinition('image.image_to_image');
assert.deepEqual(imageToImage.inputSlots.map((slot) => slot.slotId), ['prompt', 'source_image', 'references']);
assert.deepEqual(requiredSlot(imageToImage, 'source_image').bindingKinds, ['block', 'asset', 'artifact_revision']);
assert.equal(requiredSlot(imageToImage, 'source_image').required, true);
assert.equal(requiredSlot(imageToImage, 'references').required, false);

const annotationEdit = requiredDefinition('image.annotation_edit');
assert.deepEqual(annotationEdit.inputSlots.map((slot) => slot.slotId), ['source', 'prompt', 'annotated_composite']);
assert.deepEqual(requiredSlot(annotationEdit, 'prompt').bindingKinds, ['inline']);
assert.deepEqual(requiredSlot(annotationEdit, 'annotated_composite').bindingKinds, ['asset']);

const videoDefinition = requiredDefinition('video.first_last_frame_to_video');
assert.deepEqual(videoDefinition.inputSlots.map((slot) => slot.slotId), ['prompt', 'first_frame', 'last_frame']);
assert.deepEqual(videoDefinition.outputSlots.map((slot) => slot.slotId), ['videos']);
assert.equal(requiredOutputSlot(videoDefinition, 'videos').cardinality, 'one');

const videoRequest: CapabilityExecutionRequest = {
  schemaVersion: 1,
  requestId: 'request_video_001',
  scope: {
    workspaceId: 'workspace_001',
    projectId: 'project_001',
    boardId: 'board_001',
  },
  trigger: {
    kind: 'video_block_shortcut',
    sourceBlockId: 'video_block_001',
  },
  capabilityLock: {
    capabilityId: videoDefinition.capabilityId,
    version: videoDefinition.version,
    definitionHash: videoDefinition.definitionHash,
  },
  skillLock: null,
  executionProfileId: 'video_preview_default',
  requestedAdapterId: null,
  inputBindings: [
    {
      slotId: 'prompt',
      values: [{ kind: 'block', blockId: 'prompt_block_001' }],
    },
    {
      slotId: 'first_frame',
      values: [{ kind: 'asset', assetId: 'asset_first_001', blockId: 'image_block_first' }],
    },
    {
      slotId: 'last_frame',
      values: [{ kind: 'asset', assetId: 'asset_last_001', blockId: 'image_block_last' }],
    },
  ],
  parameters: {
    duration: 15,
    qualityTier: 'preview',
  },
  resultProjection: {
    mode: 'target_and_siblings',
    targetBlockId: 'video_block_001',
  },
  actor: {
    actorType: 'user',
    actorId: 'user_001',
  },
  idempotencyKey: 'video_block_001:generate:001',
  createdAt: '2026-07-20T08:00:00.000Z',
};

assertNoIssues(validateCapabilityExecutionRequest(videoRequest, videoDefinition), 'valid video request');

const missingPromptRequest = structuredClone(videoRequest);
missingPromptRequest.inputBindings = missingPromptRequest.inputBindings.filter((binding) => binding.slotId !== 'prompt');
assertHasIssue(
  validateCapabilityExecutionRequest(missingPromptRequest, videoDefinition),
  'required_input_missing',
  'request without prompt',
);

const unknownSlotRequest = structuredClone(videoRequest);
unknownSlotRequest.inputBindings.push({
  slotId: 'unsupported_input',
  values: [{ kind: 'inline', value: 'unexpected' }],
});
assertHasIssue(
  validateCapabilityExecutionRequest(unknownSlotRequest, videoDefinition),
  'input_slot_unknown',
  'request with unknown slot',
);

const disallowedBindingRequest = structuredClone(videoRequest);
disallowedBindingRequest.inputBindings[0] = {
  slotId: 'prompt',
  values: [{ kind: 'inline', value: 'prompt outside its declared binding contract' }],
};
assertHasIssue(
  validateCapabilityExecutionRequest(disallowedBindingRequest, videoDefinition),
  'binding_kind_not_allowed',
  'request with disallowed binding kind',
);

const invalidTriggerRequest = structuredClone(videoRequest) as CapabilityExecutionRequest & {
  trigger: { kind: string };
};
invalidTriggerRequest.trigger = { kind: 'provider_cli' };
assertHasIssue(
  validateCapabilityExecutionRequest(invalidTriggerRequest, videoDefinition),
  'trigger_invalid',
  'request with adapter route used as trigger',
);

const providerCliAdapter: AdapterDefinition = {
  schemaVersion: 1,
  adapterId: 'video.seedance_cli',
  version: '0.1.0',
  definitionHash: 'sha256:test-provider-cli-adapter',
  adapterClass: 'video.generate',
  routeKind: 'provider_cli',
  provider: 'seedance',
  supportedCapabilityIds: ['video.first_last_frame_to_video'],
  inputProfiles: [
    {
      profileId: 'first_last_frame',
      requiredSlots: ['prompt', 'first_frame', 'last_frame'],
      optionalSlots: [],
    },
  ],
  constraints: {
    maxDurationSeconds: 15,
  },
  executionBinding: {
    pluginId: 'retake.seedance-cli',
    executableRef: 'seedance.generate-video',
    transport: 'stdio_json',
  },
  availability: 'installed',
};

assertNoIssues(validateAdapterDefinition(providerCliAdapter), 'valid provider_cli adapter');
assertNoIssues(validateAdapterDefinition(aiSdkTextAdapterDefinition), 'valid AI SDK text adapter');
assertNoIssues(validateAdapterDefinition(seedanceModelArkAdapterDefinition), 'valid Seedance ModelArk adapter');
assertNoIssues(validateAdapterDefinition(dreaminaCliAdapterDefinition), 'valid Dreamina CLI adapter');
assertNoIssues(validateAdapterDefinition(volcengineArkSeedreamImageAdapterDefinition), 'valid Volcengine Ark Seedream image adapter');

const unboundProviderCliAdapter = structuredClone(providerCliAdapter);
delete unboundProviderCliAdapter.executionBinding;
assertHasIssue(
  validateAdapterDefinition(unboundProviderCliAdapter),
  'provider_cli_binding_missing',
  'provider_cli without controlled execution binding',
);

const duplicateSlotDefinition = structuredClone(videoDefinition);
duplicateSlotDefinition.outputSlots[0].slotId = duplicateSlotDefinition.inputSlots[0].slotId;
assertHasIssue(
  validateCapabilityDefinition(duplicateSlotDefinition),
  'slot_id_duplicate',
  'definition with duplicate slot id',
);

console.log(JSON.stringify({
  ok: true,
  validatedLegacyCapabilities: legacyCapabilityIds.length,
  requestContract: videoDefinition.capabilityId,
  providerCliBindingRequired: true,
}));

function requiredDefinition(capabilityId: string): CapabilityDefinition {
  const definition = definitions.get(capabilityId);
  assert.ok(definition, `Expected definition for ${capabilityId}.`);
  return definition;
}

function requiredSlot(definition: CapabilityDefinition, slotId: string) {
  const slot = definition.inputSlots.find((entry) => entry.slotId === slotId);
  assert.ok(slot, `Expected input slot ${slotId} on ${definition.capabilityId}.`);
  return slot;
}

function requiredOutputSlot(definition: CapabilityDefinition, slotId: string) {
  const slot = definition.outputSlots.find((entry) => entry.slotId === slotId);
  assert.ok(slot, `Expected output slot ${slotId} on ${definition.capabilityId}.`);
  return slot;
}

function assertNoIssues(issues: ContractValidationIssue[], label: string): void {
  assert.deepEqual(issues, [], `${label} should be valid:\n${formatIssues(issues)}`);
}

function assertHasIssue(issues: ContractValidationIssue[], code: string, label: string): void {
  assert.ok(issues.some((entry) => entry.code === code), `${label} should include ${code}:\n${formatIssues(issues)}`);
}

function formatIssues(issues: ContractValidationIssue[]): string {
  return issues.map((entry) => `${entry.code} ${entry.path}: ${entry.message}`).join('\n');
}
