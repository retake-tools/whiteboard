import { rm } from 'node:fs/promises';
import './studio-domain-test-fixtures';
import { createAgentSession } from '../src/core/agentSession';
import { createAgentRunForWorkflowRun } from '../src/core/agentRuntime';
import { createBlockRecord } from '../src/core/blockFactory';
import { currentOperationConfiguration } from '../src/core/executionConfiguration';
import { nowIso } from '../src/core/id';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import { createWorkflowRunForGroup } from '../src/core/workflowRuntime';
import type { AssetRecord, ExecutionRecord } from '../src/core/types';
import { storyToStoryboardWorkflow } from './studio-domain-test-fixtures';
import { retakeRoot } from './local-store/context';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-workflow-agent-gate-v0')) {
  throw new Error('Workflow Agent Gate fixture requires a disposable RETAKE_WORKSPACE_DIR.');
}

await rm(retakeRoot, { recursive: true, force: true });
const snapshot = await resetWorkspace();
snapshot.project.name = '[TEST] Workflow Agent Gate V0';
snapshot.board.name = '[TEST] 商品图发布套装';
snapshot.blocks = [];
snapshot.edges = [];
snapshot.assets = [];
snapshot.executions = [];
snapshot.workflowRuns = [];
snapshot.workflowStepRuns = [];
snapshot.agentRuns = [];
snapshot.agentSessions = [];
snapshot.agentMessages = [];
snapshot.agentRuntimeBindings = [];
snapshot.agentRuntimeEvents = [];
snapshot.board.viewport = { x: 125, y: 170, zoom: 0.64 };

const projection = projectWorkflowDraft(snapshot, {
  connectionIdForCapability: () => 'fixture-connection',
  labelsForSkill: (_skillId) => ({
    operationTitle: '商品图处理',
    promptPlaceholder: '连接上一步结果',
    promptTitle: '输入',
    resultTitle: '结果',
    waitingBody: '等待执行',
  }),
  outputPlaceholder: '等待上一步完成',
  workflowDefinition: storyToStoryboardWorkflow,
  workflowId: storyToStoryboardWorkflow.workflowId,
  workflowTitle: '商品图发布套装',
});
const group = projection.groupBlock;
group.position = { x: -430, y: -260 };
group.size = { width: 1460, height: 580 };

const run = createWorkflowRunForGroup(snapshot, group.blockId).record;
const steps = run.stepRunIds.flatMap((stepRunId) => {
  const step = snapshot.workflowStepRuns?.find((candidate) => candidate.stepRunId === stepRunId);
  return step ? [step] : [];
});
if (steps.length < 4) throw new Error('Workflow Agent Gate fixture requires at least four steps.');
const stepTitles = ['理解素材', '生成背景', '生成多尺寸', '交付检查'];
steps.forEach((step, index) => {
  const operation = snapshot.blocks.find((block) => block.blockId === step.operationBlockId);
  if (operation) operation.data.title = stepTitles[index] ?? `步骤 ${index + 1}`;
  step.status = index < 2 ? 'succeeded' : index === 2 ? 'waiting_selection' : 'pending';
  step.updatedAt = nowIso();
});

const timestamp = nowIso();
const backgroundAsset = imageAsset('asset_gate_background', '/brand/retake-github-avatar.png', timestamp);
const candidateOneAsset = imageAsset('asset_gate_candidate_one', '/brand/retake-favicon-master.png', timestamp);
const candidateTwoAsset = imageAsset('asset_gate_candidate_two', '/brand/apple-touch-icon.png', timestamp);
snapshot.assets.push(backgroundAsset, candidateOneAsset, candidateTwoAsset);
const backgroundBlock = imageBlock('block_gate_background', '背景方案', backgroundAsset.assetId, -120, 430);
const candidateOneBlock = imageBlock('block_gate_candidate_one', '主图方案 A', candidateOneAsset.assetId, 230, 430);
const candidateTwoBlock = imageBlock('block_gate_candidate_two', '主图方案 B', candidateTwoAsset.assetId, 540, 430);
snapshot.blocks.push(backgroundBlock, candidateOneBlock, candidateTwoBlock);

const secondStep = steps[1]!;
secondStep.outputAssetIds = [backgroundAsset.assetId];
secondStep.outputBlockIds = [backgroundBlock.blockId];
secondStep.acceptedOutputAssetIds = [backgroundAsset.assetId];
secondStep.acceptedBy = 'agent';
secondStep.acceptanceReason = 'fixture_completed';
const selectionStep = steps[2]!;
selectionStep.outputAcceptancePolicy = 'manual_single';
selectionStep.outputAssetIds = [candidateOneAsset.assetId, candidateTwoAsset.assetId];
selectionStep.outputBlockIds = [candidateOneBlock.blockId, candidateTwoBlock.blockId];
selectionStep.acceptedOutputAssetIds = [];
selectionStep.recordVersion += 1;

const completedSteps = [steps[0]!, secondStep, selectionStep];
for (const [index, step] of completedSteps.entries()) {
  const operation = snapshot.blocks.find((block) => block.blockId === step.operationBlockId);
  if (!operation) throw new Error(`Workflow operation missing for fixture step: ${step.stepId}`);
  const outputAssetIds = index === 2
    ? [candidateOneAsset.assetId, candidateTwoAsset.assetId]
    : [backgroundAsset.assetId];
  const outputBlockIds = index === 2
    ? [candidateOneBlock.blockId, candidateTwoBlock.blockId]
    : [];
  const execution: ExecutionRecord = {
    adapter: 'direct_api',
    boardId: snapshot.board.boardId,
    capabilityId: step.capabilityLock.capabilityId,
    completedAt: timestamp,
    configuration: currentOperationConfiguration(snapshot, operation),
    connectionId: 'fixture-connection',
    executionId: `execution_gate_step_${index + 1}`,
    inputBlockIds: [],
    outputAssetIds,
    outputBlockIds,
    projectId: snapshot.project.projectId,
    startedAt: timestamp,
    status: 'succeeded',
    stepRunId: step.stepRunId,
    workflowRunId: run.workflowRunId,
  };
  snapshot.executions.push(execution);
  step.executionIds = [execution.executionId];
}
candidateOneAsset.sourceExecutionId = 'execution_gate_step_3';
candidateTwoAsset.sourceExecutionId = 'execution_gate_step_3';

run.status = 'waiting_selection';
run.currentStepIds = [selectionStep.stepId];
run.updatedAt = timestamp;
const agentRun = createAgentRunForWorkflowRun(snapshot, run.workflowRunId).record;
steps.forEach((step, index) => {
  step.status = index < 2 ? 'succeeded' : index === 2 ? 'waiting_selection' : 'pending';
  step.updatedAt = timestamp;
});
secondStep.outputAssetIds = [backgroundAsset.assetId];
secondStep.outputBlockIds = [backgroundBlock.blockId];
secondStep.acceptedOutputAssetIds = [backgroundAsset.assetId];
secondStep.acceptedBy = 'agent';
secondStep.acceptanceReason = 'fixture_completed';
selectionStep.outputAcceptancePolicy = 'manual_single';
selectionStep.outputAssetIds = [candidateOneAsset.assetId, candidateTwoAsset.assetId];
selectionStep.outputBlockIds = [candidateOneBlock.blockId, candidateTwoBlock.blockId];
selectionStep.acceptedOutputAssetIds = [];
agentRun.status = 'waiting_selection';
agentRun.currentOperationBlockId = selectionStep.operationBlockId;
agentRun.updatedAt = timestamp;
agentRun.recordVersion += 1;
const session = createAgentSession(snapshot, {
  agentRunId: agentRun.agentRunId,
  model: 'fixture-model',
  title: '商品图发布套装',
}).session;

await saveSnapshot(snapshot);

console.log(JSON.stringify({
  agentRunId: agentRun.agentRunId,
  boardId: snapshot.board.boardId,
  candidateBlockIds: [candidateOneBlock.blockId, candidateTwoBlock.blockId],
  projectId: snapshot.project.projectId,
  sessionId: session.agentSessionId,
  stepRunId: selectionStep.stepRunId,
  workspaceDirectory,
}));

function imageAsset(assetId: string, previewUrl: string, createdAt: string): AssetRecord {
  return {
    assetId,
    createdAt,
    height: 1440,
    kind: 'image',
    mimeType: 'image/png',
    previewUrl,
    projectId: snapshot.project.projectId,
    storageKey: previewUrl,
    storageProvider: 'local',
    width: 1080,
  };
}

function imageBlock(blockId: string, title: string, assetId: string, x: number, y: number) {
  const block = createBlockRecord(snapshot, 'image');
  block.blockId = blockId;
  block.position = { x, y };
  block.size = { width: 260, height: 320 };
  block.data = { assetId, title };
  return block;
}
