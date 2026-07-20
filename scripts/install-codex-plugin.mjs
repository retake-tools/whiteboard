import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCodexPluginPackage } from './codex-plugin-package.mjs';

const pluginName = 'retake-whiteboard';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marketplaceRoot = path.join(homedir(), '.agents');
const marketplacePath = path.join(marketplaceRoot, 'plugins', 'marketplace.json');
const pluginSourceRoot = path.join(homedir(), 'plugins', pluginName);

await prepareCodexPluginPackage({ repositoryRoot, pluginRoot: pluginSourceRoot });
const marketplaceName = await registerPersonalMarketplaceEntry();

execFileSync('codex', ['plugin', 'add', `${pluginName}@${marketplaceName}`], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});

console.log(`Installed ${pluginName}@${marketplaceName}. Start a new Codex task to load its Skill and MCP tools.`);

async function registerPersonalMarketplaceEntry() {
  await mkdir(path.dirname(marketplacePath), { recursive: true });

  let marketplace;
  try {
    marketplace = JSON.parse(await readFile(marketplacePath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Cannot parse existing Codex marketplace file: ${marketplacePath}`);
    }
    if (error instanceof Error && 'code' in error && error.code !== 'ENOENT') throw error;
    marketplace = {
      name: 'personal',
      interface: { displayName: 'Personal' },
      plugins: [],
    };
  }

  if (typeof marketplace.name !== 'string' || !marketplace.name || !Array.isArray(marketplace.plugins)) {
    throw new Error(`Invalid Codex marketplace structure: ${marketplacePath}`);
  }

  const entry = {
    name: pluginName,
    source: { source: 'local', path: `./plugins/${pluginName}` },
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Productivity',
  };
  const existingIndex = marketplace.plugins.findIndex((plugin) => plugin?.name === pluginName);
  if (existingIndex >= 0) marketplace.plugins[existingIndex] = entry;
  else marketplace.plugins.push(entry);

  await writeFile(marketplacePath, `${JSON.stringify(marketplace, null, 2)}\n`, 'utf8');
  return marketplace.name;
}
