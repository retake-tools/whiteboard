import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import { textDocumentCapabilityIds } from '../src/core/capabilityRegistry';
import { executeExistingTextGenerationOperation, type TextGenerationLabels } from '../src/core/textOperations';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import { storyToStoryboardWorkflow } from '../src/core/workflowRegistry';
import {
  acceptWorkflowStepOutputs,
  createWorkflowRunForGroup,
  reconcileWorkflowRuntime,
  workflowRunViewForGroup,
  workflowStepRuntimeForOperation,
} from '../src/core/workflowRuntime';
import type { AssetRecord, BlockRecord, BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { loadSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const readyTextConnection: ExecutionConnectionSummary = {
  connectionId: 'test-text-connection',
  connectorId: 'openai-compatible',
  providerLabel: 'Test text provider',
  displayName: 'Test text provider',
  description: 'Workflow runtime test connection.',
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

const [groupToolbarSource, groupInspectorSource, whiteboardCanvasSource] = await Promise.all([
  readFile(new URL('../src/components/GroupToolbar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/GroupInspector.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/WhiteboardCanvas.tsx', import.meta.url), 'utf8'),
]);
assert.match(groupToolbarSource, /workflow-run-control/);
assert.match(groupInspectorSource, /workflow-run-step-list/);
assert.match(groupInspectorSource, /onSelectWorkflowOutput/);
assert.match(groupInspectorSource, /workflow-output-selection/);
assert.match(whiteboardCanvasSource, /workflowRuntime\.createWorkflowRun/);

const snapshot = await emptySnapshot();
const firstProjection = projectWorkflowDraft(snapshot, projectionInput());
const brief = blockFor(snapshot, firstProjection.workflowInputBlockIds[0]);
brief.data.body = 'A cat must carry the last energy core across a ruined city.';
const firstRun = createWorkflowRunForGroup(snapshot, firstProjection.groupBlock.blockId);

assert.equal(firstRun.status, 'ready');
assert.deepEqual(firstRun.record.workflowDefinitionLock, {
  workflowId: storyToStoryboardWorkflow.workflowId,
  version: storyToStoryboardWorkflow.version,
  definitionHash: storyToStoryboardWorkflow.definitionHash,
});
assert.deepEqual(firstRun.steps.map((step) => [step.record.stepId, step.status]), [
  ['screenplay_generate', 'ready'],
  ['character_define', 'pending'],
  ['scene_define', 'pending'],
  ['storyboard_plan', 'pending'],
]);
assert.equal(firstRun.steps.every((step) => step.record.capabilityLock.definitionHash.startsWith('sha256:')), true);
assert.equal(firstRun.steps.every((step) => step.record.skillLock.definitionHash.startsWith('sha256:')), true);
assert.equal(firstProjection.groupBlock.data.workflowRunId, firstRun.record.workflowRunId);

const screenplayOperation = operationForStep(snapshot, firstRun.record.workflowRunId, 'screenplay_generate');
const screenplayExecution = queueStep(snapshot, screenplayOperation);
assert.equal(screenplayExecution.workflowRunId, firstRun.record.workflowRunId);
assert.equal(screenplayExecution.stepRunId, stepFor(snapshot, firstRun.record.workflowRunId, 'screenplay_generate').stepRunId);
assert.equal(workflowStepRuntimeForOperation(snapshot, screenplayOperation.blockId)?.status, 'queued');
screenplayExecution.status = 'running';
reconcileWorkflowRuntime(snapshot);
assert.equal(workflowStepRuntimeForOperation(snapshot, screenplayOperation.blockId)?.status, 'running');
const firstScreenplayAssetId = completeStep(snapshot, screenplayExecution, '# Screenplay v1\n\nThe cat reaches the tower.');
assert.deepEqual(stepStatuses(snapshot, firstRun.record.workflowRunId), [
  ['screenplay_generate', 'succeeded', 'current'],
  ['character_define', 'ready', 'current'],
  ['scene_define', 'ready', 'current'],
  ['storyboard_plan', 'pending', 'current'],
]);

const characterExecution = queueStep(snapshot, operationForStep(snapshot, firstRun.record.workflowRunId, 'character_define'));
completeStep(snapshot, characterExecution, '# Character Bible\n\nOrange cat courier.');
const sceneExecution = queueStep(snapshot, operationForStep(snapshot, firstRun.record.workflowRunId, 'scene_define'));
completeStep(snapshot, sceneExecution, '# Scene Bible\n\nRuined city and energy tower.');
assert.equal(stepView(snapshot, firstRun.record.workflowRunId, 'storyboard_plan').status, 'ready');

const storyboardExecution = queueStep(snapshot, operationForStep(snapshot, firstRun.record.workflowRunId, 'storyboard_plan'));
completeStep(snapshot, storyboardExecution, '# Storyboard Plan\n\nShot 01: the cat enters frame.');
assert.equal(workflowRunViewForGroup(snapshot, firstProjection.groupBlock.blockId)?.status, 'succeeded');
assert.equal(snapshot.executions.filter((execution) => execution.workflowRunId === firstRun.record.workflowRunId).length, 4);
assert.equal(
  stepFor(snapshot, firstRun.record.workflowRunId, 'screenplay_generate').outputAcceptancePolicy,
  'automatic',
  'Existing document Steps must keep automatic output acceptance.',
);

brief.data.body = 'A cat and a dog must carry the last energy core across a flooded ruined city.';
reconcileWorkflowRuntime(snapshot);
const outdatedRun = workflowRunViewForGroup(snapshot, firstProjection.groupBlock.blockId);
assert.equal(outdatedRun?.status, 'needs_attention');
assert.deepEqual(outdatedRun?.steps.map((step) => step.freshness), ['outdated', 'outdated', 'outdated', 'outdated']);
assert.equal(snapshot.assets.some((asset) => asset.assetId === firstScreenplayAssetId), true, 'Upstream edits must not delete old assets.');

const screenplayRetry = queueStep(snapshot, screenplayOperation);
const secondScreenplayAssetId = completeStep(snapshot, screenplayRetry, '# Screenplay v2\n\nThe cat and dog reach the flooded tower.');
assert.notEqual(secondScreenplayAssetId, firstScreenplayAssetId);
assert.equal(snapshot.assets.some((asset) => asset.assetId === firstScreenplayAssetId), true);
assert.deepEqual(
  stepFor(snapshot, firstRun.record.workflowRunId, 'screenplay_generate').outputAssetIds,
  [firstScreenplayAssetId, secondScreenplayAssetId],
);
assert.equal(stepView(snapshot, firstRun.record.workflowRunId, 'screenplay_generate').freshness, 'current');
assert.equal(stepView(snapshot, firstRun.record.workflowRunId, 'character_define').freshness, 'outdated');

await saveSnapshot(snapshot);
const recovered = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
assert.equal(workflowRunViewForGroup(recovered, firstProjection.groupBlock.blockId)?.status, 'needs_attention');
assert.equal(recovered.executions.find((execution) => execution.executionId === screenplayRetry.executionId)?.stepRunId, screenplayRetry.stepRunId);
const staleRuntimeSnapshot = structuredClone(recovered);
const durableRun = (recovered.workflowRuns ?? []).find((run) => run.workflowRunId === firstRun.record.workflowRunId);
assert.ok(durableRun);
durableRun.status = 'paused';
durableRun.recordVersion += 1;
await saveSnapshot(recovered);
await saveSnapshot(staleRuntimeSnapshot);
const conflictRecovered = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
assert.equal(
  (conflictRecovered.workflowRuns ?? []).find((run) => run.workflowRunId === firstRun.record.workflowRunId)?.status,
  'paused',
  'A stale board save must not roll back a newer WorkflowRun record.',
);

const failedSnapshot = await emptySnapshot();
const failedProjection = projectWorkflowDraft(failedSnapshot, projectionInput());
blockFor(failedSnapshot, failedProjection.workflowInputBlockIds[0]).data.body = 'A short test brief.';
const failedRun = createWorkflowRunForGroup(failedSnapshot, failedProjection.groupBlock.blockId);
const failedOperation = operationForStep(failedSnapshot, failedRun.record.workflowRunId, 'screenplay_generate');
const failedExecution = queueStep(failedSnapshot, failedOperation);
failedExecution.status = 'failed';
failedExecution.errorMessage = 'Provider unavailable.';
reconcileWorkflowRuntime(failedSnapshot);
assert.equal(stepView(failedSnapshot, failedRun.record.workflowRunId, 'screenplay_generate').status, 'failed');
assert.equal(workflowRunViewForGroup(failedSnapshot, failedProjection.groupBlock.blockId)?.status, 'needs_attention');
assert.equal(workflowStepRuntimeForOperation(failedSnapshot, failedOperation.blockId)?.canStart, true);
const retryAfterFailure = queueStep(failedSnapshot, failedOperation);
assert.deepEqual(
  stepFor(failedSnapshot, failedRun.record.workflowRunId, 'screenplay_generate').executionIds,
  [failedExecution.executionId, retryAfterFailure.executionId],
);

const manualSnapshot = await emptySnapshot();
const manualProjection = projectWorkflowDraft(manualSnapshot, projectionInput());
blockFor(manualSnapshot, manualProjection.workflowInputBlockIds[0]).data.body = 'Manual canvas path.';
const manualExecution = queueStep(
  manualSnapshot,
  blockFor(manualSnapshot, manualProjection.operationBlockIds[0]),
);
assert.equal(manualExecution.workflowRunId, undefined, 'Manual canvas execution must remain valid without WorkflowRun.');
assert.equal(manualExecution.stepRunId, undefined);
assert.throws(
  () => createWorkflowRunForGroup(manualSnapshot, manualProjection.groupBlock.blockId),
  /before executing projected Operations/,
);

const incompleteSnapshot = await emptySnapshot();
const incompleteProjection = projectWorkflowDraft(incompleteSnapshot, projectionInput());
blockFor(incompleteSnapshot, incompleteProjection.workflowInputBlockIds[0]).data.body = 'Incomplete runtime record.';
const incompleteRun = createWorkflowRunForGroup(incompleteSnapshot, incompleteProjection.groupBlock.blockId);
const missingDependency = stepFor(incompleteSnapshot, incompleteRun.record.workflowRunId, 'screenplay_generate');
incompleteSnapshot.workflowStepRuns = (incompleteSnapshot.workflowStepRuns ?? []).filter(
  (step) => step.stepRunId !== missingDependency.stepRunId,
);
assert.equal(stepView(incompleteSnapshot, incompleteRun.record.workflowRunId, 'character_define').status, 'blocked');
assert.equal(workflowRunViewForGroup(incompleteSnapshot, incompleteProjection.groupBlock.blockId)?.status, 'needs_attention');

const selectionSnapshot = await emptySnapshot();
const selectionProjection = projectWorkflowDraft(selectionSnapshot, projectionInput());
blockFor(selectionSnapshot, selectionProjection.workflowInputBlockIds[0]).data.body = 'Choose one generated candidate.';
const selectionDefinitionStep = storyToStoryboardWorkflow.steps.find(
  (step) => step.stepId === 'screenplay_generate',
);
assert.ok(selectionDefinitionStep);
selectionDefinitionStep.outputAcceptancePolicy = 'manual_selection';
const selectionRun = createWorkflowRunForGroup(selectionSnapshot, selectionProjection.groupBlock.blockId);
delete selectionDefinitionStep.outputAcceptancePolicy;
const selectionStep = stepFor(selectionSnapshot, selectionRun.record.workflowRunId, 'screenplay_generate');
assert.equal(selectionStep.outputAcceptancePolicy, 'manual_selection');
const firstCandidateExecution = queueStep(
  selectionSnapshot,
  operationForStep(selectionSnapshot, selectionRun.record.workflowRunId, 'screenplay_generate'),
);
const firstCandidateAssetId = completeStep(
  selectionSnapshot,
  firstCandidateExecution,
  '# Candidate one\n\nFirst selectable output.',
);
assert.equal(
  stepView(selectionSnapshot, selectionRun.record.workflowRunId, 'screenplay_generate').status,
  'waiting_selection',
);
assert.equal(
  workflowRunViewForGroup(selectionSnapshot, selectionProjection.groupBlock.blockId)?.status,
  'waiting_selection',
);
assert.deepEqual(selectionRun.record.currentStepIds, ['screenplay_generate']);
const firstCandidateBlock = structuredClone(blockFor(selectionSnapshot, firstCandidateExecution.outputBlockIds[0]));
firstCandidateBlock.blockId = 'block_selection_candidate_one';
firstCandidateBlock.position.x += 420;
selectionSnapshot.blocks.push(firstCandidateBlock);

const secondCandidateExecution = queueStep(
  selectionSnapshot,
  operationForStep(selectionSnapshot, selectionRun.record.workflowRunId, 'screenplay_generate'),
);
const secondCandidateAssetId = completeStep(
  selectionSnapshot,
  secondCandidateExecution,
  '# Candidate two\n\nSecond selectable output.',
);
assert.deepEqual(selectionStep.outputAssetIds, [firstCandidateAssetId, secondCandidateAssetId]);
assert.equal(selectionSnapshot.assets.some((asset) => asset.assetId === firstCandidateAssetId), true);
const selectionVersion = selectionStep.recordVersion;
const acceptedView = acceptWorkflowStepOutputs(selectionSnapshot, {
  stepRunId: selectionStep.stepRunId,
  acceptedOutputAssetIds: [secondCandidateAssetId],
  expectedStepRunVersion: selectionVersion,
});
assert.equal(acceptedView.status, 'succeeded');
assert.deepEqual(selectionStep.acceptedOutputAssetIds, [secondCandidateAssetId]);
assert.equal(selectionStep.acceptedBy, 'user');
assert.ok(selectionStep.acceptedAt);
assert.equal(blockFor(selectionSnapshot, secondCandidateExecution.outputBlockIds[0]).data.reviewStatus, 'selected');
assert.equal(firstCandidateBlock.data.reviewStatus, undefined);
assert.throws(
  () => acceptWorkflowStepOutputs(selectionSnapshot, {
    stepRunId: selectionStep.stepRunId,
    acceptedOutputAssetIds: [firstCandidateAssetId],
    expectedStepRunVersion: selectionVersion,
  }),
  /version conflict/,
);
const foreignAsset: AssetRecord = {
  ...selectionSnapshot.assets.find((asset) => asset.assetId === firstCandidateAssetId)!,
  assetId: 'asset_not_in_step_execution_outputs',
};
selectionSnapshot.assets.push(foreignAsset);
assert.throws(
  () => acceptWorkflowStepOutputs(selectionSnapshot, {
    stepRunId: selectionStep.stepRunId,
    acceptedOutputAssetIds: [foreignAsset.assetId],
    expectedStepRunVersion: selectionStep.recordVersion,
  }),
  /not a selectable output/,
);
const reselectedView = acceptWorkflowStepOutputs(selectionSnapshot, {
  stepRunId: selectionStep.stepRunId,
  acceptedOutputAssetIds: [firstCandidateAssetId],
  expectedStepRunVersion: selectionStep.recordVersion,
});
assert.equal(reselectedView.status, 'succeeded');
assert.deepEqual(selectionStep.acceptedOutputAssetIds, [firstCandidateAssetId]);
assert.equal(firstCandidateBlock.data.reviewStatus, 'selected');
assert.equal(blockFor(selectionSnapshot, secondCandidateExecution.outputBlockIds[0]).data.reviewStatus, undefined);
assert.equal(selectionSnapshot.assets.some((asset) => asset.assetId === secondCandidateAssetId), true);
await saveSnapshot(selectionSnapshot);
const recoveredSelection = await loadSnapshot(
  selectionSnapshot.project.projectId,
  selectionSnapshot.board.boardId,
);
const recoveredSelectionStep = stepFor(
  recoveredSelection,
  selectionRun.record.workflowRunId,
  'screenplay_generate',
);
assert.deepEqual(recoveredSelectionStep.acceptedOutputAssetIds, [firstCandidateAssetId]);
assert.equal(blockFor(recoveredSelection, firstCandidateBlock.blockId).data.reviewStatus, 'selected');

console.log(JSON.stringify({
  ok: true,
  workflowRunRecovered: true,
  staleRuntimeWriteRejected: true,
  lockedDefinitionAndSteps: true,
  executionLineageAttached: true,
  manualReadyStepProgression: true,
  upstreamFreshnessPropagation: true,
  oldAssetsPreserved: true,
  failedStepRetryable: true,
  manualCanvasPathPreserved: true,
  missingDependencyBlocked: true,
  manualOutputSelection: true,
  outputReselectionPreservesAssets: true,
  outputSelectionVersionAndLineageValidated: true,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const next = await resetWorkspace();
  next.blocks = [];
  next.edges = [];
  next.assets = [];
  next.executions = [];
  next.workflowRuns = [];
  next.workflowStepRuns = [];
  next.historyEvents = [];
  return next;
}

function projectionInput() {
  return {
    workflowId: storyToStoryboardWorkflow.workflowId,
    workflowTitle: 'Story to storyboard plan',
    outputPlaceholder: 'Run the upstream operation.',
    labelsForSkill,
    connectionIdForCapability: () => readyTextConnection.connectionId,
  };
}

function queueStep(snapshot: BoardSnapshot, operation: BlockRecord): ExecutionRecord {
  return executeExistingTextGenerationOperation(snapshot, {
    connection: readyTextConnection,
    labels: labelsForSkill(String(operation.data.skillId)),
    operationBlockId: operation.blockId,
  }).execution;
}

function completeStep(snapshot: BoardSnapshot, execution: ExecutionRecord, markdown: string): string {
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
  return assetId;
}

function operationForStep(snapshot: BoardSnapshot, workflowRunId: string, stepId: string): BlockRecord {
  return blockFor(snapshot, stepFor(snapshot, workflowRunId, stepId).operationBlockId);
}

function stepFor(snapshot: BoardSnapshot, workflowRunId: string, stepId: string) {
  const step = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => candidate.workflowRunId === workflowRunId && candidate.stepId === stepId,
  );
  assert.ok(step);
  return step;
}

function stepView(snapshot: BoardSnapshot, workflowRunId: string, stepId: string) {
  const step = stepFor(snapshot, workflowRunId, stepId);
  const view = workflowStepRuntimeForOperation(snapshot, step.operationBlockId);
  assert.ok(view);
  return view;
}

function stepStatuses(snapshot: BoardSnapshot, workflowRunId: string) {
  const run = (snapshot.workflowRuns ?? []).find((candidate) => candidate.workflowRunId === workflowRunId);
  assert.ok(run);
  return run.stepRunIds.map((stepRunId) => {
    const step = (snapshot.workflowStepRuns ?? []).find((candidate) => candidate.stepRunId === stepRunId);
    assert.ok(step);
    const view = workflowStepRuntimeForOperation(snapshot, step.operationBlockId);
    assert.ok(view);
    return [step.stepId, view.status, view.freshness];
  });
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
