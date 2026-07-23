import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  attachAgentRunExecution,
  createAgentRunForWorkflowArtifactSlice,
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
  reconcileWorkflowRuntime,
  workflowRunViewForId,
} from '../src/core/workflowRuntime';
import { reconcileAgentArtifactTargets } from './agent-artifact-target-service';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { createOrAdvanceArtifact } from './local-store/artifact-store';
import {
  markExecutionRunning,
  updateDocumentResultBlock,
} from './local-store/execution-store';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import { reconcileWorkflowArtifactGates } from './workflow-gate-artifact-service';

const [groupInspectorSource, localApiSource] = await Promise.all([
  readFile(new URL('../src/components/GroupInspector.tsx', import.meta.url), 'utf8'),
  readFile(new URL('./vite-local-api.ts', import.meta.url), 'utf8'),
]);
assert.match(groupInspectorSource, /workflowRuntime\.gateArtifactRevision/);
assert.match(groupInspectorSource, /subjectArtifactRevisionId/);
assert.match(localApiSource, /workflow\/artifact-gates\/reconcile/);

const readyTextConnection: ExecutionConnectionSummary = {
  connectionId: 'test-text-connection',
  connectorId: 'openai-compatible',
  providerLabel: 'Test text provider',
  displayName: 'Test text provider',
  description: 'Workflow Artifact Gate runtime test connection.',
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

const artifactGate: WorkflowHumanApprovalGateDefinition = {
  definitionHash: 'sha256:test-screenplay-artifact-approval-v1',
  gateId: 'gate_screenplay_artifact_approval',
  kind: 'human_approval',
  required: true,
  reviewChecklist: ['The screenplay Artifact Revision is ready for production design.'],
  subject: {
    kind: 'artifact_revision',
    workflowOutputSlotId: 'screenplay',
  },
};
assert.deepEqual(
  validateWorkflowDefinition({
    ...storyToStoryboardWorkflow,
    gates: [{
      ...artifactGate,
      subject: {
        kind: 'artifact_revision',
        workflowOutputSlotId: 'missing_output',
      },
    }],
  }),
  ['Workflow Gate Artifact subject output is missing: gate_screenplay_artifact_approval.missing_output'],
);

const fixture = await workflowFixture('Approve an authoritative screenplay Artifact.');
const snapshot = fixture.snapshot;
const run = requiredWorkflowRun(snapshot);
const screenplayStep = stepFor(snapshot, run.workflowRunId, 'screenplay_generate');
assert.deepEqual(run.gateDefinitionLocks[0], {
  ...artifactGate,
  subject: {
    artifactScope: 'workflow_run',
    artifactType: 'screenplay_master',
    kind: 'artifact_revision',
    outputSlotId: 'screenplay',
    semanticKey: 'workflow_output:screenplay',
    stepId: 'screenplay_generate',
    workflowOutputSlotId: 'screenplay',
  },
});
assert.equal(workflowGateViewsForRun(snapshot, run.workflowRunId)[0]?.evaluation, undefined);

const artifactAgent = createAgentRunForWorkflowArtifactSlice(
  snapshot,
  run.workflowRunId,
  'screenplay',
);
startAgentRun(snapshot, artifactAgent.record.agentRunId);
const firstExecution = queueStep(snapshot, screenplayStep);
attachAgentRunExecution(snapshot, artifactAgent.record.agentRunId, firstExecution.executionId);
await saveSnapshot(snapshot);
const firstCompleted = await completeDocumentExecution(
  snapshot,
  firstExecution,
  '# Screenplay v1\n\nThe courier cat reaches the bridge.',
);
const firstBinding = stepFor(
  firstCompleted.snapshot,
  run.workflowRunId,
  'screenplay_generate',
).outputArtifactBindings[0];
assert.ok(firstBinding);
const firstGate = workflowGateViewsForRun(firstCompleted.snapshot, run.workflowRunId)[0];
assert.ok(firstGate.evaluation);
assert.ok(firstGate.request);
assert.equal(firstGate.evaluation.status, 'waiting_approval');
assert.equal(firstGate.evaluation.subjectArtifactId, firstBinding.artifactId);
assert.equal(
  firstGate.evaluation.subjectArtifactRevisionId,
  firstBinding.artifactRevisionId,
);
assert.deepEqual(firstGate.evaluation.subjectAssetIds, firstBinding.assetIds);
assert.deepEqual(firstGate.evaluation.subjectExecutionIds, firstBinding.executionIds);
assert.equal(firstGate.request.subjectArtifactId, firstBinding.artifactId);
assert.equal(firstGate.request.subjectArtifactRevisionId, firstBinding.artifactRevisionId);
assert.equal(
  workflowRunViewForId(firstCompleted.snapshot, run.workflowRunId)?.status,
  'waiting_approval',
);
assert.equal(
  stepView(firstCompleted.snapshot, run.workflowRunId, 'character_define').status,
  'pending',
);
const waitingAgent = agentFor(firstCompleted.snapshot, artifactAgent.record.agentRunId);
assert.equal(waitingAgent.status, 'waiting_approval');
assert.equal(waitingAgent.satisfiedArtifactRevisionId, undefined);

const firstDecision = decideWorkflowApproval(firstCompleted.snapshot, {
  approvalRequestId: firstGate.request.approvalRequestId,
  decision: 'approve',
  expectedApprovalRequestVersion: firstGate.request.recordVersion,
});
reconcileWorkflowRuntime(firstCompleted.snapshot);
reconcileAgentRuntime(firstCompleted.snapshot);
assert.equal(firstDecision.subjectArtifactId, firstBinding.artifactId);
assert.equal(firstDecision.subjectArtifactRevisionId, firstBinding.artifactRevisionId);
assert.equal(
  workflowGateViewsForRun(firstCompleted.snapshot, run.workflowRunId)[0].evaluation?.status,
  'passed',
);
assert.equal(
  stepView(firstCompleted.snapshot, run.workflowRunId, 'character_define').status,
  'ready',
);
assert.equal(
  agentFor(firstCompleted.snapshot, artifactAgent.record.agentRunId).status,
  'running',
  'Passing the Gate still requires authoritative Agent Artifact verification.',
);
await saveSnapshot(firstCompleted.snapshot);
const verifiedAgentResult = await reconcileAgentArtifactTargets({
  agentRunId: artifactAgent.record.agentRunId,
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
});
assert.equal(
  agentFor(verifiedAgentResult.snapshot, artifactAgent.record.agentRunId).status,
  'succeeded',
);
firstCompleted.snapshot = verifiedAgentResult.snapshot;

const brief = blockFor(firstCompleted.snapshot, fixture.inputBlockId);
brief.data.body = 'Approve a revised screenplay Artifact.';
reconcileWorkflowRuntime(firstCompleted.snapshot);
const invalidatedFirstEvaluation = (firstCompleted.snapshot.workflowGateEvaluations ?? []).find(
  (evaluation) => evaluation.gateEvaluationId === firstGate.evaluation!.gateEvaluationId,
);
const historicalFirstRequest = (firstCompleted.snapshot.workflowApprovalRequests ?? []).find(
  (request) => request.approvalRequestId === firstGate.request!.approvalRequestId,
);
assert.equal(invalidatedFirstEvaluation?.freshness, 'outdated');
assert.equal(
  historicalFirstRequest?.status,
  'approved',
  'Historical approval decisions remain immutable after the subject becomes outdated.',
);
const secondExecution = queueStep(
  firstCompleted.snapshot,
  stepFor(firstCompleted.snapshot, run.workflowRunId, 'screenplay_generate'),
);
await saveSnapshot(firstCompleted.snapshot);
const secondCompleted = await completeDocumentExecution(
  firstCompleted.snapshot,
  secondExecution,
  '# Screenplay v2\n\nThe courier cat and dog reach the bridge.',
);
const secondBinding = stepFor(
  secondCompleted.snapshot,
  run.workflowRunId,
  'screenplay_generate',
).outputArtifactBindings[0];
assert.equal(secondBinding.artifactId, firstBinding.artifactId);
assert.notEqual(secondBinding.artifactRevisionId, firstBinding.artifactRevisionId);
const secondGate = workflowGateViewsForRun(secondCompleted.snapshot, run.workflowRunId)[0];
assert.ok(secondGate.evaluation);
assert.ok(secondGate.request);
assert.notEqual(secondGate.evaluation.gateEvaluationId, firstGate.evaluation.gateEvaluationId);
assert.equal(secondGate.evaluation.status, 'waiting_approval');
assert.equal(secondGate.evaluation.subjectArtifactRevisionId, secondBinding.artifactRevisionId);
assert.equal((secondCompleted.snapshot.workflowApprovalDecisions ?? []).length, 1);

await saveSnapshot(secondCompleted.snapshot);
const idempotent = await reconcileWorkflowArtifactGates({
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
  workflowRunId: run.workflowRunId,
});
assert.deepEqual(idempotent.createdGateEvaluationIds, []);
assert.equal(
  (idempotent.snapshot.workflowGateEvaluations ?? []).length,
  (secondCompleted.snapshot.workflowGateEvaluations ?? []).length,
);

const wrongScopeFixture = await workflowFixture('Reject a Project-scope Artifact as a Gate subject.');
const wrongScope = wrongScopeFixture.snapshot;
const wrongScopeRun = requiredWorkflowRun(wrongScope);
const wrongScopeStep = stepFor(wrongScope, wrongScopeRun.workflowRunId, 'screenplay_generate');
const wrongScopeExecution = queueStep(wrongScope, wrongScopeStep);
await saveSnapshot(wrongScope);
const wrongScopeCompleted = await completeDocumentExecution(
  wrongScope,
  wrongScopeExecution,
  '# Screenplay\n\nWrong scope.',
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
  idempotencyKey: 'workflow-gate-artifact-wrong-project-scope',
  libraryVisibility: 'listed',
  primaryAssetId: workflowBinding.primaryAssetId,
  projectId: wrongScope.project.projectId,
  schemaVersion: 1,
  scope: 'project',
  semanticKey: 'screenplay:wrong-gate-scope',
  sourceArtifactRevisionIds: [],
  sourceAssetIds: [],
  sourceContext: {
    boardId: wrongScope.board.boardId,
    operationBlockId: wrongScopeStep.operationBlockId,
    outputSlotId: workflowBinding.outputSlotId,
  },
});
currentWrongScopeStep.outputArtifactBindings = [{
  ...workflowBinding,
  artifactId: projectArtifact.artifact.artifactId,
  artifactRevisionId: projectArtifact.revision.artifactRevisionId,
}];
await saveSnapshot(wrongScopeCompleted.snapshot);
await assert.rejects(
  reconcileWorkflowArtifactGates({
    boardId: wrongScope.board.boardId,
    projectId: wrongScope.project.projectId,
    workflowRunId: wrongScopeRun.workflowRunId,
  }),
  /does not match the frozen target identity/,
);

console.log(JSON.stringify({
  ok: true,
  subject: 'artifact_revision',
  runLockResolvedFromWorkflowOutput: true,
  authoritativeRevisionRecorded: true,
  artifactSliceWaitsForApproval: true,
  revisionAdvanceInvalidatesApproval: true,
  idempotentRecovery: true,
  sameTypeProjectArtifactRejected: true,
  stepOutputGateCompatibilityCoveredByExistingSuite: true,
}));

async function workflowFixture(
  brief: string,
): Promise<{ inputBlockId: string; snapshot: BoardSnapshot }> {
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
  storyToStoryboardWorkflow.gates.push(artifactGate);
  try {
    createWorkflowRunForGroup(snapshot, projection.groupBlock.blockId);
  } finally {
    storyToStoryboardWorkflow.gates.pop();
  }
  return { inputBlockId: projection.workflowInputBlockIds[0], snapshot };
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

function stepView(snapshot: BoardSnapshot, workflowRunId: string, stepId: string) {
  const step = workflowRunViewForId(snapshot, workflowRunId)?.steps.find(
    (candidate) => candidate.record.stepId === stepId,
  );
  assert.ok(step);
  return step;
}

function blockFor(snapshot: BoardSnapshot, blockId: string): BlockRecord {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  assert.ok(block);
  return block;
}

function agentFor(snapshot: BoardSnapshot, agentRunId: string) {
  const record = (snapshot.agentRuns ?? []).find(
    (candidate) => candidate.agentRunId === agentRunId,
  );
  assert.ok(record);
  return record;
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
