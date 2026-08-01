import assert from 'node:assert/strict';
import {
  validateCapabilityDefinition,
  validateCapabilityExecutionRequest,
  type CapabilityExecutionRequest,
} from '../src/core/capabilityContracts';
import {
  capabilityDefinitionFor,
  codexAppServerImageAdapterDefinition,
  volcengineArkSeedreamImageAdapterDefinition,
} from '../src/core/capabilityRegistry';
import { resolveAdapterInputProfile } from '../src/core/adapterInputProfiles';
import {
  imageGenerateCapabilityDefinition,
  imageGenerateCapabilityId,
  imageGenerateDefinitionHash,
  imageGenerateParametersSchemaRef,
  imageGenerateCapabilityVersion,
  validateImageGenerateParametersV1,
} from '../src/core/imageGenerateContracts';
import { createBlockRecord } from '../src/core/blockFactory';
import { operationReadinessFor } from '../src/core/capabilities';
import { createDraftImageGenerateOperation } from '../src/core/imageOperations';
import { createReferenceIntent } from '../src/core/referenceIntent';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { migrateBoardSnapshot } from '../src/core/snapshotMigration';
import type { BoardSnapshot } from '../src/core/types';

assert.deepEqual(validateCapabilityDefinition(imageGenerateCapabilityDefinition), []);
assert.equal(capabilityDefinitionFor(imageGenerateCapabilityId), imageGenerateCapabilityDefinition);
assert.equal(imageGenerateCapabilityDefinition.version, imageGenerateCapabilityVersion);
assert.equal(imageGenerateCapabilityDefinition.definitionHash, imageGenerateDefinitionHash);
assert.equal(imageGenerateCapabilityDefinition.parametersSchemaRef, imageGenerateParametersSchemaRef);
assert.deepEqual(
  imageGenerateCapabilityDefinition.inputSlots.map((slot) => [
    slot.slotId,
    slot.semanticRole,
    slot.cardinality,
    slot.required,
  ]),
  [
    ['prompt', 'prompt', 'one', true],
    ['source_image', 'source', 'optional', false],
    ['references', 'reference', 'many', false],
  ],
);
assert.deepEqual(
  imageGenerateCapabilityDefinition.outputSlots.map((slot) => [
    slot.slotId,
    slot.semanticRole,
    slot.dataType,
    slot.cardinality,
  ]),
  [['images', 'generated_images', 'image', 'many']],
);
assert.equal(
  resolveAdapterInputProfile(
    codexAppServerImageAdapterDefinition,
    imageGenerateCapabilityId,
    ['prompt', 'references'],
  ).profileId,
  'codex_image_generation',
);
assert.equal(
  resolveAdapterInputProfile(
    codexAppServerImageAdapterDefinition,
    imageGenerateCapabilityId,
    ['references', 'source_image', 'prompt'],
  ).profileId,
  'codex_image_edit',
);
assert.equal(
  resolveAdapterInputProfile(
    volcengineArkSeedreamImageAdapterDefinition,
    imageGenerateCapabilityId,
    ['prompt'],
  ).profileId,
  'seedream_text_to_image',
);
assert.equal(
  resolveAdapterInputProfile(
    volcengineArkSeedreamImageAdapterDefinition,
    imageGenerateCapabilityId,
    ['prompt', 'source_image', 'references'],
  ).profileId,
  'seedream_image_to_image',
);

assert.deepEqual(validateImageGenerateParametersV1({
  aspectRatioPreset: '16:9',
  model: 'provider-model',
  targetAspectRatio: 16 / 9,
  targetHeight: 2304,
  targetResolution: '4K',
  targetWidth: 4096,
  variationCount: 4,
}), []);
assert.deepEqual(validateImageGenerateParametersV1({ aspectRatioPreset: 'source' }), []);
assert.ok(validateImageGenerateParametersV1({ variationCount: 5 }).includes(
  'variationCount must be an integer from 1 to 4',
));
assert.ok(validateImageGenerateParametersV1({ targetWidth: 1024 }).includes(
  'targetWidth and targetHeight must be provided together',
));
assert.ok(validateImageGenerateParametersV1({ providerOption: true }).includes(
  'unknown parameter: providerOption',
));

const textRequest = imageGenerateRequest();
assert.deepEqual(
  validateCapabilityExecutionRequest(textRequest, imageGenerateCapabilityDefinition),
  [],
);

const sourceRequest = imageGenerateRequest();
sourceRequest.inputBindings.push({
  slotId: 'source_image',
  values: [{ kind: 'asset', assetId: 'asset_source' }],
});
sourceRequest.inputBindings.push({
  slotId: 'references',
  values: [
    {
      kind: 'asset',
      assetId: 'asset_character',
      referenceIntent: {
        schemaVersion: 1,
        label: 'Character',
        instruction: 'Preserve the character identity.',
        origin: 'user',
      },
    },
    {
      kind: 'asset',
      assetId: 'asset_style',
      referenceIntent: {
        schemaVersion: 1,
        label: 'Style',
        instruction: 'Use the lighting and color language.',
        origin: 'preset',
      },
    },
  ],
});
assert.deepEqual(
  validateCapabilityExecutionRequest(sourceRequest, imageGenerateCapabilityDefinition),
  [],
);
assert.deepEqual(
  sourceRequest.inputBindings[2]?.values.map((value) => value.kind === 'asset' ? value.assetId : undefined),
  ['asset_character', 'asset_style'],
  'reference order remains authoritative',
);

const multipleSources = structuredClone(sourceRequest);
multipleSources.inputBindings[1]!.values.push({ kind: 'asset', assetId: 'asset_source_2' });
assert.ok(validateCapabilityExecutionRequest(multipleSources, imageGenerateCapabilityDefinition)
  .some((issue) => issue.code === 'binding_cardinality_invalid'));

const sourceWithReferenceIntent = structuredClone(sourceRequest);
sourceWithReferenceIntent.inputBindings[1]!.values[0] = {
  kind: 'asset',
  assetId: 'asset_source',
  referenceIntent: {
    schemaVersion: 1,
    label: 'Source',
    instruction: 'This metadata is not allowed on the source slot.',
    origin: 'user',
  },
};
assert.ok(validateCapabilityExecutionRequest(sourceWithReferenceIntent, imageGenerateCapabilityDefinition)
  .some((issue) => issue.code === 'reference_intent_not_allowed'));

const invalidReferenceIntent = structuredClone(sourceRequest) as CapabilityExecutionRequest;
const invalidReferenceValue = invalidReferenceIntent.inputBindings[2]?.values[0] as unknown as {
  referenceIntent: Record<string, unknown>;
};
invalidReferenceValue.referenceIntent.schemaVersion = 2;
assert.ok(validateCapabilityExecutionRequest(invalidReferenceIntent, imageGenerateCapabilityDefinition)
  .some((issue) => issue.code === 'reference_intent_invalid'));

const textSnapshot = emptyBoardSnapshot();
const textDraft = createDraftImageGenerateOperation(textSnapshot, {
  operationTitle: 'Generate image',
  textBlockBody: 'Create a cinematic portrait.',
  textBlockTitle: 'Prompt',
});
assert.equal(textDraft.operationBlock.data.capabilityId, imageGenerateCapabilityId);
assert.equal(textDraft.operationBlock.data.operationMode, 'text_to_image');
assert.deepEqual(textDraft.operationBlock.data.generationParams, {
  aspectRatioPreset: '9:16',
  targetAspectRatio: 9 / 16,
});
assert.deepEqual(
  textSnapshot.edges
    .filter((edge) => edge.targetBlockId === textDraft.operationBlock.blockId)
    .map((edge) => edge.inputSlotId),
  ['prompt'],
);
assert.equal(operationReadinessFor(textSnapshot, textDraft.operationBlock).canRun, true);

const sourceSnapshot = emptyBoardSnapshot();
const sourceBlock = createBlockRecord(sourceSnapshot, 'image');
sourceBlock.blockId = 'block_source_image';
sourceBlock.data.assetId = 'asset_source_image';
sourceSnapshot.blocks.push(sourceBlock);
sourceSnapshot.assets.push({
  assetId: 'asset_source_image',
  createdAt: '2026-08-01T00:00:00.000Z',
  height: 1200,
  kind: 'image',
  mimeType: 'image/png',
  projectId: sourceSnapshot.project.projectId,
  storageKey: 'asset_source_image.png',
  storageProvider: 'local',
  width: 1600,
});
const sourceDraft = createDraftImageGenerateOperation(sourceSnapshot, {
  operationTitle: 'Generate image',
  operationVariant: 'quick_edit',
  sourceBlockId: sourceBlock.blockId,
  textBlockBody: 'Turn the scene into moonlight.',
  textBlockTitle: 'Prompt',
});
assert.equal(sourceDraft.operationBlock.data.capabilityId, imageGenerateCapabilityId);
assert.equal(sourceDraft.operationBlock.data.operationMode, 'image_to_image');
assert.deepEqual(sourceDraft.operationBlock.data.generationParams, {
  aspectRatioPreset: 'source',
  targetAspectRatio: 4 / 3,
});
assert.deepEqual(
  sourceSnapshot.edges
    .filter((edge) => edge.targetBlockId === sourceDraft.operationBlock.blockId)
    .map((edge) => edge.inputSlotId),
  ['source_image', 'prompt'],
);
assert.equal(operationReadinessFor(sourceSnapshot, sourceDraft.operationBlock).canRun, true);

const duplicateSource = createBlockRecord(sourceSnapshot, 'image');
duplicateSource.blockId = 'block_source_image_2';
duplicateSource.data.assetId = 'asset_source_image';
sourceSnapshot.blocks.push(duplicateSource);
sourceSnapshot.edges.push({
  edgeId: 'edge_duplicate_source',
  inputSlotId: 'source_image',
  kind: 'execution_input',
  sourceBlockId: duplicateSource.blockId,
  targetBlockId: sourceDraft.operationBlock.blockId,
});
assert.equal(operationReadinessFor(sourceSnapshot, sourceDraft.operationBlock).canRun, false);
sourceSnapshot.edges.pop();
const sourceEdge = sourceSnapshot.edges.find((edge) => (
  edge.targetBlockId === sourceDraft.operationBlock.blockId
  && edge.inputSlotId === 'source_image'
));
assert.ok(sourceEdge);
sourceEdge.referenceIntent = createReferenceIntent('Invalid source metadata.', 'user');
assert.equal(operationReadinessFor(sourceSnapshot, sourceDraft.operationBlock).canRun, false);

console.log(JSON.stringify({
  capabilityId: imageGenerateCapabilityId,
  definitionHash: imageGenerateDefinitionHash,
  ok: true,
  parameterSchema: imageGenerateParametersSchemaRef,
  referenceIntentBoundToReferencesOnly: true,
  slots: ['prompt', 'source_image', 'references'],
}));

function imageGenerateRequest(): CapabilityExecutionRequest {
  return {
    schemaVersion: 1,
    requestId: 'request_image_generate_001',
    scope: {
      workspaceId: 'workspace_001',
      projectId: 'project_001',
      boardId: 'board_001',
    },
    trigger: { kind: 'direct_api' },
    capabilityLock: {
      capabilityId: imageGenerateCapabilityId,
      version: imageGenerateCapabilityVersion,
      definitionHash: imageGenerateDefinitionHash,
    },
    skillLock: null,
    executionProfileId: 'image_generate_default',
    requestedAdapterId: null,
    requestedConnectionId: null,
    inputBindings: [{
      slotId: 'prompt',
      values: [{ kind: 'inline', value: 'Create a cinematic portrait.' }],
    }],
    parameters: {
      aspectRatioPreset: '9:16',
      targetResolution: '2K',
      variationCount: 1,
    },
    resultProjection: { mode: 'none' },
    actor: { actorType: 'user', actorId: 'user_001' },
    idempotencyKey: 'image_generate_001',
    createdAt: '2026-08-01T00:00:00.000Z',
  };
}

function emptyBoardSnapshot(): BoardSnapshot {
  const snapshot = migrateBoardSnapshot(structuredClone(defaultSnapshot) as BoardSnapshot);
  snapshot.blocks = [];
  snapshot.edges = [];
  snapshot.assets = [];
  snapshot.executions = [];
  return snapshot;
}
