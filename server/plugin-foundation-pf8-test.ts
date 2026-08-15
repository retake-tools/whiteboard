import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  codexAppServerImageAdapterDefinition,
} from '../src/core/capabilityRegistry';
import { imageGenerateCapabilityDefinition } from '../src/core/imageGenerateContracts';
import {
  configureAgentPresetRegistry,
  listAgentPresets,
} from '../src/core/agentPresetRegistry';
import type { RetakePackageManifest } from '../src/core/packageContracts';
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
import {
  listInstalledPluginCapabilityDefinitions,
  replaceInstalledPluginCapabilityDefinitions,
} from '../src/core/pluginCapabilityDefinitions';
import { readInstalledPackageCapabilityDefinitions } from './installed-plugin-capability-definitions';
import {
  readMaterializedPackageArchive,
  validateDeclarativePackage,
} from './declarative-package-service';
import {
  retiredGuidedImageSkillId,
  retiredGuidedImageWorkflowId,
} from '../src/core/retiredDefinitions';
import { compatibleSkillsForWorkflowStep } from '../src/core/workflowAuthoringGraph';

const retiredAgentPresetId = 'retake.agent.guided-image-operator';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageArchive = path.join(
  repositoryRoot,
  'packages',
  'bootstrap',
  'image-studio-0.12.4.retakepkg',
);
const publicEntrypointId = 'workflow:retake.workflow.ip-character-design';
const original = {
  agents: listAgentPresets(),
  packages: listPackages(),
  skills: listSkills(),
  workflows: listWorkflows(),
  capabilities: listInstalledPluginCapabilityDefinitions(),
};

try {
  const inspected = await validateDeclarativePackage(packageArchive);
  const materialized = await readMaterializedPackageArchive(packageArchive);
  assert.deepEqual(inspected.components, {
    agentPresets: 0,
    pluginModules: 1,
    skills: 4,
    workflows: 1,
  });
  assert.deepEqual(inspected.manifest.dependencies, []);
  assert.equal(materialized.definitions.skills.has(retiredGuidedImageSkillId), false);
  assert.equal(materialized.definitions.workflows.has(retiredGuidedImageWorkflowId), false);
  assert.equal(materialized.definitions.agentPresets.has(retiredAgentPresetId), false);
  assert.equal(
    [...materialized.files.keys()].some((file) => file.includes('guided-image')),
    false,
  );

  const packageSkills = [...materialized.definitions.skills.values()]
    .map((definition) => definition as unknown as RetakeSkillDefinition);
  const packageWorkflows = [...materialized.definitions.workflows.values()]
    .map((definition) => definition as unknown as WorkflowDefinition);
  const manifest = inspected.manifest;
  const runtimePackage: RetakePackageManifest = {
    components: {
      adapterPlugins: [],
      agentPresets: [],
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
      installationId: 'test-fixture-image-studio-0.12.4',
      kind: 'installed',
    },
    version: manifest.version,
  };

  configureSkillRegistry(packageSkills);
  configureWorkflowRegistry(packageWorkflows);
  configureAgentPresetRegistry([]);
  replaceInstalledPluginCapabilityDefinitions([
    ...readInstalledPackageCapabilityDefinitions(
      materialized.definitions.pluginModules.values(),
      materialized.files,
    ).values(),
  ]);
  configurePackageRegistry([runtimePackage]);

  assert.equal(
    runtimePackage.entrypoints.some((entry) => entry.entrypointId === publicEntrypointId),
    true,
  );
  assert.equal(
    runtimePackage.entrypoints.some((entry) => (
      entry.entrypointId.includes('guided-image')
      || (entry.kind === 'skill' && entry.ref.skillId === retiredGuidedImageSkillId)
    )),
    false,
  );
  assert.equal(listSkills().some((skill) => skill.skillId === retiredGuidedImageSkillId), false);
  assert.equal(
    listWorkflows().some((workflow) => workflow.workflowId === retiredGuidedImageWorkflowId),
    false,
  );
  assert.equal(listAgentPresets().some((preset) => preset.agentPresetId === retiredAgentPresetId), false);
  const imageWorkflowStep = packageWorkflows[0]?.steps.find(
    (step) => step.capabilityLock.capabilityId === 'image.generate',
  );
  assert.ok(imageWorkflowStep);
  assert.equal(
    compatibleSkillsForWorkflowStep(imageWorkflowStep).some(
      (skill) => skill.skillId === retiredGuidedImageSkillId,
    ),
    false,
    'Workflow Editor must not discover the retired Skill through its active authoring catalog.',
  );

  const capability = imageGenerateCapabilityDefinition;
  assert.equal(capability.version, '0.2.0');
  assert.equal(
    capability.outputSlots.find((slot) => slot.slotId === 'images')?.artifactType,
    'image',
  );
  assert.ok(
    codexAppServerImageAdapterDefinition.supportedCapabilityIds.includes('image.generate'),
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

  console.log(JSON.stringify({
    ok: true,
    packageComponents: inspected.components,
    publicCapability: capability.capabilityId,
    optionalGuidance: capability.inputSlots.find(
      (slot) => slot.slotId === 'references',
    )?.required === false,
    coreCapabilityShared: true,
    retiredGuidedDefinitionsAbsent: true,
    currentAuthoringRegistryClean: true,
  }));
} finally {
  configureSkillRegistry(original.skills);
  configureWorkflowRegistry(original.workflows);
  configureAgentPresetRegistry(original.agents);
  replaceInstalledPluginCapabilityDefinitions(original.capabilities);
  configurePackageRegistry(original.packages);
}
