import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type {
  ArtifactRevision,
  ProjectArtifactLibraryItem,
  ProjectArtifactLibrarySnapshot,
} from '../src/core/artifactContracts';
import { createBlockRecord } from '../src/core/blockFactory';
import type {
  WorkflowGateEvaluationRecord,
  WorkflowGateEvaluationStatus,
  WorkflowGateFreshness,
} from '../src/core/workflowGateContracts';
import {
  resolveWorkflowContinuation,
  type WorkflowContinuationResolution,
} from '../src/core/workflowContinuation';
import type { AssetKind, BlockType, BoardSnapshot } from '../src/core/types';
import { resetWorkspace } from './local-store/snapshot-store';

const snapshot = await emptySnapshot();

const plan = addArtifactBlock(snapshot, {
  artifactId: 'artifact_plan',
  artifactRevisionId: 'revision_plan_1',
  artifactType: 'storyboard_plan',
  blockType: 'document',
  title: 'Storyboard Plan',
});
const planAuthority = authority(snapshot, artifactItem(snapshot, {
  artifactId: 'artifact_plan',
  artifactRevisionId: 'revision_plan_1',
  artifactType: 'storyboard_plan',
  assetKind: 'document',
}));
const planResolution = ready(resolveWorkflowContinuation(snapshot, planAuthority, plan.blockId));
assert.deepEqual(
  planResolution.candidates.map((candidate) => candidate.entrypointId),
  [
    'workflow:retake.workflow.storyboard-unit-to-sheet',
    'workflow:retake.workflow.storyboard-unit-to-generation-package',
  ],
);
assert.deepEqual(planResolution.candidates[0]?.missingRequiredSlotIds, ['unit_id']);
assert.deepEqual(
  planResolution.candidates[1]?.missingRequiredSlotIds,
  ['storyboard_sheet', 'unit_id'],
);

const sheet = addArtifactBlock(snapshot, {
  artifactId: 'artifact_sheet',
  artifactRevisionId: 'revision_sheet_1',
  artifactType: 'storyboard_sheet',
  blockType: 'image',
  title: 'Storyboard Sheet · U01',
});
snapshot.workflowGateEvaluations = [
  gate(snapshot, 'revision_sheet_1', 'passed', 'current'),
];
const sheetAuthority = authority(snapshot, artifactItem(snapshot, {
  artifactId: 'artifact_sheet',
  artifactRevisionId: 'revision_sheet_1',
  artifactType: 'storyboard_sheet',
  assetKind: 'image',
  metadata: {
    gridLayout: '3x2',
    kind: 'storyboard_sheet',
    panelAspectRatio: '16:9',
    panelCount: 6,
    renderMode: 'panel_grid',
    schemaRef: 'retake.storyboard-sheet-metadata/v1',
    unitId: 'U01',
  },
}));
const sheetResolution = ready(resolveWorkflowContinuation(snapshot, sheetAuthority, sheet.blockId));
assert.equal(sheetResolution.source.gateStatus, 'passed');
assert.deepEqual(sheetResolution.candidates.map((candidate) => candidate.entrypointId), [
  'workflow:retake.workflow.storyboard-unit-to-generation-package',
]);
assert.deepEqual(sheetResolution.candidates[0]?.inlineValuesBySlot, { unit_id: 'U01' });
assert.deepEqual(sheetResolution.candidates[0]?.missingRequiredSlotIds, ['storyboard_plan']);
assert.deepEqual(sheetResolution.candidates[0]?.mention, {
  blockId: sheet.blockId,
  kind: 'block',
  slotId: 'storyboard_sheet',
});

snapshot.workflowGateEvaluations = [
  gate(snapshot, 'revision_sheet_1', 'passed', 'current'),
  gate(snapshot, 'revision_sheet_1', 'waiting_approval', 'current', 'secondary_review'),
];
assert.equal(
  blockedReason(resolveWorkflowContinuation(snapshot, sheetAuthority, sheet.blockId)),
  'gate_waiting_approval',
);
snapshot.workflowGateEvaluations = [
  gate(snapshot, 'revision_sheet_1', 'waiting_approval', 'current'),
];
assert.equal(
  resolveWorkflowContinuation(snapshot, sheetAuthority, sheet.blockId).status,
  'blocked',
);
assert.equal(
  blockedReason(resolveWorkflowContinuation(snapshot, sheetAuthority, sheet.blockId)),
  'gate_waiting_approval',
);
snapshot.workflowGateEvaluations = [
  gate(snapshot, 'revision_sheet_1', 'failed', 'current'),
];
assert.equal(
  blockedReason(resolveWorkflowContinuation(snapshot, sheetAuthority, sheet.blockId)),
  'gate_rejected',
);
snapshot.workflowGateEvaluations = [
  gate(snapshot, 'revision_sheet_1', 'passed', 'outdated'),
];
assert.equal(
  blockedReason(resolveWorkflowContinuation(snapshot, sheetAuthority, sheet.blockId)),
  'gate_outdated',
);

snapshot.workflowGateEvaluations = [
  gate(snapshot, 'revision_sheet_1', 'passed', 'current'),
];
const staleSheetAuthority = structuredClone(sheetAuthority);
staleSheetAuthority.items[0]!.artifact.currentRevisionId = 'revision_sheet_2';
staleSheetAuthority.items[0]!.currentRevision.artifactRevisionId = 'revision_sheet_2';
assert.equal(
  blockedReason(resolveWorkflowContinuation(snapshot, staleSheetAuthority, sheet.blockId)),
  'artifact_outdated',
);

const generationPackage = addArtifactBlock(snapshot, {
  artifactId: 'artifact_package',
  artifactRevisionId: 'revision_package_1',
  artifactType: 'video_generation_package',
  blockType: 'document',
  title: 'Generation Package · U01',
});
snapshot.workflowGateEvaluations = [
  gate(snapshot, 'revision_package_1', 'passed', 'current', 'generation_package_review'),
];
const packageResolution = ready(resolveWorkflowContinuation(
  snapshot,
  authority(snapshot, artifactItem(snapshot, {
    artifactId: 'artifact_package',
    artifactRevisionId: 'revision_package_1',
    artifactType: 'video_generation_package',
    assetKind: 'document',
  })),
  generationPackage.blockId,
));
assert.deepEqual(packageResolution.candidates.map((candidate) => candidate.entrypointId), [
  'workflow:retake.workflow.approved-generation-package-to-video',
]);
assert.deepEqual(packageResolution.candidates[0]?.missingRequiredSlotIds, []);

const video = addArtifactBlock(snapshot, {
  artifactId: 'artifact_video',
  artifactRevisionId: 'revision_video_1',
  artifactType: 'video_clip',
  blockType: 'video',
  title: 'Selected Video · U01',
});
snapshot.workflowGateEvaluations = [
  gate(snapshot, 'revision_video_1', 'passed', 'current'),
];
const videoResolution = ready(resolveWorkflowContinuation(
  snapshot,
  authority(snapshot, artifactItem(snapshot, {
    artifactId: 'artifact_video',
    artifactRevisionId: 'revision_video_1',
    artifactType: 'video_clip',
    assetKind: 'video',
  })),
  video.blockId,
));
assert.deepEqual(videoResolution.candidates, []);

const [blockNodeSource, dialogSource, providerSource] = await Promise.all([
  readFile(new URL('../src/nodes/BlockNode.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/WorkflowContinuationDialog.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/UnifiedComposerProvider.tsx', import.meta.url), 'utf8'),
]);
assert.match(blockNodeSource, /retake:open-workflow-continuation/);
assert.match(dialogSource, /loadProjectArtifactAuthority/);
assert.match(dialogSource, /replacementCandidateId !== candidate\.candidateId/);
assert.match(dialogSource, /startWorkflowContinuation/);
assert.equal(dialogSource.includes('projectWorkflowDraft'), false);
assert.equal(dialogSource.includes('createWorkflowRun'), false);
assert.match(providerSource, /setEntrypointId\(handoff\.entrypointId\)/);
assert.match(providerSource, /setMentions\(structuredClone\(handoff\.mentions\)\)/);

console.log(JSON.stringify({
  ok: true,
  currentRevisionAuthority: true,
  gateRequiredWhenPresent: true,
  planMultipleCandidates: planResolution.candidates.length,
  sheetUnitInherited: sheetResolution.candidates[0]?.inlineValuesBySlot.unit_id,
  packageToVideoCandidate: packageResolution.candidates[0]?.entrypointId,
  terminalVideoZeroCandidates: true,
  dirtyComposerRequiresSecondConfirmation: true,
  composerOnlyNoRuntimeMutation: true,
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
  return value;
}

function addArtifactBlock(
  snapshotValue: BoardSnapshot,
  input: {
    artifactId: string;
    artifactRevisionId: string;
    artifactType: string;
    blockType: BlockType;
    title: string;
  },
) {
  const block = createBlockRecord(snapshotValue, input.blockType);
  block.data = {
    ...block.data,
    artifactId: input.artifactId,
    artifactRevisionId: input.artifactRevisionId,
    artifactType: input.artifactType,
    title: input.title,
  };
  snapshotValue.blocks.push(block);
  return block;
}

function artifactItem(
  snapshotValue: BoardSnapshot,
  input: {
    artifactId: string;
    artifactRevisionId: string;
    artifactType: string;
    assetKind: AssetKind;
    metadata?: ArtifactRevision['metadata'];
  },
): ProjectArtifactLibraryItem {
  const now = '2026-07-25T08:00:00.000Z';
  const assetId = `asset_${input.artifactId}`;
  const revision: ArtifactRevision = {
    artifactId: input.artifactId,
    artifactRevisionId: input.artifactRevisionId,
    assetIds: [assetId],
    createdAt: now,
    createdByActor: { actorId: 'test', actorType: 'system' },
    ...(input.metadata ? { metadata: structuredClone(input.metadata) } : {}),
    primaryAssetId: assetId,
    projectId: snapshotValue.project.projectId,
    revision: 1,
    sourceArtifactRevisionIds: [],
    sourceAssetIds: [],
  };
  return {
    artifact: {
      artifactId: input.artifactId,
      artifactType: input.artifactType,
      createdAt: now,
      currentRevisionId: input.artifactRevisionId,
      libraryVisibility: 'hidden',
      projectId: snapshotValue.project.projectId,
      recordVersion: 1,
      scope: 'workflow_run',
      semanticKey: `workflow_output:${input.artifactType}`,
      updatedAt: now,
    },
    currentRevision: revision,
    primaryAsset: {
      assetId,
      createdAt: now,
      kind: input.assetKind,
      mimeType: input.assetKind === 'image'
        ? 'image/png'
        : input.assetKind === 'video'
          ? 'video/mp4'
          : 'text/markdown',
      previewUrl: `/api/local/assets/${assetId}`,
      projectId: snapshotValue.project.projectId,
      storageKey: `${assetId}/original`,
      storageProvider: 'local',
    },
    revisions: [revision],
  };
}

function authority(
  snapshotValue: BoardSnapshot,
  ...items: ProjectArtifactLibraryItem[]
): ProjectArtifactLibrarySnapshot {
  return {
    items,
    projectId: snapshotValue.project.projectId,
    schemaVersion: 1,
  };
}

function gate(
  snapshotValue: BoardSnapshot,
  artifactRevisionId: string,
  status: WorkflowGateEvaluationStatus,
  freshness: WorkflowGateFreshness,
  gateId = `gate_${artifactRevisionId}`,
): WorkflowGateEvaluationRecord {
  return {
    approvalRequestId: `approval_${artifactRevisionId}`,
    boardId: snapshotValue.board.boardId,
    createdAt: '2026-07-25T08:00:00.000Z',
    freshness,
    gateDefinitionLock: {
      gateId,
      required: true,
      subject: {
        artifactScope: 'workflow_run',
        artifactType: 'test',
        kind: 'artifact_revision',
        semanticKey: 'workflow_output:test',
        stepId: 'test_step',
        workflowOutputSlotId: 'test',
      },
    },
    gateEvaluationId: `evaluation_${artifactRevisionId}`,
    gateId,
    projectId: snapshotValue.project.projectId,
    recordVersion: 1,
    status,
    subjectArtifactId: `artifact_${artifactRevisionId}`,
    subjectArtifactRevisionId: artifactRevisionId,
    subjectAssetIds: [],
    subjectExecutionIds: [],
    subjectFingerprint: `fingerprint_${artifactRevisionId}`,
    updatedAt: '2026-07-25T08:00:00.000Z',
    workflowRunId: `workflow_${artifactRevisionId}`,
  } as WorkflowGateEvaluationRecord;
}

function ready(
  resolution: WorkflowContinuationResolution,
): Extract<WorkflowContinuationResolution, { status: 'ready' }> {
  assert.equal(resolution.status, 'ready');
  assert.ok(resolution.status === 'ready');
  return resolution;
}

function blockedReason(
  resolution: WorkflowContinuationResolution,
): Extract<WorkflowContinuationResolution, { status: 'blocked' }>['blockedReason'] {
  assert.equal(resolution.status, 'blocked');
  assert.ok(resolution.status === 'blocked');
  return resolution.blockedReason;
}
