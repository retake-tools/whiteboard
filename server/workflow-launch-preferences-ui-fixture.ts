import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import {
  agentRuntimeTurnContext,
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
} from '../src/core/agentSession';
import type { BoardSnapshot } from '../src/core/types';
import {
  bootstrapDeclarativePackages,
  defaultBootstrapProfilePath,
} from './declarative-package-bootstrap-service';
import { retakeRoot } from './local-store/context';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-workflow-launch-preferences')) {
  throw new Error('Workflow launch preferences fixture requires a disposable workspace.');
}

await rm(retakeRoot, { force: true, recursive: true });
await bootstrapDeclarativePackages({
  activateRuntime: true,
  hostVersion: '0.1.4',
  profilePath: defaultBootstrapProfilePath,
  workspaceRoot: retakeRoot,
});

const snapshot = await emptySnapshot();
const session = createAgentSession(snapshot, {
  model: 'fixture-model',
  title: '社区宠物店 · IP 设计',
}).session;
const message = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '为一家社区宠物店创建亲切、可靠、方便记忆的完整 IP 形象。',
});
const context = agentRuntimeTurnContext(
  snapshot,
  session.agentSessionId,
  message.agentMessageId,
);
const workflowEntryPointId = 'workflow:retake.workflow.ip-character-design';
assert.ok(context.goalPlanOptions.some(
  (option) => option.entrypointId === workflowEntryPointId,
));
const turn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: {
    coverage: 'full',
    kind: 'goal_plan_proposal',
    limitations: [],
    message: '这个目标适合使用 IP 形象设计流程。确认偏好后，我会从角色定位推进到应用展示。',
    summary: '为社区宠物店设计一套亲切、可靠、方便记忆的完整 IP 形象。',
    workflowEntryPointId,
  },
  externalThreadId: 'fixture_workflow_launch_preferences_thread',
  runtimeModel: 'fixture-model',
  runtimeTurnId: 'fixture_workflow_launch_preferences_turn',
  sourceMessageId: message.agentMessageId,
});
assert.equal(turn.proposal?.kind, 'plan_goal');
await saveSnapshot(snapshot);

console.log(JSON.stringify({
  boardId: snapshot.board.boardId,
  ok: true,
  projectId: snapshot.project.projectId,
  proposalId: turn.proposal?.proposalId,
  sessionId: session.agentSessionId,
  workspaceDirectory,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const value = await resetWorkspace();
  value.project.name = '[TEST] Workflow launch preferences 2026-08-09';
  value.board.name = '[TEST] Workflow launch preferences 2026-08-09';
  value.blocks = [];
  value.edges = [];
  value.assets = [];
  value.executions = [];
  value.agentRuns = [];
  value.agentSessions = [];
  value.agentMessages = [];
  value.agentRuntimeBindings = [];
  value.agentRuntimeEvents = [];
  value.changeProposals = [];
  value.changeDecisions = [];
  value.workflowRuns = [];
  value.workflowStepRuns = [];
  value.historyEvents = [];
  return value;
}
