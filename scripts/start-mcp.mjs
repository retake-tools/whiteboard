import { access, readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pluginName = 'retake-whiteboard';
const stagedPluginPath = path.join(homedir(), 'plugins', pluginName);
const installedPluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let repositoryRoot;
try {
  const marker = JSON.parse(await readFile(path.join(installedPluginRoot, '.retake-plugin-source.json'), 'utf8'));
  repositoryRoot = await realpath(marker.repositoryRoot);
  await access(path.join(repositoryRoot, 'server', 'mcp-server.ts'));
  await access(path.join(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'));
} catch {
  console.error(
    `Retake Whiteboard source is not registered for ${stagedPluginPath}. ` +
      'Run npm install and npm run codex:install from the Retake Whiteboard checkout.',
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [path.join(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), path.join(repositoryRoot, 'server', 'mcp-server.ts')],
  {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'inherit',
  },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  console.error(`Failed to start Retake Whiteboard MCP: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
