import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  access,
  readFile,
} from 'node:fs/promises';
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
  commit: '3733987c06bb212b238b83bf866ed0a1db858f50',
  repository: 'https://github.com/retake-tools/package',
  version: '0.1.0',
});
assert.equal(manifest.schemaVersion, 1);
assert.equal(manifest.toolchainVersion, '0.1.0');
assert.equal(manifest.packages.length, 6);

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
  declarativePackageService.materializeDeclarativePackage,
  packageSdk.materializeDeclarativePackage,
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

const manager = new LocalPackageManagerService({
  hostVersion: '0.1.2',
  workspaceRoot: path.join(repositoryRoot, '.retake-test-package-sdk-cutover-r0'),
});
assert.equal(manager.sdkManager instanceof packageSdk.PackageManager, true);
assert.equal(manager.packagesRoot, manager.sdkManager.packagesRoot);

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
  portableImplementationsRemoved: removedPortableImplementations.length,
  sdkAuthority: true,
})}\n`);

async function readJson(filePath: string): Promise<any> {
  return JSON.parse(await readFile(filePath, 'utf8'));
}
