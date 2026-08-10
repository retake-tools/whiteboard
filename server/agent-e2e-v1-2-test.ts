import assert from 'node:assert/strict';
import { agentRunInterventionFor } from '../src/core/agentRunIntervention';
import {
  createAgentRunForWorkflowRun,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import type { BoardSnapshot } from '../src/core/types';
import { createBlockRecord } from '../src/core/blockFactory';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import { storyToStoryboardWorkflow } from './studio-domain-test-fixtures';
import { createWorkflowRunForGroup } from '../src/core/workflowRuntime';
import { resetWorkspace } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory || workspaceDirectory === '.retake') {
  throw new Error('Agent E2E V1.2 test requires an explicit disposable RETAKE_WORKSPACE_DIR.');
}

const readyTextConnection: ExecutionConnectionSummary = {
  connectionId: 'test-text-connection',
  connectorId: 'openai-compatible',
  providerLabel: 'Test text provider',
  displayName: 'Test text provider',
  description: 'Agent E2E V1.2 test connection.',
  connectionKind: 'model_provider',
  implementationKind: 'ai_sdk',
  supportedCapabilityIds: [
    'story.screenplay.generate',
    'design.character.define',
    'design.scene.define',
    'previs.storyboard.plan',
  ],
  enabledUseCases: ['text'],
  configurable: true,
  deletable: true,
  enabled: true,
  status: 'ready',
  hasCredential: true,
  modelId: 'test-model',
};

const snapshot = await workflowSnapshot('');
const workflowRun = snapshot.workflowRuns?.[0];
assert.ok(workflowRun);
const agent = createAgentRunForWorkflowRun(snapshot, workflowRun.workflowRunId);
startAgentRun(snapshot, agent.record.agentRunId);
reconcileAgentRuntime(snapshot);
assert.equal(agent.record.status, 'waiting_input');

const waitingInput = agentRunInterventionFor(snapshot, agent.record);
assert.equal(waitingInput?.kind, 'input');
assert.ok(waitingInput?.locateBlockId);
assert.ok(waitingInput?.targetLabel);
assert.ok(waitingInput?.readinessIssues.length);

agent.record.stopReason = 'provider_execution_authorization_required';
const providerAuthorization = agentRunInterventionFor(snapshot, agent.record);
assert.equal(providerAuthorization?.kind, 'provider_authorization');
assert.equal(providerAuthorization?.locateBlockId, waitingInput?.locateBlockId);
assert.deepEqual(providerAuthorization?.readinessIssues, []);

const firstStep = snapshot.workflowStepRuns?.[0];
assert.ok(firstStep);
firstStep.status = 'waiting_selection';
agent.record.status = 'waiting_selection';
agent.record.stopReason = undefined;
agent.record.currentOperationBlockId = firstStep.operationBlockId;
const waitingSelection = agentRunInterventionFor(snapshot, agent.record);
assert.equal(waitingSelection?.kind, 'selection');
assert.equal(waitingSelection?.locateBlockId, firstStep.operationBlockId);

const gateDefinitionLock = {
  definitionHash: 'sha256:agent-e2e-v1-2-gate',
  gateId: 'screenplay_review',
  kind: 'human_approval' as const,
  name: '剧本审阅',
  required: true as const,
  subject: {
    kind: 'step_output' as const,
    outputSlotId: 'screenplay',
    stepId: firstStep.stepId,
  },
};
workflowRun.gateDefinitionLocks = [gateDefinitionLock];
snapshot.workflowGateEvaluations = [{
  approvalRequestId: 'approval_request_agent_e2e_v1_2',
  boardId: snapshot.board.boardId,
  createdAt: '2026-07-24T00:00:00.000Z',
  freshness: 'current',
  gateDefinitionLock,
  gateEvaluationId: 'gate_evaluation_agent_e2e_v1_2',
  gateId: gateDefinitionLock.gateId,
  projectId: snapshot.project.projectId,
  recordVersion: 1,
  status: 'waiting_approval',
  subjectAssetIds: [],
  subjectExecutionIds: [],
  subjectFingerprint: 'fnv1a:agent-e2e-v1-2',
  updatedAt: '2026-07-24T00:00:00.000Z',
  workflowRunId: workflowRun.workflowRunId,
}];
agent.record.status = 'waiting_approval';
agent.record.currentOperationBlockId = undefined;
const waitingApproval = agentRunInterventionFor(snapshot, agent.record);
assert.equal(waitingApproval?.kind, 'approval');
assert.equal(waitingApproval?.targetLabel, '剧本审阅');
assert.equal(waitingApproval?.locateBlockId, firstStep.operationBlockId);

const reviewRecoverySnapshot = structuredClone(snapshot);
reviewRecoverySnapshot.workflowGateEvaluations = [];
reviewRecoverySnapshot.workflowApprovalRequests = [];
const reviewRecoveryRun = reviewRecoverySnapshot.agentRuns?.find(
  (candidate) => candidate.agentRunId === agent.record.agentRunId,
);
const reviewRecoveryWorkflowRun = reviewRecoverySnapshot.workflowRuns?.find(
  (candidate) => candidate.workflowRunId === workflowRun.workflowRunId,
);
const reviewRecoveryStep = reviewRecoverySnapshot.workflowStepRuns?.find(
  (candidate) => candidate.stepRunId === firstStep.stepRunId,
);
assert.ok(reviewRecoveryRun && reviewRecoveryWorkflowRun && reviewRecoveryStep);
reviewRecoveryWorkflowRun.gateEvaluationIds = [];
reviewRecoveryStep.status = 'succeeded';
reviewRecoveryStep.freshness = 'current';
reviewRecoveryStep.outputAcceptancePolicy = 'manual_single';
reviewRecoveryStep.outputAssetIds = ['asset_review_recovery'];
reviewRecoveryStep.acceptedOutputAssetIds = ['asset_review_recovery'];
reviewRecoveryRun.status = 'needs_attention';
reviewRecoveryRun.currentOperationBlockId = undefined;
const reviewRecovery = agentRunInterventionFor(reviewRecoverySnapshot, reviewRecoveryRun);
assert.equal(reviewRecovery?.attentionReason, 'review_not_ready');
assert.equal(reviewRecovery?.prepareReviewStepRunId, reviewRecoveryStep.stepRunId);
assert.equal(reviewRecovery?.locateBlockId, reviewRecoveryStep.operationBlockId);
assert.equal(reviewRecovery?.targetLabel, '剧本审阅');

firstStep.status = 'failed';
firstStep.error = 'Fixture execution failed.';
agent.record.status = 'needs_attention';
agent.record.error = firstStep.error;
agent.record.currentOperationBlockId = firstStep.operationBlockId;
const failedResultBlocks = [0, 1].map((index) => {
  const block = createBlockRecord(snapshot, 'image');
  block.blockId = `block_agent_e2e_failed_result_${index}`;
  block.data = {
    ...block.data,
    sourceExecutionId: 'execution_agent_e2e_failed_images',
    status: 'failed',
    title: `Failed image ${index + 1}`,
  };
  return block;
});
snapshot.blocks.push(...failedResultBlocks);
snapshot.executions.push({
  adapter: 'codex_app_server',
  boardId: snapshot.board.boardId,
  capabilityId: 'image.generate',
  completedAt: '2026-07-24T00:01:00.000Z',
  connectionId: 'codex-app-server',
  errorMessage: 'stream disconnected before completion',
  executionId: 'execution_agent_e2e_failed_images',
  inputBlockIds: [],
  outputAssetIds: [],
  outputBlockIds: failedResultBlocks.map((block) => block.blockId),
  params: { operationBlockId: firstStep.operationBlockId },
  projectId: snapshot.project.projectId,
  startedAt: '2026-07-24T00:00:30.000Z',
  status: 'failed',
  stepRunId: firstStep.stepRunId,
  workflowRunId: workflowRun.workflowRunId,
});
agent.record.executionIds = [];
const needsAttention = agentRunInterventionFor(snapshot, agent.record);
assert.equal(needsAttention?.kind, 'attention');
assert.equal(needsAttention?.attentionReason, 'execution_failed');
assert.equal(needsAttention?.detail, firstStep.error);
assert.equal(needsAttention?.locateBlockId, firstStep.operationBlockId);
assert.equal(needsAttention?.retryExecutionId, 'execution_agent_e2e_failed_images');
assert.deepEqual(
  needsAttention?.retryableResultBlockIds,
  failedResultBlocks.map((block) => block.blockId),
);
assert.equal(
  snapshot.executions.at(-1)?.agentRunId,
  undefined,
  'Workflow Step recovery must not depend on a redundant direct AgentRun assignment.',
);

snapshot.blocks = snapshot.blocks.filter((block) => !failedResultBlocks.includes(block));
snapshot.executions = snapshot.executions.filter(
  (execution) => execution.executionId !== 'execution_agent_e2e_failed_images',
);
agent.record.executionIds = [];

agent.record.stopReason = 'operation_execution_missing';
assert.equal(
  agentRunInterventionFor(snapshot, agent.record)?.attentionReason,
  'execution_missing',
);
agent.record.stopReason = 'retired_definition';
assert.equal(
  agentRunInterventionFor(snapshot, agent.record)?.attentionReason,
  'retired_definition',
);
agent.record.stopReason = undefined;
firstStep.status = 'ready';
firstStep.freshness = 'outdated';
assert.equal(
  agentRunInterventionFor(snapshot, agent.record)?.attentionReason,
  'outdated',
);

const snapshotBeforeProjection = JSON.stringify(snapshot);
agentRunInterventionFor(snapshot, agent.record);
assert.equal(
  JSON.stringify(snapshot),
  snapshotBeforeProjection,
  'The intervention view must not mutate canonical runtime state.',
);

console.log(JSON.stringify({
  ok: true,
  waitingInputReason: true,
  waitingSelectionReason: true,
  waitingApprovalGate: true,
  reviewRecoveryAction: true,
  providerAuthorizationBoundary: true,
  needsAttentionReason: true,
  retiredDefinitionReason: true,
  canvasLocator: true,
  readOnlyProjection: true,
}));

async function workflowSnapshot(briefBody: string): Promise<BoardSnapshot> {
  const snapshot = await emptySnapshot();
  const projection = projectWorkflowDraft(snapshot, {
    workflowId: storyToStoryboardWorkflow.workflowId,
    workflowTitle: 'Story to storyboard plan',
    outputPlaceholder: 'Waiting.',
    labelsForSkill: () => ({
      operationTitle: 'Generate screenplay',
      promptPlaceholder: 'Connect required input',
      promptTitle: 'Workflow input',
      resultTitle: 'Workflow result',
      waitingBody: 'Waiting.',
    }),
    connectionIdForCapability: () => readyTextConnection.connectionId,
  });
  const brief = snapshot.blocks.find(
    (block) => block.blockId === projection.workflowInputBlockIds[0],
  );
  assert.ok(brief);
  brief.data.body = briefBody;
  createWorkflowRunForGroup(snapshot, projection.groupBlock.blockId);
  return snapshot;
}

async function emptySnapshot(): Promise<BoardSnapshot> {
  const snapshot = await resetWorkspace();
  snapshot.blocks = [];
  snapshot.edges = [];
  snapshot.assets = [];
  snapshot.executions = [];
  snapshot.agentRuns = [];
  snapshot.workflowRuns = [];
  snapshot.workflowStepRuns = [];
  snapshot.workflowGateEvaluations = [];
  snapshot.workflowApprovalRequests = [];
  return snapshot;
}
