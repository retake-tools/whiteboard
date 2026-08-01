import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginSourceMarker, prepareCodexPluginPackage } from './codex-plugin-package.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'retake-codex-plugin-'));
const pluginRoot = path.join(temporaryRoot, 'retake-whiteboard');
const collisionRoot = path.join(temporaryRoot, 'checkout-collision');

try {
  await assert.rejects(
    prepareCodexPluginPackage({ repositoryRoot: collisionRoot, pluginRoot: collisionRoot }),
    /repository checkout cannot also be the managed plugin package/,
  );
  await prepareCodexPluginPackage({ repositoryRoot, pluginRoot });
  await prepareCodexPluginPackage({ repositoryRoot, pluginRoot });

  const entries = (await readdir(pluginRoot)).sort();
  assert.deepEqual(entries, [
    '.codex-plugin',
    '.mcp.json',
    pluginSourceMarker,
    'LICENSE',
    'NOTICE',
    'README.md',
    'README.zh-CN.md',
    'assets',
    'scripts',
    'skills',
  ].sort());

  const marker = JSON.parse(await readFile(path.join(pluginRoot, pluginSourceMarker), 'utf8'));
  const packageManifest = JSON.parse(await readFile(
    path.join(repositoryRoot, 'package.json'),
    'utf8',
  ));
  const pluginManifest = JSON.parse(await readFile(
    path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
    'utf8',
  ));
  assert.equal(marker.repositoryRoot, repositoryRoot);
  assert.equal(marker.managedBy, '@retake-tools/whiteboard');
  assert.equal(
    pluginManifest.version,
    packageManifest.version,
    'The packaged Codex Plugin version must match the Whiteboard release.',
  );

  console.log({
    checkoutCollisionRejected: true,
    entries,
    excludesWorkspaceData: true,
    managedReinstall: true,
    releaseVersion: pluginManifest.version,
    repositoryRoot,
  });
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
