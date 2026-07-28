import assert from 'node:assert/strict';
import {
  mkdtemp,
  stat,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  PluginProfileStore,
  pluginProfileStateFile,
} from './plugin-profile-store';

const packagesRoot = await mkdtemp(
  path.join(tmpdir(), 'retake-plugin-foundation-pf5-'),
);
assert.notEqual(path.resolve(packagesRoot), path.resolve('.retake'));
const store = new PluginProfileStore(packagesRoot);
assert.deepEqual(await store.read(), {
  entries: [],
  revision: 0,
  schemaVersion: 1,
});

await store.update({
  boardId: null,
  pluginModuleId: 'retake.plugin.profile-fixture',
  projectId: 'project.fixture',
  scope: 'project',
  state: 'enabled',
});
const boardState = await store.update({
  boardId: 'board.fixture',
  pluginModuleId: 'retake.plugin.profile-fixture',
  projectId: 'project.fixture',
  scope: 'board',
  state: 'disabled',
});
assert.equal(boardState.revision, 2);
assert.deepEqual(
  boardState.entries.map((entry) => entry.scope),
  ['board', 'project'],
);

const inherited = await store.update({
  boardId: 'board.fixture',
  pluginModuleId: 'retake.plugin.profile-fixture',
  projectId: 'project.fixture',
  scope: 'board',
  state: 'inherit',
});
assert.equal(inherited.revision, 3);
assert.deepEqual(
  inherited.entries.map((entry) => entry.scope),
  ['project'],
);
assert.deepEqual(
  await new PluginProfileStore(packagesRoot).read(),
  inherited,
);
assert.equal(
  (await stat(path.join(packagesRoot, pluginProfileStateFile))).mode & 0o777,
  0o600,
);
await assert.rejects(
  store.update({
    boardId: null,
    pluginModuleId: 'retake.plugin.profile-fixture',
    projectId: 'project.fixture',
    scope: 'board',
    state: 'enabled',
  }),
  /override entry is invalid/,
);

process.stdout.write(`${JSON.stringify({
  inheritDeletesOverride: true,
  profilePersistedSeparately: true,
  profileRestartRecovery: true,
  profileWritesAreAtomicAndPrivate: true,
  workspaceWrites: 'disposable-only',
})}\n`);
