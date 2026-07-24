import assert from 'node:assert/strict';
import path from 'node:path';
import {
  createAgentSession,
  runtimeBindingForSession,
  setAgentSessionRun,
} from '../src/core/agentSession';
import {
  createAgentRunForOperation,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import { createDraftSkillOperation } from '../src/core/textOperations';
import type { BoardSnapshot } from '../src/core/types';
import {
  checkExecutionConnection,
  updateExecutionConnection,
} from './local-store/execution-provider-store';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory || path.resolve(workspaceDirectory) === path.resolve('.retake')) {
  throw new Error('Agent E2E V1.3 live fixture requires an explicit disposable RETAKE_WORKSPACE_DIR.');
}

const snapshot = await emptySnapshot();
const model = process.env.RETAKE_AGENT_TEST_MODEL?.trim() || 'gpt-5.6-terra';
await updateExecutionConnection('codex-app-server', { modelId: model });
const settings = await checkExecutionConnection('codex-app-server');
const connection = settings.connections.find(
  (candidate) => candidate.connectionId === 'codex-app-server',
);
assert.equal(connection?.status, 'ready', connection?.lastError);
assert.equal(connection?.modelId, model);

const draft = createDraftSkillOperation(snapshot, {
  bodyPlaceholder: '输入创意 Brief',
  inputTitle: '创意 Brief',
  operationBody: '生成可执行的视频剧本',
  operationTitle: '生成剧本',
  outputPlaceholder: '等待生成',
  outputTitle: '剧本',
  skillId: 'retake.screenplay.from-brief',
  initialText: { body: '', inputSlotId: 'brief' },
});
const run = createAgentRunForOperation(snapshot, draft.operationBlock.blockId);
startAgentRun(snapshot, run.record.agentRunId);
reconcileAgentRuntime(snapshot);
assert.equal(run.record.status, 'waiting_input');

const runSession = createAgentSession(snapshot, {
  agentRunId: run.record.agentRunId,
  connectionId: connection.connectionId,
  model,
  title: 'Run 控制验收',
}).session;
const readOnlySession = createAgentSession(snapshot, {
  connectionId: connection.connectionId,
  model,
  title: '只读问答验收',
}).session;
setAgentSessionRun(snapshot, readOnlySession.agentSessionId, undefined);
assert.equal(readOnlySession.activeAgentRunId, undefined);
runSession.updatedAt = '2026-07-24T10:00:00.000Z';
readOnlySession.updatedAt = '2026-07-24T11:00:00.000Z';
assert.equal(
  runtimeBindingForSession(snapshot, readOnlySession.agentSessionId)?.externalThreadId,
  undefined,
);
assert.equal(snapshot.executions.length, 0);
await saveSnapshot(snapshot);

console.log(JSON.stringify({
  ok: true,
  workspaceDirectory,
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  model,
  readOnlySessionId: readOnlySession.agentSessionId,
  runSessionId: runSession.agentSessionId,
  agentRunId: run.record.agentRunId,
  agentRunStatus: run.record.status,
  executions: snapshot.executions.length,
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
  snapshot.workflowGateEvaluations = [];
  snapshot.workflowApprovalRequests = [];
  snapshot.historyEvents = [];
  return snapshot;
}
