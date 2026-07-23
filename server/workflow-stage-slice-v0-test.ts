import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  attachAgentRunExecution,
  createAgentRunForWorkflowStageSlice,
  nextAgentRunExecutionAction,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import { capabilityDefinitionFor, textDocumentCapabilityIds } from '../src/core/capabilityRegistry';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import { executeExistingTextGenerationOperation, type TextGenerationLabels } from '../src/core/textOperations';
import type { AssetRecord, BlockRecord, BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import { decideWorkflowApproval, workflowGateViewsForRun } from '../src/core/workflowGateRuntime';
import { storyToStoryboardWorkflow } from '../src/core/workflowRegistry';
import {
  createWorkflowRunForGroup,
  workflowRunViewForId,
} from '../src/core/workflowRuntime';
import { reconcileAgentArtifactTargets } from './agent-artifact-target-service';
import { createAssetFromDataUrl } from './local-store/asset-store';
import {
  markExecutionRunning,
  updateDocumentResultBlock,
} from './local-store/execution-store';
import { loadSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const [controllerSource, groupInspectorSource, appSource] = await Promise.all([
  readFile(new URL('../src/app/useAgentRuntimeController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/GroupInspector.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
]);
assert.match(controllerSource, /createAgentRunForWorkflowStageSlice/);
assert.match(controllerSource, /createWorkflowStageSliceAgentRun/);
assert.match(groupInspectorSource, /agentRuntime\.untilStage/);
assert.match(groupInspectorSource, /onCreateWorkflowStageSliceAgentRun/);
assert.match(appSource, /onCreateWorkflowStageSliceAgentRun/);

const readyTextConnection: ExecutionConnectionSummary = {
  connectionId: 'test-text-connection',
  connectorId: 'openai-compatible',
  providerLabel: 'Test text provider',
  displayName: 'Test text provider',
  description: 'Workflow Stage Slice runtime test connection.',
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

const automatic = await workflowSnapshot('Run through production design.');
const automaticRun = requiredWorkflowRun(automatic);
const screenplayStep = stepFor(automatic, automaticRun.workflowRunId, 'screenplay_generate');
const characterStep = stepFor(automatic, automaticRun.workflowRunId, 'character_define');
const sceneStep = stepFor(automatic, automaticRun.workflowRunId, 'scene_define');
const storyboardStep = stepFor(automatic, automaticRun.workflowRunId, 'storyboard_plan');
const automaticAgent = createAgentRunForWorkflowStageSlice(
  automatic,
  automaticRun.workflowRunId,
  'production_design',
);
assert.equal(automaticAgent.record.target.kind, 'workflow_slice');
if (
  automaticAgent.record.target.kind !== 'workflow_slice'
  || automaticAgent.record.target.until.kind !== 'stage'
) throw new Error('Stage Slice target expected.');
assert.deepEqual(automaticAgent.record.target.until, {
  kind: 'stage',
  stageId: 'production_design',
  stageTypeId: 'retake.stage.production_design',
  requiredStepRunIds: [characterStep.stepRunId, sceneStep.stepRunId],
  outputTargets: [
    {
      artifactScope: 'workflow_run',
      artifactType: 'character_bible',
      outputSlotId: 'character_bible',
      semanticKey: 'workflow_output:character_bible',
      stepId: 'character_define',
      stepRunId: characterStep.stepRunId,
      workflowOutputSlotId: 'character_bible',
    },
    {
      artifactScope: 'workflow_run',
      artifactType: 'scene_bible',
      outputSlotId: 'scene_bible',
      semanticKey: 'workflow_output:scene_bible',
      stepId: 'scene_define',
      stepRunId: sceneStep.stepRunId,
      workflowOutputSlotId: 'scene_bible',
    },
  ],
});
assert.deepEqual(automaticAgent.record.scope.allowedStepRunIds, [
  screenplayStep.stepRunId,
  characterStep.stepRunId,
  sceneStep.stepRunId,
]);
assert.equal(
  automaticAgent.record.scope.allowedStepRunIds.includes(storyboardStep.stepRunId),
  false,
);
startAgentRun(automatic, automaticAgent.record.agentRunId);

let automaticSnapshot = automatic;
automaticSnapshot = await executeNextStep(
  automaticSnapshot,
  automaticAgent.record.agentRunId,
  '# Screenplay\n\nA courier cat reaches the bridge.',
);
automaticSnapshot = await executeNextStep(
  automaticSnapshot,
  automaticAgent.record.agentRunId,
  '# Character Bible\n\nCourier cat.',
);
assert.equal(
  agentFor(automaticSnapshot, automaticAgent.record.agentRunId).status,
  'running',
  'The first of multiple Stage outputs must not satisfy the Stage target.',
);
automaticSnapshot = await executeNextStep(
  automaticSnapshot,
  automaticAgent.record.agentRunId,
  '# Scene Bible\n\nCollapsing bridge.',
);
const completedAgent = agentFor(automaticSnapshot, automaticAgent.record.agentRunId);
assert.equal(completedAgent.status, 'succeeded');
assert.equal(completedAgent.stopReason, 'slice_target_satisfied');
assert.deepEqual(
  completedAgent.satisfiedArtifactRevisionIds,
  [
    stepFor(automaticSnapshot, automaticRun.workflowRunId, 'character_define')
      .outputArtifactBindings[0]?.artifactRevisionId,
    stepFor(automaticSnapshot, automaticRun.workflowRunId, 'scene_define')
      .outputArtifactBindings[0]?.artifactRevisionId,
  ],
);
assert.equal(
  stepFor(automaticSnapshot, automaticRun.workflowRunId, 'storyboard_plan').executionIds.length,
  0,
);
assert.notEqual(
  workflowRunViewForId(automaticSnapshot, automaticRun.workflowRunId)?.status,
  'succeeded',
  'Completing a Stage Slice must not report the full Workflow as complete.',
);

const optional = await workflowSnapshot('Exclude an optional Stage member from scope.');
const optionalRun = requiredWorkflowRun(optional);
const optionalStage = optionalRun.stageDefinitionLocks?.find(
  (stage) => stage.stageId === 'production_design',
);
assert.ok(optionalStage);
optionalStage.requiredStepIds = ['character_define'];
optionalStage.optionalStepIds = ['scene_define'];
optionalStage.outputSlotLocks = optionalStage.outputSlotLocks.filter(
  (output) => output.workflowOutputSlotId === 'character_bible',
);
stepFor(optional, optionalRun.workflowRunId, 'scene_define').optional = true;
const optionalAgent = createAgentRunForWorkflowStageSlice(
  optional,
  optionalRun.workflowRunId,
  'production_design',
);
assert.deepEqual(optionalAgent.record.scope.allowedStepRunIds, [
  stepFor(optional, optionalRun.workflowRunId, 'screenplay_generate').stepRunId,
  stepFor(optional, optionalRun.workflowRunId, 'character_define').stepRunId,
]);
assert.equal(
  optionalAgent.record.scope.allowedStepRunIds.includes(
    stepFor(optional, optionalRun.workflowRunId, 'scene_define').stepRunId,
  ),
  false,
);

const noOutput = await workflowSnapshot('Stop at a Stage without a required output.');
const noOutputRun = requiredWorkflowRun(noOutput);
const noOutputStage = noOutputRun.stageDefinitionLocks?.find(
  (stage) => stage.stageId === 'story_screenplay',
);
assert.ok(noOutputStage);
noOutputStage.outputSlotLocks = [];
const noOutputAgent = createAgentRunForWorkflowStageSlice(
  noOutput,
  noOutputRun.workflowRunId,
  'story_screenplay',
);
startAgentRun(noOutput, noOutputAgent.record.agentRunId);
const noOutputCompleted = await executeNextStep(
  noOutput,
  noOutputAgent.record.agentRunId,
  '# Screenplay\n\nNo Stage output contract.',
);
assert.equal(agentFor(noOutputCompleted, noOutputAgent.record.agentRunId).status, 'succeeded');
assert.deepEqual(
  agentFor(noOutputCompleted, noOutputAgent.record.agentRunId).satisfiedArtifactRevisionIds,
  [],
);

const gated = await workflowSnapshot('Require approval for a Stage output.');
const gatedRun = requiredWorkflowRun(gated);
gatedRun.gateDefinitionLocks = [{
  gateId: 'gate_scene_approval',
  kind: 'human_approval',
  required: true,
  definitionHash: 'sha256:test-scene-approval-v1',
  subject: {
    kind: 'step_output',
    stepId: 'scene_define',
    outputSlotId: 'scene_bible',
  },
}];
const gatedAgent = createAgentRunForWorkflowStageSlice(
  gated,
  gatedRun.workflowRunId,
  'production_design',
);
startAgentRun(gated, gatedAgent.record.agentRunId);
let gatedSnapshot = gated;
gatedSnapshot = await executeNextStep(
  gatedSnapshot,
  gatedAgent.record.agentRunId,
  '# Screenplay\n\nApproval path.',
);
gatedSnapshot = await executeNextStep(
  gatedSnapshot,
  gatedAgent.record.agentRunId,
  '# Character Bible\n\nApproval candidate.',
);
gatedSnapshot = await executeNextStep(
  gatedSnapshot,
  gatedAgent.record.agentRunId,
  '# Scene Bible\n\nApproval scene.',
);
assert.equal(agentFor(gatedSnapshot, gatedAgent.record.agentRunId).status, 'waiting_approval');
assert.deepEqual(agentFor(gatedSnapshot, gatedAgent.record.agentRunId).satisfiedArtifactRevisionIds, []);
const gate = workflowGateViewsForRun(gatedSnapshot, gatedRun.workflowRunId)[0];
assert.ok(gate?.request);
decideWorkflowApproval(gatedSnapshot, {
  approvalRequestId: gate.request.approvalRequestId,
  expectedApprovalRequestVersion: gate.request.recordVersion,
  decision: 'approve',
});
reconcileAgentRuntime(gatedSnapshot);
assert.equal(
  agentFor(gatedSnapshot, gatedAgent.record.agentRunId).status,
  'running',
  'A passed Gate still requires authoritative verification of every Stage output.',
);
await saveSnapshot(gatedSnapshot);
const gatedVerified = await reconcileAgentArtifactTargets({
  agentRunId: gatedAgent.record.agentRunId,
  boardId: gatedSnapshot.board.boardId,
  projectId: gatedSnapshot.project.projectId,
});
assert.equal(agentFor(gatedVerified.snapshot, gatedAgent.record.agentRunId).status, 'succeeded');
assert.equal(
  agentFor(gatedVerified.snapshot, gatedAgent.record.agentRunId)
    .satisfiedArtifactRevisionIds?.length,
  2,
);

const tampered = await workflowSnapshot('Reject a changed frozen Stage target.');
const tamperedRun = requiredWorkflowRun(tampered);
const tamperedAgent = createAgentRunForWorkflowStageSlice(
  tampered,
  tamperedRun.workflowRunId,
  'production_design',
);
startAgentRun(tampered, tamperedAgent.record.agentRunId);
if (
  tamperedAgent.record.target.kind !== 'workflow_slice'
  || tamperedAgent.record.target.until.kind !== 'stage'
) throw new Error('Stage Slice target expected.');
tamperedAgent.record.target.until.stageTypeId = 'retake.stage.changed';
reconcileAgentRuntime(tampered);
assert.equal(tamperedAgent.record.status, 'failed');
assert.equal(tamperedAgent.record.stopReason, 'target_invalid');
assert.match(tamperedAgent.record.error ?? '', /Stage target lock changed/);

console.log(JSON.stringify({
  ok: true,
  target: 'workflow_slice.until_stage',
  requiredDependencyClosureUnionFrozen: true,
  optionalMembersExcluded: true,
  multipleAuthoritativeRevisionsRequired: true,
  zeroOutputStageSupported: true,
  requiredHumanGateEnforced: true,
  workflowStatusPreserved: true,
}));

async function workflowSnapshot(brief: string): Promise<BoardSnapshot> {
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
  const projection = projectWorkflowDraft(snapshot, {
    workflowId: storyToStoryboardWorkflow.workflowId,
    workflowTitle: 'Story to storyboard plan',
    outputPlaceholder: 'Run the upstream operation.',
    labelsForSkill,
    connectionIdForCapability: () => readyTextConnection.connectionId,
  });
  blockFor(snapshot, projection.workflowInputBlockIds[0]).data.body = brief;
  createWorkflowRunForGroup(snapshot, projection.groupBlock.blockId);
  return snapshot;
}

async function executeNextStep(
  snapshot: BoardSnapshot,
  agentRunId: string,
  markdown: string,
): Promise<BoardSnapshot> {
  const action = nextAgentRunExecutionAction(snapshot);
  assert.ok(action?.stepRunId);
  const step = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => candidate.stepRunId === action.stepRunId,
  );
  assert.ok(step);
  const execution = executeExistingTextGenerationOperation(snapshot, {
    connection: readyTextConnection,
    labels: labelsForSkill(step.skillLock.skillId),
    operationBlockId: step.operationBlockId,
  }).execution;
  attachAgentRunExecution(snapshot, agentRunId, execution.executionId);
  await saveSnapshot(snapshot);
  return completeDocumentExecution(snapshot, execution, markdown);
}

async function completeDocumentExecution(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  markdown: string,
): Promise<BoardSnapshot> {
  const started = await markExecutionRunning({
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    executionId: execution.executionId,
  });
  const asset = await generatedDocument(started.snapshot, started.execution, markdown);
  const resultBlock = blockFor(started.snapshot, execution.outputBlockIds[0]);
  const completed = await updateDocumentResultBlock({
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    executionId: execution.executionId,
    assetId: asset.assetId,
    resultBlockId: execution.outputBlockIds[0],
    title: String(resultBlock.data.title ?? 'Generated document'),
    documentKind: typeof resultBlock.data.documentKind === 'string'
      ? resultBlock.data.documentKind
      : 'general',
    markdown,
  });
  return completed.snapshot;
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

function requiredWorkflowRun(snapshot: BoardSnapshot) {
  const workflowRun = (snapshot.workflowRuns ?? [])[0];
  assert.ok(workflowRun);
  return workflowRun;
}

function stepFor(snapshot: BoardSnapshot, workflowRunId: string, stepId: string) {
  const step = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => candidate.workflowRunId === workflowRunId && candidate.stepId === stepId,
  );
  assert.ok(step);
  return step;
}

function agentFor(snapshot: BoardSnapshot, agentRunId: string) {
  const record = (snapshot.agentRuns ?? []).find(
    (candidate) => candidate.agentRunId === agentRunId,
  );
  assert.ok(record);
  return record;
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
