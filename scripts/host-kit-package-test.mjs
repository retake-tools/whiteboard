import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const packageRoot = new URL('../packages/host-kit/', import.meta.url);
const packageToolchainArtifacts = new URL('../vendor/package-toolchain/0.1.7/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('package.json', packageRoot), 'utf8'));
assert.equal(manifest.name, '@retake-tools/host-kit');
assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(manifest.exports['.'].import, './dist/index.js');
assert.equal(manifest.exports['./plugin'].import, './dist/plugin.js');
assert.equal(manifest.exports['./plugin-react'].import, './dist/plugin-react.js');
assert.equal(manifest.exports['./react'].import, './dist/react.js');
assert.equal(manifest.exports['./styles.css'], './dist/styles.css');
assert.equal(manifest.scripts.prepack, 'npm --prefix ../.. run host-kit:build');

const pack = parsePackJson(execFileSync(
  'npm',
  ['pack', '--dry-run', '--json', '--silent', packageRoot.pathname],
  { encoding: 'utf8' },
));
const files = new Set(pack[0].files.map((file) => file.path));
for (const required of [
  'dist/index.js',
  'dist/plugin.js',
  'dist/plugin-react.js',
  'dist/react.js',
  'dist/styles.css',
  'dist-types/host-kit/index.d.ts',
  'dist-types/host-kit/plugin/index.d.ts',
  'dist-types/host-kit/plugin-react/index.d.ts',
  'dist-types/host-kit/react/index.d.ts',
]) {
  assert(files.has(required), `Packed Host Kit is missing ${required}.`);
}
assert(![...files].some((file) => file.includes('.retake')), 'Packed Host Kit contains Workspace data.');
assert(
  ![...files].some((file) => file.startsWith('dist-types/host-kit/internal/')),
  'Packed Host Kit exposes the internal Whiteboard compatibility bridge.',
);
assert(
  ![...files].some((file) => file.startsWith('dist-types/host-kit/testing/')),
  'Packed Host Kit contains source-only testing declarations.',
);
for (const unexpected of ['dist/styles.js']) {
  assert(!files.has(unexpected), `Packed Host Kit contains unused build output ${unexpected}.`);
}

const headlessBundle = await readFile(new URL('dist/index.js', packageRoot), 'utf8');
const pluginBundle = await readFile(new URL('dist/plugin.js', packageRoot), 'utf8');
const pluginReactBundle = await readFile(new URL('dist/plugin-react.js', packageRoot), 'utf8');
const reactBundle = await readFile(new URL('dist/react.js', packageRoot), 'utf8');
const styles = await readFile(new URL('dist/styles.css', packageRoot), 'utf8');
assert.doesNotMatch(headlessBundle, /from\s+["'](?:react|react\/jsx-runtime|@xyflow\/react)["']/);
assert.doesNotMatch(pluginBundle, /from\s+["'](?:react|react\/jsx-runtime|@xyflow\/react)["']/);
assert.match(pluginReactBundle, /from\s+"react"/);
assert.match(reactBundle, /from\s+"react"/);
assert.match(reactBundle, /from\s+"@xyflow\/react"/);
assert.doesNotMatch(styles, /(^|[},]\s*)(:root|body|html|\*)\s*\{/m);

const installRoot = await mkdtemp(join(tmpdir(), 'retake-host-kit-pack-'));
try {
  const packOutput = execFileSync(
    'npm',
    ['pack', '--json', '--silent', '--pack-destination', installRoot, packageRoot.pathname],
    { encoding: 'utf8' },
  );
  const packed = parsePackJson(packOutput);
  const tarball = join(installRoot, packed[0].filename);
  execFileSync(
    'npm',
    [
      'install',
      '--ignore-scripts',
      '--legacy-peer-deps',
      '--no-package-lock',
      '--prefix',
      installRoot,
      tarball,
      new URL('retake-tools-package-contracts-0.1.7.tgz', packageToolchainArtifacts).pathname,
      new URL('retake-tools-plugin-runtime-0.1.7.tgz', packageToolchainArtifacts).pathname,
    ],
    { encoding: 'utf8' },
  );
  const imported = await import(join(installRoot, 'node_modules/@retake-tools/host-kit/dist/index.js'));
  const importedPlugin = await import(
    join(installRoot, 'node_modules/@retake-tools/host-kit/dist/plugin.js')
  );
  assert.equal(imported.canvasHostApiVersionV1, 1);
  assert.equal(typeof imported.createCanvasHost, 'function');
  assert.equal(typeof importedPlugin.createPluginHostReadStore, 'function');
  assert.equal(typeof importedPlugin.createPluginWebModuleRuntime, 'function');
} finally {
  await rm(installRoot, { force: true, recursive: true });
}

console.log({
  files: files.size,
  hostKitPackage: 'passed',
  headlessBytes: Buffer.byteLength(headlessBundle),
  name: manifest.name,
  version: manifest.version,
});

function parsePackJson(output) {
  const start = output.lastIndexOf('\n[');
  return JSON.parse(output.slice(start >= 0 ? start + 1 : output.indexOf('[')));
}
