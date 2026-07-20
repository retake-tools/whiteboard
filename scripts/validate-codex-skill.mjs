import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
const validatorPath = path.join(codexHome, 'skills', '.system', 'skill-creator', 'scripts', 'quick_validate.py');
const skillPath = path.join(repositoryRoot, 'skills', 'retake-whiteboard-codex');

if (!existsSync(validatorPath)) {
  console.error(`Codex skill validator was not found at ${validatorPath}.`);
  console.error('Install Codex system skills or set CODEX_HOME to the active Codex data directory.');
  process.exit(1);
}

const result = spawnSync(process.env.PYTHON || 'python3', [validatorPath, skillPath], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
