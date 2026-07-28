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
import type {
  DeclarativePackageManifest,
} from '@retake-tools/package-contracts';
import {
  configureInstalledRuntimeRegistry,
} from '../src/core/installedRuntimeRegistry';
import {
  listPackageEntryPoints,
  listPackages,
  resolvePackageEntryPoint,
} from '../src/core/packageRegistry';
import {
  listSkills,
  resolvedSkillUiDefinitionFor,
} from '../src/core/skillRegistry';
import {
  listWorkflows,
  resolvedWorkflowUiDefinitionFor,
} from '../src/core/workflowRegistry';
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
import {
  OfficialPackagePreferenceStore,
  officialPackagePreferenceFile,
} from './official-package-preference-store';
import { PluginRuntimeService } from './plugin-runtime-service';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), 'retake-default-studios-v2-'),
);
const bundledRoot = path.join(repositoryRoot, 'packages', 'bootstrap');
const imagePackageId = 'design.retake.image-studio';
const imagePluginModuleId = 'design.retake.image-studio.web';
const videoPackageId = 'design.retake.video-studio';
const videoPluginModuleId = 'design.retake.video-studio.web';

try {
  assert.equal(listPackages().length, 0);
  assert.equal(listSkills().length, 0);
  assert.equal(listWorkflows().length, 0);
  assert.equal(listAgentPresets().length, 0);

  const publishedProfile = await readBootstrapProfile(
    defaultBootstrapProfilePath,
  );
  assert.equal(publishedProfile.schemaVersion, 2);
  assert.equal(publishedProfile.profileId, 'retake.default-studios');
  assert.deepEqual(
    publishedProfile.packages.map((entry) => entry.packageId),
    [imagePackageId, videoPackageId],
  );
  assert.deepEqual(
    publishedProfile.packages.map((entry) => entry.version),
    ['0.10.1', '0.1.2'],
  );
  await validateBootstrapProfileArchives(
    defaultBootstrapProfilePath,
    '0.1.2',
  );

  const bootstrapCopy = await copyBootstrapFixture('valid-bootstrap');
  const workspaceRoot = path.join(temporaryRoot, 'fresh-workspace');
  const sentinelPath = path.join(
    workspaceRoot,
    'projects',
    'sentinel.txt',
  );
  await mkdir(path.dirname(sentinelPath), { recursive: true });
  await writeFile(sentinelPath, 'board-data-must-remain\n', 'utf8');

  const first = await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot,
  });
  assert.equal(first.installed, true);
  assert.equal(first.snapshot.lockRevision, 2);
  assert.equal(first.snapshot.packages.length, 2);
  assert.equal(first.snapshot.skills.length, 9);
  assert.equal(first.snapshot.workflows.length, 5);
  assert.equal(first.snapshot.agentPresets.length, 2);
  assert.equal(await readFile(sentinelPath, 'utf8'), 'board-data-must-remain\n');
  assert.deepEqual(
    first.snapshot.packages.map((manifest) => manifest.packageId),
    [imagePackageId, videoPackageId],
  );
  assert.deepEqual(
    first.pluginRuntime.modules.map((record) => ({
      grant: record.grant?.permissions ?? null,
      pluginModuleId: record.pluginModuleId,
      status: record.status,
      trustChannel: record.trust?.trustChannel ?? null,
    })),
    [
      {
        grant: [
          'retake.asset.create',
          'retake.asset.read.bound',
          'retake.block.read.bound',
          'retake.draft.write.bound',
          'retake.execution.manage.self',
        ],
        pluginModuleId: imagePluginModuleId,
        status: 'enabled',
        trustChannel: 'official',
      },
      {
        grant: [],
        pluginModuleId: videoPluginModuleId,
        status: 'enabled',
        trustChannel: 'official',
      },
    ],
  );

  configureInstalledRuntimeRegistry(first.snapshot);
  assert.equal(listPackages().length, 2);
  assert.equal(listSkills().length, 9);
  assert.equal(listWorkflows().length, 5);
  assert.equal(listAgentPresets().length, 2);
  assert.equal(listPackageEntryPoints().length, 15);
  assert.equal(
    resolvedSkillUiDefinitionFor('retake.screenplay.from-brief', 'zh-CN').name,
    '生成剧本',
  );
  const resolved = resolvePackageEntryPoint({
    entrypointId: 'workflow:retake.workflow.story-to-storyboard',
  });
  assert.equal(resolved.status, 'resolved');
  if (resolved.status === 'resolved') {
    assert.equal(resolved.target.packageLock.packageId, videoPackageId);
  }

  const lockPath = path.join(
    workspaceRoot,
    'packages',
    workspacePackageLockFile,
  );
  const lockBeforeSecondBootstrap = await readFile(lockPath);
  const second = await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot,
  });
  assert.equal(second.installed, false);
  assert.equal(second.snapshot.lockRevision, 2);
  assert.deepEqual(await readFile(lockPath), lockBeforeSecondBootstrap);

  const bundledUpgradeRoot = await copyBootstrapFixture('bundled-upgrade');
  const bundledUpgradeProfilePath = path.join(
    bundledUpgradeRoot,
    'retake.bootstrap.json',
  );
  const previousProfilePath = path.join(
    bundledUpgradeRoot,
    'retake.bootstrap.previous.json',
  );
  const previousProfile = JSON.parse(
    await readFile(bundledUpgradeProfilePath, 'utf8'),
  ) as typeof publishedProfile;
  const previousImage = previousProfile.packages.find(
    (entry) => entry.packageId === imagePackageId,
  )!;
  Object.assign(previousImage, {
    archiveDigest:
      'sha256:5937e39f255adbc626ee82297331c0ee2f17e32e2b18588448d50f9c856c0d90',
    archivePath: 'image-studio-0.10.0.retakepkg',
    digest:
      'sha256:be7f4be6ac007cfeab583e7eb4d7201040a20ca6f52ed4c4a41c8d8ba38566f8',
    version: '0.10.0',
  });
  const previousVideo = previousProfile.packages.find(
    (entry) => entry.packageId === videoPackageId,
  )!;
  Object.assign(previousVideo, {
    archiveDigest:
      'sha256:4dd5c40ce2bd9644d883a2c8695667896d368ff0a1966d043d7cc5e6801d67e5',
    archivePath: 'video-studio-0.1.1.retakepkg',
    digest:
      'sha256:50ceb7fd23fa8000b753fabd8662b8df3f49ca261fdd11c42ab3393cab636de7',
    version: '0.1.1',
  });
  await writeFile(
    previousProfilePath,
    `${JSON.stringify(previousProfile, null, 2)}\n`,
    'utf8',
  );
  const upgradeWorkspace = path.join(
    temporaryRoot,
    'bundled-upgrade-workspace',
  );
  const previousBootstrap = await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: previousProfilePath,
    workspaceRoot: upgradeWorkspace,
  });
  assert.equal(
    previousBootstrap.snapshot.packages.find(
      (entry) => entry.packageId === imagePackageId,
    )?.version,
    '0.10.0',
  );
  assert.equal(
    previousBootstrap.snapshot.packages.find(
      (entry) => entry.packageId === videoPackageId,
    )?.version,
    '0.1.1',
  );
  await new PluginRuntimeService({
    hostVersion: '0.1.2',
    workspaceRoot: upgradeWorkspace,
  }).manageModule(videoPluginModuleId, 'disable');
  const upgradedBootstrap = await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: bundledUpgradeProfilePath,
    workspaceRoot: upgradeWorkspace,
  });
  assert.equal(
    upgradedBootstrap.snapshot.packages.find(
      (entry) => entry.packageId === imagePackageId,
    )?.version,
    '0.10.1',
  );
  assert.equal(
    upgradedBootstrap.snapshot.packages.find(
      (entry) => entry.packageId === videoPackageId,
    )?.version,
    '0.1.2',
  );
  assert.equal(upgradedBootstrap.installed, true);
  const upgradedVideoModule = upgradedBootstrap.pluginRuntime.modules.find(
    (entry) => entry.pluginModuleId === videoPluginModuleId,
  );
  assert.equal(upgradedVideoModule?.desiredState, 'disabled');
  assert.equal(upgradedVideoModule?.status, 'disabled');

  const pinnedWorkspace = path.join(temporaryRoot, 'version-pinned-workspace');
  await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: pinnedWorkspace,
  });
  const pinnedSourceRoot = path.join(temporaryRoot, 'image-studio-pinned-source');
  await createPinnedPackageSource(pinnedSourceRoot, '0.9.9');
  const pinnedManager = manager(pinnedWorkspace);
  await pinnedManager.install(pinnedSourceRoot);
  const pinnedLockPath = path.join(
    pinnedWorkspace,
    'packages',
    workspacePackageLockFile,
  );
  const pinnedLockBeforeBootstrap = await readFile(pinnedLockPath);
  const pinnedBeforeBootstrap = await pinnedManager.list();
  const pinnedImageBeforeBootstrap = pinnedBeforeBootstrap.resolvedPackages.find(
    (entry) => entry.packageId === imagePackageId,
  );
  assert.equal(pinnedImageBeforeBootstrap?.version, '0.9.9');

  const afterPinnedBootstrap = await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: pinnedWorkspace,
  });
  const pinnedImageAfterBootstrap =
    afterPinnedBootstrap.snapshot.packages.find(
      (entry) => entry.packageId === imagePackageId,
    );
  const pinnedAfterBootstrap = await pinnedManager.list();
  const pinnedLockImageAfterBootstrap =
    pinnedAfterBootstrap.resolvedPackages.find(
      (entry) => entry.packageId === imagePackageId,
    );
  assert.equal(afterPinnedBootstrap.installed, false);
  assert.equal(pinnedImageAfterBootstrap?.version, '0.9.9');
  assert.equal(
    pinnedImageAfterBootstrap?.digest,
    pinnedImageBeforeBootstrap?.digest,
  );
  assert.equal(
    pinnedLockImageAfterBootstrap?.installationId,
    pinnedImageBeforeBootstrap?.installationId,
  );
  assert.deepEqual(
    await readFile(pinnedLockPath),
    pinnedLockBeforeBootstrap,
  );

  const partialGrantWorkspace = path.join(
    temporaryRoot,
    'partial-grant-workspace',
  );
  await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: partialGrantWorkspace,
  });
  await new PluginRuntimeService({
    hostVersion: '0.1.2',
    workspaceRoot: partialGrantWorkspace,
  }).setPermissions(imagePluginModuleId, ['retake.asset.read.bound']);
  const partialGrantBootstrap = await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: partialGrantWorkspace,
  });
  const partialImage = partialGrantBootstrap.pluginRuntime.modules.find(
    (entry) => entry.pluginModuleId === imagePluginModuleId,
  );
  assert.equal(partialImage?.status, 'enabled');
  assert.deepEqual(
    partialImage?.grant?.permissions,
    ['retake.asset.read.bound'],
  );
  const partialPreferences = await new OfficialPackagePreferenceStore(
    manager(partialGrantWorkspace).packagesRoot,
  ).read();
  assert.deepEqual(partialPreferences.permissionOverrides, [{
    permissions: ['retake.asset.read.bound'],
    pluginModuleId: imagePluginModuleId,
  }]);

  const runtime = new PluginRuntimeService({
    hostVersion: '0.1.2',
    workspaceRoot,
  });
  await runtime.manageModule(imagePluginModuleId, 'revoke');
  await runtime.manageModule(videoPluginModuleId, 'disable');
  const afterOverrides = await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot,
  });
  const imageAfterRevoke = afterOverrides.pluginRuntime.modules.find(
    (entry) => entry.pluginModuleId === imagePluginModuleId,
  );
  const videoAfterDisable = afterOverrides.pluginRuntime.modules.find(
    (entry) => entry.pluginModuleId === videoPluginModuleId,
  );
  assert.equal(imageAfterRevoke?.grant, null);
  assert.notEqual(imageAfterRevoke?.status, 'enabled');
  assert.equal(videoAfterDisable?.desiredState, 'disabled');
  assert.equal(videoAfterDisable?.status, 'disabled');

  const preferences = new OfficialPackagePreferenceStore(
    path.join(workspaceRoot, 'packages'),
  );
  const preferenceState = await preferences.read();
  assert.deepEqual(
    preferenceState.revokedGrantPluginModuleIds,
    [imagePluginModuleId],
  );
  assert.deepEqual(
    preferenceState.disabledPluginModuleIds,
    [videoPluginModuleId],
  );
  assert.equal(
    path.basename(preferences.statePath),
    officialPackagePreferenceFile,
  );

  const removedWorkspace = path.join(temporaryRoot, 'removed-workspace');
  await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: removedWorkspace,
  });
  const removedManager = manager(removedWorkspace);
  await removedManager.remove(imagePackageId);
  await new OfficialPackagePreferenceStore(
    removedManager.packagesRoot,
  ).setPackageRemoved(imagePackageId, true);
  const removedBootstrap = await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: removedWorkspace,
  });
  assert.equal(
    removedBootstrap.snapshot.packages.some(
      (entry) => entry.packageId === imagePackageId,
    ),
    false,
  );

  const safeWorkspace = path.join(temporaryRoot, 'safe-mode-workspace');
  const safeBootstrap = await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    pluginSafeMode: true,
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: safeWorkspace,
  });
  assert.equal(safeBootstrap.pluginRuntime.safeMode, true);
  assert.equal(
    safeBootstrap.pluginRuntime.modules.every(
      (entry) => entry.status === 'disabled',
    ),
    true,
  );

  const missingBundlePath = path.join(
    temporaryRoot,
    'bundle-is-not-needed.json',
  );
  const cachedOnly = await bootstrapDeclarativePackages({
    activateRuntime: false,
    hostVersion: '0.1.2',
    profilePath: missingBundlePath,
    workspaceRoot,
  });
  assert.equal(cachedOnly.installed, false);
  assert.equal(cachedOnly.snapshot.snapshotDigest, first.snapshot.snapshotDigest);

  await verifyProfileFailure('profile-digest-tamper', (profile) => {
    profile.packages[0]!.digest = `sha256:${'0'.repeat(64)}`;
  }, /does not match its profile lock/);
  await verifyProfileFailure('profile-host-tamper', (profile) => {
    profile.hostCompatibility = '>=2.0.0';
  }, /incompatible/);
  await verifyProfileFailure('profile-path-tamper', (profile) => {
    profile.packages[0]!.archivePath = '../escape.retakepkg';
  }, /portable filename/);
  await verifyProfileFailure('profile-permission-tamper', (profile) => {
    profile.packages[0]!.pluginModules[0]!.permissions = [];
  }, /allowlist does not match archive/);

  const symlinkArchiveRoot = await copyBootstrapFixture('archive-symlink');
  const symlinkProfile = await readBootstrapProfile(
    path.join(symlinkArchiveRoot, 'retake.bootstrap.json'),
  );
  const symlinkReference = symlinkProfile.packages[0]!;
  const symlinkArchivePath = path.join(
    symlinkArchiveRoot,
    symlinkReference.archivePath,
  );
  const symlinkTargetName = `real-${symlinkReference.archivePath}`;
  await rename(
    symlinkArchivePath,
    path.join(symlinkArchiveRoot, symlinkTargetName),
  );
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
  const archivePath = path.join(
    archiveTamperRoot,
    archiveProfile.packages[0]!.archivePath,
  );
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

  console.log(JSON.stringify({
    bundledDefaultUpgradePersistsOverrides: true,
    cachedStartupWithoutBundle: true,
    freshOfficialDefaults: true,
    officialTrustAndGrant: true,
    partialPermissionOverridePersists: true,
    permissionOverridePersists: true,
    removalOverridePersists: true,
    safeModeWins: true,
    versionPinPersists: true,
    schemaVersion: 2,
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

async function createPinnedPackageSource(
  outputRoot: string,
  version: string,
): Promise<void> {
  const manifest: DeclarativePackageManifest = {
    components: {
      agentPresets: [],
      pluginModules: [],
      skills: [],
      workflows: [],
    },
    dependencies: [],
    description: 'Pinned Image Studio fixture.',
    entrypoints: [],
    files: ['README.md'],
    integrity: 'sha256:auto',
    license: 'MIT',
    name: 'Pinned Image Studio',
    optionalDependencies: [],
    packageId: imagePackageId,
    permissions: [],
    publisher: {
      name: 'Retake Test',
      publisherId: 'test.publisher',
    },
    retakeHostCompatibility: '^0.1.0',
    schemaVersion: 1,
    signature: null,
    version,
  };
  await mkdir(outputRoot, { recursive: true });
  await writeFile(
    path.join(outputRoot, 'retake.package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(outputRoot, 'README.md'),
    `${manifest.description}\n`,
    'utf8',
  );
}

interface MutableProfile {
  hostCompatibility: string;
  packages: Array<{
    archivePath: string;
    digest: string;
    pluginModules: Array<{
      permissions: string[];
    }>;
  }>;
}

async function verifyProfileFailure(
  name: string,
  mutate: (profile: MutableProfile) => void,
  expected: RegExp,
): Promise<void> {
  const fixtureRoot = await copyBootstrapFixture(name);
  const profilePath = path.join(fixtureRoot, 'retake.bootstrap.json');
  const profile = JSON.parse(
    await readFile(profilePath, 'utf8'),
  ) as MutableProfile;
  mutate(profile);
  await writeFile(
    profilePath,
    `${JSON.stringify(profile, null, 2)}\n`,
    'utf8',
  );
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
