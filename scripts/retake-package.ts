#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectDeclarativePackage,
  packDeclarativePackage,
  validateDeclarativePackage,
  type DeclarativePackageInspection,
} from '../server/declarative-package-service';
import { LocalPackageManagerService } from '../server/local-package-manager-service';

const args = process.argv.slice(2);
const json = removeFlag(args, '--json');
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

try {
  if (args.shift() !== 'package') usage();
  const command = args.shift();
  if (command === 'validate') {
    const sourcePath = requiredArgument(args, 'Package directory or archive');
    rejectExtraArguments(args);
    const result = await validateDeclarativePackage(sourcePath);
    print(json, {
      command,
      ok: true,
      ...inspectionOutput(result),
    });
  } else if (command === 'inspect') {
    const sourcePath = requiredArgument(args, 'Package directory or archive');
    rejectExtraArguments(args);
    const result = await inspectDeclarativePackage(sourcePath);
    print(json, {
      command,
      ok: true,
      ...inspectionOutput(result),
      dependencies: result.manifest.dependencies,
      entrypointDefinitions: result.manifest.entrypoints,
      optionalDependencies: result.manifest.optionalDependencies,
      publisher: result.manifest.publisher,
    });
  } else if (command === 'pack') {
    const sourcePath = requiredArgument(args, 'Package directory');
    const outputPath = optionValue(args, '--output');
    if (!outputPath) throw new Error('Package archive output is required: --output <file.retakepkg>.');
    rejectExtraArguments(args);
    const result = await packDeclarativePackage(sourcePath, outputPath);
    print(json, {
      archiveDigest: result.archiveDigest,
      command,
      digest: result.digest,
      files: result.files.length,
      ok: true,
      outputPath: result.outputPath,
      packageId: result.manifest.packageId,
      version: result.manifest.version,
    });
  } else if (command === 'install') {
    const sourcePath = requiredArgument(args, 'Package directory or archive');
    const workspaceRoot = workspaceOption(args);
    const dependencySources = optionValues(args, '--dependency-source');
    rejectExtraArguments(args);
    const manager = await packageManager(workspaceRoot);
    const result = await manager.install(sourcePath, dependencySources);
    printManager(json, {
      changed: result.changed,
      command,
      resolvedPackages: result.lockfile.resolvedPackages,
      revision: result.lockfile.revision,
      root: result.root,
      workspaceRoot: manager.workspaceRoot,
    });
  } else if (command === 'list') {
    const workspaceRoot = workspaceOption(args);
    rejectExtraArguments(args);
    const manager = await packageManager(workspaceRoot);
    const lockfile = await manager.list();
    printManager(json, {
      command,
      installations: lockfile.installations,
      resolvedPackages: lockfile.resolvedPackages,
      revision: lockfile.revision,
      roots: lockfile.roots,
      workspaceRoot: manager.workspaceRoot,
    });
  } else if (command === 'activate') {
    const packageId = requiredArgument(args, 'Package ID');
    const workspaceRoot = workspaceOption(args);
    const version = optionValue(args, '--version');
    const digest = optionValue(args, '--digest');
    rejectExtraArguments(args);
    const manager = await packageManager(workspaceRoot);
    const result = await manager.activate({ digest, packageId, version });
    printManager(json, {
      changed: result.changed,
      command,
      resolvedPackages: result.lockfile.resolvedPackages,
      revision: result.lockfile.revision,
      root: result.root,
      workspaceRoot: manager.workspaceRoot,
    });
  } else if (command === 'rollback') {
    const packageId = requiredArgument(args, 'Package ID');
    const workspaceRoot = workspaceOption(args);
    const target = optionValue(args, '--to');
    rejectExtraArguments(args);
    const manager = await packageManager(workspaceRoot);
    const result = await manager.rollback(packageId, target);
    printManager(json, {
      changed: result.changed,
      command,
      resolvedPackages: result.lockfile.resolvedPackages,
      revision: result.lockfile.revision,
      root: result.root,
      workspaceRoot: manager.workspaceRoot,
    });
  } else if (command === 'remove') {
    const packageId = requiredArgument(args, 'Package ID');
    const workspaceRoot = workspaceOption(args);
    rejectExtraArguments(args);
    const manager = await packageManager(workspaceRoot);
    const lockfile = await manager.remove(packageId);
    printManager(json, {
      command,
      resolvedPackages: lockfile.resolvedPackages,
      revision: lockfile.revision,
      roots: lockfile.roots,
      workspaceRoot: manager.workspaceRoot,
    });
  } else {
    usage();
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (json) {
    process.stderr.write(`${JSON.stringify({ error: message, ok: false })}\n`);
  } else {
    process.stderr.write(`Retake Package error: ${message}\n`);
  }
  process.exitCode = 1;
}

function inspectionOutput(result: DeclarativePackageInspection) {
  return {
    ...(result.archiveDigest ? { archiveDigest: result.archiveDigest } : {}),
    components: result.components,
    dependencies: result.dependencies,
    digest: result.digest,
    entrypoints: result.entrypoints,
    files: result.files,
    name: result.manifest.name,
    optionalDependencies: result.optionalDependencies,
    packageId: result.manifest.packageId,
    permissions: result.manifest.permissions,
    sourceKind: result.sourceKind,
    sourcePath: result.sourcePath,
    version: result.manifest.version,
  };
}

function print(jsonOutput: boolean, value: Record<string, unknown>): void {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(value)}\n`);
    return;
  }
  const componentCounts = value.components as DeclarativePackageInspection['components'] | undefined;
  const lines = [
    `Package: ${String(value.packageId)}@${String(value.version)}`,
    `Status: ${value.ok ? 'valid' : 'invalid'}`,
    value.digest ? `Digest: ${String(value.digest)}` : undefined,
    value.archiveDigest ? `Archive digest: ${String(value.archiveDigest)}` : undefined,
    value.outputPath ? `Archive: ${String(value.outputPath)}` : undefined,
    componentCounts
      ? `Components: ${componentCounts.skills} Skills, ${componentCounts.workflows} Workflows, ${componentCounts.agentPresets} AgentPresets`
      : undefined,
    typeof value.entrypoints === 'number' ? `Entrypoints: ${value.entrypoints}` : undefined,
    Array.isArray(value.files) ? `Files: ${value.files.length}` : undefined,
  ].filter((line): line is string => Boolean(line));
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printManager(jsonOutput: boolean, value: Record<string, unknown>): void {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify({ ok: true, ...value })}\n`);
    return;
  }
  const roots = Array.isArray(value.roots) ? value.roots : undefined;
  const resolved = Array.isArray(value.resolvedPackages) ? value.resolvedPackages : [];
  const root = value.root as { packageId?: string; version?: string } | undefined;
  const lines = [
    `Command: ${String(value.command)}`,
    `Workspace: ${String(value.workspaceRoot)}`,
    typeof value.revision === 'number' ? `Revision: ${value.revision}` : undefined,
    typeof value.changed === 'boolean' ? `Changed: ${value.changed ? 'yes' : 'no'}` : undefined,
    root?.packageId ? `Root: ${root.packageId}@${String(root.version)}` : undefined,
    roots ? `Roots: ${roots.length}` : undefined,
    `Resolved Packages: ${resolved.length}`,
  ].filter((line): line is string => Boolean(line));
  process.stdout.write(`${lines.join('\n')}\n`);
}

function removeFlag(values: string[], flag: string): boolean {
  const index = values.indexOf(flag);
  if (index === -1) return false;
  values.splice(index, 1);
  return true;
}

function optionValue(values: string[], option: string): string | undefined {
  const index = values.indexOf(option);
  if (index === -1) return undefined;
  const value = values[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  values.splice(index, 2);
  return value;
}

function optionValues(values: string[], option: string): string[] {
  const results: string[] = [];
  while (values.includes(option)) {
    const value = optionValue(values, option);
    if (value) results.push(value);
  }
  return results;
}

function workspaceOption(values: string[]): string {
  return optionValue(values, '--workspace')
    ?? process.env.RETAKE_WORKSPACE_DIR
    ?? '.retake';
}

async function packageManager(workspaceRoot: string): Promise<LocalPackageManagerService> {
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'),
  ) as { version?: unknown };
  if (typeof packageJson.version !== 'string') throw new Error('Retake host version is unavailable.');
  return new LocalPackageManagerService({
    hostVersion: packageJson.version,
    workspaceRoot,
  });
}

function requiredArgument(values: string[], label: string): string {
  const value = values.shift();
  if (!value || value.startsWith('--')) throw new Error(`${label} is required.`);
  return value;
}

function rejectExtraArguments(values: string[]): void {
  if (values.length > 0) throw new Error(`Unexpected arguments: ${values.join(' ')}`);
}

function usage(): never {
  throw new Error([
    'Usage:',
    '  retake package validate <directory-or-archive> [--json]',
    '  retake package pack <directory> --output <file.retakepkg> [--json]',
    '  retake package inspect <directory-or-archive> [--json]',
    '  retake package install <directory-or-archive> --workspace <root> [--dependency-source <source>]... [--json]',
    '  retake package list --workspace <root> [--json]',
    '  retake package activate <packageId> --workspace <root> (--version <version> | --digest <digest>) [--json]',
    '  retake package rollback <packageId> --workspace <root> [--to <version-or-digest>] [--json]',
    '  retake package remove <packageId> --workspace <root> [--json]',
  ].join('\n'));
}
