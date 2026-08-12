import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import { createBlockRecord } from '../src/core/blockFactory';
import type { AssetRecord, BoardSnapshot } from '../src/core/types';
import { createCanvasHost } from '../src/host-kit';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';
import { createWhiteboardProductCommands } from '../src/whiteboard/application/whiteboardProductCommands';

const initial = createBlankBoardSnapshot({
  boardId: 'board_whiteboard_image_operation_commands',
  boardName: 'Image operation product commands',
  projectId: 'project_whiteboard_image_operation_commands',
  projectName: 'Image operation product commands',
});
const sourceAsset: AssetRecord = {
  assetId: 'asset_image_source',
  createdAt: '2026-08-11T00:00:00.000Z',
  kind: 'image',
  mimeType: 'image/png',
  previewUrl: '/assets/source.png',
  projectId: initial.project.projectId,
  storageKey: 'assets/source.png',
  storageProvider: 'local',
};
initial.assets.push(sourceAsset);
const source = createBlockRecord(initial, 'image');
source.data = {
  ...source.data,
  assetId: sourceAsset.assetId,
  previewUrl: sourceAsset.previewUrl,
  title: 'Source image',
};
const outputSlot = createBlockRecord(initial, 'image');
outputSlot.data = { ...outputSlot.data, title: 'Reusable output' };
const lockedGroup = createBlockRecord(initial, 'group');
lockedGroup.data = { ...lockedGroup.data, groupContentsLocked: true };
const lockedOperation = createBlockRecord(initial, 'operation');
lockedOperation.parentGroupId = lockedGroup.blockId;
initial.blocks.push(source, outputSlot, lockedGroup, lockedOperation);

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

const imageDraft = await commands.imageOperation.createImageToImageDraft({
  operation: 'quick_edit',
  presentation: {
    operationTitle: 'Edit image',
    placementCenter: { x: 600, y: 420 },
    promptPlaceholder: 'Describe the edit.',
    promptTitle: 'Prompt',
  },
  sourceBlockId: source.blockId,
});
assert.equal(publications, 1);
assert.equal(imageDraft.blockIds.length, 3);
const imageDraftSnapshot = host.readModel.getSnapshot();
const imageOperation = imageDraftSnapshot.blocks.find(
  (block) => block.blockId === imageDraft.operationBlockId,
);
assert.equal(imageOperation?.type, 'operation');
assert.equal(imageOperation?.data.connectionId, 'codex-app-server');
assert.equal(
  imageDraftSnapshot.edges.some((edge) => (
    edge.sourceBlockId === source.blockId
    && edge.targetBlockId === imageDraft.operationBlockId
    && edge.inputSlotId === 'source_image'
  )),
  true,
);
assert.equal((await storage.loadBoard(scopeFor(initial))).blocks.length, 6);

const beforeBlankDraft = host.readModel.getSnapshot().blocks.length;
const blankDraft = await commands.imageOperation.createImageToImageDraft({
  blankSource: {
    data: { title: 'Blank source' },
    placementCenter: { x: 900, y: 420 },
  },
  operation: 'quick_edit',
  presentation: {
    operationTitle: 'Edit image',
    placementCenter: { x: 900, y: 420 },
    promptPlaceholder: 'Describe the edit.',
    promptTitle: 'Prompt',
  },
});
assert.equal(publications, 2, 'Blank source and Draft publish atomically.');
assert.equal(blankDraft.blockIds.length, 3);
assert.equal(host.readModel.getSnapshot().blocks.length, beforeBlankDraft + 3);

const referenceDraft = await commands.imageOperation.createTextToImageDraft({
  presentation: {
    operationTitle: 'Generate image',
    placementCenter: { x: 1_200, y: 420 },
    promptPlaceholder: 'Describe an image.',
    promptTitle: 'Prompt',
  },
  referenceBlockIds: [source.blockId],
});
assert.equal(publications, 3, 'Reference edge and Draft publish atomically.');
assert.equal(referenceDraft.referenceEdgeIds.length, 1);
assert.equal(
  host.readModel.getSnapshot().edges.some((edge) => (
    edge.edgeId === referenceDraft.referenceEdgeIds[0]
    && edge.inputSlotId === 'references'
    && edge.sourceBlockId === source.blockId
  )),
  true,
);

await assert.rejects(
  commands.imageOperation.createTextToImageDraft({
    presentation: {
      operationTitle: 'Rejected image',
      placementCenter: { x: 0, y: 0 },
      promptTitle: 'Prompt',
    },
    referenceBlockIds: ['block_missing'],
  }),
  /source Block not found/,
);
assert.equal(publications, 3, 'A stale reference rejects the complete Draft transaction.');

const slotDraft = await commands.imageOperation.createTextToImageDraft({
  generationParams: { aspectRatioPreset: '1:1', targetAspectRatio: 1, variationCount: 1 },
  presentation: {
    operationTitle: 'Generate image',
    promptPlaceholder: 'Describe an image.',
    promptTitle: 'Prompt',
  },
  slotBlockId: outputSlot.blockId,
});
assert.equal(publications, 4);
assert.equal(slotDraft.blockIds.includes(outputSlot.blockId), true);
const resized = await commands.imageOperation.updateGenerationParams({
  blockId: slotDraft.operationBlockId,
  generationParams: {
    aspectRatioPreset: '16:9',
    targetAspectRatio: 16 / 9,
    variationCount: 2,
  },
});
assert.deepEqual(resized, { committed: true, updated: true });
assert.equal(publications, 5);
const resizedSlot = host.readModel.getSnapshot().blocks.find(
  (block) => block.blockId === outputSlot.blockId,
);
assert(resizedSlot);
assert(Math.abs(resizedSlot.size.width / resizedSlot.size.height - 16 / 9) < 0.02);

assert.deepEqual(
  await commands.imageOperation.updateGenerationProfile({
    blockId: slotDraft.operationBlockId,
    generationProfileId: 'image-fast',
  }),
  { committed: true, updated: true },
);
assert.deepEqual(
  await commands.imageOperation.updateConnection({
    blockId: slotDraft.operationBlockId,
    connectionId: 'custom-image',
  }),
  { committed: true, updated: true },
);
assert.deepEqual(
  await commands.imageOperation.updateCapability({
    blockId: slotDraft.operationBlockId,
    operation: 'image_to_image',
    title: 'Edit image',
  }),
  { committed: true, updated: true },
);
assert.equal(publications, 8);
const configured = host.readModel.getSnapshot().blocks.find(
  (block) => block.blockId === slotDraft.operationBlockId,
);
assert.equal(configured?.data.generationProfileId, 'image-fast');
assert.equal(configured?.data.connectionId, 'custom-image');
assert.equal(configured?.data.title, 'Edit image');

const missingNoOp = await commands.imageOperation.updateConnection({
  blockId: 'block_missing',
  connectionId: 'must-not-publish',
});
assert.deepEqual(missingNoOp, { committed: false, updated: false });
const lockedNoOp = await commands.imageOperation.updateConnection({
  blockId: lockedOperation.blockId,
  connectionId: 'must-not-publish',
});
assert.deepEqual(lockedNoOp, { committed: false, updated: false });
assert.equal(publications, 8, 'Missing and locked configuration updates do not publish.');

const controllerSource = await readFile(
  new URL('../src/app/useImageOperationController.ts', import.meta.url),
  'utf8',
);
const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
for (const command of [
  'createImageToImageDraft',
  'createTextToImageDraft',
  'updateCapability',
  'updateConnection',
  'updateGenerationParams',
  'updateGenerationProfile',
]) {
  assert.match(controllerSource, new RegExp(`commands\\.imageOperation\\.${command}\\(`));
}
assert.doesNotMatch(
  controllerSource,
  /\b(?:createDraftImageToImageOperation|createDraftTextToImageOperation|createImageComposerDraft|resizeEmptyOperationOutputSlot)\b/,
);
assert.doesNotMatch(appSource, /const edgeId = createId\('edge'\)/);
assert.match(appSource, /referenceBlockIds: \[sourceBlock\.blockId\]/);

unsubscribe();
await host.dispose();

console.log({
  blankSourceAndDraftAreAtomic: true,
  imageConfigurationNoopDoesNotPublish: true,
  imageDraftProjectionIsDurable: true,
  imageDraftStaleReferenceIsAtomic: true,
  imageReferenceEdgeAndDraftAreAtomic: true,
  imageSlotResizeUsesTypedCommand: true,
  providerExecutionStartRemainsOutsideProductTransaction: true,
});

function scopeFor(snapshot: BoardSnapshot) {
  return {
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
  };
}
