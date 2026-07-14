import { execFileSync } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pluginName = 'retake-whiteboard';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marketplaceRoot = path.join(homedir(), '.agents');
const marketplacePath = path.join(marketplaceRoot, 'plugins', 'marketplace.json');
const pluginLink = path.join(homedir(), 'plugins', pluginName);

await ensurePluginLink();
const marketplaceName = await registerPersonalMarketplaceEntry();

execFileSync('codex', ['plugin', 'add', `${pluginName}@${marketplaceName}`], {
  cwd: repositoryRoot,
  stdio: 'inherit',
});

console.log(`Installed ${pluginName}@${marketplaceName}. Start a new Codex task to load its Skill and MCP tools.`);

async function ensurePluginLink() {
  await mkdir(path.dirname(pluginLink), { recursive: true });

  try {
    const stat = await lstat(pluginLink);
    if (!stat.isSymbolicLink()) {
      throw new Error(`Cannot register ${pluginName}: ${pluginLink} already exists and is not a symbolic link.`);
    }
    const existingTarget = await realpath(pluginLink);
    if (existingTarget !== repositoryRoot) {
      throw new Error(`Cannot register ${pluginName}: ${pluginLink} points to ${existingTarget}.`);
    }
    return;
  } catch (error) {
    if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
  }

  await symlink(repositoryRoot, pluginLink, process.platform === 'win32' ? 'junction' : 'dir');
}

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
