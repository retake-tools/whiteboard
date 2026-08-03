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
