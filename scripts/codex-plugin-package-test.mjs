import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginSourceMarker, prepareCodexPluginPackage } from './codex-plugin-package.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'retake-codex-plugin-'));
const pluginRoot = path.join(temporaryRoot, 'retake-whiteboard');

try {
  await prepareCodexPluginPackage({ repositoryRoot, pluginRoot });
  await prepareCodexPluginPackage({ repositoryRoot, pluginRoot });

  const entries = (await readdir(pluginRoot)).sort();
  assert.deepEqual(entries, [
    '.codex-plugin',
    '.mcp.json',
    pluginSourceMarker,
    'LICENSE',
    'README.md',
    'scripts',
    'skills',
  ].sort());

  const marker = JSON.parse(await readFile(path.join(pluginRoot, pluginSourceMarker), 'utf8'));
  assert.equal(marker.repositoryRoot, repositoryRoot);
  assert.equal(marker.managedBy, '@retake-tools/whiteboard');

  console.log({ entries, excludesWorkspaceData: true, managedReinstall: true, repositoryRoot });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
