import assert from 'node:assert/strict';
import { savePluginDraft } from '../src/app/usePluginDraftController';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import { createBlockRecord } from '../src/core/blockFactory';
import { createCanvasHost } from '../src/host-kit';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';
import { createWhiteboardProductCommands } from '../src/whiteboard/application/whiteboardProductCommands';

const initial = createBlankBoardSnapshot({
  boardId: 'board_whiteboard_plugin_commands',
  boardName: 'Plugin product commands',
  projectId: 'project_whiteboard_plugin_commands',
  projectName: 'Plugin product commands',
});
const sourceBlock = createBlockRecord(initial, 'image');
sourceBlock.data = {
  ...sourceBlock.data,
  annotationDraft: {
    globalInstruction: 'Legacy annotation draft.',
    marks: [],
    schemaVersion: 1,
    sourceAssetId: 'asset_legacy_annotation',
    updatedAt: '2026-08-11T00:00:00.000Z',
  },
  assetId: 'asset_legacy_annotation',
};
initial.blocks.push(sourceBlock);

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
let publications = 0;
const unsubscribe = host.readModel.subscribe(() => {
  publications += 1;
});
const runProductCommand = async <Result>(
  operation: (commands: ReturnType<typeof createWhiteboardProductCommands>) => Promise<Result>,
) => operation(createWhiteboardProductCommands(host));
const request = {
  blockId: sourceBlock.blockId,
  capabilityId: 'image.annotation_edit',
  pluginModuleId: 'design.retake.annotation',
  value: {
    globalInstruction: 'Remove the reflection.',
    marks: [],
    schemaVersion: 2,
  },
};
const saved = await savePluginDraft(request, { runProductCommand });
assert.equal(saved?.blockId, sourceBlock.blockId);
assert.equal(publications, 1);
assert.equal(
  host.readModel.getSnapshot().blocks.find(
    (block) => block.blockId === sourceBlock.blockId,
  )?.data.annotationDraft,
  undefined,
);

const commands = createWhiteboardProductCommands(host);
const sameValueRetry = await commands.plugin.saveDraft({
  ...request,
  value: {
    marks: [],
    schemaVersion: 2,
    globalInstruction: 'Remove the reflection.',
  },
});
assert.equal(sameValueRetry.committed, false);
assert.equal(sameValueRetry.draft?.revision, saved?.revision);
assert.equal(publications, 1);

const removed = await commands.plugin.saveDraft({ ...request, value: null });
assert.equal(removed.committed, true);
assert.equal(removed.draft, null);
assert.equal(publications, 2);
const removedRetry = await commands.plugin.saveDraft({ ...request, value: null });
assert.equal(removedRetry.committed, false);
assert.equal(publications, 2);
await assert.rejects(
  commands.plugin.saveDraft({ ...request, blockId: 'block_missing_plugin_draft' }),
  /no longer exists/,
);
assert.equal(publications, 2);

const durable = await storage.loadBoard({
  boardId: initial.board.boardId,
  projectId: initial.project.projectId,
});
assert.equal(
  durable.blocks.find((block) => block.blockId === sourceBlock.blockId)
    ?.data.retakePluginDrafts,
  undefined,
);

unsubscribe();
await host.dispose();

console.log({
  legacyAnnotationDraftMigrated: true,
  pluginDraftCommandUsesHostTransaction: true,
  pluginDraftDeleteRetryDoesNotPublish: true,
  pluginDraftSameValueDoesNotPublish: true,
});
