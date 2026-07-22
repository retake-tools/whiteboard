import assert from 'node:assert/strict';
import { createId, nowIso } from '../src/core/id';
import { loadBoardSnapshot, saveBoardSnapshot } from '../src/core/boardStore';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { migrateBoardSnapshot } from '../src/core/snapshotMigration';
import type { AssetRecord, BoardHistoryEvent, ExecutionRecord } from '../src/core/types';
import {
  getBoardSnapshot,
  resetWorkspace,
  saveSnapshot,
  SnapshotWriteConflictError,
} from './local-store';

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

console.log({
  apiConflictSurfaced: true,
  bootstrapOverwriteRejected: true,
  durableHistoryPreserved: true,
  staleSelectionRecoveredFromServer: true,
  testWorkspace: process.env.RETAKE_WORKSPACE_DIR,
});
