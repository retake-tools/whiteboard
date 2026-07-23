import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type {
  CreateOrAdvanceArtifactCommand,
} from '../src/core/artifactContracts';
import {
  assertValidCreateOrAdvanceArtifactCommand,
} from '../src/core/artifactContracts';
import { createAssetFromDataUrl } from './local-store/asset-store';
import {
  createOrAdvanceArtifact,
  getArtifactRevision,
  readProjectArtifacts,
} from './local-store/artifact-store';
import { resetWorkspace } from './local-store/snapshot-store';
import { createBoard, deleteBoard } from './local-store/workspace-store';

const initial = await resetWorkspace();
const projectId = initial.project.projectId;
const firstBoardId = initial.board.boardId;

assert.throws(
  () => assertValidCreateOrAdvanceArtifactCommand(commandFor({
    projectId,
    scope: 'workflow_run',
    sourceContext: { workflowRunId: 'workflow_run_a' },
    libraryVisibility: 'listed',
  })),
  /Only Project-scope Artifacts/,
);
assert.throws(
  () => assertValidCreateOrAdvanceArtifactCommand(commandFor({
    projectId,
    scope: 'step_run',
    sourceContext: { workflowRunId: 'workflow_run_a' },
  })),
  /sourceContext\.stepRunId/,
);

const [assetA, assetB, sourceAsset] = await Promise.all([
  createAssetFromDataUrl({
    projectId,
    dataUrl: svgDataUrl('#2563eb'),
    fileName: 'character-a.svg',
    kind: 'image',
  }),
  createAssetFromDataUrl({
    projectId,
    dataUrl: svgDataUrl('#16a34a'),
    fileName: 'character-b.svg',
    kind: 'image',
  }),
  createAssetFromDataUrl({
    projectId,
    dataUrl: 'data:text/markdown,%23%20Character%20definition',
    fileName: 'character-definition.md',
    kind: 'document',
  }),
]);

assert.deepEqual(await readProjectArtifacts(projectId), {
  artifacts: [],
  projectId,
  revisions: [],
  schemaVersion: 1,
});

const firstCommand = commandFor({
  projectId,
  assetIds: [assetA.assetId],
  primaryAssetId: assetA.assetId,
  sourceAssetIds: [sourceAsset.assetId],
  idempotencyKey: 'character-hero-reference-v1',
  libraryVisibility: 'listed',
  sourceContext: {
    boardId: firstBoardId,
    operationBlockId: 'operation_character_reference',
    outputSlotId: 'character_reference',
  },
});
const first = await createOrAdvanceArtifact(firstCommand);
assert.equal(first.created, true);
assert.equal(first.artifact.scope, 'project');
assert.equal(first.artifact.semanticKey, 'character:hero');
assert.equal(first.artifact.currentRevisionId, first.revision.artifactRevisionId);
assert.equal(first.artifact.recordVersion, 1);
assert.equal(first.revision.revision, 1);
assert.deepEqual(first.revision.assetIds, [assetA.assetId]);
assert.deepEqual(first.revision.sourceAssetIds, [sourceAsset.assetId]);

const idempotentRetry = await createOrAdvanceArtifact(firstCommand);
assert.equal(idempotentRetry.created, false);
assert.equal(idempotentRetry.revision.artifactRevisionId, first.revision.artifactRevisionId);
const { schemaVersion: firstSchemaVersion, ...reorderedFields } = firstCommand;
const reorderedRetry = await createOrAdvanceArtifact({
  schemaVersion: firstSchemaVersion,
  ...reorderedFields,
});
assert.equal(reorderedRetry.created, false);
assert.equal(reorderedRetry.revision.artifactRevisionId, first.revision.artifactRevisionId);
assert.equal((await readProjectArtifacts(projectId)).revisions.length, 1);
await assert.rejects(
  createOrAdvanceArtifact({
    ...firstCommand,
    assetIds: [assetB.assetId],
    primaryAssetId: assetB.assetId,
  }),
  /idempotency key was reused with a different command/,
);

const second = await createOrAdvanceArtifact(commandFor({
  projectId,
  assetIds: [assetB.assetId],
  primaryAssetId: assetB.assetId,
  sourceAssetIds: [sourceAsset.assetId],
  sourceArtifactRevisionIds: [first.revision.artifactRevisionId],
  expectedCurrentRevisionId: first.revision.artifactRevisionId,
  idempotencyKey: 'character-hero-reference-v2',
  libraryVisibility: 'listed',
  sourceContext: {
    boardId: firstBoardId,
    operationBlockId: 'operation_character_reference',
    outputSlotId: 'character_reference',
  },
}));
assert.equal(second.artifact.artifactId, first.artifact.artifactId);
assert.equal(second.artifact.recordVersion, 2);
assert.equal(second.revision.revision, 2);
assert.deepEqual(second.revision.sourceArtifactRevisionIds, [first.revision.artifactRevisionId]);
assert.equal(
  (await getArtifactRevision(projectId, first.revision.artifactRevisionId))?.primaryAssetId,
  assetA.assetId,
);

await assert.rejects(
  createOrAdvanceArtifact(commandFor({
    projectId,
    assetIds: [assetA.assetId],
    primaryAssetId: assetA.assetId,
    expectedCurrentRevisionId: first.revision.artifactRevisionId,
    idempotencyKey: 'character-hero-reference-stale',
    libraryVisibility: 'listed',
  })),
  /current Revision conflict/,
);
await assert.rejects(
  createOrAdvanceArtifact(commandFor({
    projectId,
    assetIds: ['asset_missing'],
    primaryAssetId: 'asset_missing',
    semanticKey: 'character:missing',
    idempotencyKey: 'missing-asset',
    libraryVisibility: 'listed',
  })),
  /Asset does not exist/,
);
await assert.rejects(
  createOrAdvanceArtifact(commandFor({
    projectId,
    assetIds: [assetA.assetId],
    primaryAssetId: assetA.assetId,
    semanticKey: 'character:missing-source',
    sourceArtifactRevisionIds: ['artrev_missing'],
    idempotencyKey: 'missing-source-revision',
    libraryVisibility: 'listed',
  })),
  /source Revision does not exist/,
);

const workflowA = await createOrAdvanceArtifact(commandFor({
  projectId,
  assetIds: [sourceAsset.assetId],
  primaryAssetId: sourceAsset.assetId,
  artifactType: 'screenplay',
  semanticKey: 'output:screenplay',
  scope: 'workflow_run',
  sourceContext: {
    boardId: firstBoardId,
    workflowRunId: 'workflow_run_a',
    outputSlotId: 'screenplay',
  },
  idempotencyKey: 'workflow-a-screenplay-v1',
}));
const workflowB = await createOrAdvanceArtifact(commandFor({
  projectId,
  assetIds: [sourceAsset.assetId],
  primaryAssetId: sourceAsset.assetId,
  artifactType: 'screenplay',
  semanticKey: 'output:screenplay',
  scope: 'workflow_run',
  sourceContext: {
    boardId: firstBoardId,
    workflowRunId: 'workflow_run_b',
    outputSlotId: 'screenplay',
  },
  idempotencyKey: 'workflow-b-screenplay-v1',
}));
assert.notEqual(workflowA.artifact.artifactId, workflowB.artifact.artifactId);
assert.equal(workflowA.artifact.libraryVisibility, 'hidden');

const secondBoard = await createBoard({ projectId, name: '[TEST] artifact cross-board' });
const fromSecondBoardContext = await readProjectArtifacts(secondBoard.snapshot.project.projectId);
assert.equal(fromSecondBoardContext.artifacts.length, 3);
assert.equal(fromSecondBoardContext.revisions.length, 4);
assert.equal('artifacts' in secondBoard.snapshot, false);

const concurrencyBase = second.revision.artifactRevisionId;
const concurrentResults = await Promise.allSettled([
  createOrAdvanceArtifact(commandFor({
    projectId,
    assetIds: [assetA.assetId],
    primaryAssetId: assetA.assetId,
    expectedCurrentRevisionId: concurrencyBase,
    idempotencyKey: 'character-hero-reference-v3-a',
    libraryVisibility: 'listed',
  })),
  createOrAdvanceArtifact(commandFor({
    projectId,
    assetIds: [assetB.assetId],
    primaryAssetId: assetB.assetId,
    expectedCurrentRevisionId: concurrencyBase,
    idempotencyKey: 'character-hero-reference-v3-b',
    libraryVisibility: 'listed',
  })),
]);
assert.equal(
  concurrentResults.filter((result) => result.status === 'fulfilled').length,
  1,
  'Only one concurrent command may advance the same current Revision.',
);
assert.equal(
  concurrentResults.filter(
    (result) => result.status === 'rejected' && /current Revision conflict/.test(String(result.reason)),
  ).length,
  1,
);

first.revision.assetIds.push('asset_mutated_in_caller');
const persistedFirst = await getArtifactRevision(projectId, first.revision.artifactRevisionId);
assert.deepEqual(persistedFirst?.assetIds, [assetA.assetId]);

await deleteBoard({ projectId, boardId: firstBoardId });
const afterBoardDeletion = await readProjectArtifacts(projectId);
assert.equal(afterBoardDeletion.artifacts.length, 3);
assert.equal(afterBoardDeletion.revisions.length, 5);
assert.equal(
  afterBoardDeletion.artifacts.find((artifact) => artifact.semanticKey === 'character:hero')?.recordVersion,
  3,
);

const storeDir = path.join(
  process.cwd(),
  process.env.RETAKE_WORKSPACE_DIR ?? '.retake',
  'projects',
  projectId,
  'artifacts',
);
const storedFile = JSON.parse(
  await readFile(path.join(storeDir, 'index.json'), 'utf8'),
) as {
  artifacts: unknown[];
  commandResults: unknown[];
  revisions: unknown[];
  schemaVersion: number;
};
assert.equal(storedFile.schemaVersion, 1);
assert.equal(storedFile.artifacts.length, 3);
assert.equal(storedFile.revisions.length, 5);
assert.equal(storedFile.commandResults.length, 5);
assert.deepEqual(
  (await readdir(storeDir)).filter((fileName) => fileName.endsWith('.tmp')),
  [],
  'Atomic writes must not leave temporary files.',
);

console.log(JSON.stringify({
  ok: true,
  projectScopedStore: true,
  immutableRevisions: true,
  idempotentCommand: true,
  conflictingIdempotencyRejected: true,
  optimisticRevisionConflict: true,
  concurrentAdvanceSerialized: true,
  sourceLineageValidated: true,
  scopeIdentitySeparated: true,
  crossBoardReadAndBoardDeletionPreserved: true,
  atomicFileWrite: true,
}));

function commandFor(
  overrides: Partial<CreateOrAdvanceArtifactCommand> & Pick<CreateOrAdvanceArtifactCommand, 'projectId'>,
): CreateOrAdvanceArtifactCommand {
  const { projectId, ...commandOverrides } = overrides;
  return {
    artifactType: 'character_reference',
    assetIds: ['asset_placeholder'],
    createdByActor: {
      actorId: 'user_local',
      actorType: 'user',
    },
    expectedCurrentRevisionId: null,
    idempotencyKey: 'artifact-test-command',
    libraryVisibility: 'hidden',
    primaryAssetId: 'asset_placeholder',
    projectId,
    schemaVersion: 1,
    scope: 'project',
    semanticKey: 'character:hero',
    sourceArtifactRevisionIds: [],
    sourceAssetIds: [],
    ...commandOverrides,
  };
}

function svgDataUrl(color: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`,
  )}`;
}
