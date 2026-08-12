import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import type { AssetRecord, BoardSnapshot } from '../src/core/types';
import { createCanvasHost } from '../src/host-kit';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';
import { createWhiteboardProductCommands } from '../src/whiteboard/application/whiteboardProductCommands';

const initial = createBlankBoardSnapshot({
  boardId: 'board_whiteboard_video_generation_commands',
  boardName: 'Video generation product commands',
  projectId: 'project_whiteboard_video_generation_commands',
  projectName: 'Video generation product commands',
});
const referenceAsset: AssetRecord = {
  assetId: 'asset_video_reference',
  createdAt: '2026-08-11T00:00:00.000Z',
  kind: 'image',
  mimeType: 'image/png',
  previewUrl: '/assets/reference.png',
  projectId: initial.project.projectId,
  storageKey: 'assets/reference.png',
  storageProvider: 'local',
};
initial.assets.push(referenceAsset);
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
  initialScope: scopeFor(initial),
  packageRuntime: createNoopHostPackageRuntime(),
  storage,
});
const commands = createWhiteboardProductCommands(host);
let publications = 0;
const unsubscribe = host.readModel.subscribe(() => {
  publications += 1;
});

const created = await commands.videoGeneration.createDraft({
  aspectRatio: '16:9',
  connectionId: 'retake-mock',
  creativeRequest: {
    capabilityId: 'video.generate',
    compiler: { kind: 'deterministic', version: '2' },
    mediaKind: 'video',
    parameters: { aspectRatio: '16:9' },
    prompt: 'Animate the reference image.',
    references: [],
    schemaVersion: 1,
    unresolved: [],
  },
  durationSeconds: 8,
  instruction: 'Animate the reference image.',
  outputCount: 1,
  placementCenter: { x: 600, y: 400 },
  references: [{
    inputSlotId: 'general_references',
    mention: { assetId: referenceAsset.assetId, kind: 'asset', slotId: 'references' },
    referenceIntent: {
      instruction: 'Preserve the character identity.',
      label: 'Character reference',
      origin: 'user',
      schemaVersion: 1,
    },
  }],
  title: 'Video draft',
});
assert.equal(publications, 1);
const createdSnapshot = host.readModel.getSnapshot();
const video = createdSnapshot.blocks.find((block) => block.blockId === created.blockId);
assert.equal(video?.type, 'video');
assert.deepEqual(video?.position, { x: 450, y: 310 });
assert.equal(video?.data.executionDraft?.executionProfileId, 'video-mock');
const referenceBlock = createdSnapshot.blocks.find((block) => block.type === 'image');
assert.equal(referenceBlock?.data.assetId, referenceAsset.assetId);
assert.deepEqual(referenceBlock?.position, { x: 70, y: 310 });
const referenceEdge = createdSnapshot.edges.find((edge) => edge.targetBlockId === created.blockId);
assert.equal(referenceEdge?.sourceBlockId, referenceBlock?.blockId);
assert.equal(referenceEdge?.referenceIntent?.label, 'Character reference');
assert.equal((await storage.loadBoard(scopeFor(initial))).blocks.length, 2);

await assert.rejects(
  commands.videoGeneration.createDraft({
    aspectRatio: '9:16',
    connectionId: 'retake-mock',
    creativeRequest: {
      capabilityId: 'video.generate',
      compiler: { kind: 'deterministic', version: '2' },
      mediaKind: 'video',
      parameters: {},
      prompt: 'Invalid stale reference.',
      references: [],
      schemaVersion: 1,
      unresolved: [],
    },
    durationSeconds: 8,
    instruction: 'Invalid stale reference.',
    outputCount: 1,
    placementCenter: { x: 0, y: 0 },
    references: [{
      inputSlotId: 'general_references',
      mention: { blockId: 'block_missing', kind: 'block', slotId: 'references' },
    }],
    title: 'Rejected draft',
  }),
  /Image Block not found/,
);
assert.equal(publications, 1, 'A stale reference rejects the complete Draft transaction.');
assert.equal(host.readModel.getSnapshot().blocks.length, 2);

const updated = await commands.videoGeneration.updateDraft({
  blockId: created.blockId,
  durationSeconds: 12,
  outputCount: 2,
  prompt: 'Animate two distinct camera moves.',
});
assert.deepEqual(updated, { committed: true, updated: true });
assert.equal(publications, 2);
const noOp = await commands.videoGeneration.updateDraft({
  blockId: 'block_missing',
  prompt: 'Must not publish.',
});
assert.deepEqual(noOp, { committed: false, updated: false });
assert.equal(publications, 2);

const generated = await commands.videoGeneration.generateMock({
  blockId: created.blockId,
  expectedScope: scopeFor(initial),
});
assert.equal(publications, 3, 'Deterministic local Mock completes in one Host transaction.');
assert.equal(generated.outputBlockIds.length, 2);
const completed = host.readModel.getSnapshot();
const execution = completed.executions.find(
  (candidate) => candidate.executionId === generated.executionId,
);
assert.equal(execution?.status, 'succeeded');
assert.equal(execution?.outputAssetIds.length, 2);
assert.deepEqual(execution?.inputAssetIds, [referenceAsset.assetId]);
assert.deepEqual(
  generated.outputBlockIds.map((blockId) => completed.blocks.find(
    (block) => block.blockId === blockId,
  )?.data.status),
  ['succeeded', 'succeeded'],
);
assert.equal(
  (await storage.loadBoard(scopeFor(initial))).executions[0]?.executionId,
  generated.executionId,
);

const publicationsBeforeWrongScope = publications;
await assert.rejects(
  commands.videoGeneration.generateMock({
    blockId: created.blockId,
    expectedScope: { ...scopeFor(initial), boardId: 'board_wrong_scope' },
  }),
  /another Project or Board/,
);
assert.equal(publications, publicationsBeforeWrongScope);
assert.equal(host.readModel.getSnapshot().executions.length, 1);

const videoControllerSource = await readFile(
  new URL('../src/app/useVideoGenerationController.ts', import.meta.url),
  'utf8',
);
const domainControllerSource = await readFile(
  new URL('../src/app/useDomainVideoLaunchReviewController.ts', import.meta.url),
  'utf8',
);
assert.doesNotMatch(videoControllerSource, /\bupdateSnapshot\b/);
assert.doesNotMatch(videoControllerSource, /runMockVideoGeneration/);
assert.match(videoControllerSource, /commands\.videoGeneration\.updateDraft/);
assert.match(videoControllerSource, /commands\.videoGeneration\.generateMock/);
assert.match(videoControllerSource, /adoptDurableSnapshot/);
assert.doesNotMatch(domainControllerSource, /\bupdateSnapshot\b/);
assert.match(domainControllerSource, /adoptDurableSnapshot/);
assert.match(videoControllerSource, /startSeedanceVideo/);
assert.match(domainControllerSource, /startAuthorizedDomainVideoGeneration/);

unsubscribe();
await host.dispose();

console.log({
  domainVideoServerSnapshotsUseDurableAdoption: true,
  localMockVideoCompletesAtomically: true,
  providerVideoStartRemainsOutsideProductTransaction: true,
  videoDraftProjectionIsDurable: true,
  videoDraftStaleReferenceIsAtomic: true,
  videoDraftUpdateNoopDoesNotPublish: true,
});

function scopeFor(snapshot: BoardSnapshot) {
  return {
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
  };
}
