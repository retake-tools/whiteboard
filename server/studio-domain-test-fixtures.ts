import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readMaterializedPackageArchive,
} from './declarative-package-service';
import {
  configureAgentPresetRegistry,
} from '../src/core/agentPresetRegistry';
import type { AgentPresetDefinition } from '../src/core/agentPresetContracts';
import type { RetakePackageManifest } from '../src/core/packageContracts';
import {
  configurePackageRegistry,
  createPackageRegistry,
} from '../src/core/packageRegistry';
import {
  configureSkillRegistry,
  type RetakeSkillDefinition,
} from '../src/core/skillRegistry';
import {
  configureWorkflowRegistry,
  type WorkflowDefinition,
} from '../src/core/workflowRegistry';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const archivePath = path.join(
  repositoryRoot,
  'packages',
  'bootstrap',
  'video-studio-0.1.1.retakepkg',
);
const materialized = await readMaterializedPackageArchive(archivePath);

const skills = [...materialized.definitions.skills.values()]
  .map((definition) => structuredClone(definition) as RetakeSkillDefinition);
const workflows = [...materialized.definitions.workflows.values()]
  .map((definition) => structuredClone(definition) as WorkflowDefinition);
const agentPresets = [...materialized.definitions.agentPresets.values()]
  .map((definition) => structuredClone(definition) as AgentPresetDefinition);

export const videoStudioPackage: RetakePackageManifest = {
  components: {
    adapterPlugins: [],
    agentPresets: materialized.manifest.components.agentPresets.map(
      ({ agentPresetId, definitionHash, version }) => ({
        agentPresetId,
        definitionHash,
        version,
      }),
    ),
    capabilityPlugins: [],
    skills: materialized.manifest.components.skills.map(
      ({ definitionHash, skillId, version }) => ({
        definitionHash,
        skillId,
        version,
      }),
    ),
    uiPlugins: [],
    workflows: materialized.manifest.components.workflows.map(
      ({ definitionHash, version, workflowDefinitionId }) => ({
        definitionHash,
        version,
        workflowDefinitionId,
      }),
    ),
  },
  description: materialized.manifest.description,
  digest: materialized.digest,
  entrypoints: structuredClone(materialized.manifest.entrypoints),
  name: materialized.manifest.name,
  packageId: materialized.manifest.packageId,
  schemaVersion: 1,
  source: {
    archiveDigest: materialized.archiveDigest,
    installationId: 'test-fixture-video-studio-0.1.1',
    kind: 'installed',
  },
  version: materialized.manifest.version,
};

configureSkillRegistry(skills);
configureWorkflowRegistry(workflows);
configureAgentPresetRegistry(agentPresets);
configurePackageRegistry([videoStudioPackage]);

export const videoGenerationPackageFromApprovedStoryboardSkill =
  requiredSkill('retake.video-generation-package.from-approved-storyboard');
export const videoGenerationFromApprovedPackageSkill =
  requiredSkill('retake.video-generation.from-approved-package');

export const storyToStoryboardWorkflow =
  requiredWorkflow('retake.workflow.story-to-storyboard');
export const storyboardUnitToSheetWorkflow =
  requiredWorkflow('retake.workflow.storyboard-unit-to-sheet');
export const storyboardUnitToGenerationPackageWorkflow =
  requiredWorkflow('retake.workflow.storyboard-unit-to-generation-package');
export const approvedGenerationPackageToVideoWorkflow =
  requiredWorkflow('retake.workflow.approved-generation-package-to-video');

export const storyProductionDirectorPreset =
  requiredAgentPreset('retake.agent.story-production-director');

export const studioDomainPackageRegistry = createPackageRegistry([
  videoStudioPackage,
]);

// Compatibility names keep older unit scenarios readable while their data now
// comes from the immutable Video Studio archive instead of Core source imports.
export const storyProductionStarterPackage = videoStudioPackage;
export const storyProductionAgentPackage = videoStudioPackage;
export const builtInPackageRegistry = studioDomainPackageRegistry;

function requiredSkill(skillId: string): RetakeSkillDefinition {
  const definition = skills.find((candidate) => candidate.skillId === skillId);
  if (!definition) throw new Error(`Studio test Skill is missing: ${skillId}`);
  return structuredClone(definition);
}

function requiredWorkflow(workflowId: string): WorkflowDefinition {
  const definition = workflows.find(
    (candidate) => candidate.workflowId === workflowId,
  );
  if (!definition) {
    throw new Error(`Studio test Workflow is missing: ${workflowId}`);
  }
  return structuredClone(definition);
}

function requiredAgentPreset(agentPresetId: string): AgentPresetDefinition {
  const definition = agentPresets.find(
    (candidate) => candidate.agentPresetId === agentPresetId,
  );
  if (!definition) {
    throw new Error(`Studio test AgentPreset is missing: ${agentPresetId}`);
  }
  return structuredClone(definition);
}
