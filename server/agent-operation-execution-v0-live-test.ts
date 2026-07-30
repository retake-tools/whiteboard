import assert from 'node:assert/strict';
import path from 'node:path';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
  setAgentSessionRun,
} from '../src/core/agentSession';
import { applyAgentOperationExecutionRequest } from '../src/core/agentOperationExecution';
import { createDraftTextToImageOperation } from '../src/core/imageOperations';
import type { BoardSnapshot } from '../src/core/types';
import { runAgentRuntimeTurn } from './agent-runtime-port';
import {
  checkExecutionConnection,
  updateExecutionConnection,
} from './local-store/execution-provider-store';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory || path.resolve(workspaceDirectory) === path.resolve('.retake')) {
  throw new Error('Agent Operation execution live test requires an explicit disposable RETAKE_WORKSPACE_DIR.');
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

const draft = createDraftTextToImageOperation(snapshot, {
  operationTitle: 'Generate image',
  textBlockBody: '旧提示词',
  textBlockTitle: 'Prompt',
});
draft.operationBlock.data.connectionId = connection.connectionId;
const session = createAgentSession(snapshot, {
  connectionId: connection.connectionId,
  model,
  title: 'Operation 执行验收',
}).session;
setAgentSessionRun(snapshot, session.agentSessionId, undefined);
const sourceMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '生成一张家居海报，家里的温馨场景，主打落地灯，需要文字。',
});
await saveSnapshot(snapshot);

const result = await withTimeout(
  runAgentRuntimeTurn({
    agentSessionId: session.agentSessionId,
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
    sourceMessageId: sourceMessage.agentMessageId,
  }),
  120_000,
  'Agent Operation execution live turn did not complete within 120 seconds.',
);
assert.equal(result.decision.kind, 'operation_execute');
if (result.decision.kind !== 'operation_execute') {
  throw new Error('Expected an Operation execution decision.');
}
assert.equal(result.decision.operationBlockId, draft.operationBlock.blockId);
assert.ok(result.decision.operationPrompt?.trim());
assert.match(result.decision.operationPrompt, /落地灯/);

const applied = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: result.decision,
  externalThreadId: result.externalThreadId,
  runtimeModel: result.model,
  runtimeTurnId: result.runtimeTurnId,
  sourceMessageId: sourceMessage.agentMessageId,
});
assert.ok(applied.operationExecution);
applyAgentOperationExecutionRequest(snapshot, applied.operationExecution);
assert.equal(draft.textBlock.data.body, result.decision.operationPrompt);
assert.equal(snapshot.executions.length, 0);

console.log(JSON.stringify({
  ok: true,
  workspaceDirectory,
  model,
  operationBlockId: result.decision.operationBlockId,
  decisionKind: result.decision.kind,
  prompt: result.decision.operationPrompt,
  message: result.decision.message,
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

async function withTimeout<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
  message: string,
): Promise<Value> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
