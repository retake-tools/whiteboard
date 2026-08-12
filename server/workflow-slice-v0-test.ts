import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  attachAgentRunExecution,
  createAgentRunForWorkflowSlice,
  nextAgentRunExecutionAction,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import { textDocumentCapabilityIds } from '../src/core/capabilityRegistry';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import { executeExistingTextGenerationOperation, type TextGenerationLabels } from '../src/core/textOperations';
import type { AssetRecord, BlockRecord, BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import { decideWorkflowApproval, workflowGateViewsForRun } from '../src/core/workflowGateRuntime';
import { storyToStoryboardWorkflow } from './studio-domain-test-fixtures';
import { createWorkflowRunForGroup, reconcileWorkflowRuntime, workflowRunViewForId } from '../src/core/workflowRuntime';
import { resetWorkspace } from './local-store/snapshot-store';

const [controllerSource, groupInspectorSource, targetPickerSource] = await Promise.all([
  readFile(new URL('../src/app/useAgentRuntimeController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/GroupInspector.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/WorkflowAgentTargetPicker.tsx', import.meta.url), 'utf8'),
]);
assert.match(controllerSource, /commands\.agent\.createWorkflowSlice/);
assert.match(targetPickerSource, /agentRuntime\.fullWorkflow/);
assert.match(targetPickerSource, /agentRuntime\.untilStep/);
assert.match(groupInspectorSource, /onCreateWorkflowSliceAgentRun/);

const readyTextConnection: ExecutionConnectionSummary = {
  connectionId: 'test-text-connection',
  connectorId: 'openai-compatible',
  providerLabel: 'Test text provider',
  displayName: 'Test text provider',
  description: 'Workflow Slice runtime test connection.',
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

const snapshot = await workflowSnapshot();
const workflowRun = requiredWorkflowRun(snapshot);
const screenplayStep = stepFor(snapshot, workflowRun.workflowRunId, 'screenplay_generate');
const characterStep = stepFor(snapshot, workflowRun.workflowRunId, 'character_define');
const sceneStep = stepFor(snapshot, workflowRun.workflowRunId, 'scene_define');
const slice = createAgentRunForWorkflowSlice(snapshot, workflowRun.workflowRunId, characterStep.stepRunId);

assert.equal(slice.record.target.kind, 'workflow_slice');
assert.deepEqual(
  slice.record.target.kind === 'workflow_slice' ? slice.record.target.until : undefined,
  { kind: 'step', stepId: characterStep.stepId, stepRunId: characterStep.stepRunId },
);
assert.equal(slice.record.stopPolicy.kind, 'workflow_slice_target');
assert.deepEqual(slice.record.scope.allowedStepRunIds, [screenplayStep.stepRunId, characterStep.stepRunId]);
assert.deepEqual(slice.record.scope.allowedCapabilityIds, [
  'story.screenplay.generate',
  'design.character.define',
]);

startAgentRun(snapshot, slice.record.agentRunId);
let action = nextAgentRunExecutionAction(snapshot);
assert.equal(action?.stepRunId, screenplayStep.stepRunId);
let execution = queueStep(snapshot, blockFor(snapshot, action!.operationBlockId));
attachAgentRunExecution(snapshot, slice.record.agentRunId, execution.executionId);
completeStep(snapshot, execution, '# Screenplay\n\nA courier cat reaches the bridge.');
reconcileAgentRuntime(snapshot);

const outsideExecution = queueStep(snapshot, blockFor(snapshot, sceneStep.operationBlockId));
assert.equal(outsideExecution.status, 'queued');
action = nextAgentRunExecutionAction(snapshot);
assert.equal(
  action?.stepRunId,
  characterStep.stepRunId,
  'A queued Step outside the frozen dependency closure must not block Slice dispatch.',
);
execution = queueStep(snapshot, blockFor(snapshot, action!.operationBlockId));
attachAgentRunExecution(snapshot, slice.record.agentRunId, execution.executionId);
completeStep(snapshot, execution, '# Character Bible\n\nOrange courier cat.');
reconcileAgentRuntime(snapshot);

assert.equal(slice.record.status, 'succeeded');
assert.equal(slice.record.stopReason, 'slice_target_satisfied');
assert.deepEqual(slice.record.executionIds, [
  screenplayStep.executionIds[0],
  characterStep.executionIds[0],
]);
assert.equal(nextAgentRunExecutionAction(snapshot), undefined);
const remainingWorkflow = workflowRunViewForId(snapshot, workflowRun.workflowRunId);
assert.ok(remainingWorkflow);
assert.notEqual(remainingWorkflow.status, 'succeeded');
assert.notEqual(remainingWorkflow.status, 'paused');
assert.equal(sceneStep.status, 'queued');

const invalidSnapshot = await workflowSnapshot();
const invalidWorkflow = requiredWorkflowRun(invalidSnapshot);
const invalidCharacter = stepFor(invalidSnapshot, invalidWorkflow.workflowRunId, 'character_define');
const invalidSlice = createAgentRunForWorkflowSlice(
  invalidSnapshot,
  invalidWorkflow.workflowRunId,
  invalidCharacter.stepRunId,
);
startAgentRun(invalidSnapshot, invalidSlice.record.agentRunId);
invalidSlice.record.scope.allowedStepRunIds.push(
  stepFor(invalidSnapshot, invalidWorkflow.workflowRunId, 'scene_define').stepRunId,
);
reconcileAgentRuntime(invalidSnapshot);
assert.equal(invalidSlice.record.status, 'failed');
assert.equal(invalidSlice.record.stopReason, 'target_invalid');
assert.match(invalidSlice.record.error ?? '', /scope changed/);

const gateSnapshot = await workflowSnapshot();
const gateWorkflow = requiredWorkflowRun(gateSnapshot);
gateWorkflow.gateDefinitionLocks = [{
  gateId: 'gate_screenplay_approval',
  kind: 'human_approval',
  required: true,
  definitionHash: 'sha256:test-screenplay-approval-v1',
  subject: {
    kind: 'step_output',
    stepId: 'screenplay_generate',
    outputSlotId: 'screenplay',
  },
}];
const gateTarget = stepFor(gateSnapshot, gateWorkflow.workflowRunId, 'screenplay_generate');
const gateSlice = createAgentRunForWorkflowSlice(
  gateSnapshot,
  gateWorkflow.workflowRunId,
  gateTarget.stepRunId,
);
startAgentRun(gateSnapshot, gateSlice.record.agentRunId);
action = nextAgentRunExecutionAction(gateSnapshot);
execution = queueStep(gateSnapshot, blockFor(gateSnapshot, action!.operationBlockId));
attachAgentRunExecution(gateSnapshot, gateSlice.record.agentRunId, execution.executionId);
completeStep(gateSnapshot, execution, '# Screenplay\n\nApproved draft candidate.');
reconcileAgentRuntime(gateSnapshot);
assert.equal(gateSlice.record.status, 'waiting_approval');
assert.equal(gateSlice.record.stopReason, undefined);
const gate = workflowGateViewsForRun(gateSnapshot, gateWorkflow.workflowRunId)[0];
assert.equal(gate.evaluation?.status, 'waiting_approval');
assert.ok(gate.request);
decideWorkflowApproval(gateSnapshot, {
  approvalRequestId: gate.request.approvalRequestId,
  expectedApprovalRequestVersion: gate.request.recordVersion,
  decision: 'approve',
});
reconcileAgentRuntime(gateSnapshot);
assert.equal(gateSlice.record.status, 'succeeded');
assert.equal(gateSlice.record.stopReason, 'slice_target_satisfied');
assert.notEqual(workflowRunViewForId(gateSnapshot, gateWorkflow.workflowRunId)?.status, 'succeeded');

const retrySnapshot = await workflowSnapshot();
const retryWorkflow = requiredWorkflowRun(retrySnapshot);
const retryStep = stepFor(retrySnapshot, retryWorkflow.workflowRunId, 'screenplay_generate');
const firstFailedExecution = queueStep(
  retrySnapshot,
  blockFor(retrySnapshot, retryStep.operationBlockId),
);
firstFailedExecution.status = 'failed';
firstFailedExecution.errorMessage = 'Provider returned an empty result.';
reconcileWorkflowRuntime(retrySnapshot);
assert.equal(retryStep.status, 'failed');

const retrySlice = createAgentRunForWorkflowSlice(
  retrySnapshot,
  retryWorkflow.workflowRunId,
  retryStep.stepRunId,
);
startAgentRun(retrySnapshot, retrySlice.record.agentRunId);
reconcileAgentRuntime(retrySnapshot);
assert.equal(retrySlice.record.status, 'running');
assert.deepEqual(
  retrySlice.record.executionIds,
  [],
  'A new Agent Run must not inherit a previous Agent Run or manual Execution.',
);
action = nextAgentRunExecutionAction(retrySnapshot);
assert.equal(action?.stepRunId, retryStep.stepRunId);

const secondFailedExecution = queueStep(
  retrySnapshot,
  blockFor(retrySnapshot, action!.operationBlockId),
);
attachAgentRunExecution(retrySnapshot, retrySlice.record.agentRunId, secondFailedExecution.executionId);
assert.deepEqual(retryStep.executionIds, [
  firstFailedExecution.executionId,
  secondFailedExecution.executionId,
]);
retryStep.executionIds = [firstFailedExecution.executionId];
reconcileWorkflowRuntime(retrySnapshot);
reconcileAgentRuntime(retrySnapshot);
assert.equal(retrySlice.record.status, 'running');
assert.deepEqual(
  retrySlice.record.executionIds,
  [secondFailedExecution.executionId],
  'AgentRun ownership must remain observable while a concurrent save temporarily drops StepRun lineage.',
);
assert.equal(
  nextAgentRunExecutionAction(retrySnapshot),
  undefined,
  'An owned active Execution must prevent automatic redispatch when StepRun lineage is temporarily stale.',
);
retryStep.executionIds = [firstFailedExecution.executionId, secondFailedExecution.executionId];
secondFailedExecution.status = 'failed';
secondFailedExecution.errorMessage = 'Retry also failed.';
reconcileAgentRuntime(retrySnapshot);
assert.equal(retrySlice.record.status, 'needs_attention');
assert.deepEqual(retrySlice.record.executionIds, [secondFailedExecution.executionId]);
assert.equal(nextAgentRunExecutionAction(retrySnapshot), undefined);

console.log(JSON.stringify({
  ok: true,
  target: 'workflow_slice.until_step',
  dependencyClosureFrozen: true,
  outsideParallelStepIgnored: true,
  requiredHumanGateEnforced: true,
  failedStepRetryCreatesNewExecution: true,
  staleLineageDoesNotRedispatch: true,
  workflowStatusPreserved: true,
}));

async function workflowSnapshot(): Promise<BoardSnapshot> {
  const snapshot = await resetWorkspace();
  snapshot.blocks = [];
  snapshot.edges = [];
  snapshot.assets = [];
  snapshot.executions = [];
  snapshot.agentRuns = [];
  snapshot.workflowRuns = [];
  snapshot.workflowStepRuns = [];
  snapshot.historyEvents = [];
  const projection = projectWorkflowDraft(snapshot, {
    workflowId: storyToStoryboardWorkflow.workflowId,
    workflowTitle: 'Story to storyboard plan',
    outputPlaceholder: 'Waiting.',
    labelsForSkill,
    connectionIdForCapability: () => readyTextConnection.connectionId,
  });
  blockFor(snapshot, projection.workflowInputBlockIds[0]).data.body = 'A courier cat reaches the cinema.';
  createWorkflowRunForGroup(snapshot, projection.groupBlock.blockId);
  return snapshot;
}

function requiredWorkflowRun(snapshot: BoardSnapshot) {
  const workflowRun = (snapshot.workflowRuns ?? [])[0];
  assert.ok(workflowRun);
  return workflowRun;
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
  result.data = {
    ...result.data,
    assetId,
    body: markdown,
    sourceExecutionId: execution.executionId,
    status: 'succeeded',
  };
  const operation = snapshot.blocks.find((block) => block.blockId === execution.params?.operationBlockId);
  if (operation) {
    operation.data = { ...operation.data, sourceExecutionId: execution.executionId, status: 'succeeded' };
  }
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
