import assert from 'node:assert/strict';
import { capabilityDefinitionFor, textDocumentCapabilityIds } from '../src/core/capabilityRegistry';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import { syncExecutionOutputContractSnapshot } from '../src/core/executionContractSnapshot';
import { executeExistingTextGenerationOperation, type TextGenerationLabels } from '../src/core/textOperations';
import type { AssetRecord, BlockRecord, BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import {
  acceptWorkflowStepOutputs,
  createWorkflowRunForGroup,
  reconcileWorkflowRuntime,
} from '../src/core/workflowRuntime';
import { storyToStoryboardWorkflow } from '../src/core/workflowRegistry';
import { readProjectArtifactLibrary } from './artifact-library-service';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { readProjectArtifacts } from './local-store/artifact-store';
import {
  markExecutionRunning,
  updateDocumentResultBlock,
} from './local-store/execution-store';
import { loadSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import { materializeWorkflowOutputArtifacts } from './workflow-output-artifact-service';

const readyTextConnection: ExecutionConnectionSummary = {
  connectionId: 'test-text-connection',
  connectorId: 'openai-compatible',
  providerLabel: 'Test text provider',
  displayName: 'Test text provider',
  description: 'Workflow output Artifact materialization test connection.',
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

const automatic = await emptySnapshot();
const automaticProjection = projectWorkflowDraft(automatic, projectionInput());
blockFor(automatic, automaticProjection.workflowInputBlockIds[0]).data.body = 'A cat crosses a flooded city.';
const automaticRun = createWorkflowRunForGroup(automatic, automaticProjection.groupBlock.blockId);
assert.deepEqual(
  automaticRun.record.outputSlotLocks.find(
    (output) => output.workflowOutputSlotId === 'screenplay',
  ),
  {
    artifactType: 'screenplay_master',
    outputSlotId: 'screenplay',
    stepId: 'screenplay_generate',
    workflowOutputSlotId: 'screenplay',
  },
);
const automaticStep = stepFor(automatic, automaticRun.record.workflowRunId, 'screenplay_generate');
assert.deepEqual(automaticStep.outputArtifactBindings, []);
const firstExecution = queueStep(automatic, automaticStep);
await saveSnapshot(automatic);
const firstStarted = await markExecutionRunning({
  projectId: automatic.project.projectId,
  boardId: automatic.board.boardId,
  executionId: firstExecution.executionId,
});
const firstAsset = await generatedDocument(firstStarted.snapshot, firstStarted.execution, '# Screenplay v1');
const firstCompleted = await updateDocumentResultBlock({
  projectId: automatic.project.projectId,
  boardId: automatic.board.boardId,
  executionId: firstExecution.executionId,
  assetId: firstAsset.assetId,
  resultBlockId: firstExecution.outputBlockIds[0],
  title: 'Generate screenplay',
  documentKind: 'screenplay_master',
  markdown: '# Screenplay v1',
});
const firstBoundStep = stepFor(
  firstCompleted.snapshot,
  automaticRun.record.workflowRunId,
  'screenplay_generate',
);
assert.equal(firstBoundStep.outputArtifactBindings.length, 1);
const firstBinding = firstBoundStep.outputArtifactBindings[0];
assert.equal(firstBinding.workflowOutputSlotId, 'screenplay');
assert.equal(firstBinding.outputSlotId, 'screenplay');
assert.equal(firstBinding.artifactType, 'screenplay_master');
assert.deepEqual(firstBinding.assetIds, [firstAsset.assetId]);
assert.deepEqual(firstBinding.executionIds, [firstExecution.executionId]);
const firstArtifacts = await readProjectArtifacts(automatic.project.projectId);
assert.equal(firstArtifacts.artifacts.length, 1);
assert.equal(firstArtifacts.revisions.length, 1);
assert.equal(firstArtifacts.artifacts[0].scope, 'workflow_run');
assert.equal(firstArtifacts.artifacts[0].libraryVisibility, 'hidden');
assert.equal(firstArtifacts.artifacts[0].semanticKey, 'workflow_output:screenplay');
assert.equal(firstArtifacts.revisions[0].sourceContext?.workflowOutputSlotId, 'screenplay');
assert.equal((await readProjectArtifactLibrary(automatic.project.projectId)).items.length, 0);

const rerunSnapshot = firstCompleted.snapshot;
blockFor(rerunSnapshot, automaticProjection.workflowInputBlockIds[0]).data.body = 'A cat and dog cross a flooded city.';
reconcileWorkflowRuntime(rerunSnapshot);
const secondExecution = queueStep(
  rerunSnapshot,
  stepFor(rerunSnapshot, automaticRun.record.workflowRunId, 'screenplay_generate'),
);
assert.deepEqual(
  stepFor(rerunSnapshot, automaticRun.record.workflowRunId, 'screenplay_generate').outputArtifactBindings,
  [],
  'Starting a rerun must clear the current StepRun binding without deleting Artifact history.',
);
await saveSnapshot(rerunSnapshot);
const secondStarted = await markExecutionRunning({
  projectId: rerunSnapshot.project.projectId,
  boardId: rerunSnapshot.board.boardId,
  executionId: secondExecution.executionId,
});
const secondAsset = await generatedDocument(secondStarted.snapshot, secondStarted.execution, '# Screenplay v2');
const secondCompleted = await updateDocumentResultBlock({
  projectId: automatic.project.projectId,
  boardId: automatic.board.boardId,
  executionId: secondExecution.executionId,
  assetId: secondAsset.assetId,
  resultBlockId: secondExecution.outputBlockIds[0],
  title: 'Generate screenplay',
  documentKind: 'screenplay_master',
  markdown: '# Screenplay v2',
});
const secondBinding = stepFor(
  secondCompleted.snapshot,
  automaticRun.record.workflowRunId,
  'screenplay_generate',
).outputArtifactBindings[0];
assert.equal(secondBinding.artifactId, firstBinding.artifactId);
assert.notEqual(secondBinding.artifactRevisionId, firstBinding.artifactRevisionId);
assert.deepEqual(secondBinding.assetIds, [secondAsset.assetId]);
const rerunArtifacts = await readProjectArtifacts(automatic.project.projectId);
assert.equal(rerunArtifacts.artifacts.length, 1);
assert.equal(rerunArtifacts.revisions.length, 2);
assert.equal(rerunArtifacts.artifacts[0].currentRevisionId, secondBinding.artifactRevisionId);
assert.equal(
  rerunArtifacts.revisions.some(
    (revision) => revision.artifactRevisionId === firstBinding.artifactRevisionId,
  ),
  true,
);

const manual = await emptySnapshot();
const manualProjection = projectWorkflowDraft(manual, projectionInput());
blockFor(manual, manualProjection.workflowInputBlockIds[0]).data.body = 'Choose the screenplay output.';
const screenplayDefinitionStep = storyToStoryboardWorkflow.steps.find(
  (step) => step.stepId === 'screenplay_generate',
);
assert.ok(screenplayDefinitionStep);
screenplayDefinitionStep.outputAcceptancePolicy = 'manual_selection';
const manualRun = createWorkflowRunForGroup(manual, manualProjection.groupBlock.blockId);
delete screenplayDefinitionStep.outputAcceptancePolicy;
const manualStep = stepFor(manual, manualRun.record.workflowRunId, 'screenplay_generate');
const manualExecution = queueStep(manual, manualStep);
await saveSnapshot(manual);
const manualStarted = await markExecutionRunning({
  projectId: manual.project.projectId,
  boardId: manual.board.boardId,
  executionId: manualExecution.executionId,
});
const manualAsset = await generatedDocument(manualStarted.snapshot, manualStarted.execution, '# Selected screenplay');
const manualCompleted = await updateDocumentResultBlock({
  projectId: manual.project.projectId,
  boardId: manual.board.boardId,
  executionId: manualExecution.executionId,
  assetId: manualAsset.assetId,
  resultBlockId: manualExecution.outputBlockIds[0],
  title: 'Generate screenplay',
  documentKind: 'screenplay_master',
  markdown: '# Selected screenplay',
});
assert.deepEqual(
  stepFor(manualCompleted.snapshot, manualRun.record.workflowRunId, 'screenplay_generate')
    .outputArtifactBindings,
  [],
  'Manual-selection candidates must not materialize before acceptance.',
);
assert.equal((await readProjectArtifacts(manual.project.projectId)).artifacts.length, 0);
const accepted = manualCompleted.snapshot;
const acceptedStep = stepFor(accepted, manualRun.record.workflowRunId, 'screenplay_generate');
acceptWorkflowStepOutputs(accepted, {
  acceptedOutputAssetIds: [manualAsset.assetId],
  expectedStepRunVersion: acceptedStep.recordVersion,
  stepRunId: acceptedStep.stepRunId,
});
await saveSnapshot(accepted);
const acceptedResult = await materializeWorkflowOutputArtifacts({
  boardId: accepted.board.boardId,
  projectId: accepted.project.projectId,
  trigger: { kind: 'output_accepted', stepRunId: acceptedStep.stepRunId },
});
const acceptedBinding = stepFor(
  acceptedResult.snapshot,
  manualRun.record.workflowRunId,
  'screenplay_generate',
).outputArtifactBindings[0];
assert.deepEqual(acceptedBinding.assetIds, [manualAsset.assetId]);
const acceptedArtifacts = await readProjectArtifacts(manual.project.projectId);
assert.equal(acceptedArtifacts.revisions[0].createdByActor.actorType, 'user');
assert.equal(acceptedArtifacts.artifacts[0].libraryVisibility, 'hidden');

const interrupted = await emptySnapshot();
const interruptedProjection = projectWorkflowDraft(interrupted, projectionInput());
blockFor(interrupted, interruptedProjection.workflowInputBlockIds[0]).data.body = 'Recover an interrupted binding write.';
const interruptedRun = createWorkflowRunForGroup(interrupted, interruptedProjection.groupBlock.blockId);
const interruptedStep = stepFor(interrupted, interruptedRun.record.workflowRunId, 'screenplay_generate');
const interruptedExecution = queueStep(interrupted, interruptedStep);
await saveSnapshot(interrupted);
const interruptedStarted = await markExecutionRunning({
  projectId: interrupted.project.projectId,
  boardId: interrupted.board.boardId,
  executionId: interruptedExecution.executionId,
});
const interruptedAsset = await generatedDocument(
  interruptedStarted.snapshot,
  interruptedStarted.execution,
  '# Interrupted',
);
const interruptedCompletion = interruptedStarted.snapshot;
completeExecutionInMemory(interruptedCompletion, interruptedStarted.execution, interruptedAsset);
await saveSnapshot(interruptedCompletion);
await assert.rejects(
  materializeWorkflowOutputArtifacts({
    boardId: interrupted.board.boardId,
    projectId: interrupted.project.projectId,
    trigger: { kind: 'execution_succeeded', executionId: interruptedExecution.executionId },
  }, {
    afterArtifactWrite: async () => {
      const changed = await loadSnapshot(interrupted.project.projectId, interrupted.board.boardId);
      const changedStep = stepFor(changed, interruptedRun.record.workflowRunId, 'screenplay_generate');
      changedStep.recordVersion += 1;
      changedStep.updatedAt = new Date().toISOString();
      await saveSnapshot(changed);
    },
  }),
  /Workflow StepRun version conflict/,
);
const interruptedArtifacts = await readProjectArtifacts(interrupted.project.projectId);
assert.equal(interruptedArtifacts.revisions.length, 1);
const interruptedWithoutBinding = await loadSnapshot(
  interrupted.project.projectId,
  interrupted.board.boardId,
);
assert.deepEqual(
  stepFor(interruptedWithoutBinding, interruptedRun.record.workflowRunId, 'screenplay_generate')
    .outputArtifactBindings,
  [],
);
const recovered = await materializeWorkflowOutputArtifacts({
  boardId: interrupted.board.boardId,
  projectId: interrupted.project.projectId,
  trigger: { kind: 'execution_succeeded', executionId: interruptedExecution.executionId },
});
assert.equal(recovered.bindings.length, 1);
assert.equal(
  (await readProjectArtifacts(interrupted.project.projectId)).revisions.length,
  1,
  'Retry after an interrupted binding write must reuse the idempotent Revision.',
);
const idempotentRetry = await materializeWorkflowOutputArtifacts({
  boardId: interrupted.board.boardId,
  projectId: interrupted.project.projectId,
  trigger: { kind: 'execution_succeeded', executionId: interruptedExecution.executionId },
});
assert.equal(idempotentRetry.bindings.length, 0);
assert.equal((await readProjectArtifacts(interrupted.project.projectId)).revisions.length, 1);

console.log(JSON.stringify({
  ok: true,
  automaticOutputMaterialized: true,
  hiddenWorkflowArtifactExcludedFromLibrary: true,
  rerunAdvancesRevisionAndPreservesHistory: true,
  manualSelectionWaitsForAcceptance: true,
  acceptedOutputMaterialized: true,
  interruptedBindingWriteRecoverable: true,
  idempotentRetryDoesNotDuplicateRevision: true,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const snapshot = await resetWorkspace();
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
  snapshot.historyEvents = [];
  await saveSnapshot(snapshot);
  return snapshot;
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

function queueStep(snapshot: BoardSnapshot, step: ReturnType<typeof stepFor>): ExecutionRecord {
  return executeExistingTextGenerationOperation(snapshot, {
    connection: readyTextConnection,
    labels: labelsForSkill(step.skillLock.skillId),
    operationBlockId: step.operationBlockId,
  }).execution;
}

async function generatedDocument(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  markdown: string,
): Promise<AssetRecord> {
  return createAssetFromDataUrl({
    projectId: snapshot.project.projectId,
    sourceExecutionId: execution.executionId,
    dataUrl: `data:text/markdown;base64,${Buffer.from(markdown, 'utf8').toString('base64')}`,
    fileName: 'generated.md',
    kind: 'document',
  });
}

function completeExecutionInMemory(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  asset: AssetRecord,
): void {
  snapshot.assets.push(asset);
  execution.status = 'succeeded';
  execution.outputAssetIds = [asset.assetId];
  execution.completedAt = new Date().toISOString();
  syncExecutionOutputContractSnapshot(execution);
  const resultBlock = blockFor(snapshot, execution.outputBlockIds[0]);
  resultBlock.data = {
    ...resultBlock.data,
    assetId: asset.assetId,
    body: '# Interrupted',
    sourceExecutionId: execution.executionId,
    status: 'succeeded',
  };
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
  const capability = capabilityDefinitionFor(
    storyToStoryboardWorkflow.steps.find((step) => step.skillLock.skillId === skillId)
      ?.capabilityLock.capabilityId ?? '',
  );
  return {
    operationTitle: capability.displayName,
    promptTitle: capability.inputSlots[0]?.semanticRole ?? 'Input',
    promptPlaceholder: 'Connect the Workflow input.',
    resultTitle: capability.displayName,
    waitingBody: 'Waiting.',
    inputSlots: capability.inputSlots.map((slot) => ({
      slotId: slot.slotId,
      promptTitle: slot.semanticRole,
      promptPlaceholder: `Connect ${slot.semanticRole}.`,
    })),
  };
}
