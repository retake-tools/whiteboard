import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  attachAgentRunExecution,
  createAgentRunForWorkflowGateSlice,
  nextAgentRunExecutionAction,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import { capabilityDefinitionFor, textDocumentCapabilityIds } from '../src/core/capabilityRegistry';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import { executeExistingTextGenerationOperation, type TextGenerationLabels } from '../src/core/textOperations';
import type { AssetRecord, BlockRecord, BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import {
  decideWorkflowApproval,
  workflowGateViewsForRun,
} from '../src/core/workflowGateRuntime';
import {
  storyToStoryboardWorkflow,
  validateWorkflowDefinition,
  type WorkflowHumanApprovalGateDefinition,
} from '../src/core/workflowRegistry';
import {
  createWorkflowRunForGroup,
  workflowRunViewForId,
} from '../src/core/workflowRuntime';
import { createAssetFromDataUrl } from './local-store/asset-store';
import {
  markExecutionRunning,
  updateDocumentResultBlock,
} from './local-store/execution-store';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import { reconcileWorkflowArtifactGates } from './workflow-gate-artifact-service';

const [controllerSource, groupInspectorSource, appSource, artifactGateClientSource] = await Promise.all([
  readFile(new URL('../src/app/useAgentRuntimeController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/GroupInspector.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/core/workflowArtifactGateClient.ts', import.meta.url), 'utf8'),
]);
assert.match(controllerSource, /createAgentRunForWorkflowGateSlice/);
assert.match(controllerSource, /createWorkflowGateSliceAgentRun/);
assert.match(groupInspectorSource, /agentRuntime\.untilGate/);
assert.match(groupInspectorSource, /agentRuntime\.gateCompletion/);
assert.match(groupInspectorSource, /onCreateWorkflowGateSliceAgentRun/);
assert.match(appSource, /onCreateWorkflowGateSliceAgentRun/);
assert.match(artifactGateClientSource, /workflow\/artifact-gates\/reconcile/);

const readyTextConnection: ExecutionConnectionSummary = {
  connectionId: 'test-text-connection',
  connectorId: 'openai-compatible',
  providerLabel: 'Test text provider',
  displayName: 'Test text provider',
  description: 'Workflow Gate Slice runtime test connection.',
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

const screenplayGate = stepOutputGate(
  'screenplay_approval',
  'Screenplay approval',
  'screenplay_generate',
  'screenplay',
);
assert.deepEqual(
  validateWorkflowDefinition({
    ...storyToStoryboardWorkflow,
    gates: [{ ...screenplayGate, name: '   ' }],
  }),
  ['Workflow Gate name is invalid: screenplay_approval'],
);

const arrived = await workflowSnapshot('Arrive at screenplay approval.', [screenplayGate]);
const arrivedRun = requiredWorkflowRun(arrived);
const arrivedScreenplay = stepFor(arrived, arrivedRun.workflowRunId, 'screenplay_generate');
const arrivedAgent = createAgentRunForWorkflowGateSlice(
  arrived,
  arrivedRun.workflowRunId,
  screenplayGate.gateId,
  'arrived',
);
assert.equal(arrivedAgent.record.target.kind, 'workflow_slice');
if (
  arrivedAgent.record.target.kind !== 'workflow_slice'
  || arrivedAgent.record.target.until.kind !== 'gate'
) throw new Error('Gate Slice target expected.');
assert.deepEqual(arrivedAgent.record.target.until, {
  completion: 'arrived',
  gateDefinitionLock: screenplayGate,
  kind: 'gate',
  subjectStepRunId: arrivedScreenplay.stepRunId,
});
assert.deepEqual(arrivedAgent.record.scope.allowedStepRunIds, [arrivedScreenplay.stepRunId]);
startAgentRun(arrived, arrivedAgent.record.agentRunId);
const arrivedCompleted = await executeNextStep(
  arrived,
  arrivedAgent.record.agentRunId,
  '# Screenplay\n\nApproval candidate.',
);
const arrivedGateView = gateView(
  arrivedCompleted,
  arrivedRun.workflowRunId,
  screenplayGate.gateId,
);
assert.equal(arrivedGateView.evaluation?.status, 'waiting_approval');
assert.equal(agentFor(arrivedCompleted, arrivedAgent.record.agentRunId).status, 'succeeded');
assert.equal(
  agentFor(arrivedCompleted, arrivedAgent.record.agentRunId).satisfiedGateEvaluationId,
  arrivedGateView.evaluation?.gateEvaluationId,
);
assert.equal(
  workflowRunViewForId(arrivedCompleted, arrivedRun.workflowRunId)?.status,
  'waiting_approval',
);
assert.equal(
  stepFor(arrivedCompleted, arrivedRun.workflowRunId, 'character_define').executionIds.length,
  0,
);

const passed = await workflowSnapshot('Wait for screenplay approval.', [screenplayGate]);
const passedRun = requiredWorkflowRun(passed);
const passedAgent = createAgentRunForWorkflowGateSlice(
  passed,
  passedRun.workflowRunId,
  screenplayGate.gateId,
  'passed',
);
startAgentRun(passed, passedAgent.record.agentRunId);
const passedWaiting = await executeNextStep(
  passed,
  passedAgent.record.agentRunId,
  '# Screenplay\n\nWait for the user.',
);
assert.equal(agentFor(passedWaiting, passedAgent.record.agentRunId).status, 'waiting_approval');
const passedGateView = gateView(passedWaiting, passedRun.workflowRunId, screenplayGate.gateId);
assert.ok(passedGateView.request);
decideWorkflowApproval(passedWaiting, {
  approvalRequestId: passedGateView.request.approvalRequestId,
  expectedApprovalRequestVersion: passedGateView.request.recordVersion,
  decision: 'approve',
});
reconcileAgentRuntime(passedWaiting);
const passedCompleted = agentFor(passedWaiting, passedAgent.record.agentRunId);
assert.equal(passedCompleted.status, 'succeeded');
assert.equal(passedCompleted.stopReason, 'slice_target_satisfied');
assert.equal(
  passedCompleted.satisfiedGateEvaluationId,
  passedGateView.evaluation?.gateEvaluationId,
);
assert.equal(
  stepFor(passedWaiting, passedRun.workflowRunId, 'character_define').executionIds.length,
  0,
);

for (const completion of ['arrived', 'passed'] as const) {
  const alreadyPassed = createAgentRunForWorkflowGateSlice(
    passedWaiting,
    passedRun.workflowRunId,
    screenplayGate.gateId,
    completion,
  );
  startAgentRun(passedWaiting, alreadyPassed.record.agentRunId);
  reconcileAgentRuntime(passedWaiting);
  assert.equal(alreadyPassed.record.status, 'succeeded');
  assert.equal(
    alreadyPassed.record.satisfiedGateEvaluationId,
    passedGateView.evaluation?.gateEvaluationId,
  );
}

const rejected = await workflowSnapshot('Reject a Gate target.', [screenplayGate]);
const rejectedRun = requiredWorkflowRun(rejected);
const rejectedAgent = createAgentRunForWorkflowGateSlice(
  rejected,
  rejectedRun.workflowRunId,
  screenplayGate.gateId,
  'passed',
);
startAgentRun(rejected, rejectedAgent.record.agentRunId);
const rejectedWaiting = await executeNextStep(
  rejected,
  rejectedAgent.record.agentRunId,
  '# Screenplay\n\nRejected candidate.',
);
const rejectedGate = gateView(rejectedWaiting, rejectedRun.workflowRunId, screenplayGate.gateId);
assert.ok(rejectedGate.request);
decideWorkflowApproval(rejectedWaiting, {
  approvalRequestId: rejectedGate.request.approvalRequestId,
  expectedApprovalRequestVersion: rejectedGate.request.recordVersion,
  decision: 'reject',
});
reconcileAgentRuntime(rejectedWaiting);
assert.equal(agentFor(rejectedWaiting, rejectedAgent.record.agentRunId).status, 'needs_attention');
assert.match(agentFor(rejectedWaiting, rejectedAgent.record.agentRunId).error ?? '', /rejected/);

const upstreamGate = stepOutputGate(
  'screenplay_upstream_approval',
  'Upstream screenplay approval',
  'screenplay_generate',
  'screenplay',
);
const characterGate = stepOutputGate(
  'character_approval',
  'Character approval',
  'character_define',
  'character_bible',
);
const characterSiblingGate = stepOutputGate(
  'character_legal_approval',
  'Character legal approval',
  'character_define',
  'character_bible',
);
const gatedDependencies = await workflowSnapshot(
  'Respect upstream Gates without waiting for siblings.',
  [upstreamGate, characterGate, characterSiblingGate],
);
const gatedDependenciesRun = requiredWorkflowRun(gatedDependencies);
const gatedDependenciesAgent = createAgentRunForWorkflowGateSlice(
  gatedDependencies,
  gatedDependenciesRun.workflowRunId,
  characterGate.gateId,
  'passed',
);
startAgentRun(gatedDependencies, gatedDependenciesAgent.record.agentRunId);
let gatedDependenciesSnapshot = await executeNextStep(
  gatedDependencies,
  gatedDependenciesAgent.record.agentRunId,
  '# Screenplay\n\nUpstream approval.',
);
assert.equal(
  agentFor(gatedDependenciesSnapshot, gatedDependenciesAgent.record.agentRunId).status,
  'waiting_approval',
);
approveGate(gatedDependenciesSnapshot, gatedDependenciesRun.workflowRunId, upstreamGate.gateId);
reconcileAgentRuntime(gatedDependenciesSnapshot);
assert.equal(
  agentFor(gatedDependenciesSnapshot, gatedDependenciesAgent.record.agentRunId).status,
  'running',
);
gatedDependenciesSnapshot = await executeNextStep(
  gatedDependenciesSnapshot,
  gatedDependenciesAgent.record.agentRunId,
  '# Character Bible\n\nTarget approval.',
);
assert.equal(
  agentFor(gatedDependenciesSnapshot, gatedDependenciesAgent.record.agentRunId).status,
  'waiting_approval',
);
approveGate(gatedDependenciesSnapshot, gatedDependenciesRun.workflowRunId, characterGate.gateId);
reconcileAgentRuntime(gatedDependenciesSnapshot);
assert.equal(
  agentFor(gatedDependenciesSnapshot, gatedDependenciesAgent.record.agentRunId).status,
  'succeeded',
);
assert.equal(
  gateView(
    gatedDependenciesSnapshot,
    gatedDependenciesRun.workflowRunId,
    characterSiblingGate.gateId,
  ).evaluation?.status,
  'waiting_approval',
);

const artifactGate: WorkflowHumanApprovalGateDefinition = {
  definitionHash: 'sha256:test-screenplay-artifact-gate-slice-v1',
  gateId: 'screenplay_artifact_approval',
  kind: 'human_approval',
  name: 'Screenplay Artifact approval',
  required: true,
  subject: {
    kind: 'artifact_revision',
    workflowOutputSlotId: 'screenplay',
  },
};
const artifact = await workflowSnapshot('Arrive at an Artifact Revision Gate.', [artifactGate]);
const artifactRun = requiredWorkflowRun(artifact);
const artifactAgent = createAgentRunForWorkflowGateSlice(
  artifact,
  artifactRun.workflowRunId,
  artifactGate.gateId,
  'arrived',
);
startAgentRun(artifact, artifactAgent.record.agentRunId);
const artifactCompleted = await executeNextStep(
  artifact,
  artifactAgent.record.agentRunId,
  '# Screenplay\n\nAuthoritative Artifact Revision.',
);
await saveSnapshot(artifactCompleted);
const artifactReconciled = await reconcileWorkflowArtifactGates({
  boardId: artifactCompleted.board.boardId,
  projectId: artifactCompleted.project.projectId,
  workflowRunId: artifactRun.workflowRunId,
});
const artifactGateView = gateView(
  artifactReconciled.snapshot,
  artifactRun.workflowRunId,
  artifactGate.gateId,
);
assert.ok(artifactGateView.evaluation?.subjectArtifactRevisionId);
assert.equal(
  agentFor(artifactReconciled.snapshot, artifactAgent.record.agentRunId).status,
  'succeeded',
);
assert.equal(
  agentFor(artifactReconciled.snapshot, artifactAgent.record.agentRunId)
    .satisfiedGateEvaluationId,
  artifactGateView.evaluation?.gateEvaluationId,
);

const optional = await workflowSnapshot('Explicitly target an optional subject.', [characterGate]);
const optionalRun = requiredWorkflowRun(optional);
stepFor(optional, optionalRun.workflowRunId, 'character_define').optional = true;
const optionalAgent = createAgentRunForWorkflowGateSlice(
  optional,
  optionalRun.workflowRunId,
  characterGate.gateId,
  'arrived',
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

const tampered = await workflowSnapshot('Reject a changed Gate target.', [screenplayGate]);
const tamperedRun = requiredWorkflowRun(tampered);
const tamperedAgent = createAgentRunForWorkflowGateSlice(
  tampered,
  tamperedRun.workflowRunId,
  screenplayGate.gateId,
  'arrived',
);
startAgentRun(tampered, tamperedAgent.record.agentRunId);
if (
  tamperedAgent.record.target.kind !== 'workflow_slice'
  || tamperedAgent.record.target.until.kind !== 'gate'
) throw new Error('Gate Slice target expected.');
tamperedAgent.record.target.until.gateDefinitionLock.definitionHash = 'sha256:changed';
reconcileAgentRuntime(tampered);
assert.equal(tamperedAgent.record.status, 'failed');
assert.equal(tamperedAgent.record.stopReason, 'target_invalid');
assert.match(tamperedAgent.record.error ?? '', /Gate target lock changed/);

assert.equal(
  storyToStoryboardWorkflow.gates.length,
  0,
  'The built-in Workflow must keep no default Gate.',
);

console.log(JSON.stringify({
  ok: true,
  target: 'workflow_slice.until_gate',
  completions: ['arrived', 'passed'],
  stepOutputSubject: true,
  artifactRevisionSubject: true,
  prerequisiteGateEnforced: true,
  siblingGateExcluded: true,
  optionalSubjectIncluded: true,
  userApprovalRequired: true,
  downstreamStepsPreserved: true,
}));

async function workflowSnapshot(
  brief: string,
  gates: WorkflowHumanApprovalGateDefinition[],
): Promise<BoardSnapshot> {
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
  const initialGateCount = storyToStoryboardWorkflow.gates.length;
  storyToStoryboardWorkflow.gates.push(...gates);
  try {
    createWorkflowRunForGroup(snapshot, projection.groupBlock.blockId);
  } finally {
    storyToStoryboardWorkflow.gates.splice(initialGateCount);
  }
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

function stepOutputGate(
  gateId: string,
  name: string,
  stepId: string,
  outputSlotId: string,
): WorkflowHumanApprovalGateDefinition {
  return {
    definitionHash: `sha256:test-${gateId}-v1`,
    gateId,
    kind: 'human_approval',
    name,
    required: true,
    subject: {
      kind: 'step_output',
      outputSlotId,
      stepId,
    },
  };
}

function approveGate(snapshot: BoardSnapshot, workflowRunId: string, gateId: string): void {
  const gate = gateView(snapshot, workflowRunId, gateId);
  assert.ok(gate.request);
  decideWorkflowApproval(snapshot, {
    approvalRequestId: gate.request.approvalRequestId,
    expectedApprovalRequestVersion: gate.request.recordVersion,
    decision: 'approve',
  });
}

function gateView(snapshot: BoardSnapshot, workflowRunId: string, gateId: string) {
  const gate = workflowGateViewsForRun(snapshot, workflowRunId).find(
    (candidate) => candidate.gateDefinitionLock.gateId === gateId,
  );
  assert.ok(gate);
  return gate;
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
