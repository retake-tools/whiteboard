import assert from 'node:assert/strict';
import path from 'node:path';
import {
  agentRuntimeTurnContext,
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
  setAgentSessionRun,
} from '../src/core/agentSession';
import { stageAgentOperationExecution } from '../src/core/agentOperationExecution';
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
  throw new Error('Agent Operation V1 live test requires an explicit disposable RETAKE_WORKSPACE_DIR.');
}

let snapshot = await emptySnapshot();
const model = process.env.RETAKE_AGENT_TEST_MODEL?.trim() || 'gpt-5.6-terra';
await updateExecutionConnection('codex-app-server', { modelId: model });
const settings = await checkExecutionConnection('codex-app-server');
const connection = settings.connections.find(
  (candidate) => candidate.connectionId === 'codex-app-server',
);
assert.equal(connection?.status, 'ready', connection?.lastError);
assert.equal(connection?.modelId, model);
if (!connection) throw new Error('Codex App Server connection is missing.');

const legacyDraft = createDraftTextToImageOperation(snapshot, {
  operationTitle: 'Old Generate image',
  textBlockBody: '旧任务：废土风猫狗巡逻。',
  textBlockTitle: 'Old Prompt',
});
legacyDraft.operationBlock.data.connectionId = connection.connectionId;
const legacyPrompt = legacyDraft.textBlock.data.body;
const session = createAgentSession(snapshot, {
  connectionId: connection.connectionId,
  model,
  title: 'Operation Intent Routing V1 验收',
}).session;
setAgentSessionRun(snapshot, session.agentSessionId, undefined);
const sourceMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '生成一张家居海报，家里的温馨场景，主打落地灯，需要中文文字。',
});
await saveSnapshot(snapshot);

const createResult = await withTimeout(
  runAgentRuntimeTurn({
    agentSessionId: session.agentSessionId,
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
    sourceMessageId: sourceMessage.agentMessageId,
  }),
  120_000,
  'Agent Operation create-and-execute live turn did not complete within 120 seconds.',
);
assert.equal(createResult.decision.kind, 'operation_create_execute');
if (createResult.decision.kind !== 'operation_create_execute') {
  throw new Error('Expected a create-and-execute Operation decision.');
}
assert.equal(createResult.decision.capabilityId, 'image.text_to_image');
assert.match(createResult.decision.operationPrompt, /落地灯/);

const createTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: createResult.decision,
  externalThreadId: createResult.externalThreadId,
  runtimeModel: createResult.model,
  runtimeTurnId: createResult.runtimeTurnId,
  sourceMessageId: sourceMessage.agentMessageId,
});
assert.equal(createTurn.operationExecution?.kind, 'create_execute');
const created = stageAgentOperationExecution(snapshot, createTurn.operationExecution!, {
  connectionIdForCapability: () => connection.connectionId,
  operationTitle: 'Generate image',
  promptTitle: 'Prompt',
});
snapshot = created.stagedSnapshot;
assert.equal(legacyDraft.textBlock.data.body, legacyPrompt);
assert.equal(
  snapshot.blocks.find((block) => block.blockId === legacyDraft.textBlock.blockId)?.data.body,
  legacyPrompt,
);
assert.notEqual(created.receipt.operationBlockId, legacyDraft.operationBlock.blockId);
assert.equal(
  snapshot.agentSessions?.find(
    (candidate) => candidate.agentSessionId === session.agentSessionId,
  )?.workingOperation?.operationBlockId,
  created.receipt.operationBlockId,
);
const blockCountAfterCreate = snapshot.blocks.length;

const continuationMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '沿用刚才的家居海报任务，再来一版更克制的留白构图。',
});
const continuationContext = agentRuntimeTurnContext(
  snapshot,
  session.agentSessionId,
  continuationMessage.agentMessageId,
);
assert.equal(
  continuationContext.workingOperation?.operationBlockId,
  created.receipt.operationBlockId,
);
await saveSnapshot(snapshot);
const continuationResult = await withTimeout(
  runAgentRuntimeTurn({
    agentSessionId: session.agentSessionId,
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
    sourceMessageId: continuationMessage.agentMessageId,
  }),
  120_000,
  'Agent Operation continuation live turn did not complete within 120 seconds.',
);
assert.equal(continuationResult.decision.kind, 'operation_execute');
if (continuationResult.decision.kind !== 'operation_execute') {
  throw new Error('Expected a bound Operation continuation decision.');
}
assert.equal(continuationResult.decision.bindingSource, 'session_working');
assert.equal(continuationResult.decision.operationBlockId, created.receipt.operationBlockId);

const continuationTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: continuationResult.decision,
  externalThreadId: continuationResult.externalThreadId,
  runtimeModel: continuationResult.model,
  runtimeTurnId: continuationResult.runtimeTurnId,
  sourceMessageId: continuationMessage.agentMessageId,
});
const continued = stageAgentOperationExecution(snapshot, continuationTurn.operationExecution!, {
  connectionIdForCapability: () => connection.connectionId,
  operationTitle: 'Generate image',
  promptTitle: 'Prompt',
});
assert.equal(continued.receipt.action, 'continued');
assert.equal(continued.stagedSnapshot.blocks.length, blockCountAfterCreate);
assert.equal(
  continued.stagedSnapshot.blocks.find(
    (block) => block.blockId === legacyDraft.textBlock.blockId,
  )?.data.body,
  legacyPrompt,
);
assert.equal(continued.stagedSnapshot.executions.length, 0);

console.log(JSON.stringify({
  ok: true,
  workspaceDirectory,
  model,
  decisionKinds: [
    createResult.decision.kind,
    continuationResult.decision.kind,
  ],
  legacyOperationPreserved: true,
  createdOperationBlockId: created.receipt.operationBlockId,
  continuedOperationBlockId: continued.receipt.operationBlockId,
  workingOperationPersisted: true,
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
