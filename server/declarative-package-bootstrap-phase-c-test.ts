import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
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
  withSnapshotDigest,
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
  retiredGuidedImageAgentPresetId,
  retiredGuidedImageSkillId,
  retiredGuidedImageWorkflowId,
} from '../src/core/retiredDefinitions';
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
const videoStudioTestArchive = path.join(
  repositoryRoot,
  'server',
  'test-fixtures',
  'package-archives',
  'video-studio-0.1.2.retakepkg',
);
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
    (await readdir(bundledRoot)).sort(),
    ['image-studio-0.12.3.retakepkg', 'retake.bootstrap.json'],
    'The published Whiteboard bootstrap must not ship a Video Studio archive.',
  );
  assert.deepEqual(
    publishedProfile.packages.map((entry) => entry.version),
    ['0.12.3'],
  );
  assert.deepEqual(
    publishedProfile.packages.map((entry) => entry.updateSource),
    [
      'github:retake-tools/image-studio@main#subdirectory=plugin',
    ],
  );
  await validateBootstrapProfileArchives(
    defaultBootstrapProfilePath,
    '0.1.4',
  );
  await assert.rejects(
    validateBootstrapProfileArchives(
      defaultBootstrapProfilePath,
      '0.1.3',
    ),
    /incompatible/,
    'Whiteboard 0.1.3 must reject the Image Studio 0.12 schema before installation.',
  );

  const bootstrapCopy = await copyBootstrapFixture('valid-bootstrap');
  const legacyProfilePath = path.join(bootstrapCopy, 'retake.bootstrap.json');
  await cp(
    videoStudioTestArchive,
    path.join(bootstrapCopy, 'video-studio-0.1.2.retakepkg'),
  );
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
    hostVersion: '0.1.4',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot,
  });
  assert.equal(first.installed, true);
  assert.equal(first.snapshot.lockRevision, 2);
  assert.equal(first.snapshot.packages.length, 2);
  assert.equal(first.snapshot.skills.length, 12);
  assert.equal(first.snapshot.workflows.length, 5);
  assert.equal(first.snapshot.agentPresets.length, 1);
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
  assert.equal(listSkills().length, 12);
  assert.equal(listWorkflows().length, 5);
  assert.equal(listAgentPresets().length, 1);
  assert.equal(
    listSkills().some((skill) => skill.skillId === 'retake.image.guided-edit'),
    false,
  );
  assert.equal(
    listWorkflows().some((workflow) => workflow.workflowId === 'retake.workflow.guided-image-review'),
    false,
  );
  assert.equal(
    listAgentPresets().some((preset) => preset.agentPresetId === 'retake.agent.guided-image-operator'),
    false,
  );
  assert.equal(
    capabilityDefinitionFor('image.generate').definitionHash,
    'sha256:retake-image-generate-document-prompt-v2',
  );
  assert.equal(listPackageEntryPoints().length, 15);
  assert.equal(
    listPackageEntryPoints().some(
      (entry) => entry.entrypoint.entrypointId === 'skill:retake.image.ip-character-strategy',
    ),
    true,
  );
  assert.equal(
    listPackageEntryPoints().some(
      (entry) => entry.entrypoint.entrypointId === 'workflow:retake.workflow.guided-image-review',
    ),
    false,
  );
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

  const staleGuidedSnapshot = structuredClone(first.snapshot);
  const stalePackage = staleGuidedSnapshot.packages.find(
    (manifest) => manifest.packageId === imagePackageId,
  );
  const skillTemplate = staleGuidedSnapshot.skills[0];
  const workflowTemplate = staleGuidedSnapshot.workflows[0];
  const agentTemplate = staleGuidedSnapshot.agentPresets[0];
  assert.ok(stalePackage && skillTemplate && workflowTemplate && agentTemplate);
  staleGuidedSnapshot.skills.push({
    ...structuredClone(skillTemplate),
    skillId: retiredGuidedImageSkillId,
  });
  staleGuidedSnapshot.workflows.push({
    ...structuredClone(workflowTemplate),
    workflowId: retiredGuidedImageWorkflowId,
  });
  staleGuidedSnapshot.agentPresets.push({
    ...structuredClone(agentTemplate),
    agentPresetId: retiredGuidedImageAgentPresetId,
  });
  stalePackage.components.skills.push({
    definitionHash: skillTemplate.definitionHash,
    skillId: retiredGuidedImageSkillId,
    version: skillTemplate.version,
  });
  stalePackage.components.workflows.push({
    definitionHash: workflowTemplate.definitionHash,
    version: workflowTemplate.version,
    workflowDefinitionId: retiredGuidedImageWorkflowId,
  });
  stalePackage.components.agentPresets.push({
    agentPresetId: retiredGuidedImageAgentPresetId,
    definitionHash: agentTemplate.definitionHash,
    version: agentTemplate.version,
  });
  stalePackage.entrypoints.push({
    compatibleStageIds: [],
    description: 'Retired compatibility fixture.',
    entrypointId: `skill:${retiredGuidedImageSkillId}`,
    kind: 'skill',
    name: 'Retired compatibility fixture',
    ref: {
      capabilityId: skillTemplate.capabilityBindings[0]!.capabilityId,
      skillId: retiredGuidedImageSkillId,
    },
    requiredInputSlotIds: [],
    schemaVersion: 1,
  });
  const sanitizedStaleSnapshot = configureInstalledRuntimeRegistry(withSnapshotDigest({
    agentPresets: staleGuidedSnapshot.agentPresets,
    capabilities: staleGuidedSnapshot.capabilities,
    lockRevision: staleGuidedSnapshot.lockRevision,
    packages: staleGuidedSnapshot.packages,
    profileId: staleGuidedSnapshot.profileId,
    schemaVersion: 1,
    skills: staleGuidedSnapshot.skills,
    workflows: staleGuidedSnapshot.workflows,
  }));
  assert.equal(
    sanitizedStaleSnapshot.skills.some((skill) => skill.skillId === retiredGuidedImageSkillId),
    false,
  );
  assert.equal(
    sanitizedStaleSnapshot.workflows.some(
      (workflow) => workflow.workflowId === retiredGuidedImageWorkflowId,
    ),
    false,
  );
  assert.equal(
    sanitizedStaleSnapshot.agentPresets.some(
      (preset) => preset.agentPresetId === retiredGuidedImageAgentPresetId,
    ),
    false,
  );
  assert.equal(
    listPackageEntryPoints().some(
      ({ entrypoint }) => entrypoint.entrypointId === `skill:${retiredGuidedImageSkillId}`,
    ),
    false,
    'A pinned legacy Image Studio package must not re-register retired entrypoints.',
  );
  configureInstalledRuntimeRegistry(first.snapshot);

  const lockPath = path.join(
    workspaceRoot,
    'packages',
    workspacePackageLockFile,
  );
  const lockBeforeSecondBootstrap = await readFile(lockPath);
  const second = await bootstrapDeclarativePackages({
    hostVersion: '0.1.4',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot,
  });
  assert.equal(second.installed, false);
  assert.equal(second.snapshot.lockRevision, 2);
  assert.deepEqual(await readFile(lockPath), lockBeforeSecondBootstrap);

  const pinnedWorkspace = path.join(temporaryRoot, 'version-pinned-workspace');
  await bootstrapDeclarativePackages({
    hostVersion: '0.1.4',
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
    hostVersion: '0.1.4',
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
    hostVersion: '0.1.4',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: partialGrantWorkspace,
  });
  await new PluginRuntimeService({
    hostVersion: '0.1.4',
    workspaceRoot: partialGrantWorkspace,
  }).setPermissions(imagePluginModuleId, ['retake.asset.read.bound']);
  const partialGrantBootstrap = await bootstrapDeclarativePackages({
    hostVersion: '0.1.4',
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
    hostVersion: '0.1.4',
    workspaceRoot,
  });
  await runtime.manageModule(imagePluginModuleId, 'revoke');
  await runtime.manageModule(videoPluginModuleId, 'disable');
  const afterOverrides = await bootstrapDeclarativePackages({
    hostVersion: '0.1.4',
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
    hostVersion: '0.1.4',
    profilePath: path.join(bootstrapCopy, 'retake.bootstrap.json'),
    workspaceRoot: removedWorkspace,
  });
  const removedManager = manager(removedWorkspace);
  await removedManager.remove(imagePackageId);
  await new OfficialPackagePreferenceStore(
    removedManager.packagesRoot,
  ).setPackageRemoved(imagePackageId, true);
  const removedBootstrap = await bootstrapDeclarativePackages({
    hostVersion: '0.1.4',
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
    hostVersion: '0.1.4',
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
    hostVersion: '0.1.4',
    profilePath: missingBundlePath,
    workspaceRoot,
  });
  assert.equal(cachedOnly.installed, false);
  assert.equal(cachedOnly.snapshot.snapshotDigest, first.snapshot.snapshotDigest);
  assert.equal(cachedOnly.distributionFailures.length, 1);
  assert.equal(cachedOnly.distributionFailures[0]?.stage, 'profile');

  await verifyProfileIsolation('profile-digest-tamper', (profile) => {
    profile.packages[0]!.digest = `sha256:${'0'.repeat(64)}`;
  }, /does not match its profile lock/);
  await verifyProfileIsolation('profile-host-tamper', (profile) => {
    profile.hostCompatibility = '>=2.0.0';
  }, /incompatible/);
  await verifyProfileIsolation('profile-path-tamper', (profile) => {
    profile.packages[0]!.archivePath = '../escape.retakepkg';
  }, /portable filename/);
  await verifyProfileIsolation('profile-permission-tamper', (profile) => {
    profile.packages[0]!.pluginModules[0]!.permissions = [];
  }, /allowlist does not match archive/);
  await verifyProfileIsolation('profile-update-source-tamper', (profile) => {
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
  const symlinkBootstrap = await bootstrapDeclarativePackages({
    activateRuntime: false,
    hostVersion: '0.1.4',
    profilePath: path.join(symlinkArchiveRoot, 'retake.bootstrap.json'),
    workspaceRoot: path.join(temporaryRoot, 'archive-symlink-workspace'),
  });
  assert.equal(symlinkBootstrap.snapshot.packages.length, 0);
  assert.match(
    symlinkBootstrap.distributionFailures[0]?.error ?? '',
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
  const tamperedBootstrap = await bootstrapDeclarativePackages({
    activateRuntime: false,
    hostVersion: '0.1.4',
    profilePath: path.join(archiveTamperRoot, 'retake.bootstrap.json'),
    workspaceRoot: path.join(temporaryRoot, 'archive-tamper-workspace'),
  });
  assert.equal(tamperedBootstrap.snapshot.packages.length, 0);
  assert.match(
    tamperedBootstrap.distributionFailures[0]?.error ?? '',
    /invalid|checksum|integrity|canonical/i,
  );

  const lastGoodRoot = await copyBootstrapFixture('last-good-candidate');
  const lastGoodProfilePath = path.join(lastGoodRoot, 'retake.bootstrap.json');
  const lastGoodProfile = await readBootstrapProfile(lastGoodProfilePath);
  const lastGoodWorkspace = path.join(temporaryRoot, 'last-good-workspace');
  const lastGoodFirst = await bootstrapDeclarativePackages({
    activateRuntime: false,
    hostVersion: '0.1.4',
    profilePath: lastGoodProfilePath,
    workspaceRoot: lastGoodWorkspace,
  });
  const lastGoodManager = manager(lastGoodWorkspace);
  const lastGoodLock = await lastGoodManager.list();
  const lastGoodRootLock = lastGoodLock.roots.find(
    (entry) => entry.packageId === imagePackageId,
  )!;
  const lastGoodArchivePath = path.join(
    lastGoodRoot,
    lastGoodProfile.packages[0]!.archivePath,
  );
  const lastGoodArchiveBytes = Buffer.from(await readFile(lastGoodArchivePath));
  lastGoodArchiveBytes[Math.floor(lastGoodArchiveBytes.byteLength / 2)]! ^= 0xff;
  await writeFile(lastGoodArchivePath, lastGoodArchiveBytes);
  const lastGoodSecond = await bootstrapDeclarativePackages({
    activateRuntime: false,
    hostVersion: '0.1.4',
    profilePath: lastGoodProfilePath,
    workspaceRoot: lastGoodWorkspace,
  });
  const lastGoodAfterLock = await lastGoodManager.list();
  assert.equal(lastGoodFirst.snapshot.packages.length, 1);
  assert.equal(lastGoodSecond.snapshot.packages.length, 1);
  assert.equal(lastGoodSecond.distributionFailures.length, 1);
  assert.deepEqual(lastGoodAfterLock.roots, lastGoodLock.roots);
  assert.equal(
    lastGoodAfterLock.roots.find(
      (entry) => entry.packageId === imagePackageId,
    )?.installationId,
    lastGoodRootLock.installationId,
  );

  const isolatedMultiRoot = await copyBootstrapFixture('isolated-multi-package');
  const isolatedMultiProfilePath = path.join(
    isolatedMultiRoot,
    'retake.bootstrap.json',
  );
  await cp(
    videoStudioTestArchive,
    path.join(isolatedMultiRoot, 'video-studio-0.1.2.retakepkg'),
  );
  const isolatedMultiProfile = await readBootstrapProfile(
    isolatedMultiProfilePath,
  );
  isolatedMultiProfile.packages.push({
    archiveDigest: 'sha256:a9972f561f1e19cda253302ee9a77afd0a6b5acbe542b4950ca8786762823120',
    archivePath: 'video-studio-0.1.2.retakepkg',
    digest: 'sha256:1a377bd022b27ae5bbd029c286ac5785b60977ef51709948f15c552cdfdd8b1e',
    packageId: videoPackageId,
    pluginModules: [{ permissions: [], pluginModuleId: videoPluginModuleId }],
    updateSource: 'github:retake-tools/video-studio@main#subdirectory=package',
    version: '0.1.2',
  });
  await writeFile(
    isolatedMultiProfilePath,
    `${JSON.stringify(isolatedMultiProfile, null, 2)}\n`,
    'utf8',
  );
  const isolatedImageArchive = path.join(
    isolatedMultiRoot,
    isolatedMultiProfile.packages[0]!.archivePath,
  );
  const isolatedImageBytes = Buffer.from(await readFile(isolatedImageArchive));
  isolatedImageBytes[Math.floor(isolatedImageBytes.byteLength / 2)]! ^= 0xff;
  await writeFile(isolatedImageArchive, isolatedImageBytes);
  const isolatedMulti = await bootstrapDeclarativePackages({
    activateRuntime: false,
    hostVersion: '0.1.4',
    profilePath: isolatedMultiProfilePath,
    workspaceRoot: path.join(temporaryRoot, 'isolated-multi-workspace'),
  });
  assert.deepEqual(
    isolatedMulti.snapshot.packages.map((entry) => entry.packageId),
    [videoPackageId],
  );
  assert.equal(isolatedMulti.distributionFailures[0]?.packageId, imagePackageId);

  console.log(JSON.stringify({
    cachedStartupWithoutBundle: true,
    corruptDefaultStartsCoreOnly: true,
    installedPluginCapabilities: true,
    invalidCandidateKeepsLastGood: true,
    invalidPackageDoesNotBlockValidSibling: true,
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
    hostVersion: '0.1.4',
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

async function verifyProfileIsolation(
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
  const result = await bootstrapDeclarativePackages({
    activateRuntime: false,
    hostVersion: '0.1.4',
    profilePath,
    workspaceRoot,
  });
  assert.equal(result.snapshot.packages.length, 0);
  assert.equal(result.distributionFailures.length, 1);
  assert.match(result.distributionFailures[0]?.error ?? '', expected);
  assert.equal(await failureManager.hasLockfile(), false);
}
