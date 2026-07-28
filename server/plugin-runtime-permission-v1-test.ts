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
import {
  activatePluginWebModule,
  retakeWebPluginV1Toolchain,
} from '@retake-tools/package-sdk';
import { LocalPackageManagerService } from './local-package-manager-service';
import { PluginRuntimeService } from './plugin-runtime-service';
import { pluginRuntimeStateFile } from './plugin-runtime-state-store';

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), 'retake-plugin-runtime-v1-'),
);
try {
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  const sourceV1 = path.join(temporaryRoot, 'source-v1');
  await writePluginSource(sourceV1, {
    definitionHash: 'sha256:whiteboard-plugin-runtime-v1',
    permissions: [
      'retake.asset.read.bound',
      'retake.draft.write.bound',
    ],
    version: '0.1.0',
  });

  const manager = new LocalPackageManagerService({
    hostVersion: '0.1.2',
    workspaceRoot,
  });
  await manager.install(sourceV1);
  const service = new PluginRuntimeService({
    hostVersion: '0.1.2',
    workspaceRoot,
  });
  const installed = await service.reconcile();
  assert.equal(installed.modules.length, 1);
  assert.equal(installed.modules[0]!.status, 'installed');
  assert.equal(installed.modules[0]!.grant, null);
  await assert.rejects(
    service.assertPermission(
      'retake.plugin.whiteboard-runtime-fixture',
      'retake.asset.read.bound',
    ),
    /not granted/,
  );

  const granted = await service.manageModule(
    'retake.plugin.whiteboard-runtime-fixture',
    'grant',
  );
  assert.equal(granted.modules[0]!.status, 'installed');
  assert.equal(granted.modules[0]!.grant?.grantedBy, 'user');
  assert.deepEqual(
    granted.modules[0]!.grant?.permissions,
    granted.modules[0]!.manifest.permissions,
  );
  await assert.rejects(
    service.enable('retake.plugin.whiteboard-runtime-fixture'),
    /Code Trust/,
  );
  const trusted = await service.manageModule(
    'retake.plugin.whiteboard-runtime-fixture',
    'trust',
  );
  assert.equal(trusted.modules[0]!.trust?.trustChannel, 'user_trusted');
  assert.equal(trusted.modules[0]!.trust?.updatePolicy, 'exact_digest');
  const enabledSnapshot = await service.manageModule(
    'retake.plugin.whiteboard-runtime-fixture',
    'enable',
  );
  const enabled = enabledSnapshot.modules[0]!;
  assert.equal(enabled.status, 'enabled');
  const moduleFile = await service.readEnabledModuleFile({
    packageDigest: enabled.packageLock.digest,
    path: enabled.manifest.runtime.entrypoint,
    pluginModuleId: enabled.pluginModuleId,
  });
  assert.equal(moduleFile.mediaType, 'text/javascript; charset=utf-8');
  const moduleNamespace = await import(
    `data:text/javascript;base64,${moduleFile.bytes.toString('base64')}`
  );
  const activated = await activatePluginWebModule({
    host: {
      assets: {
        getBound: () => null,
        importImage: async () => {
          throw new Error('Fixture does not import assets.');
        },
      },
      drafts: {
        getBound: () => null,
        saveBound: async () => null,
      },
      environment: {
        getSnapshot: () => ({
          colorScheme: 'light',
          contrast: 'normal',
          direction: 'ltr',
          locale: 'en',
          reducedMotion: false,
          revision: 'fixture',
        }),
        subscribe: () => () => {},
      },
      execution: {
        listConnections: () => [],
        run: async () => {
          throw new Error('Fixture does not run executions.');
        },
        runConnected: async () => {
          throw new Error('Fixture does not run connected executions.');
        },
      },
      settings: {
        getSnapshot: () => null,
        subscribe: () => () => {},
        update: async () => {
          throw new Error('Fixture does not update settings.');
        },
      },
      getReadSnapshot: () => ({
        boardId: 'board.fixture',
        boundAssetIds: [],
        boundBlockIds: ['block.fixture'],
        boundGroupIds: [],
        projectId: 'project.fixture',
        revision: 'revision.fixture',
        selectedBlockIds: ['block.fixture'],
      }),
      subscribeReadSnapshot: () => () => {},
      version: 2,
    },
    manifest: enabled.manifest,
    module: moduleNamespace,
    packageDigest: enabled.packageLock.digest,
  });
  assert.equal(activated.contributions.length, 1);
  await activated.dispose();
  await assert.rejects(
    service.readEnabledModuleFile({
      packageDigest: `sha256:${'f'.repeat(64)}`,
      path: enabled.manifest.runtime.entrypoint,
      pluginModuleId: enabled.pluginModuleId,
    }),
    /digest is stale/,
  );
  await assert.rejects(
    service.readEnabledModuleFile({
      packageDigest: enabled.packageLock.digest,
      path: '../retake.plugin.json',
      pluginModuleId: enabled.pluginModuleId,
    }),
    /outside dist/,
  );
  await service.assertPermission(
    'retake.plugin.whiteboard-runtime-fixture',
    'retake.asset.read.bound',
  );
  await assert.rejects(
    service.assertPermission(
      'retake.plugin.whiteboard-runtime-fixture',
      'retake.asset.create',
    ),
    /not granted/,
  );

  const restored = await new PluginRuntimeService({
    hostVersion: '0.1.2',
    workspaceRoot,
  }).reconcile();
  assert.equal(restored.modules[0]!.status, 'enabled');
  assert.equal(
    restored.modules[0]!.grant?.publisherId,
    'retake.publisher.official',
  );

  const safe = await service.setSafeMode(true);
  assert.equal(safe.safeMode, true);
  assert.equal(safe.modules[0]!.status, 'disabled');
  assert.equal(safe.modules[0]!.desiredState, 'enabled');
  assert.equal(
    (await new PluginRuntimeService({
      hostVersion: '0.1.2',
      workspaceRoot,
    }).reconcile()).safeMode,
    true,
  );
  await assert.rejects(
    service.enable('retake.plugin.whiteboard-runtime-fixture'),
    /safe mode/,
  );
  const normal = await service.setSafeMode(false);
  assert.equal(normal.safeMode, false);
  assert.equal(normal.modules[0]!.status, 'enabled');

  const sourceV2 = path.join(temporaryRoot, 'source-v2');
  await writePluginSource(sourceV2, {
    definitionHash: 'sha256:whiteboard-plugin-runtime-v2',
    permissions: [
      'retake.asset.create',
      'retake.asset.read.bound',
      'retake.draft.write.bound',
    ],
    version: '0.2.0',
  });
  await manager.install(sourceV2);
  const updated = await service.reconcile();
  assert.equal(updated.modules[0]!.manifest.version, '0.2.0');
  assert.equal(updated.modules[0]!.status, 'disabled');
  assert.equal(updated.modules[0]!.desiredState, 'enabled');
  assert.equal(updated.modules[0]!.grant, null);
  assert.equal(updated.modules[0]!.trust, null);
  await assert.rejects(
    service.enable('retake.plugin.whiteboard-runtime-fixture'),
    /exact permission Grant/,
  );

  await service.grant({
    permissions: [
      'retake.asset.create',
      'retake.asset.read.bound',
      'retake.draft.write.bound',
    ],
    pluginModuleId: 'retake.plugin.whiteboard-runtime-fixture',
  });
  await service.trustUserCode(
    'retake.plugin.whiteboard-runtime-fixture',
  );
  await service.enable('retake.plugin.whiteboard-runtime-fixture');
  const failed = await service.fail(
    'retake.plugin.whiteboard-runtime-fixture',
    'fixture sandbox crash',
  );
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure?.message, 'fixture sandbox crash');
  const disabledAfterFailure = await service.manageModule(
    'retake.plugin.whiteboard-runtime-fixture',
    'disable',
  );
  assert.equal(disabledAfterFailure.modules[0]!.status, 'disabled');
  const recoveredAfterFailure = await service.manageModule(
    'retake.plugin.whiteboard-runtime-fixture',
    'enable',
  );
  assert.equal(recoveredAfterFailure.modules[0]!.status, 'enabled');
  const failedAgain = await service.fail(
    'retake.plugin.whiteboard-runtime-fixture',
    'fixture sandbox crash',
  );
  assert.equal(failedAgain.status, 'failed');

  const statePath = path.join(
    manager.packagesRoot,
    pluginRuntimeStateFile,
  );
  const persisted = JSON.parse(await readFile(statePath, 'utf8')) as {
    modules: Array<{ status: string }>;
    schemaVersion: number;
  };
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.modules[0]!.status, 'failed');

  process.stdout.write(`${JSON.stringify({
    codeTrustSeparatedFromGrant: true,
    exactModuleFileAuthority: true,
    explicitGrantTrustAndEnable: true,
    fatalFailureExplicit: true,
    installDoesNotEnable: true,
    nativeModuleActivation: true,
    runtimeManagementReturnsSnapshot: true,
    permissionUpgradeRevokesGrant: true,
    persistedRuntimeState: pluginRuntimeStateFile,
    safeModePreservesDesiredState: true,
    workspaceWrites: 'disposable-only',
  })}\n`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

async function writePluginSource(
  sourceRoot: string,
  input: {
    definitionHash: string;
    permissions: string[];
    version: string;
  },
): Promise<void> {
  await mkdir(path.join(sourceRoot, 'src'), { recursive: true });
  await mkdir(
    path.join(sourceRoot, 'definitions'),
    { recursive: true },
  );
  const capabilityDefinition = {
    capabilityId: 'image.runtime_fixture',
    category: 'image_editing',
    definitionHash:
      `sha256:whiteboard-runtime-capability-${input.version}`,
    displayName: 'Runtime fixture',
    inputSlots: [{
      artifactTypes: [],
      bindingKinds: ['asset', 'block'],
      cardinality: 'one',
      dataTypes: ['image'],
      required: true,
      semanticRole: 'source',
      slotId: 'source_image',
    }],
    outputSlots: [{
      cardinality: 'one',
      dataType: 'image',
      projectionBlockTypes: ['image'],
      semanticRole: 'result',
      slotId: 'result_image',
    }],
    runtimeRequirements: ['browser.canvas_2d'],
    schemaVersion: 2,
    supportedAdapterClasses: ['local_canvas'],
    version: input.version,
  };
  await writeJson(path.join(sourceRoot, 'retake.package.json'), {
    build: {
      entrypoint: 'src/index.ts',
      profile: 'retake_web_plugin_v1',
      toolchain: retakeWebPluginV1Toolchain,
    },
    components: {
      agentPresets: [],
      pluginModules: [{
        definitionHash: input.definitionHash,
        definitionPath: 'retake.plugin.json',
        pluginModuleId: 'retake.plugin.whiteboard-runtime-fixture',
        resourcePaths: ['definitions/image.runtime_fixture.json'],
        version: input.version,
      }],
      skills: [],
      workflows: [],
    },
    dependencies: [],
    description: 'Whiteboard Plugin Runtime fixture.',
    entrypoints: [],
    files: [
      'definitions/image.runtime_fixture.json',
      'retake.plugin.json',
      'src/index.ts',
    ],
    integrity: 'sha256:auto',
    license: 'MIT',
    name: 'Whiteboard Plugin Runtime fixture',
    optionalDependencies: [],
    packageId: 'retake.package.whiteboard-runtime-fixture',
    permissions: [],
    publisher: {
      name: 'Retake',
      publisherId: 'retake.publisher.official',
    },
    retakeHostCompatibility: '^0.1.0',
    schemaVersion: 1,
    signature: null,
    version: input.version,
  });
  await writeJson(path.join(sourceRoot, 'retake.plugin.json'), {
    contributions: [{
      contributionId: 'retake.contribution.whiteboard-runtime-fixture',
      definitionHash: capabilityDefinition.definitionHash,
      definitionPath: 'definitions/image.runtime_fixture.json',
      exportName: 'fixtureContribution',
      kind: 'capability',
    }],
    definitionHash: input.definitionHash,
    description: 'Whiteboard Plugin Runtime fixture module.',
    name: 'Whiteboard Plugin Runtime fixture',
    permissions: input.permissions,
    pluginModuleId: 'retake.plugin.whiteboard-runtime-fixture',
    runtime: {
      entrypoint: 'dist/index.js',
      hostApi: {
        maximumVersion: 2,
        minimumVersion: 2,
      },
      kind: 'web_module',
    },
    schemaVersion: 2,
    version: input.version,
  });
  await writeJson(
    path.join(
      sourceRoot,
      'definitions',
      'image.runtime_fixture.json',
    ),
    capabilityDefinition,
  );
  await writeFile(
    path.join(sourceRoot, 'src', 'index.ts'),
    [
      `export const fixtureContribution = ${JSON.stringify({
        apiVersion: 2,
        definition: capabilityDefinition,
        kind: 'capability',
      })};`,
      'export function activate(context: { host: { getReadSnapshot(): { revision: string } } }) {',
      '  context.host.getReadSnapshot();',
      '  return { dispose() {} };',
      '}',
      '',
    ].join('\n'),
  );
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
