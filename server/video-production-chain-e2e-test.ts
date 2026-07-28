import assert from 'node:assert/strict';
import path from 'node:path';
import { decideChangeProposal } from '../src/core/agentChangeApplication';
import {
  createAgentRunForWorkflowRun,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import {
  appendAgentUserMessage,
  applyAgentRuntimeTurn,
  createAgentSession,
} from '../src/core/agentSession';
import { capabilityDefinitionFor, textDocumentCapabilityIds } from '../src/core/capabilityRegistry';
import { createBlockRecord } from '../src/core/blockFactory';
import { syncExecutionOutputContractSnapshot } from '../src/core/executionContractSnapshot';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import {
  defaultGenerationPreparationParameters,
  generationPreparationWorkflowId,
} from '../src/core/generationPreparationContracts';
import { executeExistingGenerationPreparationOperation } from '../src/core/generationPreparationOperations';
import {
  buildGoalPlanDraftLaunchCommand,
  stageGoalPlanAgentLaunch,
} from '../src/core/goalPlanAgentLaunchApplication';
import { resolvePackageComposerInvocation } from '../src/core/packageComposer';
import {
  storyboardSheetWorkflowId,
} from '../src/core/storyboardSheetContracts';
import { executeExistingStoryboardSheetOperation } from '../src/core/storyboardSheetOperations';
import {
  executeExistingTextGenerationOperation,
  type TextGenerationLabels,
} from '../src/core/textOperations';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';
import {
  acceptWorkflowStepOutputs,
  createWorkflowRunForGroup,
  reconcileWorkflowRuntime,
  workflowRunViewForId,
} from '../src/core/workflowRuntime';
import {
  approvedGenerationPackageToVideoWorkflow,
  storyToStoryboardWorkflow,
} from '../src/core/workflowRegistry';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import {
  decideWorkflowApproval,
  workflowGateViewsForRun,
} from '../src/core/workflowGateRuntime';
import { authorizeAndStartDomainVideoGeneration } from './domain-video-generation-service';
import { reviewDomainVideoLaunch } from './domain-video-launch-review-service';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { readProjectArtifacts } from './local-store/artifact-store';
import {
  checkExecutionConnection,
  updateExecutionConnection,
} from './local-store/execution-provider-store';
import {
  markExecutionRunning,
  updateDocumentResultBlock,
} from './local-store/execution-store';
import {
  loadSnapshot,
  resetWorkspace,
  saveSnapshot,
} from './local-store/snapshot-store';
import { readProjectArtifactAuthority } from './artifact-library-service';
import { materializeWorkflowOutputArtifacts } from './workflow-output-artifact-service';
import { startTextGeneration } from './text-generation-service';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory || path.resolve(workspaceDirectory) === path.resolve('.retake')) {
  throw new Error('Video production chain E2E requires an explicit disposable RETAKE_WORKSPACE_DIR.');
}

let snapshot = await emptySnapshot();
const codexConnection = await readyCodexConnection();
const mockVideoConnection = mockConnection();

// Phase A: natural-language Goal -> Draft-only approval -> explicit Goal Agent launch.
const brief = createBlockRecord(snapshot, 'text');
brief.data = {
  ...brief.data,
  body: '一只快递猫必须在日出前把最后一卷胶片送到雨夜车站。',
  title: 'Creative Brief',
};
snapshot.blocks.push(brief);
const session = createAgentSession(snapshot, { model: 'test-model' }).session;
const sourceMessage = appendAgentUserMessage(snapshot, session.agentSessionId, {
  content: '把这个故事推进到可审阅的故事板计划。',
  contextRefs: [{ blockId: brief.blockId, kind: 'block', slotId: 'brief' }],
});
const goalTurn = applyAgentRuntimeTurn(snapshot, {
  agentSessionId: session.agentSessionId,
  decision: {
    coverage: 'full',
    kind: 'goal_plan_proposal',
    limitations: [],
    message: '使用已安装的 Story to storyboard plan。',
    summary: '从 Brief 生成剧本、制作设计与故事板计划。',
    workflowEntryPointId: 'workflow:retake.workflow.story-to-storyboard',
  },
  externalThreadId: 'thread_video_chain_e2e',
  runtimeModel: 'test-model',
  runtimeTurnId: 'turn_video_chain_goal',
  sourceMessageId: sourceMessage.agentMessageId,
});
assert.ok(goalTurn.proposal);
const beforeGoalApproval = runtimeCounts(snapshot);
const approvedGoal = decideChangeProposal(snapshot, {
  decision: 'approve',
  expectedProposalVersion: goalTurn.proposal.recordVersion,
  proposalId: goalTurn.proposal.proposalId,
});
assert.deepEqual(runtimeCounts(snapshot), beforeGoalApproval);
const goalLaunch = stageGoalPlanAgentLaunch(snapshot, buildGoalPlanDraftLaunchCommand({
  agentSessionId: session.agentSessionId,
  expectedProposalVersion: approvedGoal.proposal.recordVersion,
  proposalId: approvedGoal.proposal.proposalId,
}));
snapshot = goalLaunch.stagedSnapshot;
const goalRunId = goalLaunch.effect.workflowRunId;
const goalAgentRunId = goalLaunch.effect.agentRunId;
assert.deepEqual(runtimeCounts(snapshot), {
  agentRuns: 1,
  executions: 0,
  workflowRuns: 1,
  workflowStepRuns: 4,
});
await saveSnapshot(snapshot);

const storyOutputs: Array<[string, string]> = [
  ['screenplay_generate', '# Screenplay\n\nCourier Cat crosses the rain station before dawn.'],
  ['character_define', '# Character Bible\n\nCourier Cat keeps an orange rain-soaked coat.'],
  ['scene_define', '# Scene Bible\n\nRain station, blue practical light, locked platform.'],
  [
    'storyboard_plan',
    [
      '# Storyboard Plan',
      '',
      '## Unit: U01',
      '',
      '- U01-P01: wide setup; Courier Cat enters from frame left.',
      '- U01-P02: medium reaction; station light flickers.',
      '- U01-P03: close insert; the film canister seal breaks.',
      '- U01-P04: two-shot; the guard dog blocks the platform.',
      '- U01-P05: low angle; Courier Cat commits to the jump.',
      '- U01-P06: landing and continuity bridge before dawn.',
    ].join('\n'),
  ],
];
for (const [stepId, markdown] of storyOutputs) {
  snapshot = await completeTextWorkflowStep(
    snapshot,
    goalRunId,
    stepId,
    markdown,
    codexConnection,
  );
}
reconcileAgentRuntime(snapshot);
await saveSnapshot(snapshot);
assert.equal(workflowRunViewForId(snapshot, goalRunId)?.status, 'succeeded');
assert.equal(
  snapshot.agentRuns?.find((run) => run.agentRunId === goalAgentRunId)?.status,
  'succeeded',
);
const planStep = requiredStep(snapshot, goalRunId, 'storyboard_plan');
const planBinding = planStep.outputArtifactBindings[0];
assert.equal(planBinding?.artifactType, 'storyboard_plan');
const planBlock = requiredBlock(
  snapshot,
  snapshot.executions.find(
    (execution) => execution.executionId === planStep.executionIds.at(-1),
  )!.outputBlockIds[0]!,
);
assert.equal(planBlock.data.artifactRevisionId, planBinding.artifactRevisionId);
snapshot = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);

// Phase B: explicit installed Workflow -> two candidates -> manual_single -> Gate.
const sheetInvocation = resolvePackageComposerInvocation(snapshot, {
  entrypointId: `workflow:${storyboardSheetWorkflowId}`,
  instruction: '',
  inlineValues: [{ kind: 'inline', slotId: 'unit_id', value: 'U01' }],
  mentions: [{ kind: 'block', blockId: planBlock.blockId, slotId: 'storyboard_plan' }],
  parameters: {
    gridLayout: '3x2',
    outputCount: 2,
    panelAspectRatio: '16:9',
    panelCount: 6,
    renderMode: 'panel_grid',
  },
});
const sheetProjection = projectWorkflowDraft(snapshot, {
  composerInput: {
    inlineValues: sheetInvocation.invocation.inlineValues,
    mentions: sheetInvocation.invocation.mentions,
    parameters: sheetInvocation.invocation.parameters,
  },
  connectionIdForCapability: () => codexConnection.connectionId,
  labelsForSkill: () => storyboardSheetLabels(),
  outputPlaceholder: 'Waiting for same-unit candidates.',
  workflowId: storyboardSheetWorkflowId,
  workflowTitle: 'Storyboard unit to sheet',
});
const sheetRun = createWorkflowRunForGroup(snapshot, sheetProjection.groupBlock.blockId);
const sheetStep = requiredStep(snapshot, sheetRun.record.workflowRunId, 'storyboard_sheet_generate');
const sheetQueued = executeExistingStoryboardSheetOperation(snapshot, {
  connection: codexConnection,
  operationBlockId: sheetStep.operationBlockId,
});
sheetQueued.execution.status = 'running';
sheetQueued.operationBlock.data.status = 'running';
await saveSnapshot(snapshot);
const sheetCandidateA = await generatedAsset(snapshot, sheetQueued.execution.executionId, 'image', 'sheet-a');
const sheetCandidateB = await generatedAsset(snapshot, sheetQueued.execution.executionId, 'image', 'sheet-b');
snapshot.assets.push(sheetCandidateA, sheetCandidateB);
sheetQueued.execution.status = 'succeeded';
sheetQueued.execution.outputAssetIds = [sheetCandidateA.assetId, sheetCandidateB.assetId];
sheetQueued.execution.completedAt = new Date().toISOString();
syncExecutionOutputContractSnapshot(sheetQueued.execution);
sheetQueued.resultBlocks.forEach((block, index) => {
  const asset = [sheetCandidateA, sheetCandidateB][index]!;
  block.data = {
    ...block.data,
    assetId: asset.assetId,
    previewUrl: asset.previewUrl,
    status: 'succeeded',
  };
});
reconcileWorkflowRuntime(snapshot);
let currentSheetStep = requiredStep(
  snapshot,
  sheetRun.record.workflowRunId,
  'storyboard_sheet_generate',
);
assert.equal(currentSheetStep.status, 'waiting_selection');
assert.throws(() => acceptWorkflowStepOutputs(snapshot, {
  acceptedOutputAssetIds: [sheetCandidateA.assetId, sheetCandidateB.assetId],
  expectedStepRunVersion: currentSheetStep.recordVersion,
  stepRunId: currentSheetStep.stepRunId,
}), /exactly one Asset/);
acceptWorkflowStepOutputs(snapshot, {
  acceptedOutputAssetIds: [sheetCandidateA.assetId],
  expectedStepRunVersion: currentSheetStep.recordVersion,
  stepRunId: currentSheetStep.stepRunId,
});
await saveSnapshot(snapshot);
let materialized = await materializeWorkflowOutputArtifacts({
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
  trigger: { kind: 'output_accepted', stepRunId: currentSheetStep.stepRunId },
});
snapshot = materialized.snapshot;
currentSheetStep = requiredStep(snapshot, sheetRun.record.workflowRunId, 'storyboard_sheet_generate');
const sheetBinding = currentSheetStep.outputArtifactBindings[0]!;
const sheetBlock = snapshot.blocks.find(
  (block) =>
    block.data.assetId === sheetCandidateA.assetId
    && block.data.artifactRevisionId === sheetBinding.artifactRevisionId,
);
assert.ok(sheetBlock);
approveOnlyGate(snapshot, sheetRun.record.workflowRunId);
reconcileWorkflowRuntime(snapshot);
await saveSnapshot(snapshot);
assert.equal(workflowRunViewForId(snapshot, sheetRun.record.workflowRunId)?.status, 'succeeded');
snapshot = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);

// Phase C: consume the hidden Workflow Artifact authority without exposing it in Project Library.
const referenceManifest = {
  schemaRef: 'retake.generation-reference-manifest/v1' as const,
  items: [],
};
const preparationInvocation = resolvePackageComposerInvocation(snapshot, {
  entrypointId: `workflow:${generationPreparationWorkflowId}`,
  instruction: 'Keep the rain and screen direction continuous.',
  inlineValues: [
    { kind: 'inline', slotId: 'unit_id', value: 'U01' },
    { kind: 'inline', slotId: 'reference_manifest', value: referenceManifest },
  ],
  mentions: [
    { kind: 'block', blockId: planBlock.blockId, slotId: 'storyboard_plan' },
    { kind: 'block', blockId: sheetBlock.blockId, slotId: 'storyboard_sheet' },
  ],
  parameters: {
    ...defaultGenerationPreparationParameters,
    aspectRatio: '16:9',
    durationSeconds: 8,
    maxPromptChars: 1_800,
  },
});
const preparationProjection = projectWorkflowDraft(snapshot, {
  composerInput: {
    inlineValues: preparationInvocation.invocation.inlineValues,
    instruction: {
      body: preparationInvocation.invocation.instruction,
      slotId: 'instruction',
    },
    mentions: preparationInvocation.invocation.mentions,
    parameters: preparationInvocation.invocation.parameters,
  },
  connectionIdForCapability: () => codexConnection.connectionId,
  labelsForSkill: () => generationPreparationLabels(),
  outputPlaceholder: 'Waiting for generation package.',
  workflowId: generationPreparationWorkflowId,
  workflowTitle: 'Storyboard unit to generation package',
});
const preparationRun = createWorkflowRunForGroup(
  snapshot,
  preparationProjection.groupBlock.blockId,
);
const preparationStep = requiredStep(
  snapshot,
  preparationRun.record.workflowRunId,
  'generation_package_prepare',
);
const preparationQueued = executeExistingGenerationPreparationOperation(snapshot, {
  artifactLibrary: await readProjectArtifactAuthority(snapshot.project.projectId),
  connection: codexConnection,
  labels: generationPreparationLabels(),
  operationBlockId: preparationStep.operationBlockId,
});
await saveSnapshot(snapshot);
const packageMarkdown = validGenerationPackageMarkdown();
const startedPreparation = await startTextGeneration({
  boardId: snapshot.board.boardId,
  connectionId: codexConnection.connectionId,
  executionId: preparationQueued.execution.executionId,
  projectId: snapshot.project.projectId,
}, {
  runCodexAppServer: async () => ({
    text: packageMarkdown,
    threadId: 'thread_video_chain_generation_package',
    turnId: 'turn_video_chain_generation_package',
  }),
});
await startedPreparation.completion;
snapshot = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
const completedPreparation = snapshot.executions.find(
  (execution) => execution.executionId === preparationQueued.execution.executionId,
);
assert.equal(completedPreparation?.status, 'succeeded');
const packageStep = requiredStep(
  snapshot,
  preparationRun.record.workflowRunId,
  'generation_package_prepare',
);
const packageBinding = packageStep.outputArtifactBindings[0]!;
const packageBlock = snapshot.blocks.find(
  (block) =>
    block.data.sourceExecutionId === preparationQueued.execution.executionId
    && block.data.artifactRevisionId === packageBinding.artifactRevisionId,
);
assert.ok(packageBlock);
approveOnlyGate(snapshot, preparationRun.record.workflowRunId);
reconcileWorkflowRuntime(snapshot);
await saveSnapshot(snapshot);
assert.equal(
  workflowRunViewForId(snapshot, preparationRun.record.workflowRunId)?.status,
  'succeeded',
);
snapshot = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);

// Phase D: stop before exact authorization, then use the no-cost mock route.
const videoInvocation = resolvePackageComposerInvocation(snapshot, {
  entrypointId: `workflow:${approvedGenerationPackageToVideoWorkflow.workflowId}`,
  instruction: '',
  mentions: [{
    kind: 'block',
    blockId: packageBlock.blockId,
    slotId: 'generation_package',
  }],
  parameters: { outputCount: 2, qualityTier: 'preview' },
});
const videoProjection = projectWorkflowDraft(snapshot, {
  composerInput: {
    mentions: videoInvocation.invocation.mentions,
    parameters: videoInvocation.invocation.parameters,
  },
  connectionIdForCapability: () => mockVideoConnection.connectionId,
  labelsForSkill: () => domainVideoLabels(),
  outputPlaceholder: 'Waiting for launch review.',
  workflowId: approvedGenerationPackageToVideoWorkflow.workflowId,
  workflowTitle: 'Approved package to video',
});
const videoRun = createWorkflowRunForGroup(snapshot, videoProjection.groupBlock.blockId);
const videoAgent = createAgentRunForWorkflowRun(snapshot, videoRun.record.workflowRunId);
startAgentRun(snapshot, videoAgent.record.agentRunId);
reconcileAgentRuntime(snapshot);
assert.equal(videoAgent.record.status, 'waiting_input');
assert.equal(videoAgent.record.stopReason, 'provider_execution_authorization_required');
const executionCountBeforeAuthorization = snapshot.executions.length;
await saveSnapshot(snapshot);
const videoOperationId = videoProjection.operationBlockIds[0]!;
const launchReview = await reviewDomainVideoLaunch({
  blockId: videoOperationId,
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
});
assert.equal(launchReview.ready, true, JSON.stringify(launchReview, null, 2));
assert.equal(launchReview.costDisclosure?.billingSource, 'no_cost');
assert.equal(
  (await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId)).executions.length,
  executionCountBeforeAuthorization,
);
await assert.rejects(
  authorizeAndStartDomainVideoGeneration({
    blockId: videoOperationId,
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
    requestFingerprint: 'fnv1a:stale',
  }),
  /changed|fingerprint|review/i,
);
const startedVideo = await authorizeAndStartDomainVideoGeneration({
  blockId: videoOperationId,
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
  requestFingerprint: launchReview.request!.requestFingerprint,
});
snapshot = startedVideo.snapshot;
assert.equal(startedVideo.execution.status, 'succeeded');
assert.equal(startedVideo.execution.outputAssetIds.length, 2);
assert.equal(startedVideo.execution.providerCalls?.length, 2);
reconcileAgentRuntime(snapshot);
const videoStep = requiredStep(
  snapshot,
  videoRun.record.workflowRunId,
  'domain_video_generate',
);
assert.equal(videoStep.status, 'waiting_selection');
acceptWorkflowStepOutputs(snapshot, {
  acceptedOutputAssetIds: [startedVideo.execution.outputAssetIds[0]!],
  expectedStepRunVersion: videoStep.recordVersion,
  stepRunId: videoStep.stepRunId,
});
await saveSnapshot(snapshot);
materialized = await materializeWorkflowOutputArtifacts({
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
  trigger: { kind: 'output_accepted', stepRunId: videoStep.stepRunId },
});
snapshot = materialized.snapshot;
const selectedVideoBinding = requiredStep(
  snapshot,
  videoRun.record.workflowRunId,
  'domain_video_generate',
).outputArtifactBindings[0]!;
assert.equal(selectedVideoBinding.artifactType, 'video_clip');
approveOnlyGate(snapshot, videoRun.record.workflowRunId);
reconcileWorkflowRuntime(snapshot);
reconcileAgentRuntime(snapshot);
await saveSnapshot(snapshot);
assert.equal(workflowRunViewForId(snapshot, videoRun.record.workflowRunId)?.status, 'succeeded');
assert.equal(
  snapshot.agentRuns?.find((run) => run.agentRunId === videoAgent.record.agentRunId)?.status,
  'succeeded',
);

// Final chain facts.
const artifacts = await readProjectArtifacts(snapshot.project.projectId);
const selectedVideoRevision = artifacts.revisions.find(
  (revision) => revision.artifactRevisionId === selectedVideoBinding.artifactRevisionId,
);
assert.ok(selectedVideoRevision);
assert.equal(
  selectedVideoRevision.sourceArtifactRevisionIds.includes(
    packageBinding.artifactRevisionId,
  ),
  true,
);
assert.deepEqual(
  (snapshot.workflowRuns ?? []).map((run) => workflowRunViewForId(snapshot, run.workflowRunId)?.status),
  ['succeeded', 'succeeded', 'succeeded', 'succeeded'],
);
assert.equal(snapshot.executions.length, 7);
assert.equal(
  (snapshot.workflowGateEvaluations ?? []).filter(
    (gate) => gate.freshness === 'current' && gate.status === 'passed',
  ).length,
  3,
);
assert.equal(snapshot.workflowApprovalDecisions?.length ?? 0, 3);
assert.equal(snapshot.changeDecisions?.length ?? 0, 1);

console.log(JSON.stringify({
  ok: true,
  workspaceDirectory,
  goalDraftAndExplicitLaunch: true,
  workflowRuns: snapshot.workflowRuns?.length ?? 0,
  executions: snapshot.executions.length,
  manualSingleSelections: 2,
  passedHumanGates: 3,
  exactProviderAuthorization: true,
  providerCalls: startedVideo.execution.providerCalls?.length ?? 0,
  finalArtifactType: selectedVideoBinding.artifactType,
  crossWorkflowRevisionLineage: true,
  persistedPhaseRecovery: true,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const value = await resetWorkspace();
  value.blocks = [];
  value.edges = [];
  value.assets = [];
  value.executions = [];
  value.workflowRuns = [];
  value.workflowStepRuns = [];
  value.workflowGateEvaluations = [];
  value.workflowApprovalRequests = [];
  value.workflowApprovalDecisions = [];
  value.agentRuns = [];
  value.agentSessions = [];
  value.agentMessages = [];
  value.agentRuntimeBindings = [];
  value.agentRuntimeEvents = [];
  value.changeProposals = [];
  value.changeDecisions = [];
  value.historyEvents = [];
  await saveSnapshot(value);
  return value;
}

async function readyCodexConnection(): Promise<ExecutionConnectionSummary> {
  await updateExecutionConnection('codex-app-server', { modelId: 'gpt-5.6-terra' });
  const settings = await checkExecutionConnection('codex-app-server', undefined, {
    codexAppServerAvailability: () => ({
      available: true,
      executablePath: process.execPath,
      version: '0.144.6',
    }),
    probeCodexAppServer: async (selectedModelId) => ({
      authMode: 'chatgpt',
      capabilities: { imageGeneration: true, namespaceTools: true, webSearch: true },
      models: [{
        description: 'Video production chain E2E deterministic connection.',
        displayName: 'GPT-5.6-Terra',
        id: selectedModelId ?? 'gpt-5.6-terra',
        inputModalities: ['text', 'image'],
        isDefault: true,
      }],
      selectedModel: {
        description: 'Video production chain E2E deterministic connection.',
        displayName: 'GPT-5.6-Terra',
        id: selectedModelId ?? 'gpt-5.6-terra',
        inputModalities: ['text', 'image'],
        isDefault: true,
      },
      version: '0.144.6',
    }),
  });
  const connection = settings.connections.find(
    (candidate) => candidate.connectionId === 'codex-app-server',
  );
  assert.equal(connection?.status, 'ready');
  assert.ok(connection);
  return connection;
}

function mockConnection(): ExecutionConnectionSummary {
  return {
    configurable: false,
    connectionId: 'retake-mock',
    connectionKind: 'local',
    connectorId: 'retake-mock',
    deletable: false,
    description: 'No-cost local deterministic route.',
    displayName: 'Retake Mock',
    enabled: true,
    enabledUseCases: ['video'],
    hasCredential: false,
    implementationKind: 'local',
    modelId: 'contract-placeholder',
    providerLabel: 'Retake Mock',
    status: 'ready',
    supportedCapabilityIds: ['video.generate', 'generation.video.generate'],
  };
}

async function completeTextWorkflowStep(
  current: BoardSnapshot,
  workflowRunId: string,
  stepId: string,
  markdown: string,
  connection: ExecutionConnectionSummary,
): Promise<BoardSnapshot> {
  const step = requiredStep(current, workflowRunId, stepId);
  const operation = requiredBlock(current, step.operationBlockId);
  const queued = executeExistingTextGenerationOperation(current, {
    connection,
    labels: textLabelsForOperation(operation),
    operationBlockId: operation.blockId,
  }).execution;
  await saveSnapshot(current);
  const started = await markExecutionRunning({
    boardId: current.board.boardId,
    executionId: queued.executionId,
    projectId: current.project.projectId,
  });
  const asset = await generatedAsset(
    started.snapshot,
    queued.executionId,
    'document',
    stepId,
    markdown,
  );
  const output = capabilityDefinitionFor(queued.capabilityId).outputSlots[0]!;
  const completed = await updateDocumentResultBlock({
    assetId: asset.assetId,
    boardId: current.board.boardId,
    documentKind: output.artifactType,
    executionId: queued.executionId,
    markdown,
    projectId: current.project.projectId,
    resultBlockId: queued.outputBlockIds[0],
    title: output.semanticRole,
  });
  reconcileAgentRuntime(completed.snapshot);
  await saveSnapshot(completed.snapshot);
  return completed.snapshot;
}

async function generatedAsset(
  current: BoardSnapshot,
  executionId: string,
  kind: 'document' | 'image',
  name: string,
  body = name,
): Promise<AssetRecord> {
  const mimeType = kind === 'document' ? 'text/markdown' : 'image/png';
  return createAssetFromDataUrl({
    dataUrl: `data:${mimeType};base64,${Buffer.from(body, 'utf8').toString('base64')}`,
    fileName: kind === 'document' ? `${name}.md` : `${name}.png`,
    kind,
    projectId: current.project.projectId,
    sourceExecutionId: executionId,
  });
}

function approveOnlyGate(current: BoardSnapshot, workflowRunId: string): void {
  const gates = workflowGateViewsForRun(current, workflowRunId);
  assert.equal(gates.length, 1);
  const request = gates[0]?.request;
  assert.equal(gates[0]?.evaluation?.status, 'waiting_approval');
  assert.ok(request);
  decideWorkflowApproval(current, {
    approvalRequestId: request.approvalRequestId,
    decision: 'approve',
    expectedApprovalRequestVersion: request.recordVersion,
  });
}

function requiredStep(current: BoardSnapshot, workflowRunId: string, stepId: string) {
  const step = (current.workflowStepRuns ?? []).find(
    (candidate) =>
      candidate.workflowRunId === workflowRunId
      && candidate.stepId === stepId,
  );
  assert.ok(step);
  return step;
}

function requiredBlock(current: BoardSnapshot, blockId: string): BlockRecord {
  const block = current.blocks.find((candidate) => candidate.blockId === blockId);
  assert.ok(block);
  return block;
}

function textLabelsForOperation(operation: BlockRecord): TextGenerationLabels {
  const capability = capabilityDefinitionFor(String(operation.data.capabilityId));
  return {
    inputSlots: capability.inputSlots.map((slot) => ({
      promptPlaceholder: `Connect ${slot.semanticRole}.`,
      promptTitle: slot.semanticRole,
      slotId: slot.slotId,
    })),
    operationTitle: capability.displayName,
    promptPlaceholder: 'Connect Workflow input.',
    promptTitle: capability.inputSlots[0]?.semanticRole ?? 'Input',
    resultTitle: capability.displayName,
    waitingBody: 'Waiting.',
  };
}

function storyboardSheetLabels(): TextGenerationLabels {
  return {
    inputSlots: [
      { promptPlaceholder: 'Connect a plan.', promptTitle: 'Storyboard Plan', slotId: 'storyboard_plan' },
      { promptPlaceholder: 'Enter Unit ID.', promptTitle: 'Unit', slotId: 'unit_id' },
      { promptPlaceholder: 'Connect references.', promptTitle: 'References', slotId: 'references' },
    ],
    operationTitle: 'Generate storyboard sheet',
    promptPlaceholder: 'Connect a Storyboard Plan.',
    promptTitle: 'Storyboard Plan',
    resultTitle: 'Storyboard sheet',
    waitingBody: 'Waiting.',
  };
}

function generationPreparationLabels(): TextGenerationLabels {
  return {
    inputSlots: [
      { promptPlaceholder: 'Connect a plan.', promptTitle: 'Storyboard Plan', slotId: 'storyboard_plan' },
      { promptPlaceholder: 'Connect approved sheet.', promptTitle: 'Approved Sheet', slotId: 'storyboard_sheet' },
      { promptPlaceholder: 'Enter Unit ID.', promptTitle: 'Unit', slotId: 'unit_id' },
      { promptPlaceholder: 'Connect references.', promptTitle: 'References', slotId: 'references' },
      { promptPlaceholder: 'Declare references.', promptTitle: 'Manifest', slotId: 'reference_manifest' },
      { promptPlaceholder: 'Optional instruction.', promptTitle: 'Instruction', slotId: 'instruction' },
    ],
    operationTitle: 'Prepare video generation package',
    promptPlaceholder: 'Connect approved inputs.',
    promptTitle: 'Generation authority',
    resultTitle: 'Video generation package',
    waitingBody: 'Waiting.',
  };
}

function domainVideoLabels(): TextGenerationLabels {
  return {
    operationTitle: 'Generate approved package video',
    promptPlaceholder: 'Connect package.',
    promptTitle: 'Approved Generation Package',
    resultTitle: 'Video candidate',
    waitingBody: 'Waiting for launch review.',
  };
}

function validGenerationPackageMarkdown(): string {
  return [
    '# Authority',
    'Storyboard Plan and approved Storyboard Sheet revision are authoritative for U01.',
    '# Generation Profile',
    '16:9, 8 seconds, provider-neutral.',
    '# Active Subjects',
    'Courier Cat, guard dog, film canister, rain station.',
    '# Reference Mapping',
    'No optional external reference is required.',
    '# Storyboard Authority Sequence',
    '## P01',
    'Courier Cat enters from frame left.',
    '## P02',
    'The station light flickers.',
    '# State And Continuity',
    'Keep the rain-soaked coat, screen direction, and canister state.',
    '# Dialogue Voice And Sound',
    'Rain ambience and station light buzz; no dialogue.',
    '# Provider-neutral Submit Source',
    'A rain-soaked courier cat crosses the locked station before dawn, follows the approved panel order, protects the final film canister, and preserves identity, screen direction, lighting, and object continuity.',
    '# Negative Constraints',
    'No new characters, no dry coat, no reordered panels, no captions.',
    '# Readiness Review',
    'Ready: approved sheet, plan, profile, and continuity are bound. Provider and model remain intentionally unselected.',
  ].join('\n\n');
}

function runtimeCounts(current: BoardSnapshot) {
  return {
    agentRuns: current.agentRuns?.length ?? 0,
    executions: current.executions.length,
    workflowRuns: current.workflowRuns?.length ?? 0,
    workflowStepRuns: current.workflowStepRuns?.length ?? 0,
  };
}

assert.equal(textDocumentCapabilityIds.includes('story.screenplay.generate'), true);
assert.equal(storyToStoryboardWorkflow.steps.length, 4);
