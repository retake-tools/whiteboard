import assert from 'node:assert/strict';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import { createBlockRecord } from '../src/core/blockFactory';
import { domainVideoGenerationCapabilityId } from '../src/core/domainVideoGenerationContracts';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';
import { createCanvasHost } from '../src/host-kit';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';
import { createWhiteboardProductCommands } from '../src/whiteboard/application/whiteboardProductCommands';

const initial = createBlankBoardSnapshot({
  boardId: 'board_canvas_product_commands',
  boardName: 'Canvas product commands',
  projectId: 'project_canvas_product_commands',
  projectName: 'Canvas product commands',
});
const first = addBlock(initial, 'text', { x: 100, y: 100 }, 'First');
const second = addBlock(initial, 'text', { x: 420, y: 100 }, 'Second');
const dragged = addBlock(initial, 'text', { x: 1_000, y: 100 }, 'Dragged');
const source = addBlock(initial, 'image', { x: 1_100, y: 600 }, 'Source');
const sourceAsset: AssetRecord = {
  assetId: 'asset_canvas_source',
  createdAt: '2026-08-11T00:00:00.000Z',
  height: 800,
  kind: 'image',
  mimeType: 'image/png',
  previewUrl: '/api/local/assets/asset_canvas_source',
  projectId: initial.project.projectId,
  width: 800,
};
initial.assets.push(sourceAsset);
source.data.assetId = sourceAsset.assetId;
const operation = addBlock(initial, 'operation', { x: 1_600, y: 600 }, 'Image operation');
operation.data.capabilityId = 'image.generate';
const videoOperation = addBlock(initial, 'operation', { x: 2_100, y: 600 }, 'Video operation');
videoOperation.data.capabilityId = domainVideoGenerationCapabilityId;

const scope = {
  boardId: initial.board.boardId,
  projectId: initial.project.projectId,
};
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
  initialScope: scope,
  packageRuntime: createNoopHostPackageRuntime(),
  storage,
});
const commands = createWhiteboardProductCommands(host);
let publications = 0;
const unsubscribe = host.readModel.subscribe(() => {
  publications += 1;
});

const grouped = await commands.canvas.createGroupFromBounds({
  bounds: { height: 360, width: 700, x: 50, y: 50 },
  expectedScope: scope,
  title: 'Grouped',
});
assert.equal(grouped.committed, true);
assert.ok(grouped.groupId);
assert.equal(publications, 1);
let current = host.readModel.getSnapshot();
assert.equal(block(current, first.blockId).parentGroupId, grouped.groupId);
assert.equal(block(current, second.blockId).parentGroupId, grouped.groupId);

const draggedResult = await commands.canvas.commitDrag({
  absolutePositions: [
    { blockId: dragged.blockId, position: { x: 120, y: 180 } },
    { blockId: source.blockId, position: { x: 9_999, y: 9_999 } },
  ],
  collapsedGroupIds: [],
  draggedBlocks: [{
    blockId: dragged.blockId,
    position: { x: 120, y: 180 },
    size: dragged.size,
  }],
  expectedScope: scope,
});
assert.equal(draggedResult.committed, true);
assert.deepEqual(draggedResult.reparentedBlockIds, [dragged.blockId]);
assert.equal(publications, 2);
assert.deepEqual(block(host.readModel.getSnapshot(), source.blockId).position, { x: 1_100, y: 600 });

const duplicated = await commands.block.duplicate({
  blockIds: [grouped.groupId!],
  expectedScope: scope,
});
assert.equal(duplicated.committed, true);
assert.equal(duplicated.duplicatedBlockIds.length, 1);
assert.equal(publications, 3);
current = host.readModel.getSnapshot();
const duplicateGroupId = duplicated.duplicatedBlockIds[0]!;
assert.equal(
  current.blocks.filter((candidate) => candidate.parentGroupId === duplicateGroupId).length,
  3,
);

const deleted = await commands.block.delete({
  blockIds: [duplicateGroupId],
  expectedScope: scope,
});
assert.equal(deleted.committed, true);
assert.equal(deleted.deletedBlockIds.length, 4);
assert.equal(publications, 4);
current = host.readModel.getSnapshot();
assert.equal(current.blocks.some((candidate) => deleted.deletedBlockIds.includes(candidate.blockId)), false);

const input = await commands.operationInput.addBlock({
  blockData: {
    body: '',
    placeholder: 'Describe the image',
    promptRole: 'operation_prompt',
    title: 'Prompt',
  },
  expectedScope: scope,
  operationBlockId: operation.blockId,
  type: 'text',
});
assert.equal(input.committed, true);
assert.ok(input.blockId);
assert.equal(publications, 5);
assert.equal(
  host.readModel.getSnapshot().edges.find(
    (edge) => edge.sourceBlockId === input.blockId,
  )?.inputSlotId,
  'prompt',
);

const reference = await commands.operationInput.bindImageReference({
  expectedScope: scope,
  fallbackImageTitle: 'Image',
  operationBlockId: operation.blockId,
  setting: { instruction: '', mode: 'source' },
  sourceBlockId: source.blockId,
});
assert.equal(reference.committed, true);
assert.equal(publications, 6);
current = host.readModel.getSnapshot();
assert.equal(current.edges.some((edge) => (
  edge.sourceBlockId === source.blockId
  && edge.targetBlockId === operation.blockId
  && edge.inputSlotId === 'source_image'
)), true);

const videoParameters = await commands.operationInput.updateDomainVideoParameters({
  blockId: videoOperation.blockId,
  expectedScope: scope,
  parameters: { aspectRatio: '16:9', durationSeconds: 8 },
});
assert.equal(videoParameters.committed, true);
assert.equal(videoParameters.updated, true);
assert.equal(publications, 7);

const background = await commands.board.setBackground({
  background: { color: '#AABBCC', kind: 'solid' },
  expectedScope: scope,
});
assert.equal(background.committed, true);
assert.equal(publications, 8);
assert.deepEqual(host.readModel.getSnapshot().board.background, {
  color: '#aabbcc',
  kind: 'solid',
});
const backgroundNoop = await commands.board.setBackground({
  background: { color: '#aabbcc', kind: 'solid' },
  expectedScope: scope,
});
assert.equal(backgroundNoop.committed, false);
assert.equal(publications, 8);

await assert.rejects(
  commands.block.duplicate({
    blockIds: [first.blockId],
    expectedScope: { ...scope, boardId: 'board_other' },
  }),
  /scope changed/,
);
assert.equal(publications, 8);

const durable = await storage.loadBoard(scope);
assert.deepEqual(durable.board.background, { color: '#aabbcc', kind: 'solid' });
assert.ok(durable.blocks.some((candidate) => candidate.blockId === input.blockId));

unsubscribe();
await host.dispose();

console.log({
  boardBackgroundUsesConditionalHostTransaction: true,
  complexBlockDeleteAndDuplicateUseHostTransactions: true,
  complexCanvasGroupingAndDragUseHostTransactions: true,
  operationInputMutationsUseHostTransactions: true,
  scopeRaceIsRejected: true,
});

function addBlock(
  snapshot: BoardSnapshot,
  type: BlockRecord['type'],
  position: { x: number; y: number },
  title: string,
): BlockRecord {
  const result = createBlockRecord(snapshot, type);
  result.position = position;
  result.data.title = title;
  snapshot.blocks.push(result);
  return result;
}

function block(snapshot: BoardSnapshot, blockId: string): BlockRecord {
  const result = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  assert.ok(result);
  return result;
}
