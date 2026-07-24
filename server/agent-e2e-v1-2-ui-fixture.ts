import assert from 'node:assert/strict';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
  proposalsForSession,
} from '../src/core/agentSession';
import type { BoardSnapshot } from '../src/core/types';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory || workspaceDirectory === '.retake') {
  throw new Error('Agent E2E V1.2 UI fixture requires an explicit disposable RETAKE_WORKSPACE_DIR.');
}

const snapshot = await emptySnapshot();
const session = createAgentSession(snapshot, {
  model: 'fixture-model',
  title: 'Agent E2E V1.2',
}).session;
const message = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '一只快递猫要在日出前把最后一卷胶片送到影院。',
  contextRefs: [{
    entrypointId: 'skill:retake.screenplay.from-brief',
    kind: 'entrypoint',
  }],
});
const turn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: {
    kind: 'reply',
    message: '我会先提出一个生成剧本的草稿变更，批准不会执行。',
  },
  externalThreadId: 'fixture_agent_e2e_v1_2',
  runtimeModel: 'fixture-model',
  runtimeTurnId: 'fixture_agent_e2e_v1_2_turn',
  sourceMessageId: message.agentMessageId,
});
assert.equal(turn.proposal?.status, 'awaiting_decision');
assert.equal(snapshot.blocks.length, 0);
assert.equal(snapshot.executions.length, 0);
assert.equal(snapshot.agentRuns?.length, 0);
await saveSnapshot(snapshot);

console.log(JSON.stringify({
  ok: true,
  workspaceDirectory,
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  sessionId: session.agentSessionId,
  proposalId: proposalsForSession(snapshot, session.agentSessionId)[0]?.proposalId,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const snapshot = await resetWorkspace();
  snapshot.blocks = [];
  snapshot.edges = [];
  snapshot.assets = [];
  snapshot.executions = [];
  snapshot.agentRuns = [];
  snapshot.agentSessions = [];
  snapshot.agentMessages = [];
  snapshot.agentRuntimeBindings = [];
  snapshot.agentRuntimeEvents = [];
  snapshot.changeProposals = [];
  snapshot.changeDecisions = [];
  snapshot.workflowRuns = [];
  snapshot.workflowStepRuns = [];
  snapshot.historyEvents = [];
  return snapshot;
}
