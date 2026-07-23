import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  attachAgentRunExecution,
  cancelAgentRun,
  createAgentRunForOperation,
  createAgentRunForWorkflowRun,
  nextAgentRunExecutionAction,
  pauseAgentRun,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import { textDocumentCapabilityIds } from '../src/core/capabilityRegistry';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import { createDraftSkillOperation, executeExistingTextGenerationOperation, type TextGenerationLabels } from '../src/core/textOperations';
import type { AssetRecord, BlockRecord, BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import { storyToStoryboardWorkflow } from '../src/core/workflowRegistry';
import { createWorkflowRunForGroup, reconcileWorkflowRuntime } from '../src/core/workflowRuntime';
import { loadSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const readyTextConnection: ExecutionConnectionSummary = {
  connectionId: 'test-text-connection',
  connectorId: 'openai-compatible',
  providerLabel: 'Test text provider',
  displayName: 'Test text provider',
  description: 'Agent runtime test connection.',
  connectionKind: 'model_provider',
  implementationKind: 'ai_sdk',
  supportedCapabilityIds: textDocumentCapabilityIds,
  enabledUseCases: ['text'],
  configurable: true,
  deletable: true,
  enabled: true,
  status: 'ready',
  hasCredential: true,
  modelId: 'test-model',
};

const [agentRuntimeSource, controllerSource, groupInspectorSource] = await Promise.all([
  readFile(new URL('../src/core/agentRuntime.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAgentRuntimeController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/GroupInspector.tsx', import.meta.url), 'utf8'),
]);
assert.doesNotMatch(agentRuntimeSource, /AgentSession|conversationId|Chat/);
assert.doesNotMatch(agentRuntimeSource, /createBlockRecord|projectWorkflowDraft/);
assert.match(controllerSource, /nextAgentRunExecutionAction/);
assert.match(controllerSource, /runOperationRef\.current\(action\.operationBlockId\)/);
assert.match(controllerSource, /attachAgentRunExecution\(current, action\.agentRunId, execution\.executionId\)/);
assert.match(groupInspectorSource, /agentRuntime\.startSelectedTarget/);
assert.match(groupInspectorSource, /latestAgentRunForWorkflowRun/);

const snapshot = await workflowSnapshot('A courier cat must reach the cinema before sunrise.');
const workflowRun = (snapshot.workflowRuns ?? [])[0];
assert.ok(workflowRun);
const agent = createAgentRunForWorkflowRun(snapshot, workflowRun.workflowRunId);
assert.equal(agent.status, 'queued');
assert.equal(agent.record.target.kind, 'workflow_run');
assert.equal(agent.record.stopPolicy.kind, 'workflow_terminal');
assert.deepEqual(agent.record.permissions, {
  allowedToolPermissions: ['retake.read', 'retake.execute_capability'],
  canCreateBlocks: false,
  canDeleteAssets: false,
  canInstallPackages: false,
  canModifyWorkflow: false,
});
assert.deepEqual(agent.record.scope.allowedStepRunIds, workflowRun.stepRunIds);
assert.equal(agent.record.scope.allowedOperationBlockIds.length, 4);
assert.deepEqual(agent.record.scope.allowedCapabilityIds, [
  'story.screenplay.generate',
  'design.character.define',
  'design.scene.define',
  'previs.storyboard.plan',
]);
assert.throws(() => createAgentRunForWorkflowRun(snapshot, workflowRun.workflowRunId), /already has an active Agent Run/);

startAgentRun(snapshot, agent.record.agentRunId);
let action = nextAgentRunExecutionAction(snapshot);
assert.equal(action?.stepRunId, stepFor(snapshot, workflowRun.workflowRunId, 'screenplay_generate').stepRunId);
let execution = queueStep(snapshot, blockFor(snapshot, action!.operationBlockId));
attachAgentRunExecution(snapshot, agent.record.agentRunId, execution.executionId);
assert.equal(execution.agentRunId, agent.record.agentRunId);
reconcileAgentRuntime(snapshot);
assert.deepEqual(agent.record.executionIds, [execution.executionId]);
assert.equal(nextAgentRunExecutionAction(snapshot), undefined, 'Agent must not dispatch while a scoped Execution is active.');
completeStep(snapshot, execution, '# Screenplay\n\nThe courier reaches the bridge.');
reconcileAgentRuntime(snapshot);
action = nextAgentRunExecutionAction(snapshot);
assert.equal(action?.stepRunId, stepFor(snapshot, workflowRun.workflowRunId, 'character_define').stepRunId);

execution = queueStep(snapshot, blockFor(snapshot, action!.operationBlockId));
completeStep(snapshot, execution, '# Character Bible\n\nOrange courier cat.');
reconcileAgentRuntime(snapshot);
action = nextAgentRunExecutionAction(snapshot);
assert.equal(action?.stepRunId, stepFor(snapshot, workflowRun.workflowRunId, 'scene_define').stepRunId);
execution = queueStep(snapshot, blockFor(snapshot, action!.operationBlockId));
completeStep(snapshot, execution, '# Scene Bible\n\nA cinema and a sunrise bridge.');
reconcileAgentRuntime(snapshot);
action = nextAgentRunExecutionAction(snapshot);
assert.equal(action?.stepRunId, stepFor(snapshot, workflowRun.workflowRunId, 'storyboard_plan').stepRunId);
execution = queueStep(snapshot, blockFor(snapshot, action!.operationBlockId));
completeStep(snapshot, execution, '# Storyboard Plan\n\nShot 01: the courier enters frame.');
reconcileAgentRuntime(snapshot);
assert.equal(agent.record.status, 'succeeded');
assert.equal(agent.record.stopReason, 'workflow_terminal');
assert.equal(agent.record.executionIds.length, 4);
assert.equal(nextAgentRunExecutionAction(snapshot), undefined);

await saveSnapshot(snapshot);
const recovered = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
const recoveredAgent = (recovered.agentRuns ?? []).find((candidate) => candidate.agentRunId === agent.record.agentRunId);
assert.equal(recoveredAgent?.status, 'succeeded');
assert.equal(recoveredAgent?.target.kind, 'workflow_run');

const waitingSnapshot = await workflowSnapshot('');
const waitingRun = (waitingSnapshot.workflowRuns ?? [])[0];
assert.ok(waitingRun);
const waitingAgent = createAgentRunForWorkflowRun(waitingSnapshot, waitingRun.workflowRunId);
startAgentRun(waitingSnapshot, waitingAgent.record.agentRunId);
reconcileAgentRuntime(waitingSnapshot);
assert.equal(waitingAgent.record.status, 'waiting_input');
assert.equal(nextAgentRunExecutionAction(waitingSnapshot), undefined);
const brief = waitingSnapshot.blocks.find((block) => block.data.workflowInputSlotId === 'brief');
assert.ok(brief);
brief.data.body = 'A rescue cat must reach the lighthouse.';
reconcileAgentRuntime(waitingSnapshot);
assert.equal(waitingAgent.record.status, 'running');
assert.ok(nextAgentRunExecutionAction(waitingSnapshot));
const staleWaitingSnapshot = structuredClone(waitingSnapshot);
pauseAgentRun(waitingSnapshot, waitingAgent.record.agentRunId);
assert.equal(nextAgentRunExecutionAction(waitingSnapshot), undefined);
await saveSnapshot(waitingSnapshot);
await saveSnapshot(staleWaitingSnapshot);
const recoveredPause = await loadSnapshot(waitingSnapshot.project.projectId, waitingSnapshot.board.boardId);
assert.equal((recoveredPause.agentRuns ?? [])[0]?.status, 'paused', 'A stale save must not roll back a newer AgentRun record.');
startAgentRun(waitingSnapshot, waitingAgent.record.agentRunId);
assert.ok(nextAgentRunExecutionAction(waitingSnapshot));
cancelAgentRun(waitingSnapshot, waitingAgent.record.agentRunId);
assert.equal(waitingAgent.record.stopReason, 'user_canceled');
assert.equal(nextAgentRunExecutionAction(waitingSnapshot), undefined);

const invalidScopeSnapshot = await workflowSnapshot('A valid brief.');
const invalidWorkflow = (invalidScopeSnapshot.workflowRuns ?? [])[0];
assert.ok(invalidWorkflow);
const invalidAgent = createAgentRunForWorkflowRun(invalidScopeSnapshot, invalidWorkflow.workflowRunId);
startAgentRun(invalidScopeSnapshot, invalidAgent.record.agentRunId);
invalidAgent.record.scope.allowedCapabilityIds = [];
reconcileAgentRuntime(invalidScopeSnapshot);
assert.equal(invalidAgent.record.status, 'failed');
assert.equal(invalidAgent.record.stopReason, 'target_invalid');
assert.equal(nextAgentRunExecutionAction(invalidScopeSnapshot), undefined);

const invalidPermissionSnapshot = await workflowSnapshot('A valid brief.');
const permissionWorkflow = (invalidPermissionSnapshot.workflowRuns ?? [])[0];
assert.ok(permissionWorkflow);
const invalidPermissionAgent = createAgentRunForWorkflowRun(invalidPermissionSnapshot, permissionWorkflow.workflowRunId);
startAgentRun(invalidPermissionSnapshot, invalidPermissionAgent.record.agentRunId);
Object.assign(invalidPermissionAgent.record.permissions, { canModifyWorkflow: true });
reconcileAgentRuntime(invalidPermissionSnapshot);
assert.equal(invalidPermissionAgent.record.status, 'failed');
assert.match(invalidPermissionAgent.record.error ?? '', /permissions exceed/);

const foreignExecutionSnapshot = await workflowSnapshot('A valid brief.');
const foreignWorkflow = (foreignExecutionSnapshot.workflowRuns ?? [])[0];
assert.ok(foreignWorkflow);
const foreignAgent = createAgentRunForWorkflowRun(foreignExecutionSnapshot, foreignWorkflow.workflowRunId);
const foreignOperation = blockFor(foreignExecutionSnapshot, stepFor(foreignExecutionSnapshot, foreignWorkflow.workflowRunId, 'screenplay_generate').operationBlockId);
const foreignExecution = queueStep(foreignExecutionSnapshot, foreignOperation);
foreignExecution.workflowRunId = 'workflow_run_outside_scope';
assert.throws(
  () => attachAgentRunExecution(foreignExecutionSnapshot, foreignAgent.record.agentRunId, foreignExecution.executionId),
  /does not match the Agent Run Workflow target/,
);

const capabilitySnapshot = await emptySnapshot();
const capabilityDraft = createDraftSkillOperation(capabilitySnapshot, {
  ...labelsForSkill('retake.screenplay.from-brief'),
  skillId: 'retake.screenplay.from-brief',
  initialText: { body: 'A detective cat catches the final train.', inputSlotId: 'brief' },
});
const capabilityAgent = createAgentRunForOperation(capabilitySnapshot, capabilityDraft.operationBlock.blockId);
assert.equal(capabilityAgent.record.target.kind, 'capability');
assert.equal(capabilityAgent.record.stopPolicy.kind, 'capability_completed');
startAgentRun(capabilitySnapshot, capabilityAgent.record.agentRunId);
action = nextAgentRunExecutionAction(capabilitySnapshot);
assert.equal(action?.operationBlockId, capabilityDraft.operationBlock.blockId);
execution = queueStep(capabilitySnapshot, capabilityDraft.operationBlock);
completeStep(capabilitySnapshot, execution, '# Screenplay\n\nThe detective boards the train.');
reconcileAgentRuntime(capabilitySnapshot);
assert.equal(capabilityAgent.record.status, 'succeeded');
assert.equal(capabilityAgent.record.stopReason, 'capability_completed');

console.log(JSON.stringify({
  ok: true,
  typedTargets: ['capability', 'workflow_run', 'workflow_slice'],
  exactScopeFrozen: true,
  workflowAutoProgressionPlanned: true,
  waitingInputRecovered: true,
  pauseAndCancelBounded: true,
  invalidScopeRejected: true,
  durableRecovery: true,
  noSessionOrChat: true,
}));

async function workflowSnapshot(briefBody: string): Promise<BoardSnapshot> {
  const snapshot = await emptySnapshot();
  const projection = projectWorkflowDraft(snapshot, {
    workflowId: storyToStoryboardWorkflow.workflowId,
    workflowTitle: 'Story to storyboard plan',
    outputPlaceholder: 'Waiting.',
    labelsForSkill,
    connectionIdForCapability: () => readyTextConnection.connectionId,
  });
  blockFor(snapshot, projection.workflowInputBlockIds[0]).data.body = briefBody;
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
  snapshot.historyEvents = [];
  return snapshot;
}

function queueStep(snapshot: BoardSnapshot, operation: BlockRecord): ExecutionRecord {
  return executeExistingTextGenerationOperation(snapshot, {
    connection: readyTextConnection,
    labels: labelsForSkill(String(operation.data.skillId)),
    operationBlockId: operation.blockId,
  }).execution;
}

function completeStep(snapshot: BoardSnapshot, execution: ExecutionRecord, markdown: string): void {
  const assetId = `asset_${execution.executionId}`;
  const result = blockFor(snapshot, execution.outputBlockIds[0]);
  const asset: AssetRecord = {
    assetId,
    projectId: snapshot.project.projectId,
    kind: 'document',
    mimeType: 'text/markdown',
    storageProvider: 'local',
    storageKey: `assets/${assetId}/generated.md`,
    previewUrl: `/api/local/assets/${snapshot.project.projectId}/${assetId}/generated.md`,
    sourceExecutionId: execution.executionId,
    createdAt: new Date().toISOString(),
  };
  snapshot.assets.push(asset);
  execution.status = 'succeeded';
  execution.outputAssetIds = [assetId];
  execution.completedAt = new Date().toISOString();
  result.data = { ...result.data, assetId, body: markdown, sourceExecutionId: execution.executionId, status: 'succeeded' };
  const operation = snapshot.blocks.find((block) => block.blockId === execution.params?.operationBlockId);
  if (operation) operation.data = { ...operation.data, sourceExecutionId: execution.executionId, status: 'succeeded' };
  reconcileWorkflowRuntime(snapshot);
}

function stepFor(snapshot: BoardSnapshot, workflowRunId: string, stepId: string) {
  const step = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => candidate.workflowRunId === workflowRunId && candidate.stepId === stepId,
  );
  assert.ok(step);
  return step;
}

function blockFor(snapshot: BoardSnapshot, blockId: string): BlockRecord {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  assert.ok(block);
  return block;
}

function labelsForSkill(skillId: string): TextGenerationLabels {
  const skillLabels: Record<string, TextGenerationLabels> = {
    'retake.screenplay.from-brief': generationLabels('Generate screenplay', 'Creative brief'),
    'retake.character-bible.from-screenplay': generationLabels('Define characters', 'Screenplay'),
    'retake.scene-bible.from-screenplay': generationLabels('Define scenes', 'Screenplay'),
    'retake.storyboard-plan.from-production-design': {
      ...generationLabels('Generate storyboard plan', 'Screenplay'),
      inputSlots: [
        { slotId: 'screenplay', promptTitle: 'Screenplay', promptPlaceholder: 'Connect the screenplay.' },
        { slotId: 'character_bible', promptTitle: 'Character Bible', promptPlaceholder: 'Connect the Character Bible.' },
        { slotId: 'scene_bible', promptTitle: 'Scene Bible', promptPlaceholder: 'Connect the Scene Bible.' },
      ],
    },
  };
  const result = skillLabels[skillId];
  if (!result) throw new Error(`Missing test labels for Skill: ${skillId}`);
  return result;
}

function generationLabels(operationTitle: string, promptTitle: string): TextGenerationLabels {
  return {
    operationTitle,
    promptTitle,
    promptPlaceholder: `Connect ${promptTitle}.`,
    resultTitle: operationTitle,
    waitingBody: 'Waiting.',
  };
}
