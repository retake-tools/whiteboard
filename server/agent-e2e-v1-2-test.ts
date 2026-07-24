import assert from 'node:assert/strict';
import { agentRunInterventionFor } from '../src/core/agentRunIntervention';
import {
  createAgentRunForWorkflowRun,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import type { BoardSnapshot } from '../src/core/types';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import { storyToStoryboardWorkflow } from '../src/core/workflowRegistry';
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

firstStep.status = 'failed';
firstStep.error = 'Fixture execution failed.';
agent.record.status = 'needs_attention';
agent.record.error = firstStep.error;
const needsAttention = agentRunInterventionFor(snapshot, agent.record);
assert.equal(needsAttention?.kind, 'attention');
assert.equal(needsAttention?.detail, firstStep.error);
assert.equal(needsAttention?.locateBlockId, firstStep.operationBlockId);

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
  providerAuthorizationBoundary: true,
  needsAttentionReason: true,
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
