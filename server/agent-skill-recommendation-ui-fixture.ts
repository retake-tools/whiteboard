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
if (!workspaceDirectory?.includes('.retake-test-agent-skill-recommendation')) {
  throw new Error('Agent Skill recommendation UI fixture requires a disposable workspace.');
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
  title: '蛋炒饭 · IP 策略',
}).session;
const message = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '先帮我把蛋炒饭小饭店的 IP 角色定位和核心性格整理成一份角色设定。',
});
const context = agentRuntimeTurnContext(
  snapshot,
  session.agentSessionId,
  message.agentMessageId,
);
assert.ok(context.skillEntrypointOptions.some(
  (option) => option.entrypointId === 'skill:retake.image.ip-character-strategy',
));
const turn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: {
    kind: 'skill_entrypoint_proposal',
    message: '这个目标适合先用“IP 角色策略”的创作方式，确认后我会直接开始。',
    skillEntryPointId: 'skill:retake.image.ip-character-strategy',
    summary: '把蛋炒饭小饭店的 IP 角色定位和核心性格整理成角色设定文档。',
  },
  externalThreadId: 'fixture_skill_recommendation_thread',
  runtimeModel: 'fixture-model',
  runtimeTurnId: 'fixture_skill_recommendation_turn',
  sourceMessageId: message.agentMessageId,
});
assert.equal(turn.proposal?.kind, 'plan_skill');
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
