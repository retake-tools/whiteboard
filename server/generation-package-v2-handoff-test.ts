import assert from 'node:assert/strict';
import { assertValidCreateOrAdvanceArtifactCommand } from '../src/core/artifactContracts';
import { generationPreparationCapabilityDefinition } from '../src/core/capabilityRegistry';
import {
  defaultGenerationPreparationParameters,
  generationPackageArtifactMetadata,
  GenerationPackageHandoffError,
  type GenerationReferenceManifest,
  isVideoGenerationPackageArtifactRevisionMetadata,
  isVideoGenerationPackageArtifactRevisionMetadataV1,
  isVideoGenerationPackageArtifactRevisionMetadataV2,
  referenceManifestDigest,
  requireVideoGenerationPackageArtifactRevisionMetadataV2,
  type VideoGenerationPackageArtifactRevisionMetadataV1,
} from '../src/core/generationPreparationContracts';
import { storyProductionStarterPackage } from '../src/core/packageRegistry';
import { videoGenerationPackageFromApprovedStoryboardSkill } from '../src/core/skillRegistry';
import { storyboardSheetArtifactMetadata } from '../src/core/storyboardSheetContracts';
import { storyboardUnitToGenerationPackageWorkflow } from '../src/core/workflowRegistry';

const referenceManifest: GenerationReferenceManifest = {
  schemaRef: 'retake.generation-reference-manifest/v1',
  items: [
    {
      requirementId: 'hero_identity',
      role: 'character_identity',
      required: true,
      bindingIdentity: 'asset:asset_hero',
      subjectId: 'character_hero',
      subjectLabel: 'Hero Cat',
      purpose: 'Preserve the hero identity across every storyboard panel.',
    },
    {
      requirementId: 'station_scene',
      role: 'scene',
      required: false,
      bindingIdentity: 'artifact_revision:artifact_revision_station',
      purpose: 'Preserve the station layout when the reference remains available.',
    },
  ],
};
const storyboardSheetMetadata = storyboardSheetArtifactMetadata({
  unitId: 'U03',
  parameters: {
    gridLayout: '4x2',
    outputCount: 1,
    panelAspectRatio: '16:9',
    panelCount: 8,
    renderMode: 'panel_grid',
  },
});
const metadataV2 = generationPackageArtifactMetadata({
  parameters: {
    ...defaultGenerationPreparationParameters,
    aspectRatio: '16:9',
    durationSeconds: 8,
  },
  referenceManifest,
  storyboardSheetArtifactRevisionId: 'artifact_revision_storyboard_sheet',
  storyboardSheetMetadata,
  unitId: 'U03',
});

assert.equal(metadataV2.schemaRef, 'retake.video-generation-package-metadata/v2');
assert.deepEqual(metadataV2.referenceManifest, referenceManifest);
assert.notEqual(metadataV2.referenceManifest, referenceManifest);
assert.equal(metadataV2.referenceManifestDigest, referenceManifestDigest(referenceManifest));
assert.equal(metadataV2.referenceCount, 2);
assert.equal(metadataV2.requiredReferenceCount, 1);
assert.equal(isVideoGenerationPackageArtifactRevisionMetadata(metadataV2), true);
assert.equal(isVideoGenerationPackageArtifactRevisionMetadataV1(metadataV2), false);
assert.equal(isVideoGenerationPackageArtifactRevisionMetadataV2(metadataV2), true);
assert.equal(requireVideoGenerationPackageArtifactRevisionMetadataV2(metadataV2), metadataV2);

referenceManifest.items[0]!.purpose = 'The source manifest changed after handoff.';
assert.notEqual(metadataV2.referenceManifest.items[0]?.purpose, referenceManifest.items[0]?.purpose);

const metadataV1: VideoGenerationPackageArtifactRevisionMetadataV1 = {
  ...metadataV2,
  schemaRef: 'retake.video-generation-package-metadata/v1',
};
delete (metadataV1 as Partial<typeof metadataV2>).referenceManifest;
assert.equal(isVideoGenerationPackageArtifactRevisionMetadata(metadataV1), true);
assert.equal(isVideoGenerationPackageArtifactRevisionMetadataV1(metadataV1), true);
assert.equal(isVideoGenerationPackageArtifactRevisionMetadataV2(metadataV1), false);
assert.throws(
  () => requireVideoGenerationPackageArtifactRevisionMetadataV2(metadataV1),
  (error) => error instanceof GenerationPackageHandoffError
    && error.code === 'generation_video_package_manifest_snapshot_required'
    && /regenerated as V2/.test(error.message),
);

const digestMismatch = {
  ...metadataV2,
  referenceManifestDigest: 'fnv1a:00000000',
};
assert.equal(isVideoGenerationPackageArtifactRevisionMetadataV2(digestMismatch), false);
assert.throws(
  () => requireVideoGenerationPackageArtifactRevisionMetadataV2(digestMismatch),
  (error) => error instanceof GenerationPackageHandoffError
    && error.code === 'generation_video_package_invalid',
);
const nonNormalizedManifest = {
  ...metadataV2,
  referenceManifest: {
    ...metadataV2.referenceManifest,
    items: metadataV2.referenceManifest.items.map((item, index) => (
      index === 0 ? { ...item, purpose: ` ${item.purpose} ` } : item
    )),
  },
};
const normalizedNonCanonicalManifest = {
  ...nonNormalizedManifest,
  referenceManifestDigest: referenceManifestDigest({
    ...metadataV2.referenceManifest,
    items: metadataV2.referenceManifest.items.map((item, index) => (
      index === 0 ? { ...item, purpose: item.purpose.trim() } : item
    )),
  }),
};
assert.equal(isVideoGenerationPackageArtifactRevisionMetadataV2(normalizedNonCanonicalManifest), false);

const validArtifactCommand = {
  artifactType: 'video_generation_package',
  assetIds: ['asset_generation_package'],
  createdByActor: { actorId: 'system_generation_package', actorType: 'system' as const },
  expectedCurrentRevisionId: null,
  idempotencyKey: 'generation-package-v2-handoff-test',
  libraryVisibility: 'listed' as const,
  metadata: metadataV2,
  primaryAssetId: 'asset_generation_package',
  projectId: 'project_generation_package_v2',
  schemaVersion: 1 as const,
  scope: 'project' as const,
  semanticKey: 'video_generation_package:u03',
  sourceArtifactRevisionIds: ['artifact_revision_storyboard_sheet'],
  sourceAssetIds: ['asset_storyboard_sheet', 'asset_hero'],
};
assert.doesNotThrow(() => assertValidCreateOrAdvanceArtifactCommand(validArtifactCommand));
assert.throws(
  () => assertValidCreateOrAdvanceArtifactCommand({
    ...validArtifactCommand,
    metadata: metadataV1,
  }),
  /valid typed V2 metadata/,
);

assert.equal(generationPreparationCapabilityDefinition.version, '0.2.0');
assert.equal(
  generationPreparationCapabilityDefinition.definitionHash,
  'sha256:retake-generation-video-package-prepare-manifest-v2',
);
assert.equal(videoGenerationPackageFromApprovedStoryboardSkill.version, '0.2.0');
assert.equal(
  videoGenerationPackageFromApprovedStoryboardSkill.definitionHash,
  'sha256:retake-video-generation-package-from-approved-storyboard-manifest-v2',
);
assert.equal(storyboardUnitToGenerationPackageWorkflow.version, '0.2.0');
assert.equal(
  storyboardUnitToGenerationPackageWorkflow.definitionHash,
  'sha256:retake-workflow-storyboard-unit-to-generation-package-manifest-v2',
);
assert.equal(storyProductionStarterPackage.version, '0.5.0');
assert.equal(
  storyProductionStarterPackage.digest,
  'sha256:retake-package-story-production-starter-domain-video-v1',
);
assert.deepEqual(
  storyProductionStarterPackage.components.skills.find(
    (lock) => lock.skillId === videoGenerationPackageFromApprovedStoryboardSkill.skillId,
  ),
  {
    skillId: videoGenerationPackageFromApprovedStoryboardSkill.skillId,
    version: videoGenerationPackageFromApprovedStoryboardSkill.version,
    definitionHash: videoGenerationPackageFromApprovedStoryboardSkill.definitionHash,
  },
);
assert.deepEqual(
  storyProductionStarterPackage.components.workflows.find(
    (lock) => lock.workflowDefinitionId === storyboardUnitToGenerationPackageWorkflow.workflowId,
  ),
  {
    workflowDefinitionId: storyboardUnitToGenerationPackageWorkflow.workflowId,
    version: storyboardUnitToGenerationPackageWorkflow.version,
    definitionHash: storyboardUnitToGenerationPackageWorkflow.definitionHash,
  },
);

console.log(JSON.stringify({
  ok: true,
  selfContainedManifestSnapshot: true,
  digestAndCountsValidated: true,
  v1ReviewableButExecutionBlocked: true,
  exactDefinitionLocks: true,
}));
