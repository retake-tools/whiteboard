import assert from 'node:assert/strict';
import type { ProjectArtifactLibraryItem } from '../src/core/artifactContracts';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import { createBlockRecord } from '../src/core/blockFactory';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { createCanvasHost } from '../src/host-kit';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';
import { createWhiteboardProductCommands } from '../src/whiteboard/application/whiteboardProductCommands';

const createdAt = '2026-08-11T00:00:00.000Z';
const initial = createBlankBoardSnapshot({
  boardId: 'board_whiteboard_board_commands',
  boardName: 'Board product commands',
  projectId: 'project_whiteboard_board_commands',
  projectName: 'Board product commands',
});
const restorableOperation = addOperation(initial, {
  body: 'Current prompt',
  capabilityId: 'image.generate',
  status: 'succeeded',
  title: 'Restorable operation',
});
const runningOperation = addOperation(initial, {
  body: 'Running prompt',
  capabilityId: 'image.generate',
  status: 'running',
  title: 'Running operation',
});
const artifactTarget = addOperation(initial, {
  body: 'Generate a video',
  capabilityId: 'video.generate',
  title: 'Artifact target',
});
artifactTarget.position = { x: 900, y: 320 };
initial.executions.push(
  execution(initial, restorableOperation.blockId, 'exec_configuration_restore'),
  execution(initial, runningOperation.blockId, 'exec_configuration_running'),
);

const artifactItem = imageArtifact(initial);
const storage = new InMemoryHostStorageAdapter([initial]);
const host = await createCanvasHost({
  connections: createNoopHostConnections(),
  environment: {
    colorScheme: 'light',
    contrast: 'normal',
    direction: 'ltr',
    locale: 'en',
    reducedMotion: true,
    themeId: 'retake.whiteboard.test',
  },
  experience: {
    commandOverrides: [],
    profileId: 'retake.whiteboard.test',
    schemaVersion: 1,
  },
  initialScope: {
    boardId: initial.board.boardId,
    projectId: initial.project.projectId,
  },
  packageRuntime: createNoopHostPackageRuntime(),
  storage,
});
const commands = createWhiteboardProductCommands(host);
let publications = 0;
const unsubscribe = host.readModel.subscribe(() => {
  publications += 1;
});

const missingRestore = await commands.executionConfiguration.restore({
  executionId: 'exec_configuration_missing',
});
assert.equal(missingRestore.committed, false);
assert.equal(missingRestore.result.restored, false);
assert.equal(publications, 0);

const runningRestore = await commands.executionConfiguration.restore({
  executionId: 'exec_configuration_running',
});
assert.equal(runningRestore.committed, false);
assert.equal(runningRestore.result.restored, false);
assert.equal(publications, 0);

const restored = await commands.executionConfiguration.restore({
  executionId: 'exec_configuration_restore',
});
assert.equal(restored.committed, true);
assert.equal(restored.result.restored, true);
assert.equal(restored.result.operationBlockId, restorableOperation.blockId);
assert.equal(publications, 1);
let current = host.readModel.getSnapshot();
assert.equal(
  current.blocks.find((block) => block.blockId === restorableOperation.blockId)?.data.body,
  'Restored prompt',
);
assert.equal(current.historyEvents?.[0]?.type, 'configuration_restored');
assert.equal(current.historyEvents?.[0]?.executionId, 'exec_configuration_restore');

const bound = await commands.artifact.insertReference({
  fallbackPosition: { x: 20, y: 40 },
  item: artifactItem,
  targetOperationId: artifactTarget.blockId,
  targetSlotId: 'character_references',
});
assert.equal(bound.boundToOperation, true);
assert.equal(publications, 2);
current = host.readModel.getSnapshot();
const boundBlock = current.blocks.find((block) => block.blockId === bound.blockId);
assert.deepEqual(boundBlock?.position, { x: 540, y: 320 });
assert.equal(boundBlock?.data.artifactRevisionId, artifactItem.currentRevision.artifactRevisionId);
assert.equal(
  current.edges.some((edge) => (
    edge.sourceBlockId === bound.blockId
    && edge.targetBlockId === artifactTarget.blockId
    && edge.inputSlotId === 'character_references'
  )),
  true,
);

const unbound = await commands.artifact.insertReference({
  fallbackPosition: { x: 120, y: 180 },
  item: artifactItem,
});
assert.equal(unbound.boundToOperation, false);
assert.equal(publications, 3);
current = host.readModel.getSnapshot();
assert.deepEqual(
  current.blocks.find((block) => block.blockId === unbound.blockId)?.position,
  { x: 120, y: 180 },
);
assert.equal(
  current.assets.filter((asset) => asset.assetId === artifactItem.primaryAsset.assetId).length,
  1,
);

await assert.rejects(
  commands.artifact.insertReference({
    fallbackPosition: { x: 0, y: 0 },
    item: artifactItem,
    targetOperationId: artifactTarget.blockId,
    targetSlotId: 'first_frame_missing',
  }),
  /no longer compatible or available/,
);
await assert.rejects(
  commands.artifact.insertReference({
    fallbackPosition: { x: 0, y: 0 },
    item: artifactItem,
    targetOperationId: 'block_missing_artifact_target',
    targetSlotId: 'character_references',
  }),
  /no longer available/,
);
assert.equal(publications, 3);

const durable = await storage.loadBoard({
  boardId: initial.board.boardId,
  projectId: initial.project.projectId,
});
assert.equal(durable.historyEvents?.[0]?.type, 'configuration_restored');
assert.equal(durable.blocks.some((block) => block.blockId === bound.blockId), true);
assert.equal(durable.blocks.some((block) => block.blockId === unbound.blockId), true);

unsubscribe();
await host.dispose();

console.log({
  artifactInsertionUsesHostTransaction: true,
  artifactInvalidTargetDoesNotPublish: true,
  executionConfigurationNoopDoesNotPublish: true,
  executionConfigurationRestoreUsesHostTransaction: true,
});

function addOperation(
  snapshot: BoardSnapshot,
  data: {
    body: string;
    capabilityId: string;
    status?: 'running' | 'succeeded';
    title: string;
  },
) {
  const operation = createBlockRecord(snapshot, 'operation');
  operation.data = { ...operation.data, ...data };
  snapshot.blocks.push(operation);
  return operation;
}

function execution(
  snapshot: BoardSnapshot,
  operationBlockId: string,
  executionId: string,
): ExecutionRecord {
  return {
    adapter: 'direct_api',
    boardId: snapshot.board.boardId,
    capabilityId: 'image.generate',
    completedAt: createdAt,
    configuration: {
      capabilityId: 'image.generate',
      connectionId: 'codex-app-server',
      generationParams: { aspectRatioPreset: '4:3' },
      imageInputs: [],
      prompt: 'Restored prompt',
      schemaVersion: 1,
    },
    executionId,
    inputBlockIds: [],
    operationVersion: 1,
    outputAssetIds: [],
    outputBlockIds: [],
    params: { operationBlockId },
    projectId: snapshot.project.projectId,
    startedAt: createdAt,
    status: 'succeeded',
  };
}

function imageArtifact(snapshot: BoardSnapshot): ProjectArtifactLibraryItem {
  const artifactId = 'artifact_character_reference';
  const artifactRevisionId = 'artifact_revision_character_reference_v1';
  const assetId = 'asset_character_reference_v1';
  const revision: ProjectArtifactLibraryItem['currentRevision'] = {
    artifactId,
    artifactRevisionId,
    assetIds: [assetId],
    createdAt,
    createdByActor: { actorId: 'test', actorType: 'system' },
    primaryAssetId: assetId,
    projectId: snapshot.project.projectId,
    revision: 1,
    sourceArtifactRevisionIds: [],
    sourceAssetIds: [],
  };
  return {
    artifact: {
      artifactId,
      artifactType: 'character_reference',
      createdAt,
      currentRevisionId: artifactRevisionId,
      libraryVisibility: 'listed',
      projectId: snapshot.project.projectId,
      recordVersion: 1,
      scope: 'project',
      semanticKey: 'character_reference:hero',
      updatedAt: createdAt,
    },
    currentRevision: revision,
    primaryAsset: {
      assetId,
      createdAt,
      height: 1200,
      kind: 'image',
      mimeType: 'image/png',
      previewUrl: `/api/local/assets/${assetId}`,
      projectId: snapshot.project.projectId,
      storageKey: `${assetId}/original.png`,
      storageProvider: 'local',
      width: 800,
    },
    revisions: [revision],
  };
}
