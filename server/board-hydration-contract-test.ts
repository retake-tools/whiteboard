import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile('src/App.tsx', 'utf8');
const boardSessionSource = await readFile('src/app/useBoardSession.ts', 'utf8');
const boardStoreSource = await readFile('src/core/boardStore.ts', 'utf8');
const canvasSource = await readFile('src/app/useCanvasController.ts', 'utf8');

assert.match(
  boardSessionSource,
  /useState<BoardLoadState>\(\{ status: 'loading' \}\)/,
  'the board session must begin in an explicit loading state',
);
assert.doesNotMatch(
  boardSessionSource,
  /createFallbackBoardSnapshot|defaultSnapshot/,
  'the interactive board session must not hydrate from a fabricated snapshot',
);
assert.match(
  boardSessionSource,
  /loadBoardSnapshot\(\)[\s\S]*?status: 'ready'[\s\S]*?\.catch\([\s\S]*?status: 'error'/,
  'initial hydration must expose separate ready and error states',
);
assert.match(
  appSource,
  /boardSession\.status === 'loading'[\s\S]*?<WorkspaceLoadState status="loading"/,
  'the canvas must not mount while the authoritative snapshot is loading',
);
assert.match(
  appSource,
  /boardSession\.status === 'error'[\s\S]*?<WorkspaceLoadState[\s\S]*?onRetry=\{boardSession\.retryLoad\}/,
  'load failures must present an explicit retryable error state',
);
assert.doesNotMatch(
  boardStoreSource,
  /retake\.whiteboard\.spike\.boardSnapshot|browser-storage|Browser-only fallback/,
  'full BoardSnapshots must never fall back to localStorage',
);
assert.match(
  boardSessionSource,
  /hasUnsavedChangesRef\.current[\s\S]*?isPaused: \(\) => pendingPersistCountRef\.current > 0 \|\| hasUnsavedChangesRef\.current/,
  'failed saves must pause remote polling before it can replace unsaved in-memory changes',
);
assert.match(
  boardSessionSource,
  /async function retrySave\(\)[\s\S]*?persistSnapshot\(requireCurrentSnapshot\(\)\)/,
  'the user must be able to retry the authoritative save without making another edit',
);
assert.match(
  canvasSource,
  /useEffect\(\(\) => \{\s*restoreBoardViewport\(snapshotRef\.current\);\s*\}, \[\]\)/,
  'the canvas must restore the first authoritative board after the ready-only canvas mounts',
);

console.log({
  authoritativeSnapshotRequired: true,
  browserSnapshotFallbackRemoved: true,
  explicitLoadStates: true,
  fabricatedHydrationRemoved: true,
  failedSavePreservedForRetry: true,
});
