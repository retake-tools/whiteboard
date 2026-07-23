import assert from 'node:assert/strict';
import { syncExecutionOutputContractSnapshot } from '../src/core/executionContractSnapshot';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import {
  listPackageComposerInlineInputOptions,
  listPackageComposerMentionOptions,
  resolvePackageComposerInvocation,
} from '../src/core/packageComposer';
import {
  buildPackageEntrypointInstantiationCommand,
  stagePackageEntrypointDraft,
} from '../src/core/packageEntrypointDraftApplication';
import type { AgentMessageRecord } from '../src/core/agentSessionContracts';
import {
  assertStoryboardUnitExists,
  normalizeStoryboardSheetGenerationParameters,
  StoryboardSheetContractError,
  storyboardSheetCapabilityId,
  storyboardSheetSkillId,
  storyboardSheetWorkflowId,
} from '../src/core/storyboardSheetContracts';
import { executeExistingStoryboardSheetOperation } from '../src/core/storyboardSheetOperations';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';
import { migrateBoardSnapshot } from '../src/core/snapshotMigration';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import {
  decideWorkflowApproval,
  workflowGateViewsForRun,
} from '../src/core/workflowGateRuntime';
import {
  acceptWorkflowStepOutputs,
  createWorkflowRunForGroup,
  reconcileWorkflowRuntime,
  workflowRunViewForId,
} from '../src/core/workflowRuntime';
import { storyboardUnitToSheetWorkflow, validateWorkflowDefinition } from '../src/core/workflowRegistry';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { readProjectArtifacts } from './local-store/artifact-store';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import { materializeWorkflowOutputArtifacts } from './workflow-output-artifact-service';

const readyImageConnection: ExecutionConnectionSummary = {
  connectionId: 'codex-app-server',
  connectorId: 'codex-app-server',
  providerLabel: 'Codex',
  displayName: 'Codex App Server',
  description: 'Storyboard Sheet Runtime V0 test connection.',
  connectionKind: 'agent_bridge',
  implementationKind: 'codex_app_server',
  supportedCapabilityIds: [storyboardSheetCapabilityId],
  enabledUseCases: ['image'],
  configurable: true,
  deletable: false,
  enabled: true,
  status: 'ready',
  hasCredential: true,
  modelId: 'gpt-5.6-terra',
};

assert.deepEqual(validateWorkflowDefinition(storyboardUnitToSheetWorkflow), []);
assert.equal(storyboardUnitToSheetWorkflow.workflowId, storyboardSheetWorkflowId);
assert.equal(storyboardUnitToSheetWorkflow.steps[0]?.outputAcceptancePolicy, 'manual_single');
assert.equal(storyboardUnitToSheetWorkflow.gates[0]?.subject.kind, 'artifact_revision');
assert.deepEqual(
  listPackageComposerInlineInputOptions('workflow:retake.workflow.storyboard-unit-to-sheet'),
  [{ schemaRef: 'retake.storyboard-unit-id/v1', slotId: 'unit_id' }],
);

assert.throws(
  () => normalizeStoryboardSheetGenerationParameters({ panelCount: 8, gridLayout: '3x2' }),
  (error) => error instanceof StoryboardSheetContractError && error.code === 'storyboard_parameters_invalid',
);
assert.throws(
  () => assertStoryboardUnitExists('# Unit: U01\n\nOne unit.', 'U03'),
  (error) => error instanceof StoryboardSheetContractError && error.code === 'storyboard_unit_not_found',
);
assert.throws(
  () => assertStoryboardUnitExists('# Unit: U03\n\nContent.\n\n## Unit: U03\n\nDuplicate.', 'U03'),
  (error) => error instanceof StoryboardSheetContractError && error.code === 'storyboard_unit_ambiguous',
);
assert.doesNotThrow(() => assertStoryboardUnitExists(
  '# Unit: U03\n\nShot U03-P01 leads to U03-P02.',
  'U03',
));

const snapshot = await emptySnapshot();
const planAsset = await documentAsset(snapshot, [
  '# Storyboard Plan',
  '',
  '## Unit: U03',
  '',
  '- U03-P01: wide setup; courier cat enters from frame left.',
  '- U03-P02: medium reaction; rain intensifies.',
  '- U03-P03: close insert; parcel seal breaks.',
  '- U03-P04: relationship two-shot; dog blocks the exit.',
  '- U03-P05: low angle; cat commits to the jump.',
  '- U03-P06: landing and continuity bridge.',
].join('\n'));
const characterReference = await imageAsset(snapshot, 'character-reference');
const sceneReference = await imageAsset(snapshot, 'scene-reference');
snapshot.assets.push(planAsset, characterReference, sceneReference);
const planBlock = assetBlock(snapshot, planAsset, 'Storyboard Plan', 'storyboard_plan');
const characterBlock = assetBlock(snapshot, characterReference, 'Courier Cat', undefined);
const sceneBlock = assetBlock(snapshot, sceneReference, 'Rainy Station', undefined);
snapshot.blocks.push(planBlock, characterBlock, sceneBlock);

const agentSourceMessage: AgentMessageRecord = {
  agentMessageId: 'agent_message_storyboard_sheet',
  agentSessionId: 'agent_session_storyboard_sheet',
  boardId: snapshot.board.boardId,
  content: '',
  contextRefs: [
    { kind: 'entrypoint', entrypointId: 'workflow:retake.workflow.storyboard-unit-to-sheet' },
    { kind: 'block', blockId: planBlock.blockId, slotId: 'storyboard_plan' },
    { kind: 'block', blockId: characterBlock.blockId, slotId: 'references' },
    { kind: 'inline', slotId: 'unit_id', value: 'U03' },
  ],
  createdAt: '2026-07-23T00:00:00.000Z',
  projectId: snapshot.project.projectId,
  recordVersion: 1,
  role: 'user',
};
const agentCommand = buildPackageEntrypointInstantiationCommand(
  snapshot,
  agentSourceMessage,
  'proposal_storyboard_sheet',
);
assert.deepEqual(agentCommand.invocation.inlineValues, [{
  kind: 'inline',
  slotId: 'unit_id',
  value: 'U03',
}]);
assert.equal(agentCommand.invocation.parameters.outputCount, 1);
const stagedAgentDraft = stagePackageEntrypointDraft(snapshot, agentCommand, {
  connectionIdForCapability: () => readyImageConnection.connectionId,
  labelsForSkill: () => labels(),
});
assert.equal(stagedAgentDraft.effect.entrypointKind, 'workflow');
assert.equal(stagedAgentDraft.stagedSnapshot.executions.length, 0);
assert.equal(stagedAgentDraft.stagedSnapshot.workflowRuns?.length ?? 0, 0);

const mentionOptions = listPackageComposerMentionOptions(
  snapshot,
  'workflow:retake.workflow.storyboard-unit-to-sheet',
);
assert.equal(
  mentionOptions.some((option) => option.kind === 'block'
    && option.blockId === planBlock.blockId
    && option.slotId === 'storyboard_plan'),
  true,
);
assert.equal(
  mentionOptions.filter((option) => option.kind === 'block'
    && [characterBlock.blockId, sceneBlock.blockId].includes(option.blockId)
    && option.slotId === 'references').length,
  2,
);

const composer = resolvePackageComposerInvocation(snapshot, {
  entrypointId: 'workflow:retake.workflow.storyboard-unit-to-sheet',
  instruction: '',
  inlineValues: [{ kind: 'inline', slotId: 'unit_id', value: ' U03 ' }],
  mentions: [
    { kind: 'block', blockId: planBlock.blockId, slotId: 'storyboard_plan' },
    { kind: 'block', blockId: characterBlock.blockId, slotId: 'references' },
    { kind: 'block', blockId: sceneBlock.blockId, slotId: 'references' },
  ],
  parameters: {
    panelCount: 6,
    gridLayout: '3x2',
    panelAspectRatio: '16:9',
    renderMode: 'panel_grid',
    outputCount: 2,
  },
});
assert.equal(composer.target.kind, 'workflow');
assert.equal(composer.invocation.inlineValues?.[0]?.value, 'U03');
assert.equal(composer.invocation.parameters?.outputCount, 2);

const projection = projectWorkflowDraft(snapshot, {
  workflowId: storyboardSheetWorkflowId,
  workflowTitle: 'Storyboard unit to sheet',
  outputPlaceholder: 'Waiting for same-unit candidates.',
  labelsForSkill: () => labels(),
  connectionIdForCapability: () => readyImageConnection.connectionId,
  composerInput: {
    inlineValues: composer.invocation.inlineValues,
    mentions: composer.invocation.mentions,
    parameters: composer.invocation.parameters,
  },
});
assert.equal(projection.operationBlockIds.length, 1);
assert.equal(projection.resultBlockIds.length, 1);
assert.equal(projection.workflowInputBlockIds.length, 3);
const runView = createWorkflowRunForGroup(snapshot, projection.groupBlock.blockId);
const step = requiredStep(snapshot, runView.record.workflowRunId);
assert.deepEqual(
  step.resolvedInputBindings.map((binding) => [
    binding.inputSlotId,
    binding.values.map((value) => value.kind),
  ]),
  [
    ['storyboard_plan', ['block']],
    ['unit_id', ['inline']],
    ['references', ['block', 'block']],
  ],
);
assert.equal(step.parameters?.outputCount, 2);
const legacySnapshot = structuredClone(snapshot) as BoardSnapshot;
const legacyRunBinding = legacySnapshot.workflowRuns?.[0]?.inputBindings[0] as unknown as {
  blockId?: string;
  values?: Array<{ blockId?: string }>;
};
legacyRunBinding.blockId = legacyRunBinding.values?.[0]?.blockId;
delete legacyRunBinding.values;
const legacyStepBinding = legacySnapshot.workflowStepRuns?.[0]?.resolvedInputBindings[0] as unknown as {
  blockId?: string;
  values?: Array<{ blockId?: string }>;
};
legacyStepBinding.blockId = legacyStepBinding.values?.[0]?.blockId;
delete legacyStepBinding.values;
const migrated = migrateBoardSnapshot(legacySnapshot);
assert.equal(migrated.workflowRuns?.[0]?.inputBindings[0]?.values[0]?.kind, 'block');
assert.equal(migrated.workflowStepRuns?.[0]?.resolvedInputBindings[0]?.values[0]?.kind, 'block');
assert.deepEqual(
  migrateBoardSnapshot(structuredClone(migrated)).workflowRuns?.[0]?.inputBindings,
  migrated.workflowRuns?.[0]?.inputBindings,
);

const operation = requiredBlock(snapshot, step.operationBlockId);
const queued = executeExistingStoryboardSheetOperation(snapshot, {
  connection: readyImageConnection,
  operationBlockId: operation.blockId,
});
assert.equal(queued.execution.capabilityId, storyboardSheetCapabilityId);
assert.equal(queued.execution.skillId, storyboardSheetSkillId);
assert.equal(queued.execution.outputBlockIds.length, 2);
assert.equal(queued.resultBlocks.length, 2);
assert.equal(queued.execution.inputBindingsSnapshot?.find(
  (binding) => binding.slotId === 'references',
)?.values.length, 2);
assert.match(queued.execution.prompt ?? '', /Generate 2 same-unit candidates/);
assert.equal(queued.resultBlocks[0]?.data.title, 'Storyboard sheet · U03 · same-unit candidate 1/2');
assert.equal(queued.resultBlocks[1]?.data.title, 'Storyboard sheet · U03 · same-unit candidate 2/2');
queued.execution.status = 'running';
queued.operationBlock.data.status = 'running';
await saveSnapshot(snapshot);

const candidateA = await generatedImage(snapshot, queued.execution.executionId, 'candidate-a');
const candidateB = await generatedImage(snapshot, queued.execution.executionId, 'candidate-b');
snapshot.assets.push(candidateA, candidateB);
queued.execution.status = 'succeeded';
queued.execution.outputAssetIds = [candidateA.assetId, candidateB.assetId];
queued.execution.completedAt = new Date().toISOString();
syncExecutionOutputContractSnapshot(queued.execution);
queued.resultBlocks.forEach((block, index) => {
  const asset = [candidateA, candidateB][index];
  block.data = {
    ...block.data,
    assetId: asset.assetId,
    previewUrl: asset.previewUrl,
    status: 'succeeded',
  };
});
reconcileWorkflowRuntime(snapshot);
let currentStep = requiredStep(snapshot, runView.record.workflowRunId);
assert.equal(currentStep.status, 'waiting_selection');
assert.deepEqual(queued.execution.outputSlotResults, [{
  slotId: 'storyboard_sheet',
  assetIds: [candidateA.assetId, candidateB.assetId],
}]);
assert.throws(() => acceptWorkflowStepOutputs(snapshot, {
  acceptedOutputAssetIds: [],
  expectedStepRunVersion: currentStep.recordVersion,
  stepRunId: currentStep.stepRunId,
}), /at least one Asset/);
assert.throws(() => acceptWorkflowStepOutputs(snapshot, {
  acceptedOutputAssetIds: [candidateA.assetId, candidateB.assetId],
  expectedStepRunVersion: currentStep.recordVersion,
  stepRunId: currentStep.stepRunId,
}), /exactly one Asset/);

acceptWorkflowStepOutputs(snapshot, {
  acceptedOutputAssetIds: [candidateA.assetId],
  expectedStepRunVersion: currentStep.recordVersion,
  stepRunId: currentStep.stepRunId,
});
currentStep = requiredStep(snapshot, runView.record.workflowRunId);
assert.equal(currentStep.status, 'succeeded');
assert.equal(currentStep.freshness, 'current');
assert.deepEqual(currentStep.acceptedOutputAssetIds, [candidateA.assetId]);
await saveSnapshot(snapshot);
const firstMaterialized = await materializeWorkflowOutputArtifacts({
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
  trigger: { kind: 'output_accepted', stepRunId: currentStep.stepRunId },
});
currentStep = requiredStep(firstMaterialized.snapshot, runView.record.workflowRunId);
assert.deepEqual(currentStep.outputArtifactBindings[0]?.assetIds, [candidateA.assetId]);
const firstArtifacts = await readProjectArtifacts(snapshot.project.projectId);
assert.equal(firstArtifacts.revisions.length, 1);
assert.deepEqual(firstArtifacts.revisions[0]?.metadata, {
  kind: 'storyboard_sheet',
  schemaRef: 'retake.storyboard-sheet-metadata/v1',
  unitId: 'U03',
  panelCount: 6,
  gridLayout: '3x2',
  panelAspectRatio: '16:9',
  renderMode: 'panel_grid',
});
assert.deepEqual(
  new Set(firstArtifacts.revisions[0]?.sourceAssetIds),
  new Set([planAsset.assetId, characterReference.assetId, sceneReference.assetId]),
);
let gate = workflowGateViewsForRun(firstMaterialized.snapshot, runView.record.workflowRunId)[0];
assert.equal(gate?.evaluation?.status, 'waiting_approval');
assert.equal(gate?.evaluation?.subjectArtifactRevisionId, firstArtifacts.revisions[0]?.artifactRevisionId);
assert.ok(gate?.request);
decideWorkflowApproval(firstMaterialized.snapshot, {
  approvalRequestId: gate.request.approvalRequestId,
  decision: 'approve',
  expectedApprovalRequestVersion: gate.request.recordVersion,
});
reconcileWorkflowRuntime(firstMaterialized.snapshot);
assert.equal(
  workflowRunViewForId(firstMaterialized.snapshot, runView.record.workflowRunId)?.status,
  'succeeded',
);

currentStep = requiredStep(firstMaterialized.snapshot, runView.record.workflowRunId);
acceptWorkflowStepOutputs(firstMaterialized.snapshot, {
  acceptedOutputAssetIds: [candidateB.assetId],
  expectedStepRunVersion: currentStep.recordVersion,
  stepRunId: currentStep.stepRunId,
});
await saveSnapshot(firstMaterialized.snapshot);
const secondMaterialized = await materializeWorkflowOutputArtifacts({
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
  trigger: { kind: 'output_accepted', stepRunId: currentStep.stepRunId },
});
const allArtifacts = await readProjectArtifacts(snapshot.project.projectId);
assert.equal(allArtifacts.artifacts.length, 1);
assert.equal(allArtifacts.revisions.length, 2);
assert.deepEqual(
  requiredStep(secondMaterialized.snapshot, runView.record.workflowRunId)
    .outputArtifactBindings[0]?.assetIds,
  [candidateB.assetId],
);
gate = workflowGateViewsForRun(secondMaterialized.snapshot, runView.record.workflowRunId)[0];
assert.equal(gate?.evaluation?.status, 'waiting_approval');
assert.notEqual(gate?.evaluation?.subjectArtifactRevisionId, firstArtifacts.revisions[0]?.artifactRevisionId);
assert.equal(
  secondMaterialized.snapshot.workflowGateEvaluations?.some(
    (evaluation) => evaluation.subjectArtifactRevisionId === firstArtifacts.revisions[0]?.artifactRevisionId
      && evaluation.freshness === 'outdated',
  ),
  true,
);

const projectedReference = secondMaterialized.snapshot.blocks.find(
  (block) => block.data.workflowInputSlotId === 'references' && block.type === 'image',
);
assert.ok(projectedReference);
projectedReference.data.assetId = characterReference.assetId === projectedReference.data.assetId
  ? sceneReference.assetId
  : characterReference.assetId;
reconcileWorkflowRuntime(secondMaterialized.snapshot);
assert.equal(
  requiredStep(secondMaterialized.snapshot, runView.record.workflowRunId).freshness,
  'outdated',
);

console.log(JSON.stringify({
  ok: true,
  typedUnitAndManyReferences: true,
  sameUnitCandidates: 2,
  manualSingleEnforced: true,
  acceptedAssetMaterialized: true,
  typedArtifactMetadata: true,
  artifactGateCurrentRevision: true,
  reselectionAdvancesRevision: true,
  sourceChangeMarksOutcomeOutdated: true,
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

async function documentAsset(snapshot: BoardSnapshot, markdown: string): Promise<AssetRecord> {
  return createAssetFromDataUrl({
    projectId: snapshot.project.projectId,
    dataUrl: `data:text/markdown;base64,${Buffer.from(markdown, 'utf8').toString('base64')}`,
    fileName: 'storyboard-plan.md',
    kind: 'document',
  });
}

async function imageAsset(snapshot: BoardSnapshot, name: string): Promise<AssetRecord> {
  return createAssetFromDataUrl({
    projectId: snapshot.project.projectId,
    dataUrl: `data:image/png;base64,${Buffer.from(name, 'utf8').toString('base64')}`,
    fileName: `${name}.png`,
    kind: 'image',
  });
}

async function generatedImage(
  snapshot: BoardSnapshot,
  executionId: string,
  name: string,
): Promise<AssetRecord> {
  return createAssetFromDataUrl({
    projectId: snapshot.project.projectId,
    sourceExecutionId: executionId,
    dataUrl: `data:image/png;base64,${Buffer.from(name, 'utf8').toString('base64')}`,
    fileName: `${name}.png`,
    kind: 'image',
  });
}

function assetBlock(
  snapshot: BoardSnapshot,
  asset: AssetRecord,
  title: string,
  documentKind: string | undefined,
): BlockRecord {
  const type = asset.kind === 'document' ? 'document' : 'image';
  return {
    blockId: `block_${asset.assetId}`,
    boardId: snapshot.board.boardId,
    type,
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { width: 260, height: 180 },
    zIndex: 1,
    data: {
      title,
      assetId: asset.assetId,
      previewUrl: asset.previewUrl,
      ...(documentKind ? { documentKind } : {}),
    },
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
}

function labels() {
  return {
    inputSlots: [
      { slotId: 'storyboard_plan', promptTitle: 'Storyboard Plan', promptPlaceholder: 'Connect a plan.' },
      { slotId: 'unit_id', promptTitle: 'Unit', promptPlaceholder: 'Enter Unit ID.' },
      { slotId: 'references', promptTitle: 'References', promptPlaceholder: 'Connect image references.' },
    ],
    operationTitle: 'Generate storyboard sheet',
    promptTitle: 'Storyboard Plan',
    promptPlaceholder: 'Connect a Storyboard Plan.',
    resultTitle: 'Storyboard sheet',
    waitingBody: 'Waiting.',
  };
}

function requiredBlock(snapshot: BoardSnapshot, blockId: string): BlockRecord {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  assert.ok(block);
  return block;
}

function requiredStep(snapshot: BoardSnapshot, workflowRunId: string) {
  const step = (snapshot.workflowStepRuns ?? []).find(
    (candidate) => candidate.workflowRunId === workflowRunId
      && candidate.stepId === 'storyboard_sheet_generate',
  );
  assert.ok(step);
  return step;
}
