import assert from 'node:assert/strict';
import {
  assertGenerationPackageMarkdown,
  defaultGenerationPreparationParameters,
  generationPreparationCapabilityId,
  generationPreparationSkillId,
  generationPreparationWorkflowId,
  GenerationPreparationContractError,
  normalizeGenerationReferenceManifest,
  requireVideoGenerationPackageArtifactRevisionMetadataV2,
} from '../src/core/generationPreparationContracts';
import {
  executeExistingGenerationPreparationOperation,
} from '../src/core/generationPreparationOperations';
import {
  packageComposerMentionBindingIdentity,
  resolvePackageComposerInvocation,
} from '../src/core/packageComposer';
import {
  buildPackageEntrypointInstantiationCommand,
  stagePackageEntrypointDraft,
} from '../src/core/packageEntrypointDraftApplication';
import type { AgentMessageRecord } from '../src/core/agentSessionContracts';
import { operationReadinessFor } from '../src/core/capabilities';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';
import {
  createWorkflowRunForGroup,
  reconcileWorkflowRuntime,
  workflowRunViewForId,
} from '../src/core/workflowRuntime';
import {
  storyboardUnitToGenerationPackageWorkflow,
  validateWorkflowDefinition,
} from '../src/core/workflowRegistry';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import { workflowGateViewsForRun } from '../src/core/workflowGateRuntime';
import { storyboardSheetArtifactMetadata } from '../src/core/storyboardSheetContracts';
import { createOrAdvanceArtifact, readProjectArtifacts } from './local-store/artifact-store';
import { createAssetFromDataUrl } from './local-store/asset-store';
import {
  checkExecutionConnection,
  updateExecutionConnection,
} from './local-store/execution-provider-store';
import {
  loadSnapshot,
  resetWorkspace,
  saveSnapshot,
} from './local-store/snapshot-store';
import { readProjectArtifactLibrary } from './artifact-library-service';
import { startTextGeneration } from './text-generation-service';
import { decideWorkflowApproval } from '../src/core/workflowGateRuntime';

assert.deepEqual(validateWorkflowDefinition(storyboardUnitToGenerationPackageWorkflow), []);
assert.equal(storyboardUnitToGenerationPackageWorkflow.workflowId, generationPreparationWorkflowId);
assert.equal(
  storyboardUnitToGenerationPackageWorkflow.steps[0]?.outputAcceptancePolicy,
  'automatic',
);
assert.equal(
  storyboardUnitToGenerationPackageWorkflow.gates[0]?.subject.kind,
  'artifact_revision',
);
assert.throws(
  () => normalizeGenerationReferenceManifest({
    schemaRef: 'retake.generation-reference-manifest/v1',
    items: [
      {
        requirementId: 'hero',
        role: 'character_identity',
        required: true,
        purpose: 'Preserve hero identity.',
      },
      {
        requirementId: 'hero',
        role: 'scene',
        required: false,
        purpose: 'Duplicate ID.',
      },
    ],
  }),
  (error) => error instanceof GenerationPreparationContractError
    && error.code === 'generation_package_reference_manifest_invalid',
);
assert.throws(
  () => assertGenerationPackageMarkdown('# Authority\n', 2_000),
  (error) => error instanceof GenerationPreparationContractError
    && error.code === 'generation_package_output_invalid',
);

const snapshot = await emptySnapshot();
await updateExecutionConnection('codex-app-server', { modelId: 'gpt-5.6-terra' });
const settings = await checkExecutionConnection('codex-app-server', undefined, {
  probeCodexAppServer: async (selectedModelId) => ({
    version: '0.144.6',
    authMode: 'chatgpt',
    capabilities: { imageGeneration: true, namespaceTools: true, webSearch: true },
    models: [{
      id: selectedModelId ?? 'gpt-5.6-terra',
      displayName: 'GPT-5.6-Terra',
      description: 'Generation Preparation test model',
      isDefault: true,
      inputModalities: ['text', 'image'],
    }],
    selectedModel: {
      id: selectedModelId ?? 'gpt-5.6-terra',
      displayName: 'GPT-5.6-Terra',
      description: 'Generation Preparation test model',
      isDefault: true,
      inputModalities: ['text', 'image'],
    },
  }),
});
const connection = settings.connections.find(
  (candidate) => candidate.connectionId === 'codex-app-server',
);
assert.equal(connection?.status, 'ready');
assert.equal(connection?.supportedCapabilityIds.includes(generationPreparationCapabilityId), true);

const planAsset = await documentAsset(snapshot, [
  '# Storyboard Plan',
  '',
  '## Unit: U03',
  '',
  '- P01: Hero cat enters the rain station from frame left.',
  '- P02: Hero cat sees the locked parcel and stops.',
  '- P03: The station light flickers while the cat reaches.',
  '- P04: The parcel opens; the cat keeps the same rain-soaked state.',
  '- P05: The cat turns toward the exit.',
  '- P06: End on the cat carrying the parcel into the rain.',
].join('\n'));
const sheetAsset = await imageAsset(snapshot, 'approved-sheet');
const referenceAsset = await imageAsset(snapshot, 'hero-reference');
snapshot.assets.push(planAsset, sheetAsset, referenceAsset);

const sheetMetadata = storyboardSheetArtifactMetadata({
  unitId: 'U03',
  parameters: {
    gridLayout: '3x2',
    outputCount: 1,
    panelAspectRatio: '16:9',
    panelCount: 6,
    renderMode: 'panel_grid',
  },
});
const sheetArtifact = await createOrAdvanceArtifact({
  artifactType: 'storyboard_sheet',
  assetIds: [sheetAsset.assetId],
  createdByActor: { actorId: 'user_local', actorType: 'user' },
  expectedCurrentRevisionId: null,
  idempotencyKey: 'generation-preparation-test:sheet',
  libraryVisibility: 'listed',
  metadata: sheetMetadata,
  primaryAssetId: sheetAsset.assetId,
  projectId: snapshot.project.projectId,
  schemaVersion: 1,
  scope: 'project',
  semanticKey: 'storyboard_sheet:u03',
  sourceArtifactRevisionIds: [],
  sourceAssetIds: [planAsset.assetId],
});

const planBlock = assetBlock(snapshot, planAsset, 'Storyboard Plan', {
  documentKind: 'storyboard_plan',
});
const sheetBlock = assetBlock(snapshot, sheetAsset, 'Approved Storyboard Sheet', {
  artifactId: sheetArtifact.artifact.artifactId,
  artifactRevisionId: sheetArtifact.revision.artifactRevisionId,
  artifactType: 'storyboard_sheet',
});
const referenceBlock = assetBlock(snapshot, referenceAsset, 'Hero identity', {
  artifactType: 'character_reference',
});
snapshot.blocks.push(planBlock, sheetBlock, referenceBlock);
snapshot.workflowGateEvaluations = [passedSheetGate(snapshot, sheetArtifact.revision.artifactRevisionId)];

const referenceIdentity = packageComposerMentionBindingIdentity(snapshot, {
  kind: 'block',
  blockId: referenceBlock.blockId,
  slotId: 'references',
});
assert.equal(referenceIdentity, `asset:${referenceAsset.assetId}`);
const manifest = {
  schemaRef: 'retake.generation-reference-manifest/v1' as const,
  items: [{
    requirementId: 'hero_identity',
    role: 'character_identity' as const,
    required: true,
    bindingIdentity: referenceIdentity,
    purpose: 'Preserve the hero cat identity in every panel responsibility.',
  }],
};
const parameters = {
  ...defaultGenerationPreparationParameters,
  aspectRatio: '16:9' as const,
  durationSeconds: 8,
  maxPromptChars: 1_800,
};
const invocation = resolvePackageComposerInvocation(snapshot, {
  entrypointId: `workflow:${generationPreparationWorkflowId}`,
  instruction: 'Keep the rain continuity explicit.',
  inlineValues: [
    { kind: 'inline', slotId: 'unit_id', value: ' U03 ' },
    { kind: 'inline', slotId: 'reference_manifest', value: manifest },
  ],
  mentions: [
    { kind: 'block', blockId: planBlock.blockId, slotId: 'storyboard_plan' },
    { kind: 'block', blockId: sheetBlock.blockId, slotId: 'storyboard_sheet' },
    { kind: 'block', blockId: referenceBlock.blockId, slotId: 'references' },
  ],
  parameters,
});
assert.equal(invocation.invocation.inlineValues?.find(
  (value) => value.slotId === 'unit_id',
)?.value, 'U03');
assert.equal(invocation.invocation.parameters?.durationSeconds, 8);

const agentSource: AgentMessageRecord = {
  agentMessageId: 'agent_message_generation_preparation',
  agentSessionId: 'agent_session_generation_preparation',
  boardId: snapshot.board.boardId,
  content: 'Keep the rain continuity explicit.',
  contextRefs: [
    { kind: 'entrypoint', entrypointId: `workflow:${generationPreparationWorkflowId}` },
    ...invocation.invocation.mentions,
    ...(invocation.invocation.inlineValues ?? []),
    { kind: 'parameters', value: parameters },
  ],
  createdAt: '2026-07-23T00:00:00.000Z',
  projectId: snapshot.project.projectId,
  recordVersion: 1,
  role: 'user',
};
const agentCommand = buildPackageEntrypointInstantiationCommand(
  snapshot,
  agentSource,
  'proposal_generation_preparation',
);
assert.equal(agentCommand.invocation.targetLock.entrypointKind, 'workflow');
assert.equal(agentCommand.invocation.parameters.durationSeconds, 8);
assert.deepEqual(
  agentCommand.invocation.inlineValues.find((value) => value.slotId === 'reference_manifest')?.value,
  manifest,
);
const staged = stagePackageEntrypointDraft(snapshot, agentCommand, {
  connectionIdForCapability: () => connection!.connectionId,
  labelsForSkill: () => labels(),
});
assert.equal(staged.effect.entrypointKind, 'workflow');
assert.equal(staged.stagedSnapshot.executions.length, 0);

const projection = projectWorkflowDraft(snapshot, {
  workflowId: generationPreparationWorkflowId,
  workflowTitle: 'Storyboard unit to generation package',
  outputPlaceholder: 'Waiting for generation package.',
  labelsForSkill: () => labels(),
  connectionIdForCapability: () => connection!.connectionId,
  composerInput: {
    inlineValues: invocation.invocation.inlineValues,
    instruction: { body: invocation.invocation.instruction, slotId: 'instruction' },
    mentions: invocation.invocation.mentions,
    parameters: invocation.invocation.parameters,
  },
});
assert.equal(projection.operationBlockIds.length, 1);
const run = createWorkflowRunForGroup(snapshot, projection.groupBlock.blockId);
const step = workflowRunViewForId(snapshot, run.record.workflowRunId)?.steps[0]?.record;
assert.ok(step);
const operation = requiredBlock(snapshot, step.operationBlockId);
assert.equal(operation.data.capabilityId, generationPreparationCapabilityId);
assert.equal(operationReadinessFor(snapshot, operation).canRun, true);

const queued = executeExistingGenerationPreparationOperation(snapshot, {
  artifactLibrary: await readProjectArtifactLibrary(snapshot.project.projectId),
  connection: connection!,
  labels: labels(),
  operationBlockId: operation.blockId,
});
assert.equal(queued.execution.skillId, generationPreparationSkillId);
assert.equal(queued.execution.outputBlockIds.length, 1);
assert.equal(queued.execution.outputSlotResults?.[0]?.slotId, 'generation_package');
assert.equal(
  queued.execution.inputBindingsSnapshot?.find(
    (binding) => binding.slotId === 'storyboard_sheet',
  )?.values[0]?.kind,
  'artifact_revision',
);
assert.equal(snapshot.executions.some((execution) => execution.capabilityId === 'video.generate'), false);
await saveSnapshot(snapshot);

const markdown = validGenerationPackageMarkdown();
let attachedImageCount = 0;
const started = await startTextGeneration({
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  executionId: queued.execution.executionId,
  connectionId: connection!.connectionId,
}, {
  runCodexAppServer: async (input) => {
    assert.match(input.prompt, /# Reference Manifest/);
    assert.match(input.prompt, /Hero cat enters the rain station/);
    assert.match(input.prompt, /Attachment 1: approved Storyboard Sheet/);
    assert.match(input.prompt, /role=character_identity/);
    assert.match(input.prompt, /Do not execute video generation/);
    attachedImageCount = input.localImagePaths?.length ?? 0;
    input.onTextDelta?.(markdown.slice(0, 40));
    return {
      threadId: 'thread_generation_preparation',
      turnId: 'turn_generation_preparation',
      text: markdown,
    };
  },
});
await started.completion;
assert.equal(attachedImageCount, 2);

const completed = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
const completedExecution = completed.executions.find(
  (execution) => execution.executionId === queued.execution.executionId,
);
assert.equal(completedExecution?.status, 'succeeded');
assert.equal(completedExecution?.outputAssetIds.length, 1);
assert.equal(completedExecution?.requestPrompts?.length, 1);
assert.equal(completed.executions.some((execution) => execution.capabilityId === 'video.generate'), false);

const artifacts = await readProjectArtifacts(snapshot.project.projectId);
const packageArtifact = artifacts.artifacts.find(
  (artifact) => artifact.artifactType === 'video_generation_package',
);
assert.ok(packageArtifact);
const packageRevision = artifacts.revisions.find(
  (revision) => revision.artifactRevisionId === packageArtifact.currentRevisionId,
);
assert.ok(packageRevision);
assert.equal(packageRevision.metadata?.kind, 'video_generation_package');
const packageMetadata = requireVideoGenerationPackageArtifactRevisionMetadataV2(packageRevision.metadata);
assert.equal(packageMetadata.schemaRef, 'retake.video-generation-package-metadata/v2');
assert.equal(packageMetadata.unitId, 'U03');
assert.equal(packageMetadata.storyboardSheetArtifactRevisionId, sheetArtifact.revision.artifactRevisionId);
assert.equal(packageMetadata.storyboardSheetPanelCount, 6);
assert.equal(packageMetadata.referenceCount, 1);
assert.equal(packageMetadata.requiredReferenceCount, 1);
assert.equal(packageMetadata.providerNeutral, true);
assert.deepEqual(packageMetadata.referenceManifest, manifest);
assert.deepEqual(packageRevision.sourceArtifactRevisionIds, [sheetArtifact.revision.artifactRevisionId]);

let packageGate = workflowGateViewsForRun(completed, run.record.workflowRunId)[0];
assert.equal(packageGate?.evaluation?.status, 'waiting_approval');
assert.equal(packageGate?.evaluation?.subjectArtifactRevisionId, packageRevision.artifactRevisionId);
assert.ok(packageGate?.request);
decideWorkflowApproval(completed, {
  approvalRequestId: packageGate.request.approvalRequestId,
  decision: 'approve',
  expectedApprovalRequestVersion: packageGate.request.recordVersion,
});
reconcileWorkflowRuntime(completed);
packageGate = workflowGateViewsForRun(completed, run.record.workflowRunId)[0];
assert.equal(packageGate?.evaluation?.status, 'passed');

const projectedReference = completed.blocks.find(
  (block) => block.data.workflowInputSlotId === 'references' && block.type === 'image',
);
assert.ok(projectedReference);
projectedReference.data.assetId = sheetAsset.assetId;
reconcileWorkflowRuntime(completed);
assert.equal(
  workflowRunViewForId(completed, run.record.workflowRunId)?.steps[0]?.freshness,
  'outdated',
);

console.log(JSON.stringify({
  ok: true,
  exactAgentCommand: true,
  approvedSheetRevisionRequired: true,
  typedReferenceManifest: true,
  selfContainedGenerationPackageV2: true,
  multimodalTextRequest: true,
  providerNeutralOutputValidated: true,
  automaticArtifactMaterialization: true,
  artifactRevisionGate: true,
  sourceChangeMarksOutcomeOutdated: true,
  videoExecutionCount: 0,
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

function assetBlock(
  snapshot: BoardSnapshot,
  asset: AssetRecord,
  title: string,
  extra: Record<string, unknown>,
): BlockRecord {
  return {
    blockId: `block_${asset.assetId}`,
    boardId: snapshot.board.boardId,
    type: asset.kind === 'document' ? 'document' : 'image',
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { width: 260, height: 180 },
    zIndex: 1,
    data: {
      title,
      assetId: asset.assetId,
      previewUrl: asset.previewUrl,
      ...extra,
    },
    createdAt: '2026-07-23T00:00:00.000Z',
    updatedAt: '2026-07-23T00:00:00.000Z',
  };
}

function passedSheetGate(snapshot: BoardSnapshot, artifactRevisionId: string) {
  return {
    approvalRequestId: 'approval_request_storyboard_sheet',
    boardId: snapshot.board.boardId,
    createdAt: '2026-07-23T00:00:00.000Z',
    freshness: 'current' as const,
    gateDefinitionLock: {
      definitionHash: 'sha256:retake-workflow-gate-storyboard-sheet-review-v1',
      gateId: 'storyboard_sheet_review',
    },
    gateEvaluationId: 'gate_evaluation_storyboard_sheet',
    gateId: 'storyboard_sheet_review',
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    status: 'passed' as const,
    subjectArtifactRevisionId: artifactRevisionId,
    subjectAssetIds: [],
    subjectExecutionIds: [],
    subjectFingerprint: `artifact_revision:${artifactRevisionId}`,
    updatedAt: '2026-07-23T00:00:00.000Z',
    workflowRunId: 'workflow_run_storyboard_sheet',
  };
}

function labels() {
  return {
    inputSlots: [
      { slotId: 'storyboard_plan', promptTitle: 'Storyboard Plan', promptPlaceholder: 'Connect a plan.' },
      { slotId: 'storyboard_sheet', promptTitle: 'Approved Sheet', promptPlaceholder: 'Connect an approved sheet.' },
      { slotId: 'unit_id', promptTitle: 'Unit', promptPlaceholder: 'Enter Unit ID.' },
      { slotId: 'references', promptTitle: 'References', promptPlaceholder: 'Connect references.' },
      { slotId: 'reference_manifest', promptTitle: 'Reference Manifest', promptPlaceholder: 'Declare references.' },
      { slotId: 'instruction', promptTitle: 'Instruction', promptPlaceholder: 'Optional instruction.' },
    ],
    operationTitle: 'Prepare video generation package',
    promptTitle: 'Generation authority',
    promptPlaceholder: 'Connect approved inputs.',
    resultTitle: 'Video generation package',
    waitingBody: 'Waiting.',
  };
}

function requiredBlock(snapshot: BoardSnapshot, blockId: string): BlockRecord {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  assert.ok(block);
  return block;
}

function validGenerationPackageMarkdown(): string {
  return [
    '# Authority',
    'Storyboard Plan and approved Storyboard Sheet revision are authoritative for U03.',
    '# Generation Profile',
    '16:9, 8 seconds, Chinese prompt source.',
    '# Active Subjects',
    'Hero cat, rain station, locked parcel.',
    '# Reference Mapping',
    'hero_identity maps to the declared hero image attachment.',
    '# Storyboard Authority Sequence',
    '## P01',
    'Hero cat enters from frame left.',
    '## P02',
    'Hero cat notices the parcel.',
    '# State And Continuity',
    'Keep the same rain-soaked coat and parcel state.',
    '# Dialogue Voice And Sound',
    'Rain ambience and station light buzz; no dialogue.',
    '# Provider-neutral Submit Source',
    'A rain-soaked hero cat enters a locked station, follows the approved panel order, opens the parcel, and exits into the rain while identity, spatial direction, lighting, and object state remain continuous.',
    '# Negative Constraints',
    'No new characters, no dry coat, no reordered panels, no captions.',
    '# Readiness Review',
    'Ready: approved sheet, plan, identity reference, profile, and continuity are bound. Provider and model remain intentionally unselected.',
  ].join('\n\n');
}
