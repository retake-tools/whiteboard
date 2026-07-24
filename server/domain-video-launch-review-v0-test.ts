import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type { ProjectArtifactLibrarySnapshot } from '../src/core/artifactContracts';
import {
  domainVideoGenerationCapabilityDefinition,
  dreaminaCliAdapterDefinition,
  mockVideoAdapterDefinition,
  seedanceModelArkAdapterDefinition,
} from '../src/core/capabilityRegistry';
import {
  domainVideoGenerationCapabilityId,
  domainVideoGenerationSkillId,
  domainVideoGenerationWorkflowId,
} from '../src/core/domainVideoGenerationContracts';
import {
  createAgentRunForWorkflowRun,
  reconcileAgentRuntime,
  startAgentRun,
} from '../src/core/agentRuntime';
import {
  costDisclosureForConnection,
  resolveDomainVideoLaunchReview,
} from '../src/core/domainVideoLaunchReview';
import {
  defaultGenerationPreparationParameters,
  generationPackageArtifactMetadata,
  type GenerationReferenceManifest,
} from '../src/core/generationPreparationContracts';
import { resolvePackageComposerInvocation } from '../src/core/packageComposer';
import { storyProductionStarterPackage } from '../src/core/packageRegistry';
import { videoGenerationFromApprovedPackageSkill } from '../src/core/skillRegistry';
import { storyboardSheetArtifactMetadata } from '../src/core/storyboardSheetContracts';
import type { AssetRecord, BoardSnapshot } from '../src/core/types';
import { operationReadinessFor } from '../src/core/capabilities';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import {
  acceptWorkflowStepOutputs,
  createWorkflowRunForGroup,
  workflowRunViewForId,
} from '../src/core/workflowRuntime';
import {
  approvedGenerationPackageToVideoWorkflow,
  validateWorkflowDefinition,
} from '../src/core/workflowRegistry';
import { authorizeAndStartDomainVideoGeneration } from './domain-video-generation-service';
import { reviewDomainVideoLaunch } from './domain-video-launch-review-service';
import { createAssetFromDataUrl } from './local-store/asset-store';
import {
  createOrAdvanceArtifact,
  readProjectArtifacts,
} from './local-store/artifact-store';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import { createBoard } from './local-store/workspace-store';
import { readProjectArtifactLibrary } from './artifact-library-service';
import { materializeWorkflowOutputArtifacts } from './workflow-output-artifact-service';

const snapshot = await resetWorkspace() as BoardSnapshot;
snapshot.blocks = [];
snapshot.edges = [];
snapshot.assets = [];
snapshot.executions = [];
snapshot.workflowGateEvaluations = [];
const packageAsset = asset('asset_generation_package', 'document', 'text/markdown');
const referenceAsset = asset('asset_hero', 'image', 'image/png');
snapshot.assets.push(packageAsset, referenceAsset);
const manifest: GenerationReferenceManifest = {
  schemaRef: 'retake.generation-reference-manifest/v1',
  items: [{
    requirementId: 'hero_identity',
    role: 'character_identity',
    required: true,
    bindingIdentity: `asset:${referenceAsset.assetId}`,
    purpose: 'Preserve the hero identity.',
  }],
};
const metadata = generationPackageArtifactMetadata({
  parameters: { ...defaultGenerationPreparationParameters, durationSeconds: 8 },
  referenceManifest: manifest,
  storyboardSheetArtifactRevisionId: 'revision_storyboard_sheet',
  storyboardSheetMetadata: storyboardSheetArtifactMetadata({
    unitId: 'U03',
    parameters: {
      gridLayout: '3x2',
      outputCount: 1,
      panelAspectRatio: '16:9',
      panelCount: 6,
      renderMode: 'panel_grid',
    },
  }),
  unitId: 'U03',
});
const library: ProjectArtifactLibrarySnapshot = {
  projectId: snapshot.project.projectId,
  schemaVersion: 1,
  items: [{
    artifact: {
      artifactId: 'artifact_generation_package',
      artifactType: 'video_generation_package',
      createdAt: '2026-07-23T00:00:00.000Z',
      currentRevisionId: 'revision_generation_package',
      libraryVisibility: 'listed',
      projectId: snapshot.project.projectId,
      recordVersion: 1,
      scope: 'project',
      semanticKey: 'video_generation_package:u03',
      updatedAt: '2026-07-23T00:00:00.000Z',
    },
    currentRevision: {
      artifactId: 'artifact_generation_package',
      artifactRevisionId: 'revision_generation_package',
      assetIds: [packageAsset.assetId],
      createdAt: '2026-07-23T00:00:00.000Z',
      createdByActor: { actorId: 'system', actorType: 'system' },
      metadata,
      primaryAssetId: packageAsset.assetId,
      projectId: snapshot.project.projectId,
      revision: 1,
      sourceArtifactRevisionIds: ['revision_storyboard_sheet'],
      sourceAssetIds: [referenceAsset.assetId],
    },
    primaryAsset: packageAsset,
    revisions: [],
  }],
};
library.items[0]!.revisions = [library.items[0]!.currentRevision];
snapshot.workflowGateEvaluations = [{
  approvalRequestId: 'approval_request_generation_package',
  boardId: snapshot.board.boardId,
  createdAt: '2026-07-23T00:00:00.000Z',
  freshness: 'current',
  gateDefinitionLock: {
    definitionHash: 'sha256:retake-workflow-gate-generation-package-review-v1',
    gateId: 'generation_package_review',
    kind: 'human_approval',
    required: true,
    subject: {
      artifactScope: 'workflow_run',
      artifactType: 'video_generation_package',
      kind: 'artifact_revision',
      outputSlotId: 'generation_package',
      semanticKey: 'video_generation_package:u03',
      stepId: 'generation_package_prepare',
      workflowOutputSlotId: 'generation_package',
    },
  },
  subjectArtifactId: 'artifact_generation_package',
  subjectArtifactRevisionId: 'revision_generation_package',
  gateEvaluationId: 'gate_evaluation_generation_package',
  gateId: 'generation_package_review',
  projectId: snapshot.project.projectId,
  recordVersion: 1,
  status: 'passed',
  subjectAssetIds: [packageAsset.assetId],
  subjectExecutionIds: ['execution_generation_package'],
  subjectFingerprint: 'gate_subject_generation_package',
  updatedAt: '2026-07-23T00:00:00.000Z',
  workflowRunId: 'workflow_run_generation_package',
}];
const block = {
  blockId: 'block_generation_package',
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  type: 'document' as const,
  position: { x: 80, y: 80 },
  size: { width: 320, height: 240 },
  zIndex: 1,
  data: {
    title: 'Generation Package U03',
    body: '',
    artifactId: 'artifact_generation_package',
    artifactRevisionId: 'revision_generation_package',
    artifactType: 'video_generation_package',
    assetId: packageAsset.assetId,
    documentKind: 'video_generation_package',
  },
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
};
snapshot.blocks.push(block);
const markdown = [
  '# Provider-neutral Submit Source',
  '',
  'U03. Preserve the ordered six-panel rain-station action and hero identity.',
  '',
  '# Negative Constraints',
  '',
  'Do not add text overlays.',
].join('\n');
const mockConnection = {
  connectionId: 'retake-mock',
  connectorId: 'retake-mock',
  providerLabel: 'Retake Mock',
  displayName: 'Retake Mock',
  description: 'No-cost local route.',
  connectionKind: 'local' as const,
  implementationKind: 'local' as const,
  supportedCapabilityIds: ['video.generate', domainVideoGenerationCapabilityId],
  enabledUseCases: ['video' as const],
  configurable: false,
  deletable: false,
  enabled: true,
  status: 'ready' as const,
  hasCredential: false,
  modelId: 'contract-placeholder',
};
const review = resolveDomainVideoLaunchReview({
  artifactLibrary: library,
  connection: mockConnection,
  generationPackageArtifactRevisionId: 'revision_generation_package',
  packageMarkdown: markdown,
  parameters: { outputCount: 2, qualityTier: 'final' },
  snapshot,
});
assert.equal(review.ready, true, JSON.stringify(review, null, 2));
assert.deepEqual(review.issues, []);
assert.equal(review.request?.schemaRef, 'retake.domain-video-request/v1');
assert.equal(review.request?.referenceBindings[0]?.assetId, referenceAsset.assetId);
assert.equal(review.request?.launchParameters.outputCount, 2);
assert.equal(review.request?.adapterId, mockVideoAdapterDefinition.adapterId);
assert.equal(review.costDisclosure?.billingSource, 'no_cost');
assert.match(review.request?.requestFingerprint ?? '', /^fnv1a:/);
const changedReview = resolveDomainVideoLaunchReview({
  artifactLibrary: library,
  connection: mockConnection,
  generationPackageArtifactRevisionId: 'revision_generation_package',
  packageMarkdown: markdown,
  parameters: { outputCount: 3, qualityTier: 'final' },
  snapshot,
});
assert.notEqual(changedReview.request?.requestFingerprint, review.request?.requestFingerprint);
const v1Metadata = {
  ...metadata,
  schemaRef: 'retake.video-generation-package-metadata/v1' as const,
};
delete (v1Metadata as Partial<typeof metadata>).referenceManifest;
const v1Library = structuredClone(library);
v1Library.items[0]!.currentRevision.metadata = v1Metadata;
v1Library.items[0]!.revisions[0]!.metadata = v1Metadata;
const v1Review = resolveDomainVideoLaunchReview({
  artifactLibrary: v1Library,
  connection: mockConnection,
  generationPackageArtifactRevisionId: 'revision_generation_package',
  packageMarkdown: markdown,
  snapshot,
});
assert.equal(v1Review.ready, false);
assert.equal(
  v1Review.issues.some((issue) => issue.code === 'generation_video_package_manifest_snapshot_required'),
  true,
);
const noConnectionReview = resolveDomainVideoLaunchReview({
  artifactLibrary: library,
  generationPackageArtifactRevisionId: 'revision_generation_package',
  packageMarkdown: markdown,
  snapshot,
});
assert.equal(noConnectionReview.ready, false);
assert.equal(noConnectionReview.issues.some((issue) => issue.code === 'generation_video_connection_required'), true);
const staleConnectionReview = resolveDomainVideoLaunchReview({
  artifactLibrary: library,
  connection: {
    ...mockConnection,
    supportedCapabilityIds: ['video.generate'],
  },
  generationPackageArtifactRevisionId: 'revision_generation_package',
  packageMarkdown: markdown,
  snapshot,
});
assert.equal(staleConnectionReview.ready, false);
assert.equal(
  staleConnectionReview.issues.some((issue) => issue.code === 'generation_video_adapter_incompatible'),
  true,
);
assert.equal(costDisclosureForConnection({
  ...mockConnection,
  connectionId: 'dreamina',
  connectorId: 'dreamina',
  connectionKind: 'provider_cli',
  implementationKind: 'provider_cli',
}, 2).billingSource, 'membership_credit');

assert.equal(domainVideoGenerationCapabilityDefinition.version, '0.1.0');
assert.equal(videoGenerationFromApprovedPackageSkill.skillId, domainVideoGenerationSkillId);
assert.deepEqual(validateWorkflowDefinition(approvedGenerationPackageToVideoWorkflow), []);
assert.equal(approvedGenerationPackageToVideoWorkflow.workflowId, domainVideoGenerationWorkflowId);
assert.equal(approvedGenerationPackageToVideoWorkflow.steps[0]?.outputAcceptancePolicy, 'manual_single');
assert.equal(approvedGenerationPackageToVideoWorkflow.gates[0]?.gateId, 'video_generation_result_review');
assert.equal(mockVideoAdapterDefinition.version, '0.2.0');
assert.equal(seedanceModelArkAdapterDefinition.version, '0.2.0');
assert.equal(dreaminaCliAdapterDefinition.version, '0.2.0');
assert.equal(storyProductionStarterPackage.version, '0.5.0');

const composer = resolvePackageComposerInvocation(snapshot, {
  entrypointId: `workflow:${domainVideoGenerationWorkflowId}`,
  instruction: '',
  mentions: [{ kind: 'block', blockId: block.blockId, slotId: 'generation_package' }],
  parameters: { outputCount: 2, qualityTier: 'final' },
});
assert.equal(composer.target.kind, 'workflow');
const projection = projectWorkflowDraft(snapshot, {
  composerInput: {
    mentions: composer.invocation.mentions,
    parameters: composer.invocation.parameters,
  },
  connectionIdForCapability: () => mockConnection.connectionId,
  labelsForSkill: () => ({
    operationTitle: 'Generate approved package video',
    promptPlaceholder: 'Connect package',
    promptTitle: 'Approved Generation Package',
    resultTitle: 'Video candidate',
    waitingBody: 'Waiting for launch review.',
  }),
  outputPlaceholder: 'Waiting for launch review.',
  workflowId: domainVideoGenerationWorkflowId,
  workflowTitle: 'Approved package to video',
});
assert.equal(projection.operationBlockIds.length, 1);
assert.equal(projection.resultBlockIds.length, 1);
assert.equal(
  snapshot.blocks.find((candidate) => candidate.blockId === projection.resultBlockIds[0])?.type,
  'video',
);
assert.equal(snapshot.executions.length, 0);

const [appSource, dialogSource, operationControllerSource] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/components/DomainVideoLaunchReviewDialog.tsx', 'utf8'),
  readFile('src/app/useOperationInputController.ts', 'utf8'),
]);
assert.match(appSource, /DomainVideoLaunchReviewDialog/);
assert.match(dialogSource, /授权并提交 Provider/);
assert.match(dialogSource, /确认并本地执行/);
assert.match(operationControllerSource, /retake:open-domain-video-launch-review/);

const sourceBoard = await resetWorkspace();
sourceBoard.blocks = [];
sourceBoard.edges = [];
sourceBoard.assets = [];
sourceBoard.executions = [];
sourceBoard.workflowGateEvaluations = [];
const persistedReference = await createAssetFromDataUrl({
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  fileName: 'hero.png',
  kind: 'image',
  projectId: sourceBoard.project.projectId,
});
const persistedManifest: GenerationReferenceManifest = {
  schemaRef: 'retake.generation-reference-manifest/v1',
  items: [{
    bindingIdentity: `asset:${persistedReference.assetId}`,
    purpose: 'Preserve the hero identity across Boards.',
    required: true,
    requirementId: 'hero_cross_board',
    role: 'character_identity',
  }],
};
const persistedMetadata = generationPackageArtifactMetadata({
  parameters: { ...defaultGenerationPreparationParameters, durationSeconds: 8 },
  referenceManifest: persistedManifest,
  storyboardSheetArtifactRevisionId: 'revision_storyboard_sheet_cross_board',
  storyboardSheetMetadata: storyboardSheetArtifactMetadata({
    unitId: 'U04',
    parameters: {
      gridLayout: '3x2',
      outputCount: 1,
      panelAspectRatio: '16:9',
      panelCount: 6,
      renderMode: 'panel_grid',
    },
  }),
  unitId: 'U04',
});
const persistedPackageAsset = await createAssetFromDataUrl({
  dataUrl: `data:text/markdown;base64,${Buffer.from(markdown).toString('base64')}`,
  fileName: 'generation-package-u04.md',
  kind: 'document',
  projectId: sourceBoard.project.projectId,
});
const persistedPackage = await createOrAdvanceArtifact({
  artifactType: 'video_generation_package',
  assetIds: [persistedPackageAsset.assetId],
  createdByActor: { actorId: 'system', actorType: 'system' },
  expectedCurrentRevisionId: null,
  idempotencyKey: 'domain-video-cross-board-package-v1',
  libraryVisibility: 'hidden',
  metadata: persistedMetadata,
  primaryAssetId: persistedPackageAsset.assetId,
  projectId: sourceBoard.project.projectId,
  schemaVersion: 1,
  scope: 'workflow_run',
  semanticKey: 'video_generation_package:u04',
  sourceArtifactRevisionIds: [],
  sourceAssetIds: [persistedReference.assetId],
  sourceContext: {
    boardId: sourceBoard.board.boardId,
    workflowRunId: 'workflow_run_generation_package_cross_board',
  },
});
sourceBoard.workflowGateEvaluations = [{
  ...snapshot.workflowGateEvaluations![0]!,
  approvalRequestId: 'approval_request_generation_package_cross_board',
  boardId: sourceBoard.board.boardId,
  gateEvaluationId: 'gate_evaluation_generation_package_cross_board',
  projectId: sourceBoard.project.projectId,
  subjectArtifactId: persistedPackage.artifact.artifactId,
  subjectArtifactRevisionId: persistedPackage.revision.artifactRevisionId,
  subjectAssetIds: [persistedPackageAsset.assetId],
  workflowRunId: 'workflow_run_generation_package_cross_board',
}];
await saveSnapshot(sourceBoard);
const targetBoard = (await createBoard({
  name: '[TEST] domain video launch review cross-board',
  projectId: sourceBoard.project.projectId,
})).snapshot;
const targetPackageBlock = {
  ...block,
  blockId: 'block_generation_package_cross_board',
  boardId: targetBoard.board.boardId,
  projectId: targetBoard.project.projectId,
  data: {
    ...block.data,
    artifactId: persistedPackage.artifact.artifactId,
    artifactRevisionId: persistedPackage.revision.artifactRevisionId,
    assetId: persistedPackageAsset.assetId,
    title: 'Generation Package U04',
  },
};
const targetOperation = {
  ...block,
  blockId: 'block_domain_video_operation_cross_board',
  boardId: targetBoard.board.boardId,
  projectId: targetBoard.project.projectId,
  type: 'operation' as const,
  data: {
    body: '',
    capabilityId: domainVideoGenerationCapabilityId,
    connectionId: 'retake-mock',
    domainVideoGenerationParameters: { outputCount: 1, qualityTier: 'preview' },
    title: 'Generate approved package video',
  },
};
targetBoard.blocks.push(targetPackageBlock, targetOperation);
targetBoard.edges.push({
  edgeId: 'edge_generation_package_cross_board',
  inputSlotId: 'generation_package',
  kind: 'execution_input',
  sourceBlockId: targetPackageBlock.blockId,
  targetBlockId: targetOperation.blockId,
});
assert.equal(operationReadinessFor(targetBoard, targetOperation).canRun, true);
await saveSnapshot(targetBoard);
assert.equal(
  (await readProjectArtifactLibrary(targetBoard.project.projectId)).items.some(
    (item) => item.currentRevision.artifactRevisionId === persistedPackage.revision.artifactRevisionId,
  ),
  false,
  'The launch review fixture must remain a hidden WorkflowRun Artifact, not a listed library item.',
);
const crossBoardReview = await reviewDomainVideoLaunch({
  blockId: targetOperation.blockId,
  boardId: targetBoard.board.boardId,
  projectId: targetBoard.project.projectId,
});
assert.equal(crossBoardReview.ready, true, JSON.stringify(crossBoardReview, null, 2));
assert.equal(crossBoardReview.packageGate.evaluationId, 'gate_evaluation_generation_package_cross_board');
assert.equal(
  crossBoardReview.request?.referenceBindings[0]?.assetId,
  persistedReference.assetId,
);

const runtimeProjection = projectWorkflowDraft(targetBoard, {
  composerInput: {
    mentions: [{
      kind: 'block',
      blockId: targetPackageBlock.blockId,
      slotId: 'generation_package',
    }],
    parameters: { outputCount: 2, qualityTier: 'preview' },
  },
  connectionIdForCapability: () => 'retake-mock',
  labelsForSkill: () => ({
    operationTitle: 'Generate approved package video',
    promptPlaceholder: 'Connect package',
    promptTitle: 'Approved Generation Package',
    resultTitle: 'Video candidate',
    waitingBody: 'Waiting for launch review.',
  }),
  outputPlaceholder: 'Waiting for launch review.',
  workflowId: domainVideoGenerationWorkflowId,
  workflowTitle: 'Approved package to video',
});
const workflow = createWorkflowRunForGroup(
  targetBoard,
  runtimeProjection.groupBlock.blockId,
);
const agent = createAgentRunForWorkflowRun(
  targetBoard,
  workflow.record.workflowRunId,
);
startAgentRun(targetBoard, agent.record.agentRunId);
reconcileAgentRuntime(targetBoard);
assert.equal(
  targetBoard.agentRuns?.find((candidate) => candidate.agentRunId === agent.record.agentRunId)?.status,
  'waiting_input',
);
assert.equal(
  targetBoard.agentRuns?.find((candidate) => candidate.agentRunId === agent.record.agentRunId)?.stopReason,
  'provider_execution_authorization_required',
);
await saveSnapshot(targetBoard);

const runtimeOperationId = runtimeProjection.operationBlockIds[0]!;
const runtimeReview = await reviewDomainVideoLaunch({
  blockId: runtimeOperationId,
  boardId: targetBoard.board.boardId,
  projectId: targetBoard.project.projectId,
});
assert.equal(runtimeReview.ready, true, JSON.stringify(runtimeReview, null, 2));
const beforeMismatchExecutionCount = targetBoard.executions.length;
await assert.rejects(
  () => authorizeAndStartDomainVideoGeneration({
    blockId: runtimeOperationId,
    boardId: targetBoard.board.boardId,
    projectId: targetBoard.project.projectId,
    requestFingerprint: 'fnv1a:stale-review',
  }),
  /changed|fingerprint|review/i,
);
assert.equal(
  (await reviewDomainVideoLaunch({
    blockId: runtimeOperationId,
    boardId: targetBoard.board.boardId,
    projectId: targetBoard.project.projectId,
  })).ready,
  true,
);
const started = await authorizeAndStartDomainVideoGeneration({
  blockId: runtimeOperationId,
  boardId: targetBoard.board.boardId,
  projectId: targetBoard.project.projectId,
  requestFingerprint: runtimeReview.request!.requestFingerprint,
});
assert.equal(started.snapshot.executions.length, beforeMismatchExecutionCount + 1);
assert.equal(started.execution.capabilityId, domainVideoGenerationCapabilityId);
assert.equal(started.execution.skillId, domainVideoGenerationSkillId);
assert.equal(started.execution.status, 'succeeded');
assert.equal(
  started.execution.providerExecutionAuthorization?.kind,
  'not_required_no_external_action',
);
assert.equal(
  started.execution.providerExecutionAuthorization?.requestFingerprint,
  runtimeReview.request?.requestFingerprint,
);
assert.equal(started.execution.requestPrompts?.length, 2);
assert.equal(started.execution.providerCalls?.length, 2);
assert.equal(
  started.execution.providerCalls?.every((call) =>
    call.status === 'succeeded' && call.outputAssetIds.length === 1),
  true,
);

reconcileAgentRuntime(started.snapshot);
const waitingSelection = workflowRunViewForId(
  started.snapshot,
  workflow.record.workflowRunId,
);
const runtimeStep = waitingSelection?.steps[0];
assert.equal(runtimeStep?.status, 'waiting_selection');
assert.equal(
  started.snapshot.agentRuns?.find((candidate) => candidate.agentRunId === agent.record.agentRunId)?.status,
  'waiting_selection',
);
acceptWorkflowStepOutputs(started.snapshot, {
  acceptedOutputAssetIds: [started.execution.outputAssetIds[0]!],
  expectedStepRunVersion: runtimeStep!.record.recordVersion,
  stepRunId: runtimeStep!.record.stepRunId,
});
await saveSnapshot(started.snapshot);
const materialized = await materializeWorkflowOutputArtifacts({
  boardId: started.snapshot.board.boardId,
  projectId: started.snapshot.project.projectId,
  trigger: {
    kind: 'output_accepted',
    stepRunId: runtimeStep!.record.stepRunId,
  },
});
assert.equal(materialized.bindings.length, 1);
assert.equal(materialized.bindings[0]?.artifactType, 'video_clip');
assert.deepEqual(
  materialized.bindings[0]?.assetIds,
  [started.execution.outputAssetIds[0]],
);
const artifacts = await readProjectArtifacts(started.snapshot.project.projectId);
const videoRevision = artifacts.revisions.find(
  (revision) =>
    revision.artifactRevisionId === materialized.bindings[0]?.artifactRevisionId,
);
assert.equal(videoRevision?.metadata?.kind, 'video_clip');
assert.equal(
  videoRevision?.sourceArtifactRevisionIds.includes(
    persistedPackage.revision.artifactRevisionId,
  ),
  true,
);
const resultGate = materialized.snapshot.workflowGateEvaluations?.find(
  (evaluation) =>
    evaluation.gateId === 'video_generation_result_review'
    && evaluation.subjectArtifactRevisionId === videoRevision?.artifactRevisionId,
);
assert.equal(resultGate?.status, 'waiting_approval');
assert.equal(resultGate?.freshness, 'current');

console.log(JSON.stringify({
  ok: true,
  agentStopsBeforeProviderAuthorization: true,
  authorizationFingerprintGuard: true,
  crossBoardProjectAuthorityRead: true,
  domainExecutionUsesExistingVideoAdapter: true,
  manualSingleVideoClipArtifactAndGate: true,
  providerCallRecords: true,
  separateDomainCapability: true,
  exactRegistryLocks: true,
  approvedPackageWorkflowDraft: true,
  deterministicRequestFingerprint: true,
  explicitCostDisclosure: true,
  launchReviewDoesNotExecute: true,
}));

function asset(assetId: string, kind: AssetRecord['kind'], mimeType: string): AssetRecord {
  return {
    assetId,
    projectId: snapshot.project.projectId,
    kind,
    mimeType,
    storageProvider: 'local',
    storageKey: `assets/${assetId}/original`,
    previewUrl: `/api/local/assets/${snapshot.project.projectId}/${assetId}/original`,
    createdAt: '2026-07-23T00:00:00.000Z',
  };
}
