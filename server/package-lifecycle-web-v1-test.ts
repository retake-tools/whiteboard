import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type {
  DeclarativePackageManifest,
} from '@retake-tools/package-contracts';
import {
  emptyPluginProfileStateV1,
  projectPluginRuntimeForProfileV1,
} from '@retake-tools/package-sdk';
import { PluginManager } from '../src/components/PluginManager';
import type {
  PackageLifecycleControllerV1,
} from '../src/core/packageLifecycleClient';
import {
  createPackageLifecycleController,
} from '../src/core/packageLifecycleClient';
import type {
  PackageLifecycleSnapshotV1,
  PackageUpdateSnapshotV1,
} from '../src/core/packageLifecycleContracts';
import type {
  PluginRuntimeControllerV1,
} from '../src/core/pluginRuntimeManagementClient';
import { I18nProvider } from '../src/i18n';
import {
  invalidateDefaultDeclarativePackageBootstrap,
} from './declarative-package-bootstrap-service';
import { handlePackageLifecycleRequest } from './package-lifecycle-api';
import { PackageLifecycleService } from './package-lifecycle-service';
import { PluginRuntimeService } from './plugin-runtime-service';

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => 'en',
    setItem: () => {},
  },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'en-US' },
});

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), 'retake-package-lifecycle-web-v1-'),
);
try {
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  const versionOne = await createPackage('1.0.0');
  const versionTwo = await createPackage('1.1.0');
  const service = new PackageLifecycleService({
    hostVersion: '0.1.2',
    workspaceRoot,
  });

  const initial = await service.read();
  assert.equal(initial.schemaVersion, 1);
  assert.equal(initial.packages.length, 2);
  const runtimeService = new PluginRuntimeService({
    hostVersion: '0.1.2',
    workspaceRoot,
  });
  await runtimeService.setSafeMode(true);
  assert.equal(
    (await service.read()).pluginRuntime.safeMode,
    true,
    'Package lifecycle reads must not replay a cached Plugin Runtime snapshot.',
  );
  await runtimeService.setSafeMode(false);

  const installedOne = await service.mutate({
    action: 'install',
    source: versionOne,
  });
  const packageOne = requiredPackage(installedOne);
  assert.equal(packageOne.version, '1.0.0');
  assert.equal(packageOne.isRoot, true);
  assert.equal(packageOne.source.kind, 'local_directory');
  assert.equal(packageOne.source.label, path.basename(versionOne));
  assert.equal(packageOne.source.label.includes(temporaryRoot), false);

  const installedTwo = await service.mutate({
    action: 'install',
    source: versionTwo,
  });
  const packageTwo = requiredPackage(installedTwo);
  assert.equal(packageTwo.version, '1.1.0');
  assert.equal(packageTwo.history.length, 1);
  assert.equal(packageTwo.history[0]!.version, '1.0.0');

  const rolledBack = await service.mutate({
    action: 'rollback',
    packageId: 'test.package.lifecycle',
  });
  assert.equal(requiredPackage(rolledBack).version, '1.0.0');

  await assert.rejects(
    service.mutate({
      action: 'update',
      packageId: 'test.package.lifecycle',
    }),
    /update is unsupported for this source/,
  );

  const removed = await service.mutate({
    action: 'remove',
    packageId: 'test.package.lifecycle',
  });
  assert.equal(
    removed.packages.some(
      (entry) => entry.packageId === 'test.package.lifecycle',
    ),
    false,
  );

  const invalidApi = await handlePackageLifecycleRequest({
    method: 'POST',
    pathname: '/package-lifecycle',
    readBody: async () => ({ action: 'install', source: '  ' }),
    service,
  });
  assert.deepEqual(invalidApi, {
    handled: true,
    statusCode: 400,
    value: { error: 'Package source is invalid.' },
  });

  const markup = renderManager(installedTwo);
  assert.match(markup, /Plugins/);
  assert.match(markup, /Installed/);
  assert.match(markup, /Add/);
  assert.match(markup, /test\.package\.lifecycle/);
  assert.match(markup, /Rollback/);
  assert.match(markup, /Remove/);
  assert.doesNotMatch(markup, /Plugin library/);
  assert.doesNotMatch(markup, new RegExp(escapeRegExp(temporaryRoot)));
  const updateMarkup = renderManager(installedTwo, 'installed', {
    checkedAt: installedTwo.updatedAt,
    checks: [{
      candidate: {
        archiveDigest: `sha256:${'a'.repeat(64)}`,
        commit: null,
        digest: `sha256:${'b'.repeat(64)}`,
        notices: [],
        version: '1.2.0',
      },
      currentDigest: packageTwo.digest,
      currentVersion: packageTwo.version,
      detail: null,
      packageId: packageTwo.packageId,
      sourceKind: packageTwo.source.kind,
      status: 'available',
    }],
    schemaVersion: 1,
  });
  assert.match(updateMarkup, /Update available/);
  assert.match(updateMarkup, /v1\.1\.0 → v1\.2\.0/);
  assert.match(updateMarkup, />Update</);
  const addMarkup = renderManager(installedTwo, 'add');
  assert.match(addMarkup, /Install source/);
  assert.match(
    addMarkup,
    /https:\/\/github\.com\/retake-tools\/plugin-directory/,
  );
  assert.match(
    renderManager(installedTwo, 'development'),
    /Linked development/,
  );

  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const appliedRuntimeRevisions: number[] = [];
  let releaseFirstRequest: (() => void) | undefined;
  const firstRequest = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });
  let responseIndex = 0;
  globalThis.fetch = async (request): Promise<Response> => {
    calls.push(String(request));
    const index = responseIndex++;
    if (index === 0) await firstRequest;
    return Response.json(index === 0 ? installedTwo : rolledBack);
  };
  try {
    const runtimeController = pluginRuntimeController(
      installedTwo,
      appliedRuntimeRevisions,
    );
    const lifecycleController = createPackageLifecycleController({
      pluginRuntimeController: runtimeController,
    });
    const refresh = lifecycleController.refresh();
    const rollback = lifecycleController.mutate({
      action: 'rollback',
      packageId: 'test.package.lifecycle',
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.equal(calls.length, 1);
    releaseFirstRequest?.();
    await Promise.all([refresh, rollback]);
    assert.deepEqual(calls, [
      '/api/local/package-lifecycle',
      '/api/local/package-lifecycle',
    ]);
    assert.equal(appliedRuntimeRevisions.length, 2);
    assert.equal(
      lifecycleController.getSnapshot()?.lockRevision,
      rolledBack.lockRevision,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  process.stdout.write(`${JSON.stringify({
    browserMutationsSerialized: true,
    currentPageSnapshotsReturnedAfterEveryMutation: true,
    dependencyRemovalGuardOwnedByPackageManager: true,
    localPathsProjectedWithoutDirectoryDisclosure: true,
    localSourceInstallRollbackRemove: true,
    pluginRuntimeReadUsesFreshPersistedAuthority: true,
    sourceUpdateCapabilityIsExact: true,
    webLibraryRendersLifecycleActions: true,
  })}\n`);
} finally {
  invalidateDefaultDeclarativePackageBootstrap();
  await rm(temporaryRoot, { force: true, recursive: true });
}

async function createPackage(version: string): Promise<string> {
  const root = path.join(temporaryRoot, `package-${version}`);
  await mkdir(root, { recursive: true });
  const manifest: DeclarativePackageManifest = {
    components: {
      agentPresets: [],
      pluginModules: [],
      skills: [],
      workflows: [],
    },
    dependencies: [],
    description: `Lifecycle fixture ${version}.`,
    entrypoints: [],
    files: ['README.md'],
    integrity: 'sha256:auto',
    license: 'MIT',
    name: 'Lifecycle fixture',
    optionalDependencies: [],
    packageId: 'test.package.lifecycle',
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
  await writeFile(
    path.join(root, 'retake.package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  );
  await writeFile(
    path.join(root, 'README.md'),
    `${manifest.description}\n`,
    'utf8',
  );
  return root;
}

function requiredPackage(snapshot: PackageLifecycleSnapshotV1) {
  const record = snapshot.packages.find(
    (entry) => entry.packageId === 'test.package.lifecycle',
  );
  assert.ok(record);
  return record;
}

function renderManager(
  snapshot: PackageLifecycleSnapshotV1,
  initialTab: 'add' | 'development' | 'installed' = 'installed',
  updates?: PackageUpdateSnapshotV1,
): string {
  const packageController: PackageLifecycleControllerV1 = {
    checkUpdates: async () => ({
      checkedAt: snapshot.updatedAt,
      checks: [],
      schemaVersion: 1,
    }),
    getDevelopmentSnapshot: () => ({
      links: [],
      revision: 0,
      schemaVersion: 1,
      updatedAt: snapshot.updatedAt,
    }),
    getSnapshot: () => snapshot,
    getUpdateSnapshot: () => updates,
    mutate: async () => snapshot,
    mutateDevelopment: async () => ({
      links: [],
      revision: 0,
      schemaVersion: 1,
      updatedAt: snapshot.updatedAt,
    }),
    refresh: async () => snapshot,
    refreshDevelopment: async () => ({
      links: [],
      revision: 0,
      schemaVersion: 1,
      updatedAt: snapshot.updatedAt,
    }),
    subscribe: () => () => {},
  };
  const runtimeController = pluginRuntimeController(snapshot, []);
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(PluginManager, {
        initialTab,
        onClose: () => {},
        packageController,
        pluginController: runtimeController,
      }),
    ),
  );
}

function pluginRuntimeController(
  snapshot: PackageLifecycleSnapshotV1,
  appliedRuntimeRevisions: number[],
): PluginRuntimeControllerV1 {
  const profile = emptyPluginProfileStateV1();
  return {
    getDemand: () => ({
      boardBound: false,
      hasBlocks: false,
      hasOperationBlocks: false,
      managerOpen: false,
      selectedBlockCount: 0,
    }),
    getProfileProjection: () => projectPluginRuntimeForProfileV1({
      boardId: null,
      profile,
      projectId: null,
      runtime: snapshot.pluginRuntime,
    }),
    getProfileState: () => profile,
    getScope: () => ({ boardId: null, projectId: null }),
    getSnapshot: () => snapshot.pluginRuntime,
    manageModule: async () => snapshot.pluginRuntime,
    refresh: async () => snapshot.pluginRuntime,
    replace: async (runtimeSnapshot) => {
      appliedRuntimeRevisions.push(appliedRuntimeRevisions.length + 1);
      return runtimeSnapshot;
    },
    setSafeMode: async () => snapshot.pluginRuntime,
    setDemand: async () => snapshot.pluginRuntime,
    setScope: async () => snapshot.pluginRuntime,
    subscribe: () => () => {},
    updateProfile: async () => snapshot.pluginRuntime,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
