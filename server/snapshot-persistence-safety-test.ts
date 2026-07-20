import assert from 'node:assert/strict';
import { createId, nowIso } from '../src/core/id';
import { createFallbackBoardSnapshot, saveBoardSnapshot } from '../src/core/boardStore';
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

const fallback = createFallbackBoardSnapshot();
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
globalThis.fetch = originalFetch;
delete (globalThis as { localStorage?: Storage }).localStorage;

console.log({
  apiConflictSurfaced: true,
  bootstrapOverwriteRejected: true,
  durableHistoryPreserved: true,
  testWorkspace: process.env.RETAKE_WORKSPACE_DIR,
});
