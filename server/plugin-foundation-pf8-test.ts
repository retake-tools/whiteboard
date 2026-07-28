import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CapabilityDefinition } from '../src/core/capabilityContracts';
import { createBlockRecord } from '../src/core/blockFactory';
import { operationReadinessFor } from '../src/core/capabilities';
import {
  codexAppServerImageAdapterDefinition,
} from '../src/core/capabilityRegistry';
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
  replacePluginCapabilityDefinitions,
} from '../src/core/pluginCapabilityDefinitions';
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
  'image-studio-0.10.1.retakepkg',
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
    skills: 1,
    workflows: 1,
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
  const capabilityBytes = materialized.files.get(
    'definitions/image.guided_edit.json',
  );
  assert.ok(skill && workflow && agent && capabilityBytes);
  const capabilitySource = JSON.parse(capabilityBytes.toString('utf8'));
  const capabilityFixture = capabilityDefinitionFromWorkflow(workflow);
  if (capabilitySource) {
    assert.deepEqual(
      {
        capabilityId: capabilitySource.capabilityId,
        definitionHash: capabilitySource.definitionHash,
        version: capabilitySource.version,
      },
      {
        capabilityId: capabilityFixture.capabilityId,
        definitionHash: capabilityFixture.definitionHash,
        version: capabilityFixture.version,
      },
    );
    assert.equal(
      capabilitySource.inputSlots.find(
        (slot: { slotId: string }) => slot.slotId === 'prompt',
      )?.bindingKinds.includes('block'),
      true,
    );
    assert.equal(
      capabilitySource.outputSlots.find(
        (slot: { slotId: string }) => slot.slotId === 'edited_images',
      )?.artifactType,
      'image',
    );
  }
  const capability = {
    ...(capabilitySource ?? capabilityFixture),
    displayName: capabilitySource?.displayName.default ?? capabilityFixture.displayName,
    schemaVersion: 1,
  } as CapabilityDefinition;
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
      installationId: 'test-fixture-image-studio-0.10.1',
      kind: 'installed',
    },
    version: manifest.version,
  };

  replacePluginCapabilityDefinitions([capability]);
  configureSkillRegistry([skill as unknown as RetakeSkillDefinition]);
  configureWorkflowRegistry([workflow as unknown as WorkflowDefinition]);
  configureAgentPresetRegistry([agent as unknown as AgentPresetDefinition]);
  configurePackageRegistry([runtimePackage]);

  assert.equal(packageComposerDependencyIssue(entrypointId), undefined);
  assert.equal(capability.version, '0.1.1');
  assert.equal(
    capability.outputSlots.find((slot) => slot.slotId === 'edited_images')
      ?.artifactType,
    'image',
  );
  assert.ok(
    codexAppServerImageAdapterDefinition.supportedCapabilityIds.includes(
      'image.guided_edit',
    ),
  );
  assert.deepEqual(
    codexAppServerImageAdapterDefinition.inputProfiles.find(
      (profile) => profile.profileId === 'codex_guided_edit',
    ),
    {
      profileId: 'codex_guided_edit',
      requiredSlots: ['prompt', 'source_image'],
      optionalSlots: ['guidance_image'],
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
  const projection = projectWorkflowDraft(projectionSnapshot, {
    composerInput: {
      instruction: {
        body: 'Warm the light while preserving the subject.',
        slotId: 'prompt',
      },
      mentions: [{
        blockId: sourceBlock.blockId,
        kind: 'block',
        slotId: 'source_image',
      }],
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
  assert.equal(projectedOperation?.data.capabilityId, 'image.guided_edit');
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
    ['prompt', 'source_image'],
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

  replacePluginCapabilityDefinitions([]);
  reconcileWorkflowRuntime(projectionSnapshot);
  assert.equal(projectionSnapshot.workflowStepRuns?.[0]?.status, 'ready');
  assert.deepEqual(packageComposerDependencyIssue(entrypointId), {
    capabilityId: 'image.guided_edit',
    reason: 'capability_unavailable',
  });

  configureSkillRegistry([skill as unknown as RetakeSkillDefinition]);
  configureWorkflowRegistry([workflow as unknown as WorkflowDefinition]);
  configureAgentPresetRegistry([agent as unknown as AgentPresetDefinition]);
  assert.deepEqual(packageComposerDependencyIssue(entrypointId), {
    capabilityId: 'image.guided_edit',
    reason: 'capability_unavailable',
  });

  console.log(JSON.stringify({
    ok: true,
    packageComponents: inspected.components,
    publicCapability: capability.capabilityId,
    optionalGuidance: capability.inputSlots.find(
      (slot) => slot.slotId === 'guidance_image',
    )?.required === false,
    genericMediaProjection: true,
    disabledDependencyBlocker: true,
    agentBounded: true,
    crossRepositoryContractChecked: Boolean(capabilitySource),
  }));
} finally {
  replacePluginCapabilityDefinitions([]);
  configureSkillRegistry(original.skills);
  configureWorkflowRegistry(original.workflows);
  configureAgentPresetRegistry(original.agents);
  configurePackageRegistry(original.packages);
}

function capabilityDefinitionFromWorkflow(workflow: any): CapabilityDefinition {
  const lock = workflow.steps[0].capabilityLock;
  return {
    ...lock,
    category: 'image_editing',
    displayName: 'Guided image edit',
    inputSlots: [
      {
        artifactTypes: [],
        bindingKinds: ['asset', 'block'],
        cardinality: 'one',
        dataTypes: ['image'],
        required: true,
        semanticRole: 'source',
        slotId: 'source_image',
      },
      {
        artifactTypes: ['image', 'reference', 'selection_mask'],
        bindingKinds: ['asset', 'block'],
        cardinality: 'optional',
        dataTypes: ['image'],
        required: false,
        semanticRole: 'guidance',
        slotId: 'guidance_image',
      },
      {
        artifactTypes: [],
        bindingKinds: ['block', 'inline'],
        cardinality: 'one',
        dataTypes: ['text'],
        required: true,
        semanticRole: 'prompt',
        slotId: 'prompt',
      },
    ],
    outputSlots: [{
      artifactType: 'image',
      cardinality: 'many',
      dataType: 'image',
      projectionBlockTypes: ['image'],
      semanticRole: 'edited_images',
      slotId: 'edited_images',
    }],
    parametersSchemaRef: 'definitions/image.guided_edit.parameters.json',
    runtimeRequirements: ['durable_asset_output', 'image_generation'],
    schemaVersion: 1,
    supportedAdapterClasses: ['agent_runtime.media'],
  };
}
