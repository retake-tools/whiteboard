import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const appSource = await readFile('src/App.tsx', 'utf8');

assert.match(
  appSource,
  /const initialSnapshotLoadedRef = useRef\(false\)/,
  'the fallback board must remain read-only until the persisted snapshot loads',
);
assert.match(
  appSource,
  /initialSnapshotLoadedRef\.current = true;[\s\S]*?snapshotRef\.current = loadedSnapshot/,
  'hydration must be marked complete before the loaded snapshot becomes interactive',
);
assert.match(
  appSource,
  /async function persistSnapshot[\s\S]*?if \(!initialSnapshotLoadedRef\.current\) return;/,
  'viewport and canvas callbacks must not persist the fallback snapshot during hydration',
);

console.log({ fallbackPersistenceBlocked: true, hydrationGateInstalled: true });
