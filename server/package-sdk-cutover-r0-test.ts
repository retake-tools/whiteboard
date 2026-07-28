import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as packageContracts from '@retake-tools/package-contracts';
import * as packageSdk from '@retake-tools/package-sdk';
import * as declarativePackageService from './declarative-package-service';
import { LocalPackageManagerService } from './local-package-manager-service';
import * as packageSemver from './package-semver';
import * as registryClient from './trusted-package-registry-client';
import * as registryDependencyResolver from './trusted-package-registry-dependency-resolver';
import * as registryInstaller from './trusted-package-registry-installer';
import * as registryResolver from './trusted-package-registry-resolver';
import * as registryStateStore from './trusted-package-registry-state-store';
import * as workspaceLock from './workspace-package-lock';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const artifactRoot = path.join(
  repositoryRoot,
  'vendor',
  'package-toolchain',
  '0.1.0',
);
const manifest = await readJson(
  path.join(artifactRoot, 'release-manifest.json'),
);
const source = await readJson(path.join(artifactRoot, 'source.json'));
const packageJson = await readJson(path.join(repositoryRoot, 'package.json'));
const packageLock = await readJson(path.join(repositoryRoot, 'package-lock.json'));

assert.deepEqual(source, {
  commit: '65219198a1ca4503a45090dbfe416d779fe7315c',
  repository: 'https://github.com/retake-tools/package',
  version: '0.1.0',
});
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.toolchainVersion, '0.1.0');
assert.equal(manifest.packages.length, 8);

for (const entry of manifest.packages) {
  const dependency = packageJson.dependencies[entry.name];
  assert.equal(
    dependency,
    `file:vendor/package-toolchain/0.1.0/${entry.file}`,
  );
  const bytes = await readFile(path.join(artifactRoot, entry.file));
  assert.equal(entry.bytes, bytes.byteLength);
  assert.equal(
    entry.sha256,
    `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
  );
  assert.equal(
    entry.integrity,
    `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
  );
  const installed = packageLock.packages[`node_modules/${entry.name}`];
  assert.equal(installed.version, entry.version);
  assert.equal(installed.integrity, entry.integrity);
  assert.equal(installed.resolved, dependency);
}

assert.equal(
  declarativePackageService.packDeclarativePackage,
  packageSdk.packDeclarativePackage,
);
assert.equal(
  declarativePackageService.readMaterializedPackageArchive,
  packageSdk.readMaterializedPackageArchive,
);
assert.equal(
  packageSemver.packageVersionSatisfies,
  packageContracts.packageVersionSatisfies,
);
assert.equal(
  workspaceLock.parseWorkspacePackageLock,
  packageSdk.parseWorkspacePackageLock,
);
assert.equal(
  registryClient.fetchTrustedRegistryCatalog,
  packageSdk.fetchTrustedRegistryCatalog,
);
assert.equal(
  registryResolver.resolveTrustedRegistryCandidate,
  packageSdk.resolveTrustedRegistryCandidate,
);
assert.equal(
  registryDependencyResolver.resolveTrustedRegistryPackageClosure,
  packageSdk.resolveTrustedRegistryPackageClosure,
);
assert.equal(
  registryInstaller.downloadVerifiedTrustedRegistryArchive,
  packageSdk.downloadVerifiedTrustedRegistryArchive,
);
assert.equal(
  registryStateStore.TrustedPackageRegistryStateStore,
  packageSdk.TrustedPackageRegistryStateStore,
);
assert.equal(packageSdk.retakeNoneBuildToolchain, 'retake_none@1');
assert.equal(packageSdk.retakeWebPluginV1OutputPath, 'dist/index.js');
assert.equal(
  packageSdk.retakeWebPluginV1Toolchain,
  'retake_web_plugin_v1@2+esbuild@0.28.1',
);
assert.equal(
  packageSdk.retakeWebPluginV1BuildProvenancePath,
  'retake.build.json',
);

const manager = new LocalPackageManagerService({
  hostVersion: '0.1.2',
  workspaceRoot: path.join(repositoryRoot, '.retake-test-package-sdk-cutover-r0'),
});
assert.equal(manager.sdkManager instanceof packageSdk.PackageManager, true);
assert.equal(manager.packagesRoot, manager.sdkManager.packagesRoot);

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), 'retake-controlled-build-cutover-'),
);
try {
  const sourceRoot = path.join(temporaryRoot, 'source');
  await mkdir(path.join(sourceRoot, 'src'), { recursive: true });
  await writeFile(
    path.join(sourceRoot, 'retake.package.json'),
    `${JSON.stringify({
      build: {
        entrypoint: 'src/index.ts',
        profile: 'retake_web_plugin_v1',
        toolchain: packageSdk.retakeWebPluginV1Toolchain,
      },
      components: {
        agentPresets: [],
        pluginModules: [{
          definitionHash: 'sha256:whiteboard-controlled-build-v1',
          definitionPath: 'retake.plugin.json',
          pluginModuleId: 'retake.plugin.controlled-build-fixture',
          resourcePaths: [],
          version: '0.1.0',
        }],
        skills: [],
        workflows: [],
      },
      dependencies: [],
      description: 'Whiteboard controlled build fixture',
      entrypoints: [],
      files: [
        'package.json',
        'retake.plugin.json',
        'src/index.ts',
      ],
      integrity: 'sha256:auto',
      license: 'MIT',
      name: 'Whiteboard controlled build fixture',
      optionalDependencies: [],
      packageId: 'retake.package.controlled-build-fixture',
      permissions: [],
      publisher: {
        name: 'Retake',
        publisherId: 'retake.publisher.official',
      },
      retakeHostCompatibility: '^0.1.0',
      schemaVersion: 1,
      signature: null,
      version: '0.1.0',
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(sourceRoot, 'package.json'),
    `${JSON.stringify({
      scripts: {
        postinstall: 'node -e "require(\'node:fs\').writeFileSync(\'lifecycle-ran\', \'\')"',
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(sourceRoot, 'retake.plugin.json'),
    `${JSON.stringify({
      contributions: [],
      definitionHash: 'sha256:whiteboard-controlled-build-v1',
      description: 'Whiteboard controlled build fixture module',
      name: 'Whiteboard controlled build fixture',
      permissions: ['retake.asset.read.bound'],
      pluginModuleId: 'retake.plugin.controlled-build-fixture',
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
    }, null, 2)}\n`,
  );
  await writeFile(
    path.join(sourceRoot, 'src', 'index.ts'),
    'export const pluginId = "retake.plugin.controlled-build-fixture";\n',
  );

  const [firstBuild, secondBuild] = await Promise.all([
    packageSdk.materializePackageSource(sourceRoot),
    packageSdk.materializePackageSource(sourceRoot),
  ]);
  assert.equal(firstBuild.digest, secondBuild.digest);
  assert.deepEqual(firstBuild.build, secondBuild.build);
  assert.equal(firstBuild.build.profile, 'retake_web_plugin_v1');
  assert.equal(firstBuild.build.toolchain, packageSdk.retakeWebPluginV1Toolchain);
  assert.deepEqual(
    [...firstBuild.files.keys()],
    [
      packageSdk.retakeWebPluginV1OutputPath,
      packageSdk.retakeWebPluginV1BuildProvenancePath,
      'retake.plugin.json',
    ],
  );
  const buildProvenance = JSON.parse(
    firstBuild.files
      .get(packageSdk.retakeWebPluginV1BuildProvenancePath)!
      .toString('utf8'),
  );
  assert.equal(buildProvenance.profile, 'retake_web_plugin_v1');
  assert.equal(buildProvenance.toolchain, packageSdk.retakeWebPluginV1Toolchain);
  assert.deepEqual(buildProvenance.dependencies, []);
  assert.equal(firstBuild.definitions.pluginModules.size, 1);
  assert.notEqual(firstBuild.source.sourceDigest, firstBuild.digest);
  await assert.rejects(
    access(path.join(sourceRoot, 'lifecycle-ran')),
    (error: unknown) => (
      error instanceof Error
      && 'code' in error
      && error.code === 'ENOENT'
    ),
  );

  const controlledManager = new LocalPackageManagerService({
    hostVersion: '0.1.2',
    workspaceRoot: path.join(temporaryRoot, 'workspace'),
  });
  const installed = await controlledManager.install(sourceRoot);
  assert.equal(installed.lockfile.installations.length, 1);
  const installation = installed.lockfile.installations[0]!;
  assert.deepEqual(installation.build, firstBuild.build);
  assert.equal(installation.sourceDigest, firstBuild.source.sourceDigest);
  assert.equal(installation.digest, firstBuild.digest);
  const [installedPackage] = await controlledManager.sdkManager.loadInstalledPackages();
  assert.deepEqual(
    [...installedPackage!.files.keys()],
    [
      packageSdk.retakeWebPluginV1OutputPath,
      packageSdk.retakeWebPluginV1BuildProvenancePath,
      'retake.plugin.json',
    ],
  );
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

const removedPortableImplementations = [
  'server/deterministic-package-tar.ts',
  'server/local-package-dependency-resolver.ts',
];
for (const relativePath of removedPortableImplementations) {
  await assert.rejects(
    access(path.join(repositoryRoot, relativePath)),
    (error: unknown) => (
      error instanceof Error
      && 'code' in error
      && error.code === 'ENOENT'
    ),
  );
}

const adapterPaths = [
  'scripts/retake-package.ts',
  'server/declarative-package-service.ts',
  'server/local-package-manager-service.ts',
  'server/package-semver.ts',
  'server/trusted-package-registry-client.ts',
  'server/trusted-package-registry-contracts.ts',
  'server/trusted-package-registry-dependency-resolver.ts',
  'server/trusted-package-registry-installer.ts',
  'server/trusted-package-registry-resolver.ts',
  'server/trusted-package-registry-state-store.ts',
  'server/workspace-package-lock.ts',
  'src/core/declarativePackageContracts.ts',
  'src/core/declarativePackageDefinitionSchemas.ts',
  'src/core/declarativePackageDefinitionValidation.ts',
];
const adapterSources = await Promise.all(adapterPaths.map(async (relativePath) => ({
  relativePath,
  source: await readFile(path.join(repositoryRoot, relativePath), 'utf8'),
})));
assert.equal(
  adapterSources.reduce(
    (lines, entry) => lines + entry.source.split('\n').length,
    0,
  ) < 450,
  true,
);
for (const entry of adapterSources) {
  assert.match(
    entry.source,
    /@retake-tools\/package-(?:archive|cli|contracts|sdk)/,
    `${entry.relativePath} must delegate to the Package artifact.`,
  );
  assert.equal(entry.source.includes("from '../package"), false);
  assert.equal(entry.source.includes('node:crypto'), false);
  assert.equal(entry.source.includes('z.object('), false);
}

const dependencyText = JSON.stringify(packageJson.dependencies);
assert.equal(dependencyText.includes('file:../package'), false);
assert.equal(dependencyText.includes('/develop'), false);
assert.equal(dependencyText.includes('/main'), false);

process.stdout.write(`${JSON.stringify({
  adapterLines: adapterSources.reduce(
    (lines, entry) => lines + entry.source.split('\n').length,
    0,
  ),
  artifactCommit: source.commit,
  artifacts: manifest.packages.length,
  exactVersionAndIntegrity: true,
  fixedBuildProfiles: ['none', 'retake_web_plugin_v1'],
  pluginRuntimeArtifact: true,
  portableImplementationsRemoved: removedPortableImplementations.length,
  sdkAuthority: true,
})}\n`);

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
