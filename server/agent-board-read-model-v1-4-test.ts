import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildAgentBoardReadModel } from '../src/core/agentBoardReadModel';
import { operationReadinessFor } from '../src/core/capabilities';
import { sha256Hex } from '../src/core/sha256';
import type { BlockRecord, BoardSnapshot } from '../src/core/types';

const now = '2026-07-25T00:00:00.000Z';
const internalSecret = 'INTERNAL_SECRET_DO_NOT_PROJECT';
const snapshot = baseSnapshot();
const promptBlock = block('text_prompt', 'text', {
  body: 'Create a quiet cinematic harbor at dawn.',
  title: 'Visible prompt',
});
const readyOperation = block('operation_ready', 'operation', {
  capabilityId: 'image.text_to_image',
  packageDigest: 'sha256:test-package',
  packageEntryPointId: 'entrypoint.test',
  packageId: 'package.test',
  packageVersion: '1.0.0',
  skillId: 'skill.test',
  title: 'Ready image operation',
});
const blockedOperation = block('operation_blocked', 'operation', {
  capabilityId: 'image.image_to_image',
  sourceExecutionId: 'execution_failed',
  status: 'failed',
  title: 'Blocked image operation',
});
const outputBlock = block('image_output', 'image', {
  artifactId: 'artifact_image',
  artifactRevisionId: 'artifact_revision_image',
  artifactType: 'image',
  assetId: 'asset_image',
  reviewStatus: 'selected',
  title: 'Selected result',
});
const documentBlock = block('document_excerpt', 'document', {
  documentExcerpt: 'A safe visible excerpt.',
  title: 'Storyboard document',
});
const mentionedLateBlock = block('text_mentioned', 'text', {
  body: 'This mentioned block should survive the detail budget.',
  title: 'Mentioned context',
});

snapshot.blocks.push(
  promptBlock,
  readyOperation,
  blockedOperation,
  outputBlock,
  documentBlock,
  ...Array.from({ length: 24 }, (_, index) => block(
    `text_filler_${String(index).padStart(2, '0')}`,
    'text',
    {
      body: index === 0 ? 'x'.repeat(400) : `Filler ${index}`,
      title: `Filler ${index}`,
    },
    `2026-07-24T${String(index).padStart(2, '0')}:00:00.000Z`,
  )),
  mentionedLateBlock,
);
snapshot.edges.push(
  {
    edgeId: 'edge_prompt',
    kind: 'execution_input',
    sourceBlockId: promptBlock.blockId,
    targetBlockId: readyOperation.blockId,
  },
  {
    edgeId: 'edge_output',
    kind: 'execution_output',
    sourceBlockId: blockedOperation.blockId,
    targetBlockId: outputBlock.blockId,
  },
);
snapshot.assets.push({
  assetId: 'asset_image',
  createdAt: now,
  height: 1920,
  kind: 'image',
  mimeType: 'image/png',
  previewUrl: `http://localhost/${internalSecret}/preview.png`,
  projectId: snapshot.project.projectId,
  sourceExecutionId: 'execution_failed',
  storageKey: `/private/${internalSecret}/asset.png`,
  storageProvider: 'local',
  width: 1080,
});
snapshot.executions.push({
  adapter: 'direct_api',
  agentPrompt: internalSecret,
  boardId: snapshot.board.boardId,
  capabilityId: 'image.image_to_image',
  completedAt: now,
  errorMessage: `Provider failed at /private/${internalSecret}`,
  executionId: 'execution_failed',
  inputBlockIds: [],
  model: 'test-model',
  outputAssetIds: [],
  outputBlockIds: [outputBlock.blockId],
  params: {
    operationBlockId: blockedOperation.blockId,
    secret: internalSecret,
  },
  projectId: snapshot.project.projectId,
  prompt: internalSecret,
  provider: 'test-provider',
  requestPrompts: [{ index: 0, prompt: internalSecret }],
  startedAt: '2026-07-24T23:59:00.000Z',
  status: 'failed',
});

const gateLock = {
  definitionHash: 'sha256:test-gate',
  gateId: 'review_gate',
  kind: 'human_approval' as const,
  name: 'Review selected result',
  required: true as const,
  subject: {
    kind: 'step_output' as const,
    outputSlotId: 'image',
    stepId: 'step_image',
  },
};
snapshot.workflowRuns = [{
  boardId: snapshot.board.boardId,
  createdAt: now,
  createdBy: 'user',
  currentStepIds: ['step_image'],
  gateDefinitionLocks: [gateLock],
  gateEvaluationIds: ['gate_outdated', 'gate_current'],
  inputBindings: [],
  outputSlotLocks: [],
  projectId: snapshot.project.projectId,
  recordVersion: 1,
  sourcePackageLock: {
    digest: 'sha256:test-package',
    packageId: 'package.test',
    version: '1.0.0',
  },
  status: 'waiting_approval',
  stepRunIds: ['step_run_image'],
  updatedAt: now,
  workflowDefinitionLock: {
    definitionHash: 'sha256:test-workflow',
    version: '1.0.0',
    workflowId: 'workflow.test',
  },
  workflowProjectionId: 'projection_test',
  workflowRunId: 'workflow_run_test',
}];
snapshot.workflowStepRuns = [{
  acceptedOutputAssetIds: [],
  capabilityLock: {
    capabilityId: 'image.image_to_image',
    definitionHash: 'sha256:test-capability',
    version: '1.0.0',
  },
  createdAt: now,
  dependsOn: [],
  executionIds: ['execution_failed'],
  freshness: 'current',
  operationBlockId: blockedOperation.blockId,
  outputAcceptancePolicy: 'manual_single',
  outputArtifactBindings: [],
  outputAssetIds: [],
  outputBlockIds: [outputBlock.blockId],
  outputSlotIds: ['image'],
  recordVersion: 1,
  resolvedInputBindings: [],
  skillLock: {
    definitionHash: 'sha256:test-skill',
    skillId: 'skill.test',
    version: '1.0.0',
  },
  stageId: 'stage_image',
  status: 'waiting_selection',
  stepId: 'step_image',
  stepRunId: 'step_run_image',
  updatedAt: now,
  workflowRunId: 'workflow_run_test',
}];
snapshot.workflowGateEvaluations = [
  {
    approvalRequestId: 'approval_outdated',
    boardId: snapshot.board.boardId,
    createdAt: '2026-07-24T22:00:00.000Z',
    freshness: 'outdated',
    gateDefinitionLock: gateLock,
    gateEvaluationId: 'gate_outdated',
    gateId: gateLock.gateId,
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    status: 'passed',
    subjectAssetIds: [],
    subjectExecutionIds: ['execution_failed'],
    subjectFingerprint: 'outdated',
    updatedAt: '2026-07-24T22:00:00.000Z',
    workflowRunId: 'workflow_run_test',
  },
  {
    approvalRequestId: 'approval_current',
    boardId: snapshot.board.boardId,
    createdAt: now,
    freshness: 'current',
    gateDefinitionLock: gateLock,
    gateEvaluationId: 'gate_current',
    gateId: gateLock.gateId,
    projectId: snapshot.project.projectId,
    recordVersion: 1,
    status: 'waiting_approval',
    subjectArtifactId: 'artifact_image',
    subjectArtifactRevisionId: 'artifact_revision_image',
    subjectAssetIds: ['asset_image'],
    subjectExecutionIds: ['execution_failed'],
    subjectFingerprint: 'current',
    updatedAt: now,
    workflowRunId: 'workflow_run_test',
  },
];

assert.equal(
  sha256Hex('abc'),
  'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
);
assert.equal(
  sha256Hex('Retake 你好'),
  createHash('sha256').update('Retake 你好', 'utf8').digest('hex'),
);

const before = JSON.stringify(snapshot);
const first = buildAgentBoardReadModel(snapshot, {
  mentionedBlockIds: [mentionedLateBlock.blockId],
});
const second = buildAgentBoardReadModel(snapshot, {
  mentionedBlockIds: [mentionedLateBlock.blockId],
});
assert.equal(JSON.stringify(snapshot), before, 'Read Model projection must not mutate the Board Snapshot.');
assert.deepEqual(second, first, 'The same Snapshot and focus must produce a deterministic Read Model.');
assert.equal(first.source.fingerprint.startsWith('sha256:'), true);
assert.equal(first.blocks[0]?.blockId, mentionedLateBlock.blockId);
assert.equal(first.blocks.length, 24);
assert.equal(first.truncation.blocksOmitted, snapshot.blocks.length - 24);
assert.equal(first.summary.blockCounts.text, 26);
assert.equal(first.summary.blockCounts.operation, 2);
assert.equal(first.summary.operationCounts.total, 2);
assert.equal(first.summary.operationCounts.ready, 1);
assert.equal(first.summary.operationCounts.blocked, 1);
assert.equal(first.summary.operationCounts.failed, 1);
assert.equal(first.summary.executionCounts.failed, 1);
assert.equal(first.summary.currentGateCounts.waitingApproval, 1);
assert.equal(first.gates.length, 1);
assert.equal(first.gates[0]?.gateEvaluationId, 'gate_current');
assert.equal(first.gates[0]?.subjectOperationBlockId, blockedOperation.blockId);
assert.equal(first.workflowRuns[0]?.workflowDefinitionId, 'workflow.test');
assert.equal(first.workflowRuns[0]?.stepCounts.waiting_selection, 1);

const readySummary = first.operations.find((operation) => operation.operationBlockId === readyOperation.blockId);
const blockedSummary = first.operations.find((operation) => operation.operationBlockId === blockedOperation.blockId);
assert.deepEqual(
  readySummary?.readiness,
  operationReadinessFor(snapshot, readyOperation),
);
assert.deepEqual(
  blockedSummary?.readiness,
  operationReadinessFor(snapshot, blockedOperation),
);
assert.equal(blockedSummary?.latestExecution?.hasError, true);
assert.equal(blockedSummary?.latestExecution?.provider, 'test-provider');
assert.equal(blockedSummary?.workflowStep?.status, 'waiting_selection');
assert.deepEqual(blockedSummary?.outputBlockIds, [outputBlock.blockId]);

const serialized = JSON.stringify(first);
assert.equal(serialized.includes(internalSecret), false);
assert.equal(serialized.includes('storageKey'), false);
assert.equal(serialized.includes('previewUrl'), false);
assert.equal(serialized.includes('errorMessage'), false);
assert.equal(serialized.includes('requestPrompts'), false);
assert.equal(serialized.includes('agentPrompt'), false);
assert.equal(serialized.includes('codexProjectPath'), false);
assert.equal(serialized.includes('localRoot'), false);

const changed = structuredClone(snapshot);
changed.board.updatedAt = '2026-07-25T00:01:00.000Z';
assert.notEqual(
  buildAgentBoardReadModel(changed, { mentionedBlockIds: [mentionedLateBlock.blockId] }).source.fingerprint,
  first.source.fingerprint,
);

console.log(JSON.stringify({
  ok: true,
  deterministicFingerprint: true,
  fullSummaryWithBoundedDetails: true,
  readinessAuthorityReused: true,
  sensitiveFieldsExcluded: true,
  snapshotImmutable: true,
}));

function baseSnapshot(): BoardSnapshot {
  return {
    agentMessages: [],
    agentRuns: [],
    agentRuntimeBindings: [],
    agentRuntimeEvents: [],
    agentSessions: [],
    assets: [],
    blocks: [],
    board: {
      boardId: 'board_read_model',
      createdAt: now,
      name: 'Read Model Board',
      projectId: 'project_read_model',
      updatedAt: now,
    },
    changeDecisions: [],
    changeProposals: [],
    edges: [],
    executions: [],
    historyEvents: [{
      actor: 'system',
      createdAt: now,
      detail: { prompt: internalSecret },
      eventId: 'history_secret',
      summary: 'Internal history',
      type: 'prompt_copied',
    }],
    layers: [{
      boardId: 'board_read_model',
      id: 'layer_default',
      locked: false,
      name: 'Default',
      order: 0,
      visible: true,
    }],
    project: {
      codexProjectPath: `/private/${internalSecret}`,
      createdAt: now,
      defaultBoardId: 'board_read_model',
      localRoot: `/private/${internalSecret}`,
      name: 'Read Model Project',
      projectId: 'project_read_model',
      updatedAt: now,
    },
    schemaVersion: 1,
    workflowApprovalDecisions: [],
    workflowApprovalRequests: [],
    workflowGateEvaluations: [],
    workflowRuns: [],
    workflowStepRuns: [],
  };
}

function block(
  blockId: string,
  type: BlockRecord['type'],
  data: BlockRecord['data'],
  updatedAt = now,
): BlockRecord {
  return {
    blockId,
    boardId: 'board_read_model',
    createdAt: now,
    data,
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { height: 200, width: 320 },
    type,
    updatedAt,
    zIndex: 1,
  };
}
