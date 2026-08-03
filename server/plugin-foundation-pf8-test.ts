import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlockRecord } from '../src/core/blockFactory';
import { operationReadinessFor } from '../src/core/capabilities';
import {
  codexAppServerImageAdapterDefinition,
} from '../src/core/capabilityRegistry';
import { imageGenerateCapabilityDefinition } from '../src/core/imageGenerateContracts';
import {
  configureAgentPresetRegistry,
  listAgentPresets,
} from '../src/core/agentPresetRegistry';
import {
  packageComposerDependencyIssue,
} from '../src/core/packageComposer';
import type {
  RetakePackageManifest,
} from '../src/core/packageContracts';
import {
  configurePackageRegistry,
  listPackages,
} from '../src/core/packageRegistry';
import {
  configureSkillRegistry,
  listSkills,
  type RetakeSkillDefinition,
} from '../src/core/skillRegistry';
import {
  configureWorkflowRegistry,
  listWorkflows,
  type WorkflowDefinition,
} from '../src/core/workflowRegistry';
import type {
  AgentPresetDefinition,
} from '../src/core/agentPresetContracts';
import {
  readMaterializedPackageArchive,
  validateDeclarativePackage,
} from './declarative-package-service';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import {
  createWorkflowRunForGroup,
  reconcileWorkflowRuntime,
} from '../src/core/workflowRuntime';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const packageArchive = path.join(
  repositoryRoot,
  'packages',
  'bootstrap',
  'image-studio-0.12.0.retakepkg',
);
const entrypointId = 'workflow:retake.workflow.guided-image-review';
const original = {
  agents: listAgentPresets(),
  packages: listPackages(),
  skills: listSkills(),
  workflows: listWorkflows(),
};

try {
  const inspected = await validateDeclarativePackage(packageArchive);
  const materialized = await readMaterializedPackageArchive(packageArchive);
  assert.deepEqual(inspected.components, {
    agentPresets: 1,
    pluginModules: 1,
    skills: 5,
    workflows: 2,
  });
  assert.deepEqual(inspected.manifest.dependencies, []);

  const skill = materialized.definitions.skills.get(
    'retake.image.guided-edit',
  );
  const workflow = materialized.definitions.workflows.get(
    'retake.workflow.guided-image-review',
  );
  const agent = materialized.definitions.agentPresets.get(
    'retake.agent.guided-image-operator',
  );
  assert.ok(skill && workflow && agent);
  const packageSkills = [...materialized.definitions.skills.values()]
    .map((definition) => definition as unknown as RetakeSkillDefinition);
  const packageWorkflows = [...materialized.definitions.workflows.values()]
    .map((definition) => definition as unknown as WorkflowDefinition);
  assert.equal(materialized.files.has('definitions/image.guided_edit.json'), false);
  const capability = imageGenerateCapabilityDefinition;
  const manifest = inspected.manifest;
  const runtimePackage: RetakePackageManifest = {
    components: {
      adapterPlugins: [],
      agentPresets: manifest.components.agentPresets.map((entry) => ({
        agentPresetId: entry.agentPresetId,
        definitionHash: entry.definitionHash,
        version: entry.version,
      })),
      capabilityPlugins: [],
      skills: manifest.components.skills.map((entry) => ({
        definitionHash: entry.definitionHash,
        skillId: entry.skillId,
        version: entry.version,
      })),
      uiPlugins: [],
      workflows: manifest.components.workflows.map((entry) => ({
        definitionHash: entry.definitionHash,
        version: entry.version,
        workflowDefinitionId: entry.workflowDefinitionId,
      })),
    },
    description: manifest.description,
    digest: inspected.digest,
    entrypoints: structuredClone(manifest.entrypoints),
    name: manifest.name,
    packageId: manifest.packageId,
    schemaVersion: 1,
    source: {
      archiveDigest: inspected.archiveDigest,
      installationId: 'test-fixture-image-studio-0.12.0',
      kind: 'installed',
    },
    version: manifest.version,
  };

  configureSkillRegistry(packageSkills);
  configureWorkflowRegistry(packageWorkflows);
  configureAgentPresetRegistry([agent as unknown as AgentPresetDefinition]);
  configurePackageRegistry([runtimePackage]);

  assert.equal(packageComposerDependencyIssue(entrypointId), undefined);
  assert.equal(capability.version, '0.2.0');
  assert.equal(
    capability.outputSlots.find((slot) => slot.slotId === 'images')
      ?.artifactType,
    'image',
  );
  assert.ok(
    codexAppServerImageAdapterDefinition.supportedCapabilityIds.includes(
      'image.generate',
    ),
  );
  assert.deepEqual(
    codexAppServerImageAdapterDefinition.inputProfiles.find(
      (profile) => profile.profileId === 'codex_image_edit',
    ),
    {
      capabilityIds: ['image.generate'],
      profileId: 'codex_image_edit',
      requiredSlots: ['prompt', 'source_image'],
      optionalSlots: ['references'],
    },
  );

  const projectionSnapshot = structuredClone(defaultSnapshot);
  const sourceBlock = createBlockRecord(projectionSnapshot, 'image');
  sourceBlock.data = {
    ...sourceBlock.data,
    assetId: 'asset_pf8_source',
    previewUrl: '/api/local/assets/proj_demo_retake/asset_pf8_source/original.jpg',
    title: 'PF8 source',
  };
  projectionSnapshot.assets.unshift({
    assetId: 'asset_pf8_source',
    createdAt: new Date().toISOString(),
    kind: 'image',
    mimeType: 'image/jpeg',
    previewUrl: sourceBlock.data.previewUrl,
    projectId: projectionSnapshot.project.projectId,
    storageKey: 'assets/asset_pf8_source/original.jpg',
    storageProvider: 'local',
  });
  projectionSnapshot.blocks.push(sourceBlock);
  const referenceBlock = createBlockRecord(projectionSnapshot, 'image');
  referenceBlock.data = {
    ...referenceBlock.data,
    assetId: 'asset_pf8_reference',
    previewUrl: '/api/local/assets/proj_demo_retake/asset_pf8_reference/original.jpg',
    title: 'PF8 lighting reference',
  };
  projectionSnapshot.assets.unshift({
    assetId: 'asset_pf8_reference',
    createdAt: new Date().toISOString(),
    kind: 'image',
    mimeType: 'image/jpeg',
    previewUrl: referenceBlock.data.previewUrl,
    projectId: projectionSnapshot.project.projectId,
    storageKey: 'assets/asset_pf8_reference/original.jpg',
    storageProvider: 'local',
  });
  projectionSnapshot.blocks.push(referenceBlock);
  const projection = projectWorkflowDraft(projectionSnapshot, {
    composerInput: {
      instruction: {
        body: 'Warm the light while preserving the subject.',
        slotId: 'prompt',
      },
      mentions: [
        {
          blockId: sourceBlock.blockId,
          kind: 'block',
          slotId: 'source_image',
        },
        {
          blockId: referenceBlock.blockId,
          kind: 'block',
          slotId: 'references',
        },
      ],
    },
    connectionIdForCapability: () => 'codex-app-server',
    labelsForSkill: () => ({
      operationTitle: 'Guided image edit',
      promptPlaceholder: 'Describe the edit.',
      promptTitle: 'Edit instruction',
      resultTitle: 'Edited image',
      waitingBody: 'Waiting for image.',
    }),
    outputPlaceholder: 'Waiting for image.',
    workflowId: 'retake.workflow.guided-image-review',
    workflowTitle: 'Guided image edit and review',
  });
  const projectedOperation = projectionSnapshot.blocks.find(
    (block) => block.blockId === projection.operationBlockIds[0],
  );
  assert.equal(projectedOperation?.data.capabilityId, 'image.generate');
  assert.equal(projectedOperation?.data.skillId, 'retake.image.guided-edit');
  assert.equal(projectedOperation?.data.storyboardSheetParameters, undefined);
  assert.deepEqual(
    operationReadinessFor(projectionSnapshot, projectedOperation!),
    { canRun: true, issues: [] },
  );
  assert.deepEqual(
    projectionSnapshot.edges
      .filter((edge) => edge.targetBlockId === projectedOperation?.blockId)
      .map((edge) => edge.inputSlotId)
      .sort(),
    ['prompt', 'references', 'source_image'],
  );
  assert.equal(
    projectionSnapshot.blocks.find(
      (block) => block.blockId === projection.resultBlockIds[0],
    )?.type,
    'image',
  );
  const workflowRun = createWorkflowRunForGroup(
    projectionSnapshot,
    projection.groupBlock.blockId,
  );
  assert.equal(workflowRun.steps[0]?.status, 'ready');

  reconcileWorkflowRuntime(projectionSnapshot);
  assert.equal(projectionSnapshot.workflowStepRuns?.[0]?.status, 'ready');
  assert.equal(packageComposerDependencyIssue(entrypointId), undefined);

  configureSkillRegistry([skill as unknown as RetakeSkillDefinition]);
  configureWorkflowRegistry([workflow as unknown as WorkflowDefinition]);
  configureAgentPresetRegistry([agent as unknown as AgentPresetDefinition]);
  assert.equal(packageComposerDependencyIssue(entrypointId), undefined);

  console.log(JSON.stringify({
    ok: true,
    packageComponents: inspected.components,
    publicCapability: capability.capabilityId,
    optionalGuidance: capability.inputSlots.find(
      (slot) => slot.slotId === 'references',
    )?.required === false,
    genericMediaProjection: true,
    coreCapabilityShared: true,
    agentBounded: true,
    duplicateGuidedCapabilityRemoved: true,
  }));
} finally {
  configureSkillRegistry(original.skills);
  configureWorkflowRegistry(original.workflows);
  configureAgentPresetRegistry(original.agents);
  configurePackageRegistry(original.packages);
}
