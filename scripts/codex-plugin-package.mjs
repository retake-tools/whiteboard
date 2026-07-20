import { cp, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const pluginSourceMarker = '.retake-plugin-source.json';

const managedBy = '@retake-tools/whiteboard';
const packagedEntries = [
  '.codex-plugin',
  '.mcp.json',
  'LICENSE',
  'README.md',
  'README.zh-CN.md',
  'skills',
  'scripts/start-mcp.mjs',
];

export async function prepareCodexPluginPackage({ repositoryRoot, pluginRoot }) {
  if (path.resolve(repositoryRoot) === path.resolve(pluginRoot)) {
    throw new Error(
      `The Retake repository checkout cannot also be the managed plugin package at ${pluginRoot}. ` +
        'Keep the checkout elsewhere, such as ~/src/retake-whiteboard.',
    );
  }

  await removeExistingManagedPackage({ repositoryRoot, pluginRoot });
  await mkdir(pluginRoot, { recursive: true });

  for (const relativePath of packagedEntries) {
    const source = path.join(repositoryRoot, relativePath);
    const destination = path.join(pluginRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true });
  }

  await writeFile(
    path.join(pluginRoot, pluginSourceMarker),
    `${JSON.stringify({ managedBy, repositoryRoot }, null, 2)}\n`,
    'utf8',
  );
}

async function removeExistingManagedPackage({ repositoryRoot, pluginRoot }) {
  let stat;
  try {
    stat = await lstat(pluginRoot);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }

  if (stat.isSymbolicLink()) {
    const target = await realpath(pluginRoot);
    if (target !== repositoryRoot) {
      throw new Error(`Cannot replace ${pluginRoot}: it points to ${target}.`);
    }
    await rm(pluginRoot);
    return;
  }

  if (!stat.isDirectory()) {
    throw new Error(`Cannot replace ${pluginRoot}: it is not a managed plugin directory.`);
  }

  let marker;
  try {
    marker = JSON.parse(await readFile(path.join(pluginRoot, pluginSourceMarker), 'utf8'));
  } catch {
    throw new Error(`Cannot replace ${pluginRoot}: the Retake managed-source marker is missing or invalid.`);
  }
  if (marker?.managedBy !== managedBy) {
    throw new Error(`Cannot replace ${pluginRoot}: it is not managed by ${managedBy}.`);
  }

  await rm(pluginRoot, { recursive: true });
}
