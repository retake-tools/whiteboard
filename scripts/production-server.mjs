import { spawn } from 'node:child_process';
import { access, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.RETAKE_PRODUCTION_HOST ?? '127.0.0.1';
const port = parsePort(process.env.RETAKE_PRODUCTION_PORT ?? '18771');
const runtimeDir = path.resolve(
  process.env.RETAKE_PRODUCTION_RUNTIME_DIR ?? path.join(repositoryRoot, '.local', 'production-server'),
);
const statePath = path.join(runtimeDir, 'server.json');
const logPath = path.join(runtimeDir, 'server.log');
const url = `http://${host}:${port}`;
const command = process.argv[2] ?? 'start';

if (command === 'start') await startServer();
else if (command === 'restart') {
  await stopServer({ quietWhenStopped: true });
  await startServer();
} else if (command === 'stop') await stopServer({ quietWhenStopped: false });
else if (command === 'status') await reportStatus();
else throw new Error(`Unknown production server command: ${command}`);

async function startServer() {
  const existing = await readState();
  if (existing && isProcessAlive(existing.pid)) {
    if (await isServerAvailable()) {
      console.log(`Retake Whiteboard is already running at ${url}`);
      console.log(`Open ${url} in your browser.`);
      return;
    }
    throw new Error(
      `Retake Whiteboard process ${existing.pid} is running but ${url} is unavailable. ` +
        `Inspect ${logPath} or run npm run production:stop before retrying.`,
    );
  }

  if (existing) await rm(statePath, { force: true });
  if (await isServerAvailable()) {
    throw new Error(
      `${url} is already in use by a process not managed by Retake Whiteboard. ` +
        'Stop that process or choose another RETAKE_PRODUCTION_PORT.',
    );
  }

  const viteCli = path.join(repositoryRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  await access(path.join(repositoryRoot, 'dist', 'index.html'));
  await access(viteCli);
  await mkdir(runtimeDir, { recursive: true });

  const logFile = await open(logPath, 'a');
  const child = spawn(
    process.execPath,
    [viteCli, 'preview', '--host', host, '--port', String(port), '--strictPort'],
    {
      cwd: repositoryRoot,
      detached: true,
      env: process.env,
      stdio: ['ignore', logFile.fd, logFile.fd],
    },
  );
  child.unref();
  await logFile.close();

  await writeFile(
    statePath,
    `${JSON.stringify({ pid: child.pid, host, port, repositoryRoot, startedAt: new Date().toISOString() }, null, 2)}\n`,
    'utf8',
  );

  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (await isServerAvailable()) {
      console.log(`Retake Whiteboard production server started in the background.`);
      console.log(`Open ${url} in your browser.`);
      console.log(`Log: ${logPath}`);
      return;
    }
    if (!isProcessAlive(child.pid)) break;
    await delay(200);
  }

  await rm(statePath, { force: true });
  throw new Error(`Retake Whiteboard did not become available at ${url}. Inspect ${logPath}.`);
}

async function stopServer({ quietWhenStopped }) {
  const existing = await readState();
  if (!existing || !isProcessAlive(existing.pid)) {
    if (existing) await rm(statePath, { force: true });
    if (!quietWhenStopped) console.log('Retake Whiteboard production server is not running.');
    return;
  }

  process.kill(existing.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 25 && isProcessAlive(existing.pid); attempt += 1) {
    await delay(100);
  }
  if (isProcessAlive(existing.pid)) {
    throw new Error(`Retake Whiteboard process ${existing.pid} did not stop. Inspect ${logPath}.`);
  }

  await rm(statePath, { force: true });
  console.log(`Stopped Retake Whiteboard production server at ${url}.`);
}

async function reportStatus() {
  const existing = await readState();
  if (existing && isProcessAlive(existing.pid) && (await isServerAvailable())) {
    console.log(`Retake Whiteboard is running at ${url} (PID ${existing.pid}).`);
    return;
  }
  if (existing && !isProcessAlive(existing.pid)) await rm(statePath, { force: true });
  console.error(`Retake Whiteboard is not available at ${url}.`);
  process.exitCode = 1;
}

async function readState() {
  try {
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    return Number.isInteger(state.pid) && state.pid > 0 ? state : undefined;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw new Error(`Cannot read production server state at ${statePath}.`, { cause: error });
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && 'code' in error && error.code === 'EPERM';
  }
}

async function isServerAvailable() {
  try {
    const response = await fetch(`${url}/api/local/health`, { signal: AbortSignal.timeout(500) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true && body?.service === 'retake-whiteboard';
  } catch {
    return false;
  }
}

function parsePort(rawPort) {
  const parsed = Number(rawPort);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid RETAKE_PRODUCTION_PORT: ${rawPort}`);
  }
  return parsed;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
