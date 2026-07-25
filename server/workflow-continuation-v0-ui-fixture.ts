import type { ArtifactRevisionMetadata } from '../src/core/artifactContracts';
import { createBlockRecord } from '../src/core/blockFactory';
import type { WorkflowGateEvaluationRecord } from '../src/core/workflowGateContracts';
import type { AssetKind, BoardSnapshot } from '../src/core/types';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { createOrAdvanceArtifact } from './local-store/artifact-store';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-workflow-continuation')) {
  throw new Error('Workflow continuation UI fixture requires a disposable RETAKE_WORKSPACE_DIR.');
}

const snapshot = await resetWorkspace();
snapshot.project.name = '[TEST] Workflow continuation V0';
snapshot.board.name = '[TEST] Workflow continuation V0';
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

const plan = await addArtifactFixture(snapshot, {
  artifactType: 'storyboard_plan',
  assetBody: '# Storyboard Plan\n\n## Unit: U01\n\nA courier crosses the rain station.',
  assetKind: 'document',
  blockType: 'document',
  position: { x: 100, y: 150 },
  semanticKey: 'workflow_output:storyboard_plan',
  title: 'Storyboard Plan · multiple next Workflows',
});

const sheet = await addArtifactFixture(snapshot, {
  artifactType: 'storyboard_sheet',
  assetBody: '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720"><rect width="1280" height="720" fill="#172033"/><text x="64" y="110" fill="white" font-size="48">Storyboard Sheet · U01</text><path d="M64 180H1216V650H64Z" fill="#29405f" stroke="#7eb6ff" stroke-width="8"/></svg>',
  assetKind: 'image',
  blockType: 'image',
  metadata: {
    gridLayout: '3x2',
    kind: 'storyboard_sheet',
    panelAspectRatio: '16:9',
    panelCount: 6,
    renderMode: 'panel_grid',
    schemaRef: 'retake.storyboard-sheet-metadata/v1',
    unitId: 'U01',
  },
  position: { x: 510, y: 150 },
  semanticKey: 'workflow_output:storyboard_sheet',
  title: 'Approved Storyboard Sheet · single next Workflow',
});
snapshot.workflowGateEvaluations?.push(passedGate(snapshot, {
  artifactId: sheet.artifactId,
  artifactRevisionId: sheet.artifactRevisionId,
  artifactType: 'storyboard_sheet',
  gateId: 'storyboard_sheet_review',
}));

const video = await addArtifactFixture(snapshot, {
  artifactType: 'video_clip',
  assetBody: 'deterministic local mock video',
  assetKind: 'video',
  blockType: 'video',
  metadata: {
    adapterId: 'retake.video.mock',
    connectionId: 'retake-mock',
    executionId: 'exec_workflow_continuation_fixture',
    generationPackageArtifactRevisionId: 'artrev_fixture_package',
    kind: 'video_clip',
    model: 'contract-placeholder',
    provider: 'Retake Mock',
    providerCallId: 'provider_call_workflow_continuation_fixture',
    schemaRef: 'retake.video-clip-metadata/v1',
    targetAspectRatio: '16:9',
    targetDurationSeconds: 8,
    unitId: 'U01',
  },
  position: { x: 920, y: 150 },
  semanticKey: 'workflow_output:video_clip',
  title: 'Approved Video Clip · no next Workflow',
});
snapshot.workflowGateEvaluations?.push(passedGate(snapshot, {
  artifactId: video.artifactId,
  artifactRevisionId: video.artifactRevisionId,
  artifactType: 'video_clip',
  gateId: 'video_generation_result_review',
}));

await saveSnapshot(snapshot);

console.log(JSON.stringify({
  ok: true,
  workspaceDirectory,
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  blocks: {
    plan: plan.blockId,
    sheet: sheet.blockId,
    video: video.blockId,
  },
}));

async function addArtifactFixture(
  snapshotValue: BoardSnapshot,
  input: {
    artifactType: string;
    assetBody: string;
    assetKind: AssetKind;
    blockType: 'document' | 'image' | 'video';
    metadata?: ArtifactRevisionMetadata;
    position: { x: number; y: number };
    semanticKey: string;
    title: string;
  },
): Promise<{
  artifactId: string;
  artifactRevisionId: string;
  blockId: string;
}> {
  const mimeType = input.assetKind === 'image'
    ? 'image/svg+xml'
    : input.assetKind === 'video'
      ? 'video/mp4'
      : 'text/markdown';
  const asset = await createAssetFromDataUrl({
    dataUrl: `data:${mimeType};base64,${Buffer.from(input.assetBody).toString('base64')}`,
    fileName: input.assetKind === 'image'
      ? `${input.artifactType}.svg`
      : input.assetKind === 'video'
        ? `${input.artifactType}.mp4`
        : `${input.artifactType}.md`,
    kind: input.assetKind,
    projectId: snapshotValue.project.projectId,
  });
  snapshotValue.assets.push(asset);
  const materialized = await createOrAdvanceArtifact({
    artifactType: input.artifactType,
    assetIds: [asset.assetId],
    createdByActor: { actorId: 'fixture', actorType: 'system' },
    expectedCurrentRevisionId: null,
    idempotencyKey: `workflow-continuation-ui:${input.artifactType}`,
    libraryVisibility: 'hidden',
    ...(input.metadata ? { metadata: input.metadata } : {}),
    primaryAssetId: asset.assetId,
    projectId: snapshotValue.project.projectId,
    schemaVersion: 1,
    scope: 'workflow_run',
    semanticKey: input.semanticKey,
    sourceArtifactRevisionIds: [],
    sourceAssetIds: [],
    sourceContext: {
      boardId: snapshotValue.board.boardId,
      workflowRunId: `workflow_run_fixture_${input.artifactType}`,
      workflowOutputSlotId: input.artifactType,
    },
  });
  const block = createBlockRecord(snapshotValue, input.blockType);
  block.position = input.position;
  block.data = {
    ...block.data,
    artifactId: materialized.artifact.artifactId,
    artifactRevisionId: materialized.revision.artifactRevisionId,
    artifactType: materialized.artifact.artifactType,
    assetId: asset.assetId,
    ...(input.blockType === 'document'
      ? {
          documentCharacterCount: input.assetBody.length,
          documentExcerpt: 'Disposable continuation fixture.',
          documentKind: input.artifactType,
        }
      : {}),
    ...(input.blockType === 'image' ? { previewUrl: asset.previewUrl } : {}),
    title: input.title,
  };
  snapshotValue.blocks.push(block);
  return {
    artifactId: materialized.artifact.artifactId,
    artifactRevisionId: materialized.revision.artifactRevisionId,
    blockId: block.blockId,
  };
}

function passedGate(
  snapshotValue: BoardSnapshot,
  input: {
    artifactId: string;
    artifactRevisionId: string;
    artifactType: string;
    gateId: string;
  },
): WorkflowGateEvaluationRecord {
  const now = '2026-07-25T09:00:00.000Z';
  return {
    approvalRequestId: `approval_fixture_${input.gateId}`,
    boardId: snapshotValue.board.boardId,
    createdAt: now,
    freshness: 'current',
    gateDefinitionLock: {
      gateId: input.gateId,
      required: true,
      subject: {
        artifactScope: 'workflow_run',
        artifactType: input.artifactType,
        kind: 'artifact_revision',
        semanticKey: `workflow_output:${input.artifactType}`,
        stepId: `step_fixture_${input.artifactType}`,
        workflowOutputSlotId: input.artifactType,
      },
    },
    gateEvaluationId: `evaluation_fixture_${input.gateId}`,
    gateId: input.gateId,
    projectId: snapshotValue.project.projectId,
    recordVersion: 1,
    status: 'passed',
    subjectArtifactId: input.artifactId,
    subjectArtifactRevisionId: input.artifactRevisionId,
    subjectAssetIds: [],
    subjectExecutionIds: [],
    subjectFingerprint: `fingerprint_fixture_${input.gateId}`,
    updatedAt: now,
    workflowRunId: `workflow_run_fixture_${input.artifactType}`,
  } as WorkflowGateEvaluationRecord;
}
