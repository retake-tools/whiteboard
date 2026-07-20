import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  adaptViewportToBasis,
  loadBoardViewState,
  removeBoardViewState,
  removeProjectBoardViewStates,
  saveBoardViewState,
  viewportShowsAnyBlock,
} from '../src/core/boardViewStateStore';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { migrateBoardSnapshot } from '../src/core/snapshotMigration';
import type { BoardSnapshot } from '../src/core/types';
import { createBlankSnapshot } from './local-store/snapshot-store';

class MemoryStorage {
  private readonly items = new Map<string, string>();

  get length(): number { return this.items.size; }
  getItem(key: string): string | null { return this.items.get(key) ?? null; }
  key(index: number): string | null { return [...this.items.keys()][index] ?? null; }
  removeItem(key: string): void { this.items.delete(key); }
  setItem(key: string, value: string): void { this.items.set(key, value); }
}

const storage = new MemoryStorage();
const savedAt = '2026-07-20T00:00:00.000Z';
saveBoardViewState({
  schemaVersion: 1,
  projectId: 'project_a',
  boardId: 'board_a',
  viewport: { x: 100, y: 50, zoom: 2 },
  viewportBasis: { canvasWidth: 1000, canvasHeight: 800 },
  updatedAt: savedAt,
}, storage);
saveBoardViewState({
  schemaVersion: 1,
  projectId: 'project_a',
  boardId: 'board_b',
  viewport: { x: 0, y: 0, zoom: 1 },
  viewportBasis: { canvasWidth: 1000, canvasHeight: 800 },
  updatedAt: savedAt,
}, storage);

assert.equal(loadBoardViewState('project_a', 'board_a', storage)?.viewport.zoom, 2);
assert.equal(loadBoardViewState('project_a', 'missing', storage), undefined);
assert.deepEqual(
  adaptViewportToBasis(
    { x: 100, y: 50, zoom: 2 },
    { canvasWidth: 1000, canvasHeight: 800 },
    { canvasWidth: 1600, canvasHeight: 1000 },
  ),
  { x: 400, y: 150, zoom: 2 },
  'resizing the canvas must preserve the saved world-space center',
);
assert.equal(
  adaptViewportToBasis(
    { x: 0, y: 0, zoom: 10 },
    { canvasWidth: 1000, canvasHeight: 800 },
    { canvasWidth: 1000, canvasHeight: 800 },
  ).zoom,
  5,
  'restored zoom must respect the canvas zoom limit',
);

assert.equal(
  viewportShowsAnyBlock({ x: 0, y: 0, zoom: 1 }, { canvasWidth: 800, canvasHeight: 600 }, [defaultSnapshot.blocks[1]]),
  true,
);
assert.equal(
  viewportShowsAnyBlock({ x: -5000, y: -5000, zoom: 1 }, { canvasWidth: 800, canvasHeight: 600 }, defaultSnapshot.blocks),
  false,
  'a saved view that has lost all board content must fall back to fitView',
);

removeBoardViewState('project_a', 'board_a', storage);
assert.equal(loadBoardViewState('project_a', 'board_a', storage), undefined);
assert.ok(loadBoardViewState('project_a', 'board_b', storage));
removeProjectBoardViewStates('project_a', storage);
assert.equal(loadBoardViewState('project_a', 'board_b', storage), undefined);

const legacySnapshot = {
  ...structuredClone(defaultSnapshot),
  viewport: { x: 550, y: 280, zoom: 0.9 },
} as BoardSnapshot & { viewport: { x: number; y: number; zoom: number } };
const migratedSnapshot = migrateBoardSnapshot(legacySnapshot);
assert.equal('viewport' in migratedSnapshot, false, 'legacy viewport must not survive BoardSnapshot migration');
assert.equal('viewport' in defaultSnapshot, false, 'the fallback snapshot must contain board content only');
assert.equal('viewport' in createBlankSnapshot({
  projectId: 'project_blank',
  boardId: 'board_blank',
  projectName: 'Blank project',
  boardName: 'Blank board',
  now: savedAt,
}), false, 'new and duplicated board snapshots must not own view state');

const canvasSource = await readFile('src/app/useCanvasController.ts', 'utf8');
assert.match(canvasSource, /saveBoardViewState\(/, 'canvas viewport changes must use BoardViewStateStore');
assert.doesNotMatch(canvasSource, /updateSnapshot\(\(next\) => \(\{ \.\.\.next, viewport \}\)/, 'viewport must not re-enter snapshot autosave');

console.log({
  boardScopedStorage: true,
  contentFallback: true,
  legacyViewportRemoved: true,
  responsiveCenterRestore: true,
});
