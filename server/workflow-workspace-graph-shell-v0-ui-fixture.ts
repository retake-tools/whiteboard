import { rm } from 'node:fs/promises';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
  setAgentSessionRun,
} from '../src/core/agentSession';
import { decideChangeProposal } from '../src/core/agentChangeApplication';
import {
  createAgentRunForWorkflowRun,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import { listPackageEntryPoints } from '../src/core/packageRegistry';
import {
  createWorkflowRunForGroup,
  reconcileWorkflowRuntime,
} from '../src/core/workflowRuntime';
import {
  configurationFingerprint,
  currentOperationConfiguration,
} from '../src/core/executionConfiguration';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import {
  bootstrapDeclarativePackages,
  defaultBootstrapProfilePath,
} from './declarative-package-bootstrap-service';
import { retakeRoot } from './local-store/context';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import {
  forkProjectWorkflowDraft,
  publishProjectWorkflowDraft,
} from './local-store/workflow-authoring-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-workflow-workspace-graph-shell')) {
  throw new Error('Workflow Workspace Graph Shell fixture requires a disposable RETAKE_WORKSPACE_DIR.');
}

await rm(retakeRoot, { recursive: true, force: true });
await bootstrapDeclarativePackages({
  activateRuntime: true,
  hostVersion: '0.1.4',
  profilePath: defaultBootstrapProfilePath,
  workspaceRoot: retakeRoot,
});
const entrypoint = listPackageEntryPoints().find(
  (candidate) => candidate.entrypoint.entrypointId
    === 'workflow:retake.workflow.ip-character-design',
);
if (!entrypoint) throw new Error('IP Design Workflow EntryPoint is unavailable.');

const snapshot = await resetWorkspace();
snapshot.project.name = '[TEST] Workflow Workspace Graph Shell V0';
snapshot.board.name = '[TEST] Workflow Workspace Graph Shell V0';
snapshot.blocks = [];
snapshot.edges = [];
snapshot.assets = [];
snapshot.executions = [];
snapshot.workflowRuns = [];
snapshot.workflowStepRuns = [];
snapshot.workflowGateEvaluations = [];
snapshot.workflowApprovalRequests = [];
snapshot.workflowApprovalDecisions = [];
snapshot.agentRuns = [];
snapshot.agentSessions = [];
snapshot.agentMessages = [];
snapshot.agentRuntimeBindings = [];
snapshot.agentRuntimeEvents = [];

const session = createAgentSession(snapshot, {
  model: 'fixture-model',
  title: 'IP Design Agent',
}).session;
const sourceMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '为城市骑行品牌设计一只橙色快递猫 IP，轮廓简洁，适合头像、贴纸和海报。',
  contextRefs: [{
    entrypointId: entrypoint.entrypoint.entrypointId,
    kind: 'entrypoint',
  }],
});
const turn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: {
    kind: 'reply',
    message: '创建 IP 形象设计 Workflow 草稿。',
  },
  externalThreadId: 'thread_workflow_workspace_graph_shell_v0',
  runtimeModel: 'fixture-model',
  runtimeTurnId: 'turn_workflow_workspace_graph_shell_v0',
  sourceMessageId: sourceMessage.agentMessageId,
});
if (!turn.proposal) throw new Error('IP Design proposal was not created.');
const approved = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: turn.proposal.recordVersion,
  proposalId: turn.proposal.proposalId,
});
const groupId = approved.proposal.appliedEffect?.kind === 'package_entrypoint_draft'
  ? approved.proposal.appliedEffect.workflowGroupId
  : undefined;
if (!groupId) throw new Error('IP Design Workflow Group was not projected.');
const workflowRun = createWorkflowRunForGroup(snapshot, groupId);
reconcileWorkflowRuntime(snapshot);
const agentRun = createAgentRunForWorkflowRun(
  snapshot,
  workflowRun.record.workflowRunId,
);
startAgentRun(snapshot, agentRun.record.agentRunId);
reconcileAgentRuntime(snapshot);
setAgentSessionRun(snapshot, session.agentSessionId, agentRun.record.agentRunId);
if (process.env.RETAKE_WORKFLOW_GRAPH_FIXTURE_SCENARIO === 'selection') {
  seedAgentWorkflowResultSelection(snapshot, {
    agentRunId: agentRun.record.agentRunId,
    workflowRunId: workflowRun.record.workflowRunId,
  });
}
await saveSnapshot(snapshot);
const authoringDraft = await forkProjectWorkflowDraft({
  projectId: snapshot.project.projectId,
  source: { kind: 'installed', workflowId: workflowRun.record.workflowDefinitionLock.workflowId },
});
const authoringRevision = await publishProjectWorkflowDraft({
  draftId: authoringDraft.draft.draftId,
  expectedRecordVersion: authoringDraft.draft.recordVersion,
  projectId: snapshot.project.projectId,
});

console.log(JSON.stringify({
  agentRunId: agentRun.record.agentRunId,
  agentSessionId: session.agentSessionId,
  boardId: snapshot.board.boardId,
  operationCount: snapshot.blocks.filter((block) => block.type === 'operation').length,
  projectId: snapshot.project.projectId,
  revisionId: authoringRevision.revision.revisionId,
  workflowRunId: workflowRun.record.workflowRunId,
  workspaceDirectory,
}));

function seedAgentWorkflowResultSelection(
  target: BoardSnapshot,
  input: { agentRunId: string; workflowRunId: string },
): void {
  const now = new Date().toISOString();
  const run = target.workflowRuns?.find(
    (candidate) => candidate.workflowRunId === input.workflowRunId,
  );
  const agent = target.agentRuns?.find(
    (candidate) => candidate.agentRunId === input.agentRunId,
  );
  const firstStep = target.workflowStepRuns?.find(
    (candidate) => candidate.workflowRunId === input.workflowRunId
      && candidate.stepId === 'define_character',
  );
  const conceptStep = target.workflowStepRuns?.find(
    (candidate) => candidate.workflowRunId === input.workflowRunId
      && candidate.stepId === 'generate_concept_directions',
  );
  const documentBlock = target.blocks.find(
    (candidate) => candidate.blockId === firstStep?.outputBlockIds[0],
  );
  const firstCandidateBlock = target.blocks.find(
    (candidate) => candidate.blockId === conceptStep?.outputBlockIds[0],
  );
  if (!run || !agent || !firstStep || !conceptStep || !documentBlock || !firstCandidateBlock) {
    throw new Error('Selection fixture could not resolve the IP Workflow projection.');
  }

  const documentAssetId = 'asset_fixture_character_bible';
  const firstCandidateAssetId = 'asset_fixture_concept_direction_a';
  const secondCandidateAssetId = 'asset_fixture_concept_direction_b';
  const firstCandidatePreview = fixtureImageDataUrl('#ff8a3d', '#1f2937', 'A');
  const secondCandidatePreview = fixtureImageDataUrl('#22c55e', '#0f172a', 'B');
  const firstExecutionId = 'execution_fixture_character_bible';
  const conceptExecutionId = 'execution_fixture_concept_directions';
  target.assets.push(
    {
      assetId: documentAssetId,
      createdAt: now,
      kind: 'document',
      mimeType: 'text/markdown',
      previewUrl: 'data:text/markdown;charset=utf-8,Fixture%20character%20bible',
      projectId: target.project.projectId,
      sourceExecutionId: firstExecutionId,
      storageKey: `assets/${documentAssetId}/character-bible.md`,
      storageProvider: 'local',
    },
    {
      assetId: firstCandidateAssetId,
      createdAt: now,
      kind: 'image',
      mimeType: 'image/svg+xml',
      previewUrl: firstCandidatePreview,
      projectId: target.project.projectId,
      sourceExecutionId: conceptExecutionId,
      storageKey: `assets/${firstCandidateAssetId}/concept-a.svg`,
      storageProvider: 'local',
    },
    {
      assetId: secondCandidateAssetId,
      createdAt: now,
      kind: 'image',
      mimeType: 'image/svg+xml',
      previewUrl: secondCandidatePreview,
      projectId: target.project.projectId,
      sourceExecutionId: conceptExecutionId,
      storageKey: `assets/${secondCandidateAssetId}/concept-b.svg`,
      storageProvider: 'local',
    },
  );

  documentBlock.data = {
    ...documentBlock.data,
    assetId: documentAssetId,
    body: '# 橙色快递猫 IP 角色圣经\n\n亲切、敏捷、可靠，轮廓适合头像、贴纸与海报。',
    documentCharacterCount: 38,
    documentExcerpt: '亲切、敏捷、可靠，轮廓适合头像、贴纸与海报。',
    documentOutline: ['橙色快递猫 IP 角色圣经', '固定身份锚点'],
    sourceExecutionId: firstExecutionId,
    title: '橙色快递猫 IP 角色圣经',
  };
  firstCandidateBlock.data = {
    ...firstCandidateBlock.data,
    assetId: firstCandidateAssetId,
    previewUrl: firstCandidatePreview,
    sourceExecutionId: conceptExecutionId,
    title: '概念方向 A',
  };
  const secondCandidateBlock = structuredClone(firstCandidateBlock);
  secondCandidateBlock.blockId = 'block_fixture_concept_direction_b';
  secondCandidateBlock.position = {
    x: firstCandidateBlock.position.x,
    y: firstCandidateBlock.position.y + firstCandidateBlock.size.height + 40,
  };
  secondCandidateBlock.data = {
    ...secondCandidateBlock.data,
    assetId: secondCandidateAssetId,
    previewUrl: secondCandidatePreview,
    sourceExecutionId: conceptExecutionId,
    title: '概念方向 B',
  };
  target.blocks.push(secondCandidateBlock);

  const firstExecution = createSucceededFixtureExecution(target, {
    executionId: firstExecutionId,
    operationBlockId: firstStep.operationBlockId,
    outputAssetIds: [documentAssetId],
    outputBlockIds: [documentBlock.blockId],
    stepRunId: firstStep.stepRunId,
    workflowRunId: input.workflowRunId,
  });
  const conceptExecution = createSucceededFixtureExecution(target, {
    executionId: conceptExecutionId,
    operationBlockId: conceptStep.operationBlockId,
    outputAssetIds: [firstCandidateAssetId, secondCandidateAssetId],
    outputBlockIds: [firstCandidateBlock.blockId, secondCandidateBlock.blockId],
    stepRunId: conceptStep.stepRunId,
    workflowRunId: input.workflowRunId,
  });
  target.executions.push(firstExecution, conceptExecution);
  firstStep.executionIds = [firstExecution.executionId];
  firstStep.acceptedOutputAssetIds = [];
  conceptStep.executionIds = [conceptExecution.executionId];
  conceptStep.outputBlockIds = [firstCandidateBlock.blockId, secondCandidateBlock.blockId];
  conceptStep.acceptedOutputAssetIds = [];
  reconcileWorkflowRuntime(target);

  agent.status = 'running';
  agent.updatedAt = now;
  agent.recordVersion += 1;
  delete agent.error;
  delete agent.stopReason;
  reconcileAgentRuntime(target);
}

function createSucceededFixtureExecution(
  target: BoardSnapshot,
  input: {
    executionId: string;
    operationBlockId: string;
    outputAssetIds: string[];
    outputBlockIds: string[];
    stepRunId: string;
    workflowRunId: string;
  },
): ExecutionRecord {
  const operation = target.blocks.find(
    (candidate) => candidate.blockId === input.operationBlockId && candidate.type === 'operation',
  );
  if (!operation) throw new Error(`Fixture Operation is missing: ${input.operationBlockId}`);
  const configuration = currentOperationConfiguration(target, operation);
  const now = new Date().toISOString();
  return {
    adapter: 'direct_api',
    boardId: target.board.boardId,
    capabilityId: String(operation.data.capabilityId),
    completedAt: now,
    configuration,
    configurationFingerprint: configurationFingerprint(configuration),
    ...(configuration.connectionId ? { connectionId: configuration.connectionId } : {}),
    executionId: input.executionId,
    inputBlockIds: target.edges
      .filter((edge) => edge.kind === 'execution_input' && edge.targetBlockId === operation.blockId)
      .map((edge) => edge.sourceBlockId),
    outputAssetIds: input.outputAssetIds,
    outputBlockIds: input.outputBlockIds,
    params: { operationBlockId: operation.blockId },
    projectId: target.project.projectId,
    prompt: configuration.prompt,
    recordVersion: 1,
    startedAt: now,
    status: 'succeeded',
    stepRunId: input.stepRunId,
    workflowRunId: input.workflowRunId,
  };
}

function fixtureImageDataUrl(
  background: string,
  foreground: string,
  label: string,
): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><rect width="640" height="640" rx="64" fill="${background}"/><circle cx="320" cy="280" r="170" fill="#fff4e6"/><path d="M215 190L170 80l125 75M425 190L470 80l-125 75" fill="#fff4e6" stroke="${foreground}" stroke-width="18" stroke-linejoin="round"/><circle cx="265" cy="275" r="16" fill="${foreground}"/><circle cx="375" cy="275" r="16" fill="${foreground}"/><path d="M275 345q45 42 90 0" fill="none" stroke="${foreground}" stroke-width="18" stroke-linecap="round"/><text x="320" y="545" text-anchor="middle" font-family="sans-serif" font-size="92" font-weight="700" fill="${foreground}">${label}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
