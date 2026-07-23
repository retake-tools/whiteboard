import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  attachAgentRunExecution,
  createAgentRunForWorkflowArtifactSlice,
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
import { readProjectArtifactLibrary } from './artifact-library-service';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { createOrAdvanceArtifact } from './local-store/artifact-store';
import {
  markExecutionRunning,
  updateDocumentResultBlock,
} from './local-store/execution-store';
import { loadSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const [controllerSource, groupInspectorSource] = await Promise.all([
  readFile(new URL('../src/app/useAgentRuntimeController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/GroupInspector.tsx', import.meta.url), 'utf8'),
]);
assert.match(controllerSource, /createAgentRunForWorkflowArtifactSlice/);
assert.match(controllerSource, /reconcileAgentArtifactTarget/);
assert.match(groupInspectorSource, /agentRuntime\.untilArtifact/);
assert.match(groupInspectorSource, /onCreateWorkflowArtifactSliceAgentRun/);

const readyTextConnection: ExecutionConnectionSummary = {
  connectionId: 'test-text-connection',
  connectorId: 'openai-compatible',
  providerLabel: 'Test text provider',
  displayName: 'Test text provider',
  description: 'Workflow Artifact Slice runtime test connection.',
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

const automatic = await workflowSnapshot('Run until the screenplay Artifact exists.');
const automaticRun = requiredWorkflowRun(automatic);
const automaticStep = stepFor(automatic, automaticRun.workflowRunId, 'screenplay_generate');
const automaticAgent = createAgentRunForWorkflowArtifactSlice(
  automatic,
  automaticRun.workflowRunId,
  'screenplay',
);
assert.deepEqual(
  automaticAgent.record.target.kind === 'workflow_slice'
    ? automaticAgent.record.target.until
    : undefined,
  {
    artifactScope: 'workflow_run',
    artifactType: 'screenplay_master',
    kind: 'artifact',
    outputSlotId: 'screenplay',
    semanticKey: 'workflow_output:screenplay',
    stepId: automaticStep.stepId,
    stepRunId: automaticStep.stepRunId,
    workflowOutputSlotId: 'screenplay',
  },
);
assert.deepEqual(automaticAgent.record.scope.allowedStepRunIds, [automaticStep.stepRunId]);
startAgentRun(automatic, automaticAgent.record.agentRunId);
const automaticAction = nextAgentRunExecutionAction(automatic);
assert.equal(automaticAction?.stepRunId, automaticStep.stepRunId);
const automaticExecution = queueStep(automatic, automaticStep);
attachAgentRunExecution(
  automatic,
  automaticAgent.record.agentRunId,
  automaticExecution.executionId,
);
await saveSnapshot(automatic);
const automaticCompleted = await completeDocumentExecution(
  automatic,
  automaticExecution,
  '# Screenplay\n\nA courier cat reaches the bridge.',
);
const completedAgent = agentFor(
  automaticCompleted.snapshot,
  automaticAgent.record.agentRunId,
);
const completedStep = stepFor(
  automaticCompleted.snapshot,
  automaticRun.workflowRunId,
  'screenplay_generate',
);
assert.equal(completedAgent.status, 'succeeded');
assert.equal(completedAgent.stopReason, 'slice_target_satisfied');
assert.equal(
  completedAgent.satisfiedArtifactRevisionId,
  completedStep.outputArtifactBindings[0]?.artifactRevisionId,
);
assert.notEqual(
  workflowRunViewForId(automaticCompleted.snapshot, automaticRun.workflowRunId)?.status,
  'succeeded',
  'Completing an Artifact Slice must not report the full Workflow as complete.',
);
assert.equal(
  (await readProjectArtifactLibrary(automatic.project.projectId)).items.length,
  0,
  'Workflow-run Artifact targets remain hidden from the Project Asset Library.',
);

const wrongScope = await workflowSnapshot('Reject a same-type Project Artifact.');
const wrongScopeRun = requiredWorkflowRun(wrongScope);
const wrongScopeStep = stepFor(wrongScope, wrongScopeRun.workflowRunId, 'screenplay_generate');
const wrongScopeExecution = queueStep(wrongScope, wrongScopeStep);
await saveSnapshot(wrongScope);
const wrongScopeCompleted = await completeDocumentExecution(
  wrongScope,
  wrongScopeExecution,
  '# Screenplay\n\nWrong scope candidate.',
);
const currentWrongScopeStep = stepFor(
  wrongScopeCompleted.snapshot,
  wrongScopeRun.workflowRunId,
  'screenplay_generate',
);
const workflowBinding = currentWrongScopeStep.outputArtifactBindings[0];
assert.ok(workflowBinding);
const projectArtifact = await createOrAdvanceArtifact({
  artifactType: workflowBinding.artifactType,
  assetIds: [...workflowBinding.assetIds],
  createdByActor: { actorId: 'test-user', actorType: 'user' },
  createdByExecutionId: workflowBinding.executionIds[0],
  expectedCurrentRevisionId: null,
  idempotencyKey: 'workflow-artifact-slice-wrong-project-scope',
  libraryVisibility: 'listed',
  primaryAssetId: workflowBinding.primaryAssetId,
  projectId: wrongScope.project.projectId,
  schemaVersion: 1,
  scope: 'project',
  semanticKey: 'screenplay:wrong-scope',
  sourceArtifactRevisionIds: [],
  sourceAssetIds: [],
  sourceContext: {
    boardId: wrongScope.board.boardId,
    operationBlockId: wrongScopeStep.operationBlockId,
    outputSlotId: workflowBinding.outputSlotId,
  },
});
const wrongScopeAgent = createAgentRunForWorkflowArtifactSlice(
  wrongScopeCompleted.snapshot,
  wrongScopeRun.workflowRunId,
  'screenplay',
);
startAgentRun(wrongScopeCompleted.snapshot, wrongScopeAgent.record.agentRunId);
currentWrongScopeStep.outputArtifactBindings = [{
  ...workflowBinding,
  artifactId: projectArtifact.artifact.artifactId,
  artifactRevisionId: projectArtifact.revision.artifactRevisionId,
}];
await saveSnapshot(wrongScopeCompleted.snapshot);
await assert.rejects(
  reconcileAgentArtifactTargets({
    agentRunId: wrongScopeAgent.record.agentRunId,
    boardId: wrongScope.board.boardId,
    projectId: wrongScope.project.projectId,
  }),
  /does not match the frozen target identity/,
);
const rejectedWrongScope = agentFor(
  await loadSnapshot(wrongScope.project.projectId, wrongScope.board.boardId),
  wrongScopeAgent.record.agentRunId,
);
assert.equal(rejectedWrongScope.satisfiedArtifactRevisionId, undefined);
assert.notEqual(rejectedWrongScope.status, 'succeeded');

const gated = await workflowSnapshot('Require approval before Artifact completion.');
const gatedRun = requiredWorkflowRun(gated);
gatedRun.gateDefinitionLocks = [{
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
const gatedStep = stepFor(gated, gatedRun.workflowRunId, 'screenplay_generate');
const gatedAgent = createAgentRunForWorkflowArtifactSlice(
  gated,
  gatedRun.workflowRunId,
  'screenplay',
);
startAgentRun(gated, gatedAgent.record.agentRunId);
const gatedExecution = queueStep(gated, gatedStep);
attachAgentRunExecution(gated, gatedAgent.record.agentRunId, gatedExecution.executionId);
await saveSnapshot(gated);
const gatedCompleted = await completeDocumentExecution(
  gated,
  gatedExecution,
  '# Screenplay\n\nApproval candidate.',
);
const waitingAgent = agentFor(gatedCompleted.snapshot, gatedAgent.record.agentRunId);
assert.equal(waitingAgent.status, 'waiting_approval');
assert.equal(waitingAgent.satisfiedArtifactRevisionId, undefined);
assert.equal(
  agentFor(
    await loadSnapshot(gated.project.projectId, gated.board.boardId),
    gatedAgent.record.agentRunId,
  ).status,
  'waiting_approval',
  'Artifact reconciliation must persist non-terminal Agent state changes.',
);
const gate = workflowGateViewsForRun(gatedCompleted.snapshot, gatedRun.workflowRunId)[0];
assert.equal(gate.evaluation?.status, 'waiting_approval');
assert.ok(gate.request);
decideWorkflowApproval(gatedCompleted.snapshot, {
  approvalRequestId: gate.request.approvalRequestId,
  expectedApprovalRequestVersion: gate.request.recordVersion,
  decision: 'approve',
});
reconcileAgentRuntime(gatedCompleted.snapshot);
assert.equal(
  agentFor(gatedCompleted.snapshot, gatedAgent.record.agentRunId).status,
  'running',
  'A passed Gate still requires authoritative Artifact verification.',
);
await saveSnapshot(gatedCompleted.snapshot);
const gatedVerified = await reconcileAgentArtifactTargets({
  agentRunId: gatedAgent.record.agentRunId,
  boardId: gated.board.boardId,
  projectId: gated.project.projectId,
});
const approvedAgent = agentFor(gatedVerified.snapshot, gatedAgent.record.agentRunId);
assert.equal(approvedAgent.status, 'succeeded');
assert.equal(approvedAgent.stopReason, 'slice_target_satisfied');
assert.ok(approvedAgent.satisfiedArtifactRevisionId);

const tampered = await workflowSnapshot('Reject a changed frozen Artifact target.');
const tamperedRun = requiredWorkflowRun(tampered);
const tamperedAgent = createAgentRunForWorkflowArtifactSlice(
  tampered,
  tamperedRun.workflowRunId,
  'screenplay',
);
startAgentRun(tampered, tamperedAgent.record.agentRunId);
if (
  tamperedAgent.record.target.kind !== 'workflow_slice'
  || tamperedAgent.record.target.until.kind !== 'artifact'
) throw new Error('Artifact Slice target expected.');
tamperedAgent.record.target.until.semanticKey = 'workflow_output:changed';
reconcileAgentRuntime(tampered);
assert.equal(tamperedAgent.record.status, 'failed');
assert.equal(tamperedAgent.record.stopReason, 'target_invalid');
assert.match(tamperedAgent.record.error ?? '', /target lock changed/);

console.log(JSON.stringify({
  ok: true,
  target: 'workflow_slice.until_artifact',
  dependencyClosureFrozen: true,
  authoritativeArtifactRevisionRequired: true,
  sameTypeWrongScopeRejected: true,
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

async function completeDocumentExecution(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  markdown: string,
) {
  const started = await markExecutionRunning({
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    executionId: execution.executionId,
  });
  const asset = await generatedDocument(started.snapshot, started.execution, markdown);
  return updateDocumentResultBlock({
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    executionId: execution.executionId,
    assetId: asset.assetId,
    resultBlockId: execution.outputBlockIds[0],
    title: 'Generate screenplay',
    documentKind: 'screenplay_master',
    markdown,
  });
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

function queueStep(snapshot: BoardSnapshot, step: ReturnType<typeof stepFor>): ExecutionRecord {
  return executeExistingTextGenerationOperation(snapshot, {
    connection: readyTextConnection,
    labels: labelsForSkill(step.skillLock.skillId),
    operationBlockId: step.operationBlockId,
  }).execution;
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
