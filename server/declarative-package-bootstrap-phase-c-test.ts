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
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
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
  projectOfficialPluginRuntimeDefaults,
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
  assert.equal(publishedProfile.schemaVersion, 3);
  assert.equal(publishedProfile.profileId, 'retake.default-studios');
  assert.deepEqual(
    publishedProfile.packages.map((entry) => entry.packageId),
    [imagePackageId],
  );
  assert.deepEqual(
    publishedProfile.packages.map((entry) => entry.version),
    ['0.11.0'],
  );
  assert.deepEqual(
    publishedProfile.packages.map((entry) => entry.updateSource),
    [
      'github:retake-tools/image-studio@main#subdirectory=plugin',
    ],
  );
  await validateBootstrapProfileArchives(
    defaultBootstrapProfilePath,
    '0.1.3',
  );

  const bootstrapCopy = await copyBootstrapFixture('valid-bootstrap');
  const legacyProfilePath = path.join(bootstrapCopy, 'retake.bootstrap.json');
  const legacyProfile = await readBootstrapProfile(legacyProfilePath);
  legacyProfile.packages.push({
    archiveDigest: 'sha256:a9972f561f1e19cda253302ee9a77afd0a6b5acbe542b4950ca8786762823120',
    archivePath: 'video-studio-0.1.2.retakepkg',
    digest: 'sha256:1a377bd022b27ae5bbd029c286ac5785b60977ef51709948f15c552cdfdd8b1e',
    packageId: videoPackageId,
    pluginModules: [{ permissions: [], pluginModuleId: videoPluginModuleId }],
    updateSource: 'github:retake-tools/video-studio@main#subdirectory=package',
    version: '0.1.2',
  });
  await writeFile(legacyProfilePath, `${JSON.stringify(legacyProfile, null, 2)}\n`, 'utf8');
  const workspaceRoot = path.join(temporaryRoot, 'fresh-workspace');
  const sentinelPath = path.join(
    workspaceRoot,
    'projects',
    'sentinel.txt',
  );
  await mkdir(path.dirname(sentinelPath), { recursive: true });
  await writeFile(sentinelPath, 'board-data-must-remain\n', 'utf8');

  const first = await bootstrapDeclarativePackages({
    hostVersion: '0.1.3',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot,
  });
  assert.equal(first.installed, true);
  assert.equal(first.snapshot.lockRevision, 2);
  assert.equal(first.snapshot.packages.length, 2);
  assert.equal(first.snapshot.skills.length, 9);
  assert.equal(first.snapshot.workflows.length, 5);
  assert.equal(first.snapshot.agentPresets.length, 2);
  assert.equal(
    first.snapshot.capabilities.some(
      (definition) => definition.capabilityId === 'image.guided_edit',
    ),
    false,
  );
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
  assert.equal(
    capabilityDefinitionFor('image.generate').definitionHash,
    'sha256:retake-image-generate-v1',
  );
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
    hostVersion: '0.1.3',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot,
  });
  assert.equal(second.installed, false);
  assert.equal(second.snapshot.lockRevision, 2);
  assert.deepEqual(await readFile(lockPath), lockBeforeSecondBootstrap);

  const pinnedWorkspace = path.join(temporaryRoot, 'version-pinned-workspace');
  await bootstrapDeclarativePackages({
    hostVersion: '0.1.3',
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
    hostVersion: '0.1.3',
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

  const officialManager = manager(workspaceRoot);
  const [officialLockfile, officialInstalled] = await Promise.all([
    officialManager.list(),
    officialManager.loadRegistryTolerant(),
  ]);
  const changedProfileDigest = structuredClone(publishedProfile);
  changedProfileDigest.packages[0]!.digest = `sha256:${'f'.repeat(64)}`;
  const unmanagedDefaults = projectOfficialPluginRuntimeDefaults({
    lockfile: officialLockfile,
    preferenceState: await new OfficialPackagePreferenceStore(
      officialManager.packagesRoot,
    ).read(),
    profile: changedProfileDigest,
    registry: officialInstalled.registry,
  });
  assert.equal(
    unmanagedDefaults.some(
      (entry) => entry.pluginModuleId === imagePluginModuleId,
    ),
    false,
  );
  const managedPreferences = await new OfficialPackagePreferenceStore(
    officialManager.packagesRoot,
  ).setPackageUpstreamManaged(imagePackageId, true);
  const managedDefaults = projectOfficialPluginRuntimeDefaults({
    lockfile: officialLockfile,
    preferenceState: managedPreferences,
    profile: changedProfileDigest,
    registry: officialInstalled.registry,
  });
  const managedImageDefault = managedDefaults.find(
    (entry) => entry.pluginModuleId === imagePluginModuleId,
  );
  assert.equal(
    managedImageDefault?.packageDigest,
    officialLockfile.resolvedPackages.find(
      (entry) => entry.packageId === imagePackageId,
    )?.digest,
  );
  assert.deepEqual(
    managedImageDefault?.permissions,
    publishedProfile.packages[0]!.pluginModules[0]!.permissions,
  );

  const partialGrantWorkspace = path.join(
    temporaryRoot,
    'partial-grant-workspace',
  );
  await bootstrapDeclarativePackages({
    hostVersion: '0.1.3',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: partialGrantWorkspace,
  });
  await new PluginRuntimeService({
    hostVersion: '0.1.3',
    workspaceRoot: partialGrantWorkspace,
  }).setPermissions(imagePluginModuleId, ['retake.asset.read.bound']);
  const partialGrantBootstrap = await bootstrapDeclarativePackages({
    hostVersion: '0.1.3',
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
    hostVersion: '0.1.3',
    workspaceRoot,
  });
  await runtime.manageModule(imagePluginModuleId, 'revoke');
  await runtime.manageModule(videoPluginModuleId, 'disable');
  const afterOverrides = await bootstrapDeclarativePackages({
    hostVersion: '0.1.3',
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
    hostVersion: '0.1.3',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: removedWorkspace,
  });
  const removedManager = manager(removedWorkspace);
  await removedManager.remove(imagePackageId);
  await new OfficialPackagePreferenceStore(
    removedManager.packagesRoot,
  ).setPackageRemoved(imagePackageId, true);
  const removedBootstrap = await bootstrapDeclarativePackages({
    hostVersion: '0.1.3',
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
    hostVersion: '0.1.3',
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
    hostVersion: '0.1.3',
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
  await verifyProfileFailure('profile-update-source-tamper', (profile) => {
    profile.packages[0]!.updateSource =
      'github:attacker/image-studio@main#subdirectory=plugin';
  }, /official GitHub main source/);

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
      hostVersion: '0.1.3',
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
      hostVersion: '0.1.3',
      profilePath: path.join(archiveTamperRoot, 'retake.bootstrap.json'),
      workspaceRoot: path.join(temporaryRoot, 'archive-tamper-workspace'),
    }),
    /invalid|checksum|integrity|canonical/i,
  );

  console.log(JSON.stringify({
    cachedStartupWithoutBundle: true,
    installedPluginCapabilities: true,
    freshOfficialDefaults: true,
    officialTrustAndGrant: true,
    partialPermissionOverridePersists: true,
    permissionOverridePersists: true,
    removalOverridePersists: true,
    safeModeWins: true,
    upstreamManagedOfficialDefaultsFollowActiveDigest: true,
    versionPinPersists: true,
    schemaVersion: 3,
  }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function manager(workspaceRoot: string): LocalPackageManagerService {
  return new LocalPackageManagerService({
    hostVersion: '0.1.3',
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
    updateSource: string;
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
      hostVersion: '0.1.3',
      profilePath,
      workspaceRoot,
    }),
    expected,
  );
  assert.equal(await failureManager.hasLockfile(), false);
}
