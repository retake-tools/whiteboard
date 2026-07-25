import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  configureInstalledRuntimeRegistry,
  currentRuntimeRegistrySnapshot,
  withSnapshotDigest,
  type InstalledRuntimeRegistrySnapshotV1,
} from '../src/core/installedRuntimeRegistry';
import {
  listPackageEntryPoints,
  listPackages,
  resolvePackageEntryPoint,
  storyProductionAgentPackage,
  storyProductionStarterPackage,
} from '../src/core/packageRegistry';
import { listSkills } from '../src/core/skillRegistry';
import { listWorkflows } from '../src/core/workflowRegistry';
import { listAgentPresets } from '../src/core/agentPresetRegistry';
import {
  bootstrapDeclarativePackages,
  defaultBootstrapProfilePath,
  readBootstrapProfile,
  validateBootstrapProfileArchives,
} from './declarative-package-bootstrap-service';
import {
  LocalPackageManagerService,
  workspacePackageLockFile,
} from './local-package-manager-service';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'retake-package-bootstrap-phase-c-'));
const bundledRoot = path.join(repositoryRoot, 'packages', 'bootstrap');

try {
  const publishedProfile = await readBootstrapProfile(defaultBootstrapProfilePath);
  assert.equal(publishedProfile.profileId, 'retake.default-video-production');
  assert.equal(
    publishedProfile.rootPackage.digest,
    'sha256:b5e0ac116b75a8fcdb56f94d6e33fae635d3cd11ec29a5ef669bc2c9aa2841e5',
  );
  assert.equal(
    publishedProfile.dependencyPackages[0]?.digest,
    'sha256:80fbebcebba51315b0bf3d5980fec07ef4f842c64dfa01cfc2426f44ffcc9514',
  );
  await validateBootstrapProfileArchives(defaultBootstrapProfilePath, '0.1.2');

  const bootstrapCopy = await copyBootstrapFixture('valid-bootstrap');
  const workspaceRoot = path.join(temporaryRoot, 'fresh-workspace');
  const sentinelPath = path.join(workspaceRoot, 'projects', 'sentinel.txt');
  await mkdir(path.dirname(sentinelPath), { recursive: true });
  await writeFile(sentinelPath, 'board-data-must-remain\n', 'utf8');

  const first = await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot,
  });
  assert.equal(first.installed, true);
  assert.equal(first.snapshot.lockRevision, 1);
  assert.equal(first.snapshot.packages.length, 2);
  assert.equal(first.snapshot.skills.length, 8);
  assert.equal(first.snapshot.workflows.length, 4);
  assert.equal(first.snapshot.agentPresets.length, 1);
  assert.equal(await readFile(sentinelPath, 'utf8'), 'board-data-must-remain\n');
  assert.match(first.snapshot.snapshotDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(
    first.snapshot.packages.map((manifest) => manifest.packageId),
    [
      storyProductionAgentPackage.packageId,
      storyProductionStarterPackage.packageId,
    ],
  );
  for (const manifest of first.snapshot.packages) {
    assert.equal(manifest.source.kind, 'installed');
    assert.match(manifest.digest, /^sha256:[a-f0-9]{64}$/);
    assert.notEqual(
      manifest.digest,
      manifest.packageId === storyProductionStarterPackage.packageId
        ? storyProductionStarterPackage.digest
        : storyProductionAgentPackage.digest,
    );
  }

  const runtimePackages = listPackages();
  assert.deepEqual(runtimePackages, first.snapshot.packages);
  assert.equal(listSkills().length, 8);
  assert.equal(listWorkflows().length, 4);
  assert.equal(listAgentPresets().length, 1);
  assert.equal(listPackageEntryPoints().length, 13);
  const resolved = resolvePackageEntryPoint({
    entrypointId: 'workflow:retake.workflow.story-to-storyboard',
  });
  assert.equal(resolved.status, 'resolved');
  if (resolved.status === 'resolved') {
    assert.equal(resolved.target.packageLock.digest, publishedProfile.rootPackage.digest);
  }

  const lockPath = path.join(workspaceRoot, 'packages', workspacePackageLockFile);
  const lockBeforeSecondBootstrap = await readFile(lockPath);
  const second = await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot,
  });
  assert.equal(second.installed, false);
  assert.equal(second.snapshot.lockRevision, 1);
  assert.deepEqual(await readFile(lockPath), lockBeforeSecondBootstrap);

  const missingBundlePath = path.join(temporaryRoot, 'bundle-is-not-needed.json');
  const cachedOnly = await bootstrapDeclarativePackages({
    activateRuntime: false,
    hostVersion: '0.1.2',
    profilePath: missingBundlePath,
    workspaceRoot,
  });
  assert.equal(cachedOnly.installed, false);
  assert.equal(cachedOnly.snapshot.snapshotDigest, first.snapshot.snapshotDigest);

  const emptyWorkspace = path.join(temporaryRoot, 'empty-lock-workspace');
  await bootstrapDeclarativePackages({
    activateRuntime: false,
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: emptyWorkspace,
  });
  const emptyManager = manager(emptyWorkspace);
  const emptyLock = await emptyManager.remove(storyProductionStarterPackage.packageId);
  assert.equal(emptyLock.roots.length, 0);
  const emptyBootstrap = await bootstrapDeclarativePackages({
    activateRuntime: false,
    hostVersion: '0.1.2',
    profilePath: missingBundlePath,
    workspaceRoot: emptyWorkspace,
  });
  assert.equal(emptyBootstrap.installed, false);
  assert.equal(emptyBootstrap.snapshot.packages.length, 0);
  assert.equal((await emptyManager.list()).revision, 2);

  await verifyProfileFailure('profile-digest-tamper', (profile) => {
    profile.rootPackage.digest = `sha256:${'0'.repeat(64)}`;
  }, /does not match its profile lock/);
  await verifyProfileFailure('profile-host-tamper', (profile) => {
    profile.hostCompatibility = '>=2.0.0';
  }, /incompatible/);
  await verifyProfileFailure('profile-path-tamper', (profile) => {
    profile.rootPackage.archivePath = '../escape.retakepkg';
  }, /portable filename/);

  const symlinkArchiveRoot = await copyBootstrapFixture('archive-symlink');
  const symlinkArchiveProfile = await readBootstrapProfile(
    path.join(symlinkArchiveRoot, 'retake.bootstrap.json'),
  );
  const symlinkArchivePath = path.join(
    symlinkArchiveRoot,
    symlinkArchiveProfile.rootPackage.archivePath,
  );
  const symlinkTargetName = `real-${symlinkArchiveProfile.rootPackage.archivePath}`;
  await rename(symlinkArchivePath, path.join(symlinkArchiveRoot, symlinkTargetName));
  await symlink(symlinkTargetName, symlinkArchivePath);
  await assert.rejects(
    bootstrapDeclarativePackages({
      activateRuntime: false,
      hostVersion: '0.1.2',
      profilePath: path.join(symlinkArchiveRoot, 'retake.bootstrap.json'),
      workspaceRoot: path.join(temporaryRoot, 'archive-symlink-workspace'),
    }),
    /must be a regular file/,
  );

  const archiveTamperRoot = await copyBootstrapFixture('archive-tamper');
  const archiveProfile = await readBootstrapProfile(
    path.join(archiveTamperRoot, 'retake.bootstrap.json'),
  );
  const archivePath = path.join(archiveTamperRoot, archiveProfile.rootPackage.archivePath);
  const archiveBytes = Buffer.from(await readFile(archivePath));
  archiveBytes[Math.floor(archiveBytes.byteLength / 2)]! ^= 0xff;
  await writeFile(archivePath, archiveBytes);
  await assert.rejects(
    bootstrapDeclarativePackages({
      activateRuntime: false,
      hostVersion: '0.1.2',
      profilePath: path.join(archiveTamperRoot, 'retake.bootstrap.json'),
      workspaceRoot: path.join(temporaryRoot, 'archive-tamper-workspace'),
    }),
    /invalid|checksum|integrity|canonical/i,
  );

  const cacheTamperWorkspace = path.join(temporaryRoot, 'cache-tamper-workspace');
  const cacheTamper = await bootstrapDeclarativePackages({
    activateRuntime: false,
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: cacheTamperWorkspace,
  });
  const cacheLockPath = path.join(
    cacheTamperWorkspace,
    'packages',
    workspacePackageLockFile,
  );
  const cacheLockBefore = await readFile(cacheLockPath);
  const rootDigest = cacheTamper.snapshot.packages.find(
    (manifest) => manifest.packageId === storyProductionStarterPackage.packageId,
  )!.digest;
  const cacheArchivePath = path.join(
    cacheTamperWorkspace,
    'packages',
    'cache',
    'sha256',
    `${rootDigest.slice('sha256:'.length)}.retakepkg`,
  );
  const cacheBytes = Buffer.from(await readFile(cacheArchivePath));
  cacheBytes[Math.floor(cacheBytes.byteLength / 2)]! ^= 0xff;
  await writeFile(cacheArchivePath, cacheBytes);
  await assert.rejects(
    bootstrapDeclarativePackages({
      activateRuntime: false,
      hostVersion: '0.1.2',
      profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
      workspaceRoot: cacheTamperWorkspace,
    }),
    /invalid|checksum|integrity|canonical/i,
  );
  assert.deepEqual(await readFile(cacheLockPath), cacheLockBefore);

  configureInstalledRuntimeRegistry(first.snapshot);
  const registryBeforeTamper = currentRuntimeRegistrySnapshot(
    first.snapshot.profileId,
    first.snapshot.lockRevision,
  );
  const payloadTamper = structuredClone(first.snapshot);
  payloadTamper.skills[0]!.description = 'Tampered after the Server snapshot was created.';
  await assert.rejects(
    async () => configureInstalledRuntimeRegistry(payloadTamper),
    /snapshot digest mismatch/,
  );
  assert.deepEqual(
    currentRuntimeRegistrySnapshot(first.snapshot.profileId, first.snapshot.lockRevision),
    registryBeforeTamper,
  );

  const lockTamper = structuredClone(first.snapshot);
  lockTamper.skills[0]!.version = '9.9.9';
  const { snapshotDigest: _ignoredDigest, ...lockTamperPayload } = lockTamper;
  const internallyConsistentTamper = withSnapshotDigest(lockTamperPayload);
  await assert.rejects(
    async () => configureInstalledRuntimeRegistry(internallyConsistentTamper),
    /Skill lock mismatch/,
  );
  assert.deepEqual(
    currentRuntimeRegistrySnapshot(first.snapshot.profileId, first.snapshot.lockRevision),
    registryBeforeTamper,
  );

  const [mainSource, apiSource] = await Promise.all([
    readFile(path.join(repositoryRoot, 'src', 'main.tsx'), 'utf8'),
    readFile(path.join(repositoryRoot, 'server', 'vite-local-api.ts'), 'utf8'),
  ]);
  assert.ok(
    mainSource.indexOf('bootstrapInstalledRuntimeRegistry()')
      < mainSource.indexOf('root.render('),
  );
  assert.match(mainSource, /Retake Package bootstrap failed/);
  assert.match(apiSource, /await ensurePackageBootstrap\(\)/);
  assert.ok(
    apiSource.indexOf("url.pathname === '/health'")
      < apiSource.indexOf('await ensurePackageBootstrap()'),
  );

  console.log(JSON.stringify({
    ok: true,
    appMountBlockedUntilBootstrap: true,
    boardDataUnaffected: true,
    bundledArchivesExact: true,
    cacheOnlyOfflineActivation: true,
    emptyLockPreserved: true,
    firstBootstrapResolvedPackages: first.snapshot.packages.length,
    firstBootstrapRootPackage: storyProductionStarterPackage.packageId,
    installedRuntimeRegistry: {
      agentPresets: first.snapshot.agentPresets.length,
      entrypoints: listPackageEntryPoints().length,
      skills: first.snapshot.skills.length,
      workflows: first.snapshot.workflows.length,
    },
    noAutomaticUpdate: true,
    profileAndArchiveTamperRejected: true,
    registryActivationRollback: true,
    runtimeUsesExactPackageDigest: true,
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

async function copyBootstrapFixture(name: string): Promise<string> {
  const output = path.join(temporaryRoot, name);
  await cp(bundledRoot, output, { recursive: true });
  return output;
}

async function verifyProfileFailure(
  name: string,
  mutate: (profile: {
    hostCompatibility: string;
    rootPackage: { archivePath: string; digest: string };
  }) => void,
  expected: RegExp,
): Promise<void> {
  const fixtureRoot = await copyBootstrapFixture(name);
  const profilePath = path.join(fixtureRoot, 'retake.bootstrap.json');
  const profile = JSON.parse(await readFile(profilePath, 'utf8')) as {
    hostCompatibility: string;
    rootPackage: { archivePath: string; digest: string };
  };
  mutate(profile);
  await writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`, 'utf8');
  const workspaceRoot = path.join(temporaryRoot, `${name}-workspace`);
  const failureManager = manager(workspaceRoot);
  await assert.rejects(
    bootstrapDeclarativePackages({
      activateRuntime: false,
      hostVersion: '0.1.2',
      profilePath,
      workspaceRoot,
    }),
    expected,
  );
  assert.equal(await failureManager.hasLockfile(), false);
}
