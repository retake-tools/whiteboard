#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const packageJson = JSON.parse(
  await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
) as { version?: unknown };
if (typeof packageJson.version !== 'string') {
  throw new Error('Retake host version is unavailable.');
}

const args = process.argv.slice(2);
const command = args[0] === 'package' ? args[1] : undefined;
if (
  command === 'activate'
  || command === 'install'
  || command === 'list'
  || command === 'remove'
  || command === 'rollback'
) {
  if (!args.includes('--workspace')) {
    args.push('--workspace', process.env.RETAKE_WORKSPACE_DIR ?? '.retake');
  }
  if (!args.includes('--host-version')) {
    args.push('--host-version', packageJson.version);
  }
}
process.argv = [process.argv[0]!, process.argv[1]!, ...args];
await import('@retake-tools/package-cli/dist/cli.js');
