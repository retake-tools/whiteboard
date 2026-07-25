import assert from 'node:assert/strict';
import path from 'node:path';
import { appendAgentRuntimeEvent } from '../src/core/agentChangeApplication';
import {
  agentRuntimeTurnContext,
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
  runtimeBindingForSession,
  setAgentSessionRun,
} from '../src/core/agentSession';
import { createDraftSkillOperation } from '../src/core/textOperations';
import type { AgentRuntimeTurnResult } from '../src/core/agentSessionContracts';
import type { BoardSnapshot } from '../src/core/types';
import type {
  WorkflowGateDefinitionLock,
  WorkflowRunRecord,
  WorkflowStepRunRecord,
} from '../src/core/workflowRuntimeContracts';
import { runAgentRuntimeTurn } from './agent-runtime-port';
import {
  checkExecutionConnection,
  updateExecutionConnection,
} from './local-store/execution-provider-store';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory || path.resolve(workspaceDirectory) === path.resolve('.retake')) {
  throw new Error('Agent Board Read Model V1.4 live test requires an explicit disposable RETAKE_WORKSPACE_DIR.');
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

createScreenplayDraft(snapshot, '第一份 Brief');
createScreenplayDraft(snapshot, '第二份 Brief');
const session = createAgentSession(snapshot, {
  connectionId: connection.connectionId,
  model,
  title: 'Board Read Model V1.4 真实验收',
}).session;
setAgentSessionRun(snapshot, session.agentSessionId, undefined);
await saveSnapshot(snapshot);

const first = await executeReadTurn(snapshot, session.agentSessionId);
assert.equal(first.operationCount, 2);
assert.equal(first.result.decision.kind, 'reply');
assert.match(first.result.decision.message, new RegExp(`count=${first.operationCount}(?:\\D|$)`));
assert.ok(first.result.decision.message.includes(`fingerprint=${first.fingerprint}`));

const blockedOperationBlockId = createScreenplayDraft(snapshot, '');
addWaitingApprovalFixture(snapshot, blockedOperationBlockId);
await saveSnapshot(snapshot);

const second = await executeReadTurn(snapshot, session.agentSessionId, {
  gateId: 'review_gate',
  operationBlockId: blockedOperationBlockId,
});
assert.equal(second.operationCount, 3);
assert.notEqual(second.fingerprint, first.fingerprint);
assert.equal(second.result.decision.kind, 'reply');
assert.match(second.result.decision.message, new RegExp(`count=${second.operationCount}(?:\\D|$)`));
assert.ok(second.result.decision.message.includes(`fingerprint=${second.fingerprint}`));
assert.ok(second.result.decision.message.includes(`operation=${blockedOperationBlockId}`));
assert.ok(second.result.decision.message.includes('canRun=false'));
assert.ok(second.result.decision.message.includes('issue=prompt_empty'));
assert.ok(second.result.decision.message.includes('gate=review_gate'));
assert.ok(second.result.decision.message.includes('gateStatus=waiting_approval'));
assert.ok(!second.result.decision.message.includes(first.fingerprint));
assert.equal(second.result.externalThreadId, first.result.externalThreadId);

assert.equal(snapshot.executions.length, 0);
assert.equal(snapshot.changeProposals?.length ?? 0, 0);
assert.equal(snapshot.changeDecisions?.length ?? 0, 0);
assert.equal(snapshot.workflowApprovalRequests?.length ?? 0, 1);
assert.equal(snapshot.workflowApprovalDecisions?.length ?? 0, 0);
assert.equal(
  runtimeBindingForSession(snapshot, session.agentSessionId)?.externalThreadId,
  first.result.externalThreadId,
);

console.log(JSON.stringify({
  ok: true,
  workspaceDirectory,
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  agentSessionId: session.agentSessionId,
  externalThreadId: first.result.externalThreadId,
  model,
  first: {
    fingerprint: first.fingerprint,
    operationCount: first.operationCount,
    message: first.result.decision.message,
  },
  second: {
    fingerprint: second.fingerprint,
    operationCount: second.operationCount,
    message: second.result.decision.message,
  },
  executions: snapshot.executions.length,
  proposals: snapshot.changeProposals?.length ?? 0,
}));

async function executeReadTurn(
  currentSnapshot: BoardSnapshot,
  agentSessionId: string,
  inspection?: { gateId: string; operationBlockId: string },
): Promise<{
  fingerprint: string;
  operationCount: number;
  result: AgentRuntimeTurnResult;
}> {
  const sourceMessage = appendAgentUserMessage(currentSnapshot, agentSessionId, {
    content: [
      '仅根据当前 retakeContext.boardReadModel 回答。',
      '输出内容必须包含且原样保留：count=<operationCounts.total>; ',
      'fingerprint=<source.fingerprint>',
      ...(inspection ? [
        `; operation=${inspection.operationBlockId}; canRun=<该 Operation readiness.canRun>; `,
        'issue=<第一个 readiness issue>; ',
        `gate=${inspection.gateId}; gateStatus=<该 current Gate status>`,
      ] : []),
      '。不要使用中文数字，不要省略上述字段，不要请求或执行任何变更。',
    ].join(''),
  });
  const context = agentRuntimeTurnContext(
    currentSnapshot,
    agentSessionId,
    sourceMessage.agentMessageId,
  );
  const fingerprint = context.boardReadModel.source.fingerprint;
  const operationCount = context.boardReadModel.summary.operationCounts.total;
  if (inspection) {
    const operation = context.boardReadModel.operations.find(
      (candidate) => candidate.operationBlockId === inspection.operationBlockId,
    );
    assert.equal(operation?.readiness.canRun, false);
    assert.equal(operation?.readiness.issues[0], 'prompt_empty');
    const gate = context.boardReadModel.gates.find(
      (candidate) => candidate.gateId === inspection.gateId,
    );
    assert.equal(gate?.status, 'waiting_approval');
    assert.equal(gate?.freshness, 'current');
  }
  await saveSnapshot(currentSnapshot);

  const result = await runAgentRuntimeTurn({
    agentSessionId,
    boardId: currentSnapshot.board.boardId,
    projectId: currentSnapshot.project.projectId,
    sourceMessageId: sourceMessage.agentMessageId,
  }, (event) => {
    appendAgentRuntimeEvent(currentSnapshot, {
      event,
      sourceMessageId: sourceMessage.agentMessageId,
    });
  });
  applyAgentRuntimeTurn(currentSnapshot, {
    agentSessionId,
    decision: result.decision,
    externalThreadId: result.externalThreadId,
    runtimeModel: result.model,
    runtimeTurnId: result.runtimeTurnId,
    sourceMessageId: sourceMessage.agentMessageId,
  });
  await saveSnapshot(currentSnapshot);
  return { fingerprint, operationCount, result };
}

function createScreenplayDraft(snapshot: BoardSnapshot, brief: string): string {
  const draft = createDraftSkillOperation(snapshot, {
    bodyPlaceholder: '输入创意 Brief',
    inputTitle: '创意 Brief',
    operationBody: '生成可执行的视频剧本',
    operationTitle: `生成剧本 ${brief}`,
    outputPlaceholder: '等待生成',
    outputTitle: '剧本',
    skillId: 'retake.screenplay.from-brief',
    initialText: { body: brief, inputSlotId: 'brief' },
  });
  return draft.operationBlock.blockId;
}

function addWaitingApprovalFixture(snapshot: BoardSnapshot, operationBlockId: string): void {
  const now = '2026-07-25T00:00:00.000Z';
  const workflowRunId = 'workflow_run_v1_4_live';
  const stepId = 'step_screenplay_review';
  const stepRunId = 'step_run_v1_4_live';
  const artifactRevisionId = 'artifact_revision_v1_4_live';
  const approvalRequestId = 'approval_request_v1_4_live';
  const gateEvaluationId = 'gate_evaluation_v1_4_live';
  const gateLock: WorkflowGateDefinitionLock = {
    definitionHash: 'sha256:v1-4-live-gate',
    gateId: 'review_gate',
    kind: 'human_approval',
    name: '剧本人工审阅',
    required: true,
    subject: {
      artifactScope: 'workflow_run',
      artifactType: 'screenplay',
      kind: 'artifact_revision',
      outputSlotId: 'screenplay',
      semanticKey: 'screenplay.current',
      stepId,
      workflowOutputSlotId: 'screenplay',
    },
  };
  const workflowRun: WorkflowRunRecord = {
    boardId: snapshot.board.boardId,
    createdAt: now,
    createdBy: 'user',
    currentStepIds: [stepId],
    gateDefinitionLocks: [gateLock],
    gateEvaluationIds: [gateEvaluationId],
    inputBindings: [],
    outputSlotLocks: [{
      artifactType: 'screenplay',
      outputSlotId: 'screenplay',
      stepId,
      workflowOutputSlotId: 'screenplay',
    }],
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    status: 'waiting_approval',
    stepRunIds: [stepRunId],
    updatedAt: now,
    workflowDefinitionLock: {
      definitionHash: 'sha256:v1-4-live-workflow',
      version: '1.0.0',
      workflowId: 'workflow.v1-4-live',
    },
    workflowProjectionId: 'workflow_projection_v1_4_live',
    workflowRunId,
  };
  const stepRun: WorkflowStepRunRecord = {
    acceptedOutputAssetIds: [],
    capabilityLock: {
      capabilityId: 'story.screenplay.generate',
      definitionHash: 'sha256:v1-4-live-capability',
      version: '1.0.0',
    },
    createdAt: now,
    dependsOn: [],
    executionIds: [],
    freshness: 'current',
    operationBlockId,
    outputAcceptancePolicy: 'automatic',
    outputArtifactBindings: [{
      artifactId: 'artifact_v1_4_live',
      artifactRevisionId,
      artifactType: 'screenplay',
      assetIds: [],
      boundAt: now,
      executionIds: [],
      outputSlotId: 'screenplay',
      primaryAssetId: 'asset_v1_4_live',
      workflowOutputSlotId: 'screenplay',
    }],
    outputAssetIds: [],
    outputBlockIds: [],
    outputSlotIds: ['screenplay'],
    recordVersion: 1,
    resolvedInputBindings: [],
    skillLock: {
      definitionHash: 'sha256:v1-4-live-skill',
      skillId: 'retake.screenplay.from-brief',
      version: '1.0.0',
    },
    status: 'waiting_input',
    stepId,
    stepRunId,
    updatedAt: now,
    workflowRunId,
  };
  snapshot.workflowRuns = [workflowRun];
  snapshot.workflowStepRuns = [stepRun];
  snapshot.workflowGateEvaluations = [{
    approvalRequestId,
    boardId: snapshot.board.boardId,
    createdAt: now,
    freshness: 'current',
    gateDefinitionLock: gateLock,
    gateEvaluationId,
    gateId: gateLock.gateId,
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    status: 'waiting_approval',
    subjectArtifactId: 'artifact_v1_4_live',
    subjectArtifactRevisionId: artifactRevisionId,
    subjectAssetIds: [],
    subjectExecutionIds: [],
    subjectFingerprint: 'sha256:v1-4-live-subject',
    updatedAt: now,
    workflowRunId,
  }];
  snapshot.workflowApprovalRequests = [{
    approvalRequestId,
    boardId: snapshot.board.boardId,
    createdAt: now,
    gateEvaluationId,
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    requestedAt: now,
    status: 'pending',
    subjectArtifactId: 'artifact_v1_4_live',
    subjectArtifactRevisionId: artifactRevisionId,
    subjectAssetIds: [],
    subjectExecutionIds: [],
    subjectFingerprint: 'sha256:v1-4-live-subject',
    updatedAt: now,
    workflowRunId,
  }];
}

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
  snapshot.workflowApprovalDecisions = [];
  snapshot.historyEvents = [];
  return snapshot;
}
