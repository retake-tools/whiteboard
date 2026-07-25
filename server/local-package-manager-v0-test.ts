import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { DeclarativePackageManifest } from '../src/core/declarativePackageContracts';
import {
  storyProductionAgentPackage,
  storyProductionStarterPackage,
} from '../src/core/packageRegistry';
import { packDeclarativePackage } from './declarative-package-service';
import {
  LocalPackageManagerService,
  workspacePackageLockFile,
} from './local-package-manager-service';
import {
  comparePackageVersions,
  packageVersionSatisfies,
} from './package-semver';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const starterRoot = path.join(repositoryRoot, 'packages', 'builtin', 'story-production-starter');
const agentRoot = path.join(repositoryRoot, 'packages', 'builtin', 'story-production-agent');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'retake-local-package-manager-v0-'));

try {
  verifySemVer();

  const starterArchive = path.join(temporaryRoot, 'starter.retakepkg');
  const agentArchive = path.join(temporaryRoot, 'agent.retakepkg');
  await packDeclarativePackage(starterRoot, starterArchive);
  await packDeclarativePackage(agentRoot, agentArchive);

  const starterWorkspace = path.join(temporaryRoot, 'starter-workspace');
  const starterManager = manager(starterWorkspace);
  const installedStarter = await starterManager.install(starterArchive, [agentArchive]);
  assert.equal(installedStarter.changed, true);
  assert.equal(installedStarter.lockfile.roots.length, 1);
  assert.deepEqual(
    installedStarter.lockfile.resolvedPackages.map((entry) => entry.packageId),
    [
      storyProductionAgentPackage.packageId,
      storyProductionStarterPackage.packageId,
    ],
  );
  assert.equal(installedStarter.root.dependencies.length, 1);
  assert.equal(installedStarter.root.dependencies[0]!.optional, false);
  assert.equal(installedStarter.lockfile.installations.length, 2);

  const idempotentStarter = await starterManager.install(starterRoot, [agentRoot]);
  assert.equal(idempotentStarter.changed, false);
  assert.equal(idempotentStarter.lockfile.revision, 1);
  assert.equal(idempotentStarter.lockfile.installations.length, 2);

  const registry = await starterManager.loadRegistry();
  assert.equal(registry.skills.size, 8);
  assert.equal(registry.workflows.size, 4);
  assert.equal(registry.agentPresets.size, 1);
  assert.deepEqual(
    registry.entrypoints.map((entry) => entry.entrypoint.entrypointId).sort(),
    [
      ...storyProductionStarterPackage.entrypoints,
      ...storyProductionAgentPackage.entrypoints,
    ].map((entrypoint) => entrypoint.entrypointId).sort(),
  );
  assert.deepEqual(
    registry.entrypoints
      .filter((entry) => entry.packageLock.packageId === storyProductionStarterPackage.packageId)
      .map((entry) => entry.entrypoint),
    [...storyProductionStarterPackage.entrypoints].sort((left, right) => (
      left.entrypointId.localeCompare(right.entrypointId)
    )),
  );
  await assert.rejects(
    starterManager.remove(storyProductionAgentPackage.packageId),
    /transitive dependency/,
  );
  const removedStarter = await starterManager.remove(storyProductionStarterPackage.packageId);
  assert.equal(removedStarter.roots.length, 0);
  assert.equal(removedStarter.resolvedPackages.length, 0);
  assert.equal(removedStarter.installations.length, 2);
  assert.equal((await starterManager.loadRegistry()).entrypoints.length, 0);

  const versionWorkspace = path.join(temporaryRoot, 'version-workspace');
  const versionOne = await createEmptyPackage('test.package.versioned', '1.0.0');
  const versionTwo = await createEmptyPackage('test.package.versioned', '1.1.0');
  const versionManager = manager(versionWorkspace);
  const installedOne = await versionManager.install(versionOne);
  const installedTwo = await versionManager.install(versionTwo);
  assert.equal(installedTwo.root.version, '1.1.0');
  assert.equal(installedTwo.lockfile.installations.length, 2);
  const activatedOne = await versionManager.activate({
    packageId: 'test.package.versioned',
    version: '1.0.0',
  });
  assert.equal(activatedOne.root.version, '1.0.0');
  const activatedTwo = await versionManager.rollback('test.package.versioned', '1.1.0');
  assert.equal(activatedTwo.root.version, '1.1.0');
  const defaultRollback = await versionManager.rollback('test.package.versioned');
  assert.equal(defaultRollback.root.version, '1.0.0');
  assert.equal(defaultRollback.lockfile.revision, installedOne.lockfile.revision + 4);

  const dependencyWorkspace = path.join(temporaryRoot, 'dependency-workspace');
  const dependencyOne = await createEmptyPackage('test.package.dependency', '1.0.0');
  const dependencyTwo = await createEmptyPackage('test.package.dependency', '1.2.0');
  const dependencyRoot = await createEmptyPackage('test.package.dependency-root', '1.0.0', {
    dependencies: [{ packageId: 'test.package.dependency', range: '^1.0.0' }],
  });
  const dependencyManager = manager(dependencyWorkspace);
  const dependencyResolution = await dependencyManager.install(
    dependencyRoot,
    [dependencyOne, dependencyTwo],
  );
  assert.equal(
    dependencyResolution.lockfile.resolvedPackages.find(
      (entry) => entry.packageId === 'test.package.dependency',
    )?.version,
    '1.2.0',
  );

  const optionalWorkspace = path.join(temporaryRoot, 'optional-workspace');
  const optionalRoot = await createEmptyPackage('test.package.optional-root', '1.0.0', {
    optionalDependencies: [{ packageId: 'test.package.not-present', range: '^1.0.0' }],
  });
  const optionalResult = await manager(optionalWorkspace).install(optionalRoot);
  assert.equal(optionalResult.root.dependencies.length, 0);

  const optionalConflictWorkspace = path.join(temporaryRoot, 'optional-conflict-workspace');
  const optionalOne = await createEmptyPackage('test.package.optional-shared', '1.0.0');
  const requiredTwo = await createEmptyPackage('test.package.optional-shared', '2.0.0');
  const optionalConsumer = await createEmptyPackage('test.package.optional-consumer', '1.0.0', {
    optionalDependencies: [{ packageId: 'test.package.optional-shared', range: '^1.0.0' }],
  });
  const requiredConsumer = await createEmptyPackage('test.package.required-consumer', '1.0.0', {
    dependencies: [{ packageId: 'test.package.optional-shared', range: '^2.0.0' }],
  });
  const optionalConflictManager = manager(optionalConflictWorkspace);
  await optionalConflictManager.install(optionalConsumer, [optionalOne]);
  const optionalConflictResult = await optionalConflictManager.install(requiredConsumer, [requiredTwo]);
  assert.equal(
    optionalConflictResult.lockfile.resolvedPackages.find(
      (entry) => entry.packageId === 'test.package.optional-shared',
    )?.version,
    '2.0.0',
  );
  assert.equal(
    optionalConflictResult.lockfile.resolvedPackages.find(
      (entry) => entry.packageId === 'test.package.optional-consumer',
    )?.dependencies.length,
    0,
  );

  const failureWorkspace = path.join(temporaryRoot, 'failure-workspace');
  const stableRoot = await createEmptyPackage('test.package.atomic-root', '1.0.0');
  const brokenUpdate = await createEmptyPackage('test.package.atomic-root', '1.1.0', {
    dependencies: [{ packageId: 'test.package.missing', range: '^1.0.0' }],
  });
  const failureManager = manager(failureWorkspace);
  await failureManager.install(stableRoot);
  const lockPath = path.join(failureWorkspace, 'packages', workspacePackageLockFile);
  const lockBeforeFailure = await readFile(lockPath);
  await assert.rejects(
    failureManager.install(brokenUpdate),
    /no compatible single-version resolution/,
  );
  assert.deepEqual(await readFile(lockPath), lockBeforeFailure);

  const hostIncompatible = await createEmptyPackage('test.package.host-incompatible', '1.0.0', {
    hostCompatibility: '>=2.0.0',
  });
  await assert.rejects(
    failureManager.install(hostIncompatible),
    /no compatible single-version resolution/,
  );
  assert.deepEqual(await readFile(lockPath), lockBeforeFailure);

  const cycleA = await createEmptyPackage('test.package.cycle-a', '1.0.0', {
    dependencies: [{ packageId: 'test.package.cycle-b', range: '1.0.0' }],
  });
  const cycleB = await createEmptyPackage('test.package.cycle-b', '1.0.0', {
    dependencies: [{ packageId: 'test.package.cycle-a', range: '1.0.0' }],
  });
  await assert.rejects(
    manager(path.join(temporaryRoot, 'cycle-workspace')).install(cycleA, [cycleB]),
    /dependency graph has a cycle/,
  );

  const conflictA = await createEmptyPackage('test.package.conflict', '1.0.0', {
    description: 'First immutable publication.',
  });
  const conflictB = await createEmptyPackage('test.package.conflict', '1.0.0', {
    description: 'Conflicting immutable publication.',
  });
  const conflictRoot = await createEmptyPackage('test.package.conflict-root', '1.0.0', {
    dependencies: [{ packageId: 'test.package.conflict', range: '1.0.0' }],
  });
  await assert.rejects(
    manager(path.join(temporaryRoot, 'conflict-workspace')).install(
      conflictRoot,
      [conflictA, conflictB],
    ),
    /Immutable Package version conflict/,
  );

  const lockBusyWorkspace = path.join(temporaryRoot, 'busy-workspace');
  const lockBusyManager = manager(lockBusyWorkspace);
  await mkdir(path.join(lockBusyWorkspace, 'packages'), { recursive: true });
  await writeFile(path.join(lockBusyWorkspace, 'packages', 'manager.lock'), 'occupied\n');
  await assert.rejects(
    lockBusyManager.install(versionOne),
    /transaction is already active/,
  );

  const tamperWorkspace = path.join(temporaryRoot, 'tamper-workspace');
  const tamperManager = manager(tamperWorkspace);
  const tamperInstall = await tamperManager.install(versionOne);
  const contentHex = tamperInstall.root.digest.slice('sha256:'.length);
  const cachePath = path.join(
    tamperWorkspace,
    'packages',
    'cache',
    'sha256',
    `${contentHex}.retakepkg`,
  );
  const archive = Buffer.from(await readFile(cachePath));
  archive[Math.floor(archive.byteLength / 2)]! ^= 0xff;
  await writeFile(cachePath, archive);
  await assert.rejects(tamperManager.loadRegistry(), /invalid|checksum|integrity|canonical/i);

  const lockTamperWorkspace = path.join(temporaryRoot, 'lock-tamper-workspace');
  const lockTamperManager = manager(lockTamperWorkspace);
  await lockTamperManager.install(versionOne);
  const lockTamperPath = path.join(lockTamperWorkspace, 'packages', workspacePackageLockFile);
  const lockValue = JSON.parse(await readFile(lockTamperPath, 'utf8')) as Record<string, unknown>;
  lockValue.unsupported = true;
  await writeJson(lockTamperPath, lockValue);
  await assert.rejects(lockTamperManager.list(), /unsupported or missing fields/);

  const cliWorkspace = path.join(temporaryRoot, 'cli-workspace');
  const cliInstall = runCli([
    'package',
    'install',
    starterArchive,
    '--dependency-source',
    agentArchive,
    '--workspace',
    cliWorkspace,
    '--json',
  ]);
  assert.equal(cliInstall.status, 0, cliInstall.stderr);
  assert.equal(JSON.parse(cliInstall.stdout).resolvedPackages.length, 2);
  const cliList = runCli(['package', 'list', '--workspace', cliWorkspace, '--json']);
  assert.equal(cliList.status, 0, cliList.stderr);
  assert.equal(JSON.parse(cliList.stdout).roots.length, 1);
  const cliRemove = runCli([
    'package',
    'remove',
    storyProductionStarterPackage.packageId,
    '--workspace',
    cliWorkspace,
    '--json',
  ]);
  assert.equal(cliRemove.status, 0, cliRemove.stderr);
  assert.equal(JSON.parse(cliRemove.stdout).resolvedPackages.length, 0);

  const implementationSource = (
    await Promise.all([
      'server/local-package-manager-service.ts',
      'server/local-package-dependency-resolver.ts',
      'server/workspace-package-lock.ts',
      'scripts/retake-package.ts',
    ].map((relativePath) => readFile(path.join(repositoryRoot, relativePath), 'utf8')))
  ).join('\n');
  assert.equal(implementationSource.includes('snapshot-store'), false);
  assert.equal(implementationSource.includes('workspace-store'), false);
  assert.equal(implementationSource.includes('fetch('), false);
  assert.equal(implementationSource.includes('http://'), false);
  assert.equal(implementationSource.includes('https://'), false);
  assert.equal(implementationSource.includes('postinstall'), false);
  assert.equal(implementationSource.includes('preinstall'), false);

  console.log(JSON.stringify({
    ok: true,
    atomicFailurePreservesLockfile: true,
    cacheAndLockTamperRejected: true,
    cliLifecycle: true,
    contentAddressedCache: true,
    dependencyCycleRejected: true,
    directoryAndArchiveInstall: true,
    dynamicRegistry: {
      agentPresets: 1,
      skills: 8,
      workflows: 4,
    },
    hostCompatibility: true,
    immutableVersionConflict: true,
    installActivateRollbackRemove: true,
    networkAndBoardIndependent: true,
    semverDependencyClosure: true,
  }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function manager(workspaceRoot: string): LocalPackageManagerService {
  return new LocalPackageManagerService({
    hostVersion: '0.1.2',
    workspaceRoot,
  });
}

async function createEmptyPackage(
  packageId: string,
  version: string,
  options: {
    dependencies?: DeclarativePackageManifest['dependencies'];
    description?: string;
    hostCompatibility?: string;
    optionalDependencies?: DeclarativePackageManifest['optionalDependencies'];
  } = {},
): Promise<string> {
  const slug = `${packageId}-${version}-${Math.random().toString(36).slice(2)}`;
  const root = path.join(temporaryRoot, slug);
  await mkdir(root, { recursive: true });
  const manifest: DeclarativePackageManifest = {
    components: {
      agentPresets: [],
      skills: [],
      workflows: [],
    },
    dependencies: options.dependencies ?? [],
    description: options.description ?? `${packageId} fixture.`,
    entrypoints: [],
    files: ['README.md'],
    integrity: 'sha256:auto',
    license: 'MIT',
    name: packageId,
    optionalDependencies: options.optionalDependencies ?? [],
    packageId,
    permissions: [],
    publisher: {
      name: 'Retake Test',
      publisherId: 'test.publisher',
    },
    retakeHostCompatibility: options.hostCompatibility ?? '^0.1.0',
    schemaVersion: 1,
    signature: null,
    version,
  };
  await writeJson(path.join(root, 'retake.package.json'), manifest);
  await writeFile(path.join(root, 'README.md'), `${manifest.description}\n`, 'utf8');
  return root;
}

function verifySemVer(): void {
  assert.equal(comparePackageVersions('1.2.0', '1.1.9') > 0, true);
  assert.equal(comparePackageVersions('1.0.0-beta.2', '1.0.0-beta.11') < 0, true);
  assert.equal(comparePackageVersions('1.0.0', '1.0.0-rc.1') > 0, true);
  assert.equal(packageVersionSatisfies('1.9.0', '^1.2.3'), true);
  assert.equal(packageVersionSatisfies('2.0.0', '^1.2.3'), false);
  assert.equal(packageVersionSatisfies('0.3.9', '^0.3.0'), true);
  assert.equal(packageVersionSatisfies('0.4.0', '^0.3.0'), false);
  assert.equal(packageVersionSatisfies('1.2.9', '~1.2.3'), true);
  assert.equal(packageVersionSatisfies('1.3.0', '~1.2.3'), false);
  assert.equal(packageVersionSatisfies('1.5.0', '>=1.2.3 <2.0.0'), true);
}

function runCli(arguments_: string[]) {
  return spawnSync(
    process.execPath,
    [path.join(repositoryRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'scripts/retake-package.ts', ...arguments_],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  );
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
