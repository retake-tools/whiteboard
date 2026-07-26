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
import { retakeWebPluginV1Toolchain } from '@retake-tools/package-sdk';
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
      'retake.package.read.self',
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

  const granted = await service.grant({
    permissions: [
      'retake.asset.read.bound',
      'retake.package.read.self',
    ],
    pluginModuleId: 'retake.plugin.whiteboard-runtime-fixture',
  });
  assert.equal(granted.status, 'installed');
  assert.equal(granted.grant?.grantedBy, 'user');
  await assert.rejects(
    service.enable('retake.plugin.whiteboard-runtime-fixture'),
    /Code Trust/,
  );
  const trusted = await service.trustUserCode(
    'retake.plugin.whiteboard-runtime-fixture',
  );
  assert.equal(trusted.trust?.trustChannel, 'user_trusted');
  assert.equal(trusted.trust?.updatePolicy, 'exact_digest');
  const enabled = await service.enable(
    'retake.plugin.whiteboard-runtime-fixture',
  );
  assert.equal(enabled.status, 'enabled');
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
      'retake.package.read.self',
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
      'retake.package.read.self',
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
    explicitGrantTrustAndEnable: true,
    fatalFailureExplicit: true,
    installDoesNotEnable: true,
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
        resourcePaths: [],
        version: input.version,
      }],
      skills: [],
      workflows: [],
    },
    dependencies: [],
    description: 'Whiteboard Plugin Runtime fixture.',
    entrypoints: [],
    files: [
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
      definitionHash: null,
      definitionPath: null,
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
        minimumVersion: 1,
      },
      kind: 'web_module',
    },
    schemaVersion: 1,
    version: input.version,
  });
  await writeFile(
    path.join(sourceRoot, 'src', 'index.ts'),
    'export const fixtureContribution = { kind: "capability" };\n',
  );
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
