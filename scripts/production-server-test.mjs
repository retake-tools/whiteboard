import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverScript = path.join(repositoryRoot, 'scripts', 'production-server.mjs');
const runtimeDir = await mkdtemp(path.join(tmpdir(), 'retake-production-server-'));
const port = await findAvailablePort();
const url = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  RETAKE_PRODUCTION_PORT: String(port),
  RETAKE_PRODUCTION_RUNTIME_DIR: runtimeDir,
};

try {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  assert.match(packageJson.scripts['codex:install'], /npm run build/);
  assert.match(packageJson.scripts['codex:install'], /production-server\.mjs restart/);

  const startOutput = run('start');
  assert.match(startOutput, new RegExp(`Open ${escapeRegExp(url)}`));
  assert.equal((await fetch(url)).status, 200);
  assert.deepEqual(await (await fetch(`${url}/api/local/health`)).json(), {
    ok: true,
    service: 'retake-whiteboard',
  });

  const duplicateStartOutput = run('start');
  assert.match(duplicateStartOutput, /already running/);

  const statusOutput = run('status');
  assert.match(statusOutput, /is running/);

  const stopOutput = run('stop');
  assert.match(stopOutput, /Stopped Retake Whiteboard/);

  console.log({
    backgroundServerPersists: true,
    codexInstallStartsProduction: true,
    duplicateStartIsIdempotent: true,
    healthEndpointIdentifiesServer: true,
    lifecycleCommandsWork: true,
    testUrl: url,
  });
} finally {
  try {
    run('stop');
  } catch {}
  await rm(runtimeDir, { recursive: true, force: true });
}

function run(command) {
  return execFileSync(process.execPath, [serverScript, command], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env,
  });
}

async function findAvailablePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert(address && typeof address === 'object');
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  return address.port;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
