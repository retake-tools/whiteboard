import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  emptyPluginProfileStateV1,
  projectPluginRuntimeForProfileV1,
  updatePluginProfileOverrideV1,
  type PluginModuleRuntimeRecordV1,
  type PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import { PluginManager } from '../src/components/PluginManager';
import { ProjectBoardManager } from '../src/components/ProjectBoardManager';
import type {
  PackageLifecycleControllerV1,
} from '../src/core/packageLifecycleClient';
import type {
  PackageLifecycleSnapshotV1,
} from '../src/core/packageLifecycleContracts';
import {
  createPluginRuntimeController,
  type PluginRuntimeControllerV1,
} from '../src/core/pluginRuntimeManagementClient';
import { I18nProvider } from '../src/i18n';
import type { WorkspaceSummary } from '../src/core/types';

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

const pluginManagerStyles = readFileSync(
  new URL('../src/components/plugin-manager.css', import.meta.url),
  'utf8',
);
assert.match(
  pluginManagerStyles,
  /\.plugin-manager-panel\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;/s,
);
assert.match(
  pluginManagerStyles,
  /\.plugin-manager-content\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/s,
);

const installed = runtimeSnapshot({
  desiredState: 'disabled',
  grant: null,
  status: 'installed',
  trust: null,
});
assert.match(renderSettings(installed), /Grant exact permissions/);

const granted = runtimeSnapshot({
  desiredState: 'disabled',
  grant: {
    grantId: 'grant.fixture',
    grantedAt: '2026-07-27T00:00:00.000Z',
    grantedBy: 'user',
    permissions: [...installed.modules[0]!.manifest.permissions],
    pluginModuleId: installed.modules[0]!.pluginModuleId,
    publisherId: installed.modules[0]!.publisherId,
    schemaVersion: 1,
  },
  status: 'installed',
  trust: null,
});
assert.match(renderSettings(granted), /Trust exact code/);

const enabled = runtimeSnapshot({
  desiredState: 'enabled',
  grant: granted.modules[0]!.grant,
  status: 'enabled',
  trust: {
    definitionHash: granted.modules[0]!.definitionHash,
    packageDigest: granted.modules[0]!.packageLock.digest,
    pluginModuleId: granted.modules[0]!.pluginModuleId,
    publisherId: granted.modules[0]!.publisherId,
    schemaVersion: 1,
    trustChannel: 'user_trusted',
    trustedAt: '2026-07-27T00:00:00.000Z',
    trustedBy: 'user',
    trustId: 'trust.fixture',
    updatePolicy: 'exact_digest',
  },
});
assert.match(renderSettings(enabled), />Disable</);
assert.doesNotMatch(renderSettings(enabled), /Enablement scope/);
assert.match(
  renderSettings(enabled),
  /<details class="plugin-manager-module-details">/,
);
assert.match(renderSettings({ ...enabled, safeMode: true }), /Leave safe mode/);
const partialGrant = structuredClone(enabled);
partialGrant.modules[0]!.grant!.permissions = [
  partialGrant.modules[0]!.manifest.permissions[0]!,
];
const partialGrantMarkup = renderSettings(partialGrant);
assert.equal(
  partialGrantMarkup.match(/type="checkbox"/g)?.length,
  partialGrant.modules[0]!.manifest.permissions.length,
);
assert.equal(partialGrantMarkup.match(/checked=""/g)?.length, 1);
const projectBoardMarkup = renderProjectBoardManager(enabled);
assert.match(projectBoardMarkup, /Projects and boards/);
assert.match(projectBoardMarkup, /Plugin settings/);
assert.match(projectBoardMarkup, /1\/1 Plugins enabled/);
assert.match(projectBoardMarkup, /Current project/);
assert.match(projectBoardMarkup, /Current board/);

const originalFetch = globalThis.fetch;
const calls: string[] = [];
const applied: PluginRuntimeSnapshotV1[] = [];
let releaseFirstRequest: (() => void) | undefined;
const firstRequest = new Promise<void>((resolve) => {
  releaseFirstRequest = resolve;
});
let responseIndex = 0;
globalThis.fetch = async (input): Promise<Response> => {
  calls.push(String(input));
  const index = responseIndex++;
  if (index === 0) await firstRequest;
  const snapshot = index === 0
    ? runtimeSnapshot({
      desiredState: 'disabled',
      grant: enabled.modules[0]!.grant,
      status: 'disabled',
      trust: enabled.modules[0]!.trust,
    })
    : {
      ...enabled,
      modules: [{
        ...enabled.modules[0]!,
        status: 'disabled',
      }],
      safeMode: true,
    };
  return new Response(JSON.stringify(snapshot), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
};

try {
  const controller = createPluginRuntimeController({
    applySnapshot: async (_base, effective) => {
      applied.push(effective);
    },
    initialProfileState: emptyPluginProfileStateV1(),
    initialSnapshot: enabled,
  });
  let notificationCount = 0;
  const unsubscribe = controller.subscribe(() => {
    notificationCount += 1;
  });
  const disable = controller.manageModule(
    enabled.modules[0]!.pluginModuleId,
    'disable',
  );
  const safeMode = controller.setSafeMode(true);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(calls.length, 1);
  releaseFirstRequest?.();
  await Promise.all([disable, safeMode]);
  unsubscribe();
  assert.deepEqual(calls, [
    '/api/local/plugin-runtime/modules/retake.plugin.runtime-management-fixture/disable',
    '/api/local/plugin-runtime/safe-mode',
  ]);
  assert.equal(applied.length, 2);
  assert.equal(notificationCount, 2);
  assert.equal(controller.getSnapshot().safeMode, true);
} finally {
  globalThis.fetch = originalFetch;
}

const boardDisabledProfile = updatePluginProfileOverrideV1(
  emptyPluginProfileStateV1(),
  {
    boardId: 'board.fixture',
    pluginModuleId: enabled.modules[0]!.pluginModuleId,
    projectId: 'project.fixture',
    scope: 'board',
    state: 'disabled',
  },
);
globalThis.fetch = async (input): Promise<Response> => {
  assert.equal(String(input), '/api/local/plugin-foundation/profile');
  return new Response(JSON.stringify(boardDisabledProfile), {
    headers: { 'Content-Type': 'application/json' },
    status: 200,
  });
};
try {
  const controller = createPluginRuntimeController({
    applySnapshot: async () => {},
    initialProfileState: emptyPluginProfileStateV1(),
    initialSnapshot: enabled,
  });
  await controller.setScope({
    boardId: 'board.fixture',
    projectId: 'project.fixture',
  });
  await controller.updateProfile({
    boardId: 'board.fixture',
    pluginModuleId: enabled.modules[0]!.pluginModuleId,
    projectId: 'project.fixture',
    scope: 'board',
    state: 'disabled',
  });
  assert.equal(
    controller.getProfileProjection().modules[0]?.source.scope,
    'board',
  );
  assert.equal(
    controller.getProfileProjection().runtime.modules[0]?.status,
    'disabled',
  );
} finally {
  globalThis.fetch = originalFetch;
}

const rendererRuntime = structuredClone(enabled);
rendererRuntime.modules[0]!.manifest.contributions = [{
  contributionId: 'retake.contribution.runtime-management-renderer',
  exportName: 'renderer',
  kind: 'renderer',
}];
const demandController = createPluginRuntimeController({
  applySnapshot: async () => {},
  initialProfileState: emptyPluginProfileStateV1(),
  initialSnapshot: rendererRuntime,
});
await demandController.setScope({
  boardId: 'board.fixture',
  demand: {
    boardBound: true,
    hasBlocks: false,
    hasOperationBlocks: false,
    managerOpen: false,
    selectedBlockCount: 0,
  },
  projectId: 'project.fixture',
});
assert.equal(
  demandController.getProfileProjection().runtime.modules[0]?.status,
  'disabled',
);
await demandController.setDemand({
  ...demandController.getDemand(),
  hasBlocks: true,
});
assert.equal(
  demandController.getProfileProjection().runtime.modules[0]?.status,
  'enabled',
);

const linkedRuntime = structuredClone(rendererRuntime);
linkedRuntime.modules[0]!.trust!.trustChannel = 'linked_source';
const linkedDemandController = createPluginRuntimeController({
  applySnapshot: async () => {},
  initialProfileState: emptyPluginProfileStateV1(),
  initialSnapshot: linkedRuntime,
});
await linkedDemandController.setScope({
  boardId: 'board.fixture',
  demand: {
    boardBound: true,
    hasBlocks: false,
    hasOperationBlocks: false,
    managerOpen: false,
    selectedBlockCount: 0,
  },
  projectId: 'project.fixture',
});
assert.equal(
  linkedDemandController.getProfileProjection().runtime.modules[0]?.status,
  'enabled',
);

const legacyRuntime = structuredClone(enabled);
legacyRuntime.modules[0]!.manifest.contributions = [];
const legacyDemandController = createPluginRuntimeController({
  applySnapshot: async () => {},
  initialProfileState: emptyPluginProfileStateV1(),
  initialSnapshot: legacyRuntime,
});
await legacyDemandController.setScope({
  boardId: 'board.fixture',
  demand: {
    boardBound: true,
    hasBlocks: false,
    hasOperationBlocks: false,
    managerOpen: false,
    selectedBlockCount: 0,
  },
  projectId: 'project.fixture',
});
assert.equal(
  legacyDemandController.getProfileProjection().runtime.modules[0]?.status,
  'enabled',
);

process.stdout.write(`${JSON.stringify({
  boardProfileReconcilesRuntime: true,
  legacyContributionFallbackRemainsEager: true,
  linkedDevelopmentValidationRemainsEager: true,
  rendererActivationFollowsBoardDemand: true,
  exactNextRuntimeAction: true,
  lazyPanelUsesStableExternalStore: true,
  partialPermissionControlsRendered: true,
  projectBoardPluginSettingsEntryRendered: true,
  runtimeMutationsSerialized: true,
  runtimeSnapshotReconciledBeforeNotification: true,
})}\n`);

function renderSettings(snapshot: PluginRuntimeSnapshotV1): string {
  const profile = emptyPluginProfileStateV1();
  const projection = projectPluginRuntimeForProfileV1({
    boardId: 'board.fixture',
    profile,
    projectId: 'project.fixture',
    runtime: snapshot,
  });
  const pluginController: PluginRuntimeControllerV1 = {
    getDemand: () => ({
      boardBound: true,
      hasBlocks: false,
      hasOperationBlocks: false,
      managerOpen: true,
      selectedBlockCount: 0,
    }),
    getProfileProjection: () => projection,
    getProfileState: () => profile,
    getScope: () => ({
      boardId: 'board.fixture',
      projectId: 'project.fixture',
    }),
    getSnapshot: () => snapshot,
    manageModule: async () => snapshot,
    refresh: async () => snapshot,
    replace: async () => snapshot,
    setPermissions: async () => snapshot,
    setSafeMode: async () => snapshot,
    setDemand: async () => snapshot,
    setScope: async () => snapshot,
    subscribe: () => () => {},
    updateProfile: async () => snapshot,
  };
  const packageSnapshot = lifecycleSnapshot(snapshot);
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
    getSnapshot: () => packageSnapshot,
    getUpdateSnapshot: () => undefined,
    mutate: async () => packageSnapshot,
    mutateDevelopment: async () => ({
      links: [],
      revision: 0,
      schemaVersion: 1,
      updatedAt: snapshot.updatedAt,
    }),
    refresh: async () => packageSnapshot,
    refreshDevelopment: async () => ({
      links: [],
      revision: 0,
      schemaVersion: 1,
      updatedAt: snapshot.updatedAt,
    }),
    subscribe: () => () => {},
  };
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(PluginManager, {
        onClose: () => {},
        packageController,
        pluginController,
      }),
    ),
  );
}

function renderProjectBoardManager(snapshot: PluginRuntimeSnapshotV1): string {
  const profile = emptyPluginProfileStateV1();
  const projection = projectPluginRuntimeForProfileV1({
    boardId: 'board.fixture',
    profile,
    projectId: 'project.fixture',
    runtime: snapshot,
  });
  const pluginController: PluginRuntimeControllerV1 = {
    getDemand: () => ({
      boardBound: true,
      hasBlocks: false,
      hasOperationBlocks: false,
      managerOpen: false,
      selectedBlockCount: 0,
    }),
    getProfileProjection: () => projection,
    getProfileState: () => profile,
    getScope: () => ({
      boardId: 'board.fixture',
      projectId: 'project.fixture',
    }),
    getSnapshot: () => snapshot,
    manageModule: async () => snapshot,
    refresh: async () => snapshot,
    replace: async () => snapshot,
    setPermissions: async () => snapshot,
    setSafeMode: async () => snapshot,
    setDemand: async () => snapshot,
    setScope: async () => snapshot,
    subscribe: () => () => {},
    updateProfile: async () => snapshot,
  };
  const workspace: WorkspaceSummary = {
    defaultProjectId: 'project.fixture',
    projects: [{
      boards: [{
        boardId: 'board.fixture',
        createdAt: snapshot.updatedAt,
        name: 'Fixture board',
        projectId: 'project.fixture',
        updatedAt: snapshot.updatedAt,
      }],
      createdAt: snapshot.updatedAt,
      defaultBoardId: 'board.fixture',
      name: 'Fixture project',
      projectId: 'project.fixture',
      updatedAt: snapshot.updatedAt,
    }],
  };
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(ProjectBoardManager, {
        currentBoardId: 'board.fixture',
        currentProjectId: 'project.fixture',
        onClose: () => {},
        onCreateBoard: () => {},
        onCreateProject: () => {},
        onDeleteBoard: () => {},
        onDeleteProject: () => {},
        onDuplicateBoard: () => {},
        onOpenBoard: () => {},
        onRenameBoard: () => {},
        onRenameProject: () => {},
        pluginController,
        workspace,
      }),
    ),
  );
}

function lifecycleSnapshot(
  pluginRuntime: PluginRuntimeSnapshotV1,
): PackageLifecycleSnapshotV1 {
  return {
    lockRevision: 1,
    packages: [{
      componentCounts: {
        agentPresets: 0,
        pluginModules: 1,
        skills: 0,
        workflows: 0,
      },
      dependencies: [],
      description: 'Runtime Management fixture.',
      digest: pluginRuntime.modules[0]!.packageLock.digest,
      history: [],
      installationId: pluginRuntime.modules[0]!.packageLock.installationId,
      isRoot: true,
      loadFailure: null,
      name: 'Runtime Management fixture',
      packageId: pluginRuntime.modules[0]!.packageLock.packageId,
      source: {
        canUpdate: false,
        kind: 'local_directory',
        label: 'runtime-management-fixture',
      },
      version: pluginRuntime.modules[0]!.packageLock.version,
    }],
    pluginRuntime,
    runtimeRegistry: {
      agentPresets: [],
      capabilities: [],
      lockRevision: 1,
      packages: [],
      profileId: 'test.plugin-manager',
      schemaVersion: 1,
      skills: [],
      snapshotDigest: `sha256:${'b'.repeat(64)}`,
      workflows: [],
    },
    schemaVersion: 1,
    updatedAt: pluginRuntime.updatedAt,
  };
}

function runtimeSnapshot(input: Pick<
  PluginModuleRuntimeRecordV1,
  'desiredState' | 'grant' | 'status' | 'trust'
>): PluginRuntimeSnapshotV1 {
  return {
    modules: [{
      definitionHash: 'sha256:runtime-management-fixture',
      desiredState: input.desiredState,
      failure: null,
      grant: input.grant,
      manifest: {
        contributions: [{
          contributionId: 'retake.contribution.runtime-management-fixture',
          exportName: 'activate',
          kind: 'panel',
        }],
        definitionHash: 'sha256:runtime-management-fixture',
        description: 'Runtime Management fixture.',
        name: 'Runtime Management fixture',
        permissions: ['retake.asset.read.bound'],
        pluginModuleId: 'retake.plugin.runtime-management-fixture',
        runtime: {
          entrypoint: 'dist/index.js',
          hostApi: {
            maximumVersion: 2,
            minimumVersion: 2,
          },
          kind: 'web_module',
        },
        schemaVersion: 2,
        version: '0.1.0',
      },
      negotiatedHostApiVersion: 2,
      packageLock: {
        digest: `sha256:${'a'.repeat(64)}`,
        installationId: 'installation.runtime-management-fixture',
        packageId: 'retake.package.runtime-management-fixture',
        version: '0.1.0',
      },
      pluginModuleId: 'retake.plugin.runtime-management-fixture',
      publisherId: 'retake.publisher.fixture',
      status: input.status,
      trust: input.trust,
      updatedAt: '2026-07-27T00:00:00.000Z',
    }],
    safeMode: false,
    schemaVersion: 1,
    updatedAt: '2026-07-27T00:00:00.000Z',
  };
}
