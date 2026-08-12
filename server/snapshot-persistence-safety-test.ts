import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createAgentSession } from '../src/core/agentSession';
import { createId, nowIso } from '../src/core/id';
import { loadBoardSnapshot, saveBoardSnapshot } from '../src/core/boardStore';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { migrateBoardSnapshot } from '../src/core/snapshotMigration';
import type { AssetRecord, BoardHistoryEvent, ExecutionRecord } from '../src/core/types';
import {
  createAssetFromDataUrl,
  getBoardSnapshot,
  listWorkspace,
  resetWorkspace,
  saveSnapshot,
  SnapshotWriteConflictError,
} from './local-store';
import { projectsRoot } from './local-store/context';
import {
  markExecutionRunning,
  recordExecutionRequestPrompts,
} from './local-store/execution-store';

const sessionOnly = await resetWorkspace();
const defaultSnapshotPath = path.join(
  projectsRoot,
  sessionOnly.project.projectId,
  'boards',
  sessionOnly.board.boardId,
  'snapshot.json',
);
const snapshotInodeBeforeReads = (await stat(defaultSnapshotPath)).ino;
await Promise.all(Array.from({ length: 12 }, () => getBoardSnapshot({
  boardId: sessionOnly.board.boardId,
  projectId: sessionOnly.project.projectId,
})));
assert.equal(
  (await stat(defaultSnapshotPath)).ino,
  snapshotInodeBeforeReads,
  'loading a migrated Snapshot must not enqueue a stale write',
);
const session = createAgentSession(sessionOnly, {
  model: 'test-model',
  title: 'Default conversation',
}).session;
await saveSnapshot(sessionOnly);
const reloadedSessionOnly = await getBoardSnapshot();
assert.equal(reloadedSessionOnly.agentSessions?.[0]?.agentSessionId, session.agentSessionId);
const workspaceWithSession = await listWorkspace();
assert.equal(workspaceWithSession.projects.length, 1);
assert.equal(workspaceWithSession.projects[0]?.projectId, sessionOnly.project.projectId);

const populated = await resetWorkspace();
const createdAt = nowIso();
const asset: AssetRecord = {
  assetId: createId('asset'),
  projectId: populated.project.projectId,
  kind: 'image',
  mimeType: 'image/png',
  storageProvider: 'local',
  storageKey: 'assets/safety/original.png',
  previewUrl: '/api/local/assets/safety/original.png',
  createdAt,
};
const execution: ExecutionRecord = {
  executionId: createId('exec'),
  projectId: populated.project.projectId,
  boardId: populated.board.boardId,
  capabilityId: 'image.text_to_image',
  adapter: 'mcp_agent',
  status: 'succeeded',
  inputBlockIds: ['block_brief'],
  outputBlockIds: [],
  outputAssetIds: [asset.assetId],
  startedAt: createdAt,
  completedAt: createdAt,
};
const historyEvent: BoardHistoryEvent = {
  eventId: createId('history'),
  type: 'execution_succeeded',
  createdAt,
  actor: 'codex',
  executionId: execution.executionId,
  assetIds: [asset.assetId],
  summary: 'Persistence safety fixture',
};
populated.blocks.push({
  ...structuredClone(populated.blocks[0]),
  blockId: 'block_user_result',
  data: { title: 'User result' },
});
populated.assets = [asset];
populated.executions = [execution];
populated.historyEvents = [historyEvent];
await saveSnapshot(populated);

const fallback = migrateBoardSnapshot(structuredClone(defaultSnapshot));
const pluginOperationSnapshot = structuredClone(defaultSnapshot);
const pluginOperation = pluginOperationSnapshot.blocks.find((block) => block.type === 'operation');
assert(pluginOperation);
pluginOperation.data.capabilityId = 'image.local_adjust';
pluginOperation.data.operationMode = 'image.local_adjust';
const migratedPluginOperation = migrateBoardSnapshot(pluginOperationSnapshot).blocks.find(
  (block) => block.blockId === pluginOperation.blockId,
);
assert.equal(
  migratedPluginOperation?.data.operationMode,
  'image.local_adjust',
  'snapshot migration must preserve a Plugin-owned operation mode',
);

const capabilityOnlyPluginSnapshot = structuredClone(pluginOperationSnapshot);
const capabilityOnlyPluginOperation = capabilityOnlyPluginSnapshot.blocks.find(
  (block) => block.blockId === pluginOperation.blockId,
);
assert(capabilityOnlyPluginOperation);
delete capabilityOnlyPluginOperation.data.operationMode;
const migratedCapabilityOnlyPluginOperation = migrateBoardSnapshot(
  capabilityOnlyPluginSnapshot,
).blocks.find((block) => block.blockId === pluginOperation.blockId);
assert.equal(
  migratedCapabilityOnlyPluginOperation?.data.operationMode,
  'image.local_adjust',
  'snapshot migration must derive a missing Plugin operation mode from capabilityId',
);

await assert.rejects(
  () => saveSnapshot(fallback),
  (error) => error instanceof SnapshotWriteConflictError,
  'a fallback hydration snapshot must never replace a populated board',
);
const afterRejectedFallback = await getBoardSnapshot({
  projectId: populated.project.projectId,
  boardId: populated.board.boardId,
});
assert(afterRejectedFallback.blocks.some((block) => block.blockId === 'block_user_result'));
assert.equal(afterRejectedFallback.executions.length, 1);
assert.equal(afterRejectedFallback.assets.length, 1);
assert.equal(afterRejectedFallback.historyEvents?.length, 1);

const authorizedInitial = migrateBoardSnapshot(structuredClone(defaultSnapshot));
authorizedInitial.project.projectId = 'project_authorized_replacement';
authorizedInitial.project.defaultBoardId = 'board_authorized_replacement';
authorizedInitial.board.projectId = authorizedInitial.project.projectId;
authorizedInitial.board.boardId = authorizedInitial.project.defaultBoardId;
authorizedInitial.board.updatedAt = '2030-01-01T00:00:01.000Z';
for (const layer of authorizedInitial.layers) layer.boardId = authorizedInitial.board.boardId;
for (const block of authorizedInitial.blocks) block.boardId = authorizedInitial.board.boardId;
authorizedInitial.blocks.push({
  ...structuredClone(authorizedInitial.blocks[0]),
  blockId: 'block_authorized_user_content',
  boardId: authorizedInitial.board.boardId,
});
authorizedInitial.blocks[0]!.data.title = 'Newer timestamp before CAS replacement';
authorizedInitial.blocks[0]!.updatedAt = '2030-01-01T00:00:05.000Z';
await saveSnapshot(authorizedInitial);
const authorizedFallbackShape = structuredClone(authorizedInitial);
authorizedFallbackShape.blocks = authorizedFallbackShape.blocks.filter(
  (block) => block.blockId !== 'block_authorized_user_content',
);
authorizedFallbackShape.board.updatedAt = '2030-01-01T00:00:02.000Z';
authorizedFallbackShape.blocks[0]!.data.title = 'CAS authoritative replacement';
authorizedFallbackShape.blocks[0]!.updatedAt = '2029-01-01T00:00:00.000Z';
await assert.rejects(
  () => saveSnapshot(authorizedFallbackShape, {
    expectedRevision: {
      boardId: authorizedInitial.board.boardId,
      projectId: authorizedInitial.project.projectId,
      updatedAt: '2030-01-01T00:00:00.000Z',
    },
  }),
  (error) => error instanceof SnapshotWriteConflictError,
  'an authorized replacement must still reject a stale expected revision',
);
await saveSnapshot(authorizedFallbackShape, {
  expectedRevision: {
    boardId: authorizedInitial.board.boardId,
    projectId: authorizedInitial.project.projectId,
    updatedAt: authorizedInitial.board.updatedAt,
  },
});
const afterAuthorizedFallbackShape = await getBoardSnapshot({
  projectId: authorizedInitial.project.projectId,
  boardId: authorizedInitial.board.boardId,
});
assert.equal(
  afterAuthorizedFallbackShape.blocks.some((block) => block.blockId === 'block_authorized_user_content'),
  false,
  'a compare-and-swap authorized command may intentionally return a Board to its fallback Block shape',
);
assert.equal(
  afterAuthorizedFallbackShape.blocks[0]?.data.title,
  'CAS authoritative replacement',
  'a compare-and-swap authorized transaction owns same-ID Block facts even when restoring an older snapshot',
);

const missingDurableHistory = structuredClone(afterRejectedFallback);
missingDurableHistory.historyEvents = [];
await saveSnapshot(missingDurableHistory);
const afterHistoryRegression = await getBoardSnapshot({
  projectId: populated.project.projectId,
  boardId: populated.board.boardId,
});
assert.equal(afterHistoryRegression.historyEvents?.[0]?.eventId, historyEvent.eventId);

const browserFallbackWrites: string[] = [];
const originalFetch = globalThis.fetch;
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => null,
    removeItem: () => undefined,
    setItem: (key: string) => browserFallbackWrites.push(key),
  },
});
globalThis.fetch = async () => new Response(
  JSON.stringify({ error: 'Snapshot conflict' }),
  { status: 409, headers: { 'Content-Type': 'application/json' } },
);
await assert.rejects(
  () => saveBoardSnapshot(afterHistoryRegression),
  /Snapshot conflict/,
  'an explicit Local API rejection must be surfaced to the app',
);
assert.deepEqual(
  browserFallbackWrites,
  [],
  'an API conflict must not be reported as a successful browser-storage fallback',
);

globalThis.fetch = async () => {
  throw new TypeError('Local API unavailable');
};
await assert.rejects(
  () => saveBoardSnapshot(afterHistoryRegression),
  /Local API unavailable/,
  'a network failure must remain a visible save failure',
);
await assert.rejects(
  () => loadBoardSnapshot({
    projectId: afterHistoryRegression.project.projectId,
    boardId: afterHistoryRegression.board.boardId,
  }),
  /Local API unavailable/,
  'a network failure must not hydrate a fabricated or browser-only snapshot',
);
assert.deepEqual(
  browserFallbackWrites,
  [],
  'network failures must never write a full BoardSnapshot to localStorage',
);

const staleSelectionRequests: string[] = [];
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => key.endsWith('currentProjectId') ? 'project_missing' : 'board_missing',
    removeItem: () => undefined,
    setItem: (key: string) => browserFallbackWrites.push(key),
  },
});
globalThis.fetch = async (input) => {
  const url = String(input);
  staleSelectionRequests.push(url);
  if (url.includes('?')) {
    return new Response(JSON.stringify({ error: 'Board not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return new Response(JSON.stringify(afterHistoryRegression), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
const recoveredFromStaleSelection = await loadBoardSnapshot();
assert.equal(recoveredFromStaleSelection.board.boardId, afterHistoryRegression.board.boardId);
assert.deepEqual(
  staleSelectionRequests,
  [
    '/api/local/snapshot?projectId=project_missing&boardId=board_missing',
    '/api/local/snapshot',
  ],
  'a stale remembered selection must recover through the authoritative server default',
);
assert.equal(
  browserFallbackWrites.every((key) => key.endsWith('currentProjectId') || key.endsWith('currentBoardId')),
  true,
  'recovery may update selection preferences but must not persist a BoardSnapshot in localStorage',
);
globalThis.fetch = originalFetch;
delete (globalThis as { localStorage?: Storage }).localStorage;

const executionRaceSnapshot = await resetWorkspace();
const raceExecutionId = createId('exec');
const raceBlock = executionRaceSnapshot.blocks.find((block) => block.type === 'operation');
assert(raceBlock);
raceBlock.data.sourceExecutionId = raceExecutionId;
raceBlock.data.status = 'queued';
executionRaceSnapshot.executions = [{
  executionId: raceExecutionId,
  recordVersion: 1,
  projectId: executionRaceSnapshot.project.projectId,
  boardId: executionRaceSnapshot.board.boardId,
  capabilityId: 'image.generate',
  adapter: 'codex_app_server',
  status: 'queued',
  inputBlockIds: [],
  outputBlockIds: [],
  outputAssetIds: [],
  params: { operationBlockId: raceBlock.blockId },
  startedAt: nowIso(),
}];
await saveSnapshot(executionRaceSnapshot);
const staleQueuedSnapshot = structuredClone(executionRaceSnapshot);
const running = await markExecutionRunning({
  projectId: executionRaceSnapshot.project.projectId,
  boardId: executionRaceSnapshot.board.boardId,
  executionId: raceExecutionId,
});
assert.equal(running.execution.status, 'running');
assert.equal(running.execution.recordVersion, 2);

const deferredAsset = await createAssetFromDataUrl({
  dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
  deferSnapshotRegistration: true,
  fileName: 'deferred-host-asset.png',
  projectId: executionRaceSnapshot.project.projectId,
  sourceExecutionId: raceExecutionId,
});
const afterDeferredAssetPersistence = await getBoardSnapshot({
  boardId: executionRaceSnapshot.board.boardId,
  projectId: executionRaceSnapshot.project.projectId,
});
assert.equal(
  afterDeferredAssetPersistence.assets.some(
    (candidate) => candidate.assetId === deferredAsset.assetId,
  ),
  false,
  'Host-owned Asset persistence must defer Board registration to the Host command commit.',
);
assert.equal(
  afterDeferredAssetPersistence.historyEvents?.some(
    (event) => event.assetIds?.includes(deferredAsset.assetId),
  ),
  false,
  'Host-owned Asset persistence must not create a competing legacy history write.',
);

await saveSnapshot(staleQueuedSnapshot);
const promptRecorded = await recordExecutionRequestPrompts({
  projectId: executionRaceSnapshot.project.projectId,
  boardId: executionRaceSnapshot.board.boardId,
  executionId: raceExecutionId,
  requestPrompts: [{ index: 0, prompt: 'Generate a regression-test image.' }],
});
assert.equal(promptRecorded.execution.status, 'running');
assert.equal(promptRecorded.execution.recordVersion, 3);
assert.equal(promptRecorded.execution.requestPrompts?.[0]?.prompt, 'Generate a regression-test image.');
assert.equal(
  promptRecorded.snapshot.blocks.find((block) => block.blockId === raceBlock.blockId)?.data.status,
  'running',
);
assert.equal(
  promptRecorded.snapshot.historyEvents?.some(
    (event) => event.type === 'execution_started' && event.executionId === raceExecutionId,
  ),
  true,
);

const concurrentBlockSnapshot = await resetWorkspace();
const concurrentBlocks = concurrentBlockSnapshot.blocks.slice(0, 2);
assert.equal(concurrentBlocks.length, 2);
await saveSnapshot(concurrentBlockSnapshot);
const completionA = structuredClone(concurrentBlockSnapshot);
const completionB = structuredClone(concurrentBlockSnapshot);
const completionABlock = completionA.blocks.find((block) => block.blockId === concurrentBlocks[0]?.blockId);
const completionBBlock = completionB.blocks.find((block) => block.blockId === concurrentBlocks[1]?.blockId);
assert(completionABlock);
assert(completionBBlock);
completionABlock.data.concurrentResult = 'agent-a';
completionABlock.updatedAt = '2099-01-01T00:00:01.000Z';
completionBBlock.data.concurrentResult = 'agent-b';
completionBBlock.updatedAt = '2099-01-01T00:00:02.000Z';
await saveSnapshot(completionA);
await saveSnapshot(completionB);
const afterConcurrentCompletions = await getBoardSnapshot({
  projectId: concurrentBlockSnapshot.project.projectId,
  boardId: concurrentBlockSnapshot.board.boardId,
});
assert.equal(
  afterConcurrentCompletions.blocks.find((block) => block.blockId === completionABlock.blockId)
    ?.data.concurrentResult,
  'agent-a',
  'a stale second completion must preserve the first Agent result Block',
);
assert.equal(
  afterConcurrentCompletions.blocks.find((block) => block.blockId === completionBBlock.blockId)
    ?.data.concurrentResult,
  'agent-b',
  'the second Agent result Block must also be saved',
);

console.log({
  agentSessionDoesNotLookLikeBootstrap: true,
  apiConflictSurfaced: true,
  authorizedFallbackShapePersisted: true,
  bootstrapOverwriteRejected: true,
  durableHistoryPreserved: true,
  hostAssetPersistenceDefersSnapshotRegistration: true,
  concurrentAgentBlocksPreserved: true,
  pluginOperationModePreserved: true,
  snapshotLoadsAreReadOnly: true,
  staleQueuedExecutionRejected: true,
  staleSelectionRecoveredFromServer: true,
  testWorkspace: process.env.RETAKE_WORKSPACE_DIR,
});
