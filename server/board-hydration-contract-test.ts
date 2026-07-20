import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const boardSessionSource = await readFile('src/app/useBoardSession.ts', 'utf8');

assert.match(
  boardSessionSource,
  /const initialSnapshotLoadedRef = useRef\(false\)/,
  'the fallback board must remain read-only until the persisted snapshot loads',
);
assert.match(
  boardSessionSource,
  /initialSnapshotLoadedRef\.current = true;[\s\S]*?snapshotRef\.current = loadedSnapshot/,
  'hydration must be marked complete before the loaded snapshot becomes interactive',
);
assert.match(
  boardSessionSource,
  /async function persistSnapshot[\s\S]*?if \(!initialSnapshotLoadedRef\.current\) return;/,
  'canvas callbacks must not persist the fallback snapshot during hydration',
);

console.log({ fallbackPersistenceBlocked: true, hydrationGateInstalled: true });
