import assert from 'node:assert/strict';
import { defaultBlockSize, fitImageBlockSize, fitMediaBlockSize } from '../src/core/blockSizing';
import { managedResultStatusMessageKey } from '../src/core/resultStatus';
import { createBlockRecord } from '../src/core/blockFactory';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { blockGroupBounds, moveBlockGroupToNearestFreeArea } from '../src/core/workflowPlacement';

assert.deepEqual(defaultBlockSize('image'), { width: 300, height: 230 });
assert.deepEqual(defaultBlockSize('document'), { width: 320, height: 240 });
assert.deepEqual(defaultBlockSize('text'), { width: 260, height: 170 });
assert.deepEqual(defaultBlockSize('video'), { width: 300, height: 180 });
assert.deepEqual(defaultBlockSize('operation'), { width: 320, height: 190 });

assert.deepEqual(fitImageBlockSize(1086, 1448), { width: 285, height: 380 });
assert.deepEqual(fitMediaBlockSize(9 / 16), { width: 214, height: 380 });
assert.deepEqual(fitMediaBlockSize(16 / 9), { width: 380, height: 214 });
assert.deepEqual(fitMediaBlockSize(1), { width: 380, height: 380 });
assert.equal(managedResultStatusMessageKey({ title: 'Queued', status: 'queued', executionAdapter: 'mcp_agent' }), 'resultStatus.codexQueued');
assert.equal(managedResultStatusMessageKey({ title: 'Running', status: 'running', executionAdapter: 'mcp_agent' }), 'resultStatus.codexRunning');
assert.equal(managedResultStatusMessageKey({ title: 'Queued API', status: 'queued', executionAdapter: 'direct_api' }), 'resultStatus.directApiQueued');
assert.equal(managedResultStatusMessageKey({ title: 'Running API', status: 'running', executionAdapter: 'direct_api' }), 'resultStatus.directApiRunning');

const placementSnapshot = structuredClone(defaultSnapshot);
placementSnapshot.blocks = [];
const occupiedBlock = createBlockRecord(placementSnapshot, 'image');
occupiedBlock.position = { x: -150, y: -115 };
const workflowBlocks = [
  createBlockRecord(placementSnapshot, 'image'),
  createBlockRecord(placementSnapshot, 'text'),
  createBlockRecord(placementSnapshot, 'operation'),
];
workflowBlocks[0].position = { x: -530, y: -115 };
workflowBlocks[1].position = { x: -150, y: -70 };
workflowBlocks[2].position = { x: 210, y: -95 };
const relativeOffsets = workflowBlocks.slice(1).map((block) => ({
  x: block.position.x - workflowBlocks[0].position.x,
  y: block.position.y - workflowBlocks[0].position.y,
}));
placementSnapshot.blocks.push(occupiedBlock, ...workflowBlocks);
moveBlockGroupToNearestFreeArea(placementSnapshot, workflowBlocks, { x: 0, y: 0 });
const placedBounds = blockGroupBounds(workflowBlocks);
assert.deepEqual(
  workflowBlocks.slice(1).map((block) => ({
    x: block.position.x - workflowBlocks[0].position.x,
    y: block.position.y - workflowBlocks[0].position.y,
  })),
  relativeOffsets,
  'group placement must preserve the workflow internal layout',
);
assert.equal(
  placedBounds.x + placedBounds.width + 32 <= occupiedBlock.position.x ||
    occupiedBlock.position.x + occupiedBlock.size.width + 32 <= placedBounds.x ||
    placedBounds.y + placedBounds.height + 32 <= occupiedBlock.position.y ||
    occupiedBlock.position.y + occupiedBlock.size.height + 32 <= placedBounds.y,
  true,
  'workflow bounds must move as one unit away from occupied blocks',
);

console.log({
  defaults: {
    document: defaultBlockSize('document'),
    image: defaultBlockSize('image'),
    operation: defaultBlockSize('operation'),
    text: defaultBlockSize('text'),
    video: defaultBlockSize('video'),
  },
  importedPortrait: fitImageBlockSize(1086, 1448),
  generatedPortrait: fitMediaBlockSize(9 / 16),
  workflowGroupAvoidedCollision: true,
});
