import type { AgentRunRecord } from '../src/core/agentRuntimeContracts';
import { createAgentSession } from '../src/core/agentSession';
import { createBlockRecord } from '../src/core/blockFactory';
import type { WorkflowRunRecord, WorkflowStepRunRecord } from '../src/core/workflowRuntimeContracts';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-workflow-run-experience')) {
  throw new Error('Workflow Run Experience fixture requires a disposable RETAKE_WORKSPACE_DIR.');
}

const snapshot = await resetWorkspace();
snapshot.project.name = '[TEST] Workflow Run Experience V0';
snapshot.board.name = '[TEST] Workflow Run Experience V0';
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

const group = createBlockRecord(snapshot, 'group');
group.data = {
  ...group.data,
  groupKind: 'workflow',
  title: 'Guided image production',
  workflowProjectionId: 'projection_guided_image',
};
const operations = [
  operation('准备创意输入', 'prepare'),
  operation('生成图片', 'generate'),
  operation('选择候选结果', 'review'),
  operation('发布最终图片', 'publish'),
];
snapshot.blocks.push(group, ...operations);

const now = new Date().toISOString();
const workflowRun: WorkflowRunRecord = {
  boardId: snapshot.board.boardId,
  createdAt: now,
  createdBy: 'user',
  currentStepIds: ['generate', 'review'],
  gateDefinitionLocks: [{
    definitionHash: 'sha256:fixture-gate',
    gateId: 'gate.review',
    kind: 'human_approval',
    name: 'Review generated image',
    required: true,
    subject: { kind: 'step_output', outputSlotId: 'image', stepId: 'review' },
  }],
  gateEvaluationIds: [],
  inputBindings: [],
  outputSlotLocks: [],
  projectId: snapshot.project.projectId,
  recordVersion: 1,
  status: 'waiting_selection',
  stepRunIds: ['step_prepare', 'step_generate', 'step_review', 'step_publish'],
  updatedAt: now,
  workflowDefinitionLock: {
    definitionHash: 'sha256:fixture-guided-image',
    version: '0.11.0',
    workflowId: 'design.retake.image-studio.guided-image',
  },
  workflowProjectionId: 'projection_guided_image',
  workflowRunId: 'workflow_run_guided_image',
};
const historyRun: WorkflowRunRecord = {
  ...structuredClone(workflowRun),
  currentStepIds: [],
  gateDefinitionLocks: [],
  status: 'succeeded',
  stepRunIds: ['step_history'],
  updatedAt: '2026-07-31T12:00:00.000Z',
  workflowDefinitionLock: {
    definitionHash: 'sha256:fixture-history',
    version: '0.10.8',
    workflowId: 'design.retake.image-studio.guided-image',
  },
  workflowProjectionId: 'projection_history_removed',
  workflowRunId: 'workflow_run_history',
};
snapshot.workflowRuns.push(workflowRun, historyRun);
snapshot.workflowStepRuns.push(
  step('step_prepare', workflowRun.workflowRunId, 'prepare', operations[0].blockId, 'succeeded'),
  step('step_generate', workflowRun.workflowRunId, 'generate', operations[1].blockId, 'succeeded'),
  step('step_review', workflowRun.workflowRunId, 'review', operations[2].blockId, 'waiting_selection'),
  step('step_publish', workflowRun.workflowRunId, 'publish', operations[3].blockId, 'blocked'),
  step('step_history', historyRun.workflowRunId, 'history', operations[0].blockId, 'succeeded'),
);

const agentRun: AgentRunRecord = {
  agentRunId: 'agent_run_guided_image',
  boardId: snapshot.board.boardId,
  createdAt: now,
  createdBy: 'user',
  executionIds: [],
  permissions: {
    allowedToolPermissions: ['retake.read', 'retake.execute_capability'],
    canCreateBlocks: false,
    canDeleteAssets: false,
    canInstallPackages: false,
    canModifyWorkflow: false,
  },
  projectId: snapshot.project.projectId,
  recordVersion: 1,
  runtimeKind: 'retake_orchestrator',
  scope: {
    allowedCapabilityIds: ['image.generate'],
    allowedOperationBlockIds: operations.map((item) => item.blockId),
    allowedStepRunIds: workflowRun.stepRunIds,
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
    workflowRunId: workflowRun.workflowRunId,
  },
  status: 'waiting_selection',
  stopPolicy: { kind: 'workflow_terminal' },
  target: {
    kind: 'workflow_run',
    workflowDefinitionLock: structuredClone(workflowRun.workflowDefinitionLock),
    workflowRunId: workflowRun.workflowRunId,
  },
  updatedAt: now,
};
snapshot.agentRuns.push(agentRun);
const session = createAgentSession(snapshot, {
  agentRunId: agentRun.agentRunId,
  model: 'fixture-model',
  title: '图片制作 Agent',
}).session;

await saveSnapshot(snapshot);

console.log(JSON.stringify({
  agentSessionId: session.agentSessionId,
  boardId: snapshot.board.boardId,
  ok: true,
  projectId: snapshot.project.projectId,
  workspaceDirectory,
}));

function operation(title: string, stepId: string) {
  const value = createBlockRecord(snapshot, 'operation');
  value.data = {
    ...value.data,
    title,
    workflowProjectionId: 'projection_guided_image',
    workflowStepId: stepId,
  };
  return value;
}

function step(
  stepRunId: string,
  workflowRunId: string,
  stepId: string,
  operationBlockId: string,
  status: WorkflowStepRunRecord['status'],
): WorkflowStepRunRecord {
  return {
    acceptedOutputAssetIds: [],
    capabilityLock: { capabilityId: 'image.generate', definitionHash: 'sha256:fixture-capability', version: '1.0.0' },
    createdAt: now,
    dependsOn: [],
    executionIds: status === 'succeeded' ? [`execution_${stepRunId}`] : [],
    freshness: 'current',
    operationBlockId,
    outputAcceptancePolicy: status === 'waiting_selection' ? 'manual_selection' : 'automatic',
    outputArtifactBindings: [],
    outputAssetIds: [],
    outputBlockIds: [],
    outputSlotIds: [],
    recordVersion: 1,
    resolvedInputBindings: [],
    skillLock: { definitionHash: 'sha256:fixture-skill', skillId: 'guided-image', version: '0.11.0' },
    status,
    stepId,
    stepRunId,
    updatedAt: now,
    workflowRunId,
  };
}
