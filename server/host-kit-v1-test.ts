import assert from 'node:assert/strict';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import { createCanvasHost } from '../src/host-kit';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
  InMemoryHostStorageConflictError,
} from '../src/host-kit/testing';
import { whiteboardCanvasHostBridge } from '../src/host-kit/internal/whiteboardCompatibility';

const initial = createBlankBoardSnapshot({
  boardId: 'board_host_v1',
  boardName: 'Host V1',
  projectId: 'project_host_v1',
  projectName: 'Host Kit Tests',
});
const storage = new InMemoryHostStorageAdapter([initial]);
const experience = {
  commandOverrides: [],
  profileId: 'retake.host.test',
  schemaVersion: 1,
} as const;
const environment = {
  colorScheme: 'light',
  contrast: 'normal',
  direction: 'ltr',
  locale: 'en',
  reducedMotion: true,
  themeId: 'retake.test',
} as const;
const scope = {
  boardId: initial.board.boardId,
  projectId: initial.project.projectId,
};
const host = await createCanvasHost({
  connections: createNoopHostConnections(),
  environment,
  experience,
  initialScope: scope,
  packageRuntime: createNoopHostPackageRuntime(),
  storage,
});
let runtimePublications = 0;
const unsubscribeRuntime = host.runtime.subscribe(() => {
  runtimePublications += 1;
});

assert.equal(host.apiVersion, 1);
assert.equal(host.domainSchemaVersion, 1);
assert(Object.isFrozen(host.readModel.getSnapshot()));
assert(Object.isFrozen(host.readModel.getSnapshot().blocks));
assert.throws(
  () => (host.readModel.getSnapshot().blocks as unknown[]).push({}),
  TypeError,
);

let publications = 0;
const unsubscribe = host.readModel.subscribe(() => {
  publications += 1;
});
const text = await host.commands.createBlock({
  body: 'A portable Host command',
  title: 'Brief',
  type: 'text',
});
const compatibility = whiteboardCanvasHostBridge(host);
const beforeCompatibilityEdit = structuredClone(host.readModel.getSnapshot());
const compatibilityEdit = structuredClone(beforeCompatibilityEdit);
compatibilityEdit.board.name = 'Compatibility replacement';
compatibilityEdit.board.updatedAt = new Date(
  Date.parse(compatibilityEdit.board.updatedAt) + 1_000,
).toISOString();
compatibilityEdit.project.updatedAt = compatibilityEdit.board.updatedAt;
compatibility.replaceSnapshot(compatibilityEdit);
await compatibility.persistSnapshot(compatibilityEdit);
const productTransaction = await compatibility.executeProductTransaction((snapshot) => {
  snapshot.board.name = 'Typed Whiteboard product transaction';
  return { boardId: snapshot.board.boardId };
});
assert.equal(productTransaction.result.boardId, initial.board.boardId);
assert.equal(productTransaction.snapshot.board.name, 'Typed Whiteboard product transaction');
assert.equal(
  (await storage.loadBoard(scope)).board.name,
  'Typed Whiteboard product transaction',
  'Whiteboard product commands must commit through the Host serialized CAS authority.',
);
const publicationsBeforeNoopProductTransaction = publications;
const noOpProductTransaction = await compatibility.executeConditionalProductTransaction((snapshot) => ({
  changed: false,
  result: { boardId: snapshot.board.boardId },
}));
assert.equal(noOpProductTransaction.committed, false);
assert.equal(noOpProductTransaction.result.boardId, initial.board.boardId);
assert.equal(publications, publicationsBeforeNoopProductTransaction);
assert.equal(
  noOpProductTransaction.snapshot.board.updatedAt,
  host.readModel.getSnapshot().board.updatedAt,
  'A read-only product reconciliation must not touch or publish the Board.',
);
const image = await host.commands.createBlock({
  position: { x: 420, y: 80 },
  title: 'Result',
  type: 'image',
});
const updatedText = await host.commands.updateBlock({
  blockId: text.blockId,
  body: 'Updated through the Application command.',
});
assert.equal(updatedText.data.body, 'Updated through the Application command.');
const operation = await host.commands.createBlock({
  data: { capabilityId: 'image.generate' },
  title: 'Generate image',
  type: 'operation',
});
assert.equal(publications, 7);
await assert.rejects(
  host.commands.createGroup({ blockIds: [text.blockId, 'block_missing'] }),
  /Block not found/,
);
await assert.rejects(
  host.commands.createGroup({ blockIds: [text.blockId, text.blockId] }),
  /duplicate Block IDs/,
);
const group = await host.commands.createGroup({
  blockIds: [text.blockId, image.blockId],
  color: 'blue',
  title: 'Portable Group',
});
assert.equal(group.type, 'group');
assert.equal(
  host.readModel.getSnapshot().blocks.find((block) => block.blockId === text.blockId)?.parentGroupId,
  group.blockId,
);
const updatedGroup = await host.commands.updateGroup({
  color: 'rose',
  groupId: group.blockId,
  title: 'Updated Group',
});
assert.equal(updatedGroup.data.groupColor, 'rose');
await host.commands.layoutGroup({ groupId: group.blockId, layoutMode: 'row' });
const resizedGroup = await host.commands.resizeGroup({
  groupId: group.blockId,
  position: group.position,
  size: {
    height: group.size.height + 40,
    width: group.size.width + 40,
  },
});
assert.equal(resizedGroup.size.width, group.size.width + 40);
await host.commands.fitGroup({ groupId: group.blockId });
await host.commands.updateGroup({ contentsLocked: true, groupId: group.blockId });
await assert.rejects(
  host.commands.layoutGroup({ groupId: group.blockId, layoutMode: 'grid' }),
  /structure is locked/,
);
await host.commands.updateGroup({ contentsLocked: false, groupId: group.blockId });
const dissolvedGroup = await host.commands.dissolveGroup({ groupId: group.blockId });
assert.deepEqual(new Set(dissolvedGroup.childBlockIds), new Set([text.blockId, image.blockId]));
assert(!host.readModel.getSnapshot().blocks.some((block) => block.blockId === group.blockId));
await host.commands.moveBlocks({
  moves: [{ blockId: text.blockId, position: { x: 120, y: 160 } }],
});
await host.commands.resizeBlock({
  blockId: image.blockId,
  size: { height: 360, width: 480 },
});
const edge = await host.commands.connectBlocks({
  sourceBlockId: text.blockId,
  targetBlockId: operation.blockId,
});
assert.equal(edge.kind, 'visual_note');
await host.commands.removeConnections({ edgeIds: [edge.edgeId] });
const replacementEdge = await host.commands.connectBlocks({
  sourceBlockId: text.blockId,
  targetBlockId: operation.blockId,
});

const asset = await host.commands.attachAsset({
  assetId: 'asset_host_v1',
  blockId: image.blockId,
  fileName: 'portable.svg',
  height: 512,
  kind: 'image',
  mimeType: 'image/svg+xml',
  previewUrl: 'data:image/svg+xml,<svg/>',
  storageKey: 'memory://asset_host_v1',
  storageProvider: 'custom',
  width: 512,
});
assert.equal(storage.readAsset(scope.projectId, asset.assetId)?.assetId, asset.assetId);
assert.equal(storage.readLastPersistAssetOptions()?.fileName, 'portable.svg');
const importedImage = host.readModel.getSnapshot().blocks.find(
  (block) => block.blockId === image.blockId,
);
assert.equal(importedImage?.data.title, 'portable.svg');
assert.deepEqual(importedImage?.size, { height: 380, width: 380 });

const replacementAsset = await host.commands.attachAsset({
  assetId: 'asset_host_v1_replacement',
  blockId: image.blockId,
  fileName: 'replacement.svg',
  height: 256,
  kind: 'image',
  mimeType: 'image/svg+xml',
  previewUrl: 'data:image/svg+xml,<svg/>',
  storageKey: 'memory://asset_host_v1_replacement',
  storageProvider: 'custom',
  width: 512,
});
assert.equal(
  host.readModel.getSnapshot().historyEvents?.[0]?.type,
  'asset_replaced',
);
assert.deepEqual(
  host.readModel.getSnapshot().blocks.find(
    (block) => block.blockId === image.blockId,
  )?.size,
  { height: 190, width: 380 },
);
const lockedAssetGroup = await host.commands.createGroup({
  blockIds: [image.blockId, operation.blockId],
});
await host.commands.updateGroup({
  contentsLocked: true,
  groupId: lockedAssetGroup.blockId,
});
await assert.rejects(
  host.commands.moveBlocks({
    moves: [{ blockId: image.blockId, position: { x: 1, y: 1 } }],
  }),
  /cannot be moved/,
);
await assert.rejects(
  host.commands.resizeBlock({
    blockId: image.blockId,
    size: { height: 100, width: 100 },
  }),
  /cannot be resized/,
);
await assert.rejects(
  host.commands.resizeBlock({
    blockId: lockedAssetGroup.blockId,
    size: { height: 100, width: 100 },
  }),
  /resizeGroup/,
);
await assert.rejects(
  host.commands.removeBlocks({ blockIds: [image.blockId] }),
  /cannot be removed/,
);
await assert.rejects(
  host.commands.attachAsset({
    assetId: 'asset_must_not_persist',
    blockId: image.blockId,
    kind: 'image',
    mimeType: 'image/png',
    previewUrl: 'data:image/png;base64,',
    storageKey: 'memory://asset_must_not_persist',
    storageProvider: 'custom',
  }),
  /locked by its Group/,
);
assert.equal(storage.readAsset(scope.projectId, 'asset_must_not_persist'), undefined);
await host.commands.updateGroup({
  contentsLocked: false,
  groupId: lockedAssetGroup.blockId,
});
await host.commands.dissolveGroup({ groupId: lockedAssetGroup.blockId });
const canceledOutput = await host.commands.createBlock({ type: 'image' });
const cancellableExecution = await host.commands.createExecution({
  adapter: 'mock',
  capabilityId: 'image.generate',
  inputBlockIds: [image.blockId],
  operationBlockId: operation.blockId,
  outputBlockIds: [canceledOutput.blockId],
  triggerMode: 'local_mock',
});
assert.equal(cancellableExecution.params?.operationBlockId, operation.blockId);
await assert.rejects(
  host.commands.removeBlocks({ blockIds: [operation.blockId] }),
  /active Execution cancellation/,
);
const canceled = await host.commands.cancelExecution({
  executionId: cancellableExecution.executionId,
});
assert.equal(canceled.execution.status, 'canceled');
assert.deepEqual(canceled.removedBlockIds, [canceledOutput.blockId]);
assert(!host.readModel.getSnapshot().blocks.some(
  (block) => block.blockId === canceledOutput.blockId,
));
await assert.rejects(
  host.commands.cancelExecution({ executionId: cancellableExecution.executionId }),
  /not active/,
);

const execution = await host.commands.createExecution({
  adapter: 'mock',
  capabilityId: 'image.generate',
  inputBlockIds: [text.blockId],
  operationBlockId: operation.blockId,
  outputBlockIds: [image.blockId],
  prompt: 'A portable image',
  triggerMode: 'local_mock',
});
await host.commands.transitionExecution({
  executionId: execution.executionId,
  status: 'running',
});
const completed = await host.commands.transitionExecution({
  executionId: execution.executionId,
  outputAssetIds: [replacementAsset.assetId],
  outputBlockIds: [image.blockId],
  status: 'succeeded',
});
assert.equal(completed.status, 'succeeded');
assert.equal(completed.recordVersion, 3);
await host.commands.removeBlocks({ blockIds: [text.blockId] });
assert(!host.readModel.getSnapshot().edges.some((candidate) => candidate.edgeId === replacementEdge.edgeId));
assert.deepEqual(
  host.readModel.getSnapshot().historyEvents?.map((event) => event.type),
  ['execution_succeeded', 'execution_started', 'execution_canceled', 'asset_replaced', 'asset_imported', 'operation_created'],
);
await assert.rejects(
  host.commands.transitionExecution({
    executionId: execution.executionId,
    status: 'running',
  }),
  /Invalid Execution transition/,
);

const secondHost = await createCanvasHost({
  connections: createNoopHostConnections(),
  environment,
  experience,
  initialScope: scope,
  packageRuntime: createNoopHostPackageRuntime(),
  storage,
});
assert.equal(
  secondHost.readModel.getSnapshot().executions.find(
    (candidate) => candidate.executionId === execution.executionId,
  )?.status,
  'succeeded',
);
await host.commands.createBlock({ title: 'After second open', type: 'text' });
await assert.rejects(
  secondHost.commands.createBlock({ title: 'Stale write', type: 'text' }),
  InMemoryHostStorageConflictError,
);

const createdBoard = await host.commands.createBoard({
  boardId: 'board_host_created',
  boardName: 'Created by Application Service',
  projectId: 'project_host_created',
  projectName: 'Created Project',
});
assert.equal(host.readModel.getSnapshot().board.boardId, createdBoard.board.boardId);
assert.equal(runtimePublications, 1);
await host.setScope(scope);
assert.equal(host.readModel.getSnapshot().board.boardId, scope.boardId);
assert.equal(runtimePublications, 2);
assert.throws(
  () => compatibility.replaceSnapshot(createdBoard as typeof initial),
  /outside the requested scope/,
);
await assert.rejects(
  compatibility.persistSnapshot(createdBoard as typeof initial),
  /outside the requested scope/,
);
assert.equal((await storage.listWorkspace()).projects.length, 2);

const detachedCompletion = await host.commands.startLocalImageExecution({
  capabilityId: 'image.generate',
  params: { brightness: 12 },
  sourceBlockId: image.blockId,
  title: 'Detached completion',
});
await host.setScope({
  boardId: createdBoard.board.boardId,
  projectId: createdBoard.project.projectId,
});
const completedDetached = await host.commands.completeLocalImageExecution({
  asset: {
    assetId: 'asset_detached_completion',
    fileName: 'detached-completion.png',
    height: 1,
    kind: 'image',
    mimeType: 'image/png',
    previewUrl: 'data:image/png;base64,',
    storageKey: 'memory://asset_detached_completion',
    storageProvider: 'custom',
    width: 1,
  },
  executionId: detachedCompletion.execution.executionId,
  scope,
});
assert.equal(completedDetached.execution.status, 'succeeded');
assert.equal(completedDetached.asset.sourceExecutionId, detachedCompletion.execution.executionId);
assert.equal(host.readModel.getSnapshot().board.boardId, createdBoard.board.boardId);
assert.equal(
  (await storage.loadBoard(scope)).executions.find(
    (candidate) => candidate.executionId === detachedCompletion.execution.executionId,
  )?.status,
  'succeeded',
);

await host.setScope(scope);
const detachedFailure = await host.commands.startLocalImageExecution({
  capabilityId: 'image.generate',
  sourceBlockId: image.blockId,
  title: 'Detached failure',
});
await host.setScope({
  boardId: createdBoard.board.boardId,
  projectId: createdBoard.project.projectId,
});
const failedDetached = await host.commands.failLocalImageExecution({
  errorMessage: 'Fixture processor failed.',
  executionId: detachedFailure.execution.executionId,
  scope,
});
assert.equal(failedDetached.status, 'failed');
assert.equal(host.readModel.getSnapshot().board.boardId, createdBoard.board.boardId);
assert.equal(
  (await storage.loadBoard(scope)).executions.find(
    (candidate) => candidate.executionId === detachedFailure.execution.executionId,
  )?.errorMessage,
  'Fixture processor failed.',
);
await host.setScope(scope);

unsubscribe();
unsubscribeRuntime();
await secondHost.dispose();
await host.dispose();
await assert.rejects(
  host.commands.createBlock({ title: 'Disposed', type: 'text' }),
  /disposed/,
);

console.log({
  assets: host.readModel.getSnapshot().assets.length,
  blocks: host.readModel.getSnapshot().blocks.length,
  executions: host.readModel.getSnapshot().executions.length,
  hostKitApplication: 'passed',
  publications,
});
