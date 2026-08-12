import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hostKitRoot = path.join(repositoryRoot, 'src', 'host-kit');
const forbiddenRoots = [
  path.join(repositoryRoot, 'server'),
  path.join(repositoryRoot, 'src', 'app'),
  path.join(repositoryRoot, 'src', 'components'),
  path.join(repositoryRoot, 'src', 'nodes'),
  path.join(repositoryRoot, 'src', 'whiteboard'),
];
const forbiddenInternalModules = new Set([
  'boardStore',
  'pluginContributionRegistry',
  'pluginWebModuleLoader',
]);

const files = await sourceFiles(hostKitRoot);
assert(files.length > 0, 'Host Kit boundary has no source files.');

for (const file of files) {
  const source = await readFile(file, 'utf8');
  if (file.includes(`${path.sep}plugin${path.sep}`)) {
    for (const forbidden of [
      '/api/local/',
      'createImageAssetFromDataUrl',
      'loadPluginSettingsState',
      'replacePluginCapabilityDefinitions',
    ]) {
      assert(
        !source.includes(forbidden),
        `${relative(file)}: public Plugin Host code contains product dependency ${forbidden}.`,
      );
    }
  }
  const specifiers = importSpecifiers(source);
  for (const specifier of specifiers) {
    if (file.includes(`${path.sep}contracts${path.sep}`)) {
      assert(
        specifier !== 'react'
          && specifier !== 'react-dom'
          && specifier !== '@xyflow/react',
        `${relative(file)}: Host contracts cannot import ${specifier}.`,
      );
    }
    if (!specifier.startsWith('.')) continue;
    const resolved = path.resolve(path.dirname(file), specifier);
    assert(
      !forbiddenRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`)),
      `${relative(file)}: forbidden Host Kit dependency ${specifier}.`,
    );
    assert(
      !(
        resolved.startsWith(path.join(repositoryRoot, 'src', 'core', path.sep))
        && forbiddenInternalModules.has(path.basename(resolved))
      ),
      `${relative(file)}: mutable implementation ${specifier} is not a Host Kit dependency.`,
    );
  }
}

console.log({ files: files.length, hostKitBoundary: 'passed' });

async function sourceFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(target);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [target] : [];
  }));
  return nested.flat().sort();
}

function importSpecifiers(source) {
  const matches = source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/g);
  return [...matches].map((match) => match[2]);
}

function relative(file) {
  return path.relative(repositoryRoot, file);
}
