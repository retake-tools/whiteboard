#!/usr/bin/env node
import {
  inspectDeclarativePackage,
  packDeclarativePackage,
  validateDeclarativePackage,
  type DeclarativePackageInspection,
} from '../server/declarative-package-service';

const args = process.argv.slice(2);
const json = removeFlag(args, '--json');

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
  ].join('\n'));
}
