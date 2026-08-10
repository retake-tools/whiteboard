import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createAgentRunForWorkflowRun,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import {
  appendAgentUserMessage,
  createAgentSession,
  setAgentSessionRun,
} from '../src/core/agentSession';
import {
  configureAgentPresetRegistry,
} from '../src/core/agentPresetRegistry';
import type { RetakePackageManifest } from '../src/core/packageContracts';
import { configurePackageRegistry } from '../src/core/packageRegistry';
import {
  configureSkillRegistry,
  type RetakeSkillDefinition,
} from '../src/core/skillRegistry';
import type { BoardSnapshot } from '../src/core/types';
import {
  configureWorkflowRegistry,
  type WorkflowDefinition,
} from '../src/core/workflowRegistry';
import { replaceInstalledPluginCapabilityDefinitions } from '../src/core/pluginCapabilityDefinitions';
import { readInstalledPackageCapabilityDefinitions } from './installed-plugin-capability-definitions';
import {
  createWorkflowRunForGroup,
  reconcileWorkflowRuntime,
  workflowRunViewForGroup,
} from '../src/core/workflowRuntime';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import {
  readMaterializedPackageArchive,
  validateDeclarativePackage,
} from './declarative-package-service';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-workflow-run-experience')) {
  throw new Error('Workflow Run Experience fixture requires a disposable RETAKE_WORKSPACE_DIR.');
}

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const packageArchive = path.join(
  repositoryRoot,
  'packages',
  'bootstrap',
  'image-studio-0.12.3.retakepkg',
);
const inspected = await validateDeclarativePackage(packageArchive);
const materialized = await readMaterializedPackageArchive(packageArchive);
const runtimePackage = packageManifestForFixture(inspected, materialized);
const skills = [...materialized.definitions.skills.values()]
  .map((definition) => structuredClone(definition) as RetakeSkillDefinition);
const workflows = [...materialized.definitions.workflows.values()]
  .map((definition) => structuredClone(definition) as WorkflowDefinition);

configureSkillRegistry(skills);
configureWorkflowRegistry(workflows);
configureAgentPresetRegistry([]);
replaceInstalledPluginCapabilityDefinitions([
  ...readInstalledPackageCapabilityDefinitions(
    materialized.definitions.pluginModules.values(),
    materialized.files,
  ).values(),
]);
configurePackageRegistry([runtimePackage]);

const snapshot = await emptySnapshot();
const workflow = workflows.find(
  (candidate) => candidate.workflowId === 'retake.workflow.ip-character-design',
);
if (!workflow) {
  throw new Error('Bundled Image Studio IP Character Design definition is missing.');
}

const session = createAgentSession(snapshot, {
  model: 'fixture-model',
  title: 'IP 形象设计 Agent',
}).session;
const sourceMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '为一家社区早餐店设计亲切、易识别的蛋炒饭 IP 角色。',
  contextRefs: [],
});
const projection = projectWorkflowDraft(snapshot, {
  composerInput: {
    instruction: {
      body: sourceMessage.content,
      slotId: 'creative_brief',
    },
    mentions: [],
  },
  connectionIdForCapability: () => 'codex-app-server',
  labelsForSkill: () => ({
    operationTitle: 'IP design step',
    promptPlaceholder: 'Describe the character.',
    promptTitle: 'Creative brief',
    resultTitle: 'IP design result',
    waitingBody: 'Waiting for the result.',
  }),
  outputPlaceholder: 'Waiting for the result.',
  workflowId: workflow.workflowId,
  workflowTitle: 'IP 形象设计',
});
const projectionGroupId = projection.groupBlock.blockId;
const operationBlockIds = projection.operationBlockIds;

const workflowRun = createWorkflowRunForGroup(snapshot, projectionGroupId);
reconcileWorkflowRuntime(snapshot);
const runtimeView = workflowRunViewForGroup(snapshot, projectionGroupId);
if (runtimeView?.status !== 'ready' || runtimeView.steps.length !== 4) {
  throw new Error(`IP Character Design Workflow did not start through the real Runtime path: ${JSON.stringify({
    status: runtimeView?.status,
    steps: runtimeView?.steps.map((step) => ({
      status: step.status,
      inputBindings: step.record.resolvedInputBindings,
    })),
  })}`);
}

const agentRun = createAgentRunForWorkflowRun(snapshot, workflowRun.record.workflowRunId);
startAgentRun(snapshot, agentRun.record.agentRunId);
reconcileAgentRuntime(snapshot);
setAgentSessionRun(snapshot, session.agentSessionId, agentRun.record.agentRunId);

await saveSnapshot(snapshot);

console.log(JSON.stringify({
  agentRunStatus: agentRun.record.status,
  agentSessionId: session.agentSessionId,
  boardId: snapshot.board.boardId,
  entrypointId: 'workflow:retake.workflow.ip-character-design',
  ok: true,
  operationCount: operationBlockIds.length,
  packageVersion: runtimePackage.version,
  projectId: snapshot.project.projectId,
  workflowRunId: workflowRun.record.workflowRunId,
  workflowRunStatus: runtimeView.status,
  workspaceDirectory,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const value = await resetWorkspace();
  value.project.name = '[TEST] Workflow Run Experience V0';
  value.board.name = '[TEST] Workflow Run Experience V0';
  value.blocks = [];
  value.edges = [];
  value.assets = [];
  value.executions = [];
  value.workflowRuns = [];
  value.workflowStepRuns = [];
  value.workflowGateEvaluations = [];
  value.workflowApprovalRequests = [];
  value.workflowApprovalDecisions = [];
  value.agentRuns = [];
  value.agentSessions = [];
  value.agentMessages = [];
  value.agentRuntimeBindings = [];
  value.agentRuntimeEvents = [];
  return value;
}

function packageManifestForFixture(
  inspected: Awaited<ReturnType<typeof validateDeclarativePackage>>,
  packageArchiveValue: Awaited<ReturnType<typeof readMaterializedPackageArchive>>,
): RetakePackageManifest {
  const manifest = inspected.manifest;
  return {
    components: {
      adapterPlugins: [],
      agentPresets: manifest.components.agentPresets.map(
        ({ agentPresetId, definitionHash, version }) => ({ agentPresetId, definitionHash, version }),
      ),
      capabilityPlugins: [],
      skills: manifest.components.skills.map(
        ({ definitionHash, skillId, version }) => ({ definitionHash, skillId, version }),
      ),
      uiPlugins: [],
      workflows: manifest.components.workflows.map(
        ({ definitionHash, version, workflowDefinitionId }) => ({
          definitionHash,
          version,
          workflowDefinitionId,
        }),
      ),
    },
    description: manifest.description,
    digest: inspected.digest,
    entrypoints: structuredClone(manifest.entrypoints),
    name: manifest.name,
    packageId: manifest.packageId,
    schemaVersion: 1,
    source: {
      archiveDigest: packageArchiveValue.archiveDigest,
      installationId: 'test-fixture-image-studio-0.12.3',
      kind: 'installed',
    },
    version: manifest.version,
  };
}
