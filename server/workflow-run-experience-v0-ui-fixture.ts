import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentPresetDefinition } from '../src/core/agentPresetContracts';
import {
  createAgentRunForWorkflowRun,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
  setAgentSessionRun,
} from '../src/core/agentSession';
import {
  configureAgentPresetRegistry,
} from '../src/core/agentPresetRegistry';
import { decideChangeProposal } from '../src/core/agentChangeApplication';
import { createBlockRecord } from '../src/core/blockFactory';
import { operationReadinessFor } from '../src/core/capabilities';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import { executeExistingImageOperationBlock } from '../src/core/imageOperations';
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
import {
  createWorkflowRunForGroup,
  reconcileWorkflowRuntime,
  workflowRunViewForGroup,
} from '../src/core/workflowRuntime';
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
  'image-studio-0.12.0.retakepkg',
);
const inspected = await validateDeclarativePackage(packageArchive);
const materialized = await readMaterializedPackageArchive(packageArchive);
const runtimePackage = packageManifestForFixture(inspected, materialized);
const skills = [...materialized.definitions.skills.values()]
  .map((definition) => structuredClone(definition) as RetakeSkillDefinition);
const workflows = [...materialized.definitions.workflows.values()]
  .map((definition) => structuredClone(definition) as WorkflowDefinition);
const agentPresets = [...materialized.definitions.agentPresets.values()]
  .map((definition) => structuredClone(definition) as AgentPresetDefinition);

configureSkillRegistry(skills);
configureWorkflowRegistry(workflows);
configureAgentPresetRegistry(agentPresets);
configurePackageRegistry([runtimePackage]);

const snapshot = await emptySnapshot();
const previewUrl = fixtureImageDataUrl();
snapshot.assets.push({
  assetId: 'asset_workflow_run_experience_source',
  createdAt: new Date().toISOString(),
  kind: 'image',
  mimeType: 'image/svg+xml',
  previewUrl,
  projectId: snapshot.project.projectId,
  storageKey: 'assets/asset_workflow_run_experience_source/original.svg',
  storageProvider: 'local',
});
const sourceImage = createBlockRecord(snapshot, 'image');
sourceImage.position = { x: 80, y: 160 };
sourceImage.data = {
  ...sourceImage.data,
  assetId: 'asset_workflow_run_experience_source',
  previewUrl,
  title: '源图片（验收 fixture）',
};
snapshot.blocks.push(sourceImage);

const workflow = workflows.find(
  (candidate) => candidate.workflowId === 'retake.workflow.guided-image-review',
);
const entrypoint = runtimePackage.entrypoints.find(
  (candidate) => candidate.entrypointId === 'workflow:retake.workflow.guided-image-review',
);
if (!workflow || !entrypoint) {
  throw new Error('Bundled Image Studio Guided Image Workflow is incomplete.');
}

const session = createAgentSession(snapshot, {
  model: 'fixture-model',
  title: '引导式图片 Agent',
}).session;
const sourceMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '把背景调整为温暖的日落光线，同时保持主体、构图和文字不变。',
  contextRefs: [
    { entrypointId: entrypoint.entrypointId, kind: 'entrypoint' },
    {
      blockId: sourceImage.blockId,
      kind: 'block',
      slotId: 'source_image',
    },
  ],
});
const proposalTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: {
    kind: 'reply',
    message: '将创建引导式图片编辑 Workflow 草稿，等待批准。',
  },
  externalThreadId: 'thread_workflow_run_experience_fixture',
  runtimeModel: 'fixture-model',
  runtimeTurnId: 'turn_workflow_run_experience_fixture',
  sourceMessageId: sourceMessage.agentMessageId,
});
if (!proposalTurn.proposal) {
  throw new Error('Guided Image EntryPoint did not create a typed Change Proposal.');
}
const approvedDraft = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: proposalTurn.proposal.recordVersion,
  proposalId: proposalTurn.proposal.proposalId,
});
const projectionGroupId = approvedDraft.proposal.appliedEffect?.kind === 'package_entrypoint_draft'
  ? approvedDraft.proposal.appliedEffect.workflowGroupId
  : undefined;
if (!projectionGroupId) {
  throw new Error('Guided Image EntryPoint did not project a Workflow Group.');
}
const operationBlockIds = approvedDraft.proposal.appliedEffect?.createdBlockIds.filter((blockId) =>
  snapshot.blocks.some((block) => block.blockId === blockId && block.type === 'operation')) ?? [];

const workflowRun = createWorkflowRunForGroup(snapshot, projectionGroupId);
reconcileWorkflowRuntime(snapshot);
const runtimeView = workflowRunViewForGroup(snapshot, projectionGroupId);
if (runtimeView?.status !== 'ready' || runtimeView.steps.length !== 1) {
  const operationBlock = snapshot.blocks.find(
    (block) => block.blockId === operationBlockIds[0],
  );
  throw new Error(`Guided Image Workflow did not start through the real Runtime path: ${JSON.stringify({
    operation: operationBlock ? operationReadinessFor(snapshot, operationBlock) : undefined,
    status: runtimeView?.status,
    steps: runtimeView?.steps.map((step) => ({
      status: step.status,
      inputBindings: step.record.resolvedInputBindings,
    })),
  })}`);
}

const attachmentProbe = structuredClone(snapshot);
const probeOperation = attachmentProbe.blocks.find(
  (block) => block.blockId === operationBlockIds[0] && block.type === 'operation',
);
if (!probeOperation) throw new Error('Guided Image Workflow Operation is missing.');
const probeExecution = executeExistingImageOperationBlock(attachmentProbe, {
  capabilityId: String(probeOperation.data.capabilityId),
  connection: readyCodexMcpConnection(),
  operation: 'image_to_image',
  operationBlockId: probeOperation.blockId,
}).execution;
const attachedStep = attachmentProbe.workflowStepRuns?.find(
  (step) => step.operationBlockId === probeOperation.blockId,
);
if (
  !attachedStep
  || probeExecution.workflowRunId !== attachedStep.workflowRunId
  || probeExecution.stepRunId !== attachedStep.stepRunId
  || !attachedStep.executionIds.includes(probeExecution.executionId)
) {
  throw new Error('Image execution was not attached to its Workflow Step.');
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
  entrypointId: entrypoint.entrypointId,
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
      installationId: 'test-fixture-image-studio-0.12.0',
      kind: 'installed',
    },
    version: manifest.version,
  };
}

function fixtureImageDataUrl(): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="960" height="640">',
    '<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">',
    '<stop offset="0" stop-color="#8bb7d8"/><stop offset="1" stop-color="#ead3b0"/>',
    '</linearGradient></defs>',
    '<rect width="960" height="640" fill="url(#sky)"/>',
    '<rect y="420" width="960" height="220" fill="#64745d"/>',
    '<circle cx="480" cy="300" r="120" fill="#f1b86a"/>',
    '<path d="M360 500 L480 250 L600 500 Z" fill="#26323b"/>',
    '<text x="480" y="585" text-anchor="middle" font-family="sans-serif" font-size="34" fill="white">RETAKE</text>',
    '</svg>',
  ].join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function readyCodexMcpConnection(): ExecutionConnectionSummary {
  return {
    configurable: false,
    connectionId: 'codex-managed',
    connectionKind: 'model_provider',
    connectorId: 'codex-managed',
    deletable: false,
    description: 'Workflow attachment regression fixture.',
    displayName: 'Codex MCP',
    enabled: true,
    enabledUseCases: ['image'],
    hasCredential: true,
    implementationKind: 'mcp',
    modelId: 'codex-mcp',
    providerLabel: 'Codex MCP',
    status: 'ready',
    supportedCapabilityIds: ['image.generate'],
  };
}
