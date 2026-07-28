import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DeclarativePackageManifest,
} from '@retake-tools/package-contracts';
import type {
  RegistryCatalogV1,
  TrustedRegistryRootV1,
  VerifiedTrustedRegistryCatalog,
} from '@retake-tools/package-sdk';
import {
  bootstrapDeclarativePackages,
  defaultBootstrapProfilePath,
  readBootstrapProfile,
} from './declarative-package-bootstrap-service';
import { LocalPackageManagerService } from './local-package-manager-service';
import { PackageUpdateService } from './package-update-service';
import { PackageUpdateBanner } from '../src/components/TopBar';
import type {
  PackageLifecycleControllerV1,
} from '../src/core/packageLifecycleClient';
import { I18nProvider } from '../src/i18n';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), 'retake-package-update-v1-'),
);

try {
  const profile = await readBootstrapProfile(defaultBootstrapProfilePath);
  const root = JSON.parse(await readFile(
    path.join(
      repositoryRoot,
      'vendor',
      'package-toolchain',
      '0.1.1',
      'official-registry-root.v1.json',
    ),
    'utf8',
  )) as TrustedRegistryRootV1;
  const verifiedCatalog = fakeCatalog(root, profile.packages);
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  await bootstrapDeclarativePackages({
    hostVersion: '0.1.2',
    profilePath: defaultBootstrapProfilePath,
    workspaceRoot,
  });
  const service = new PackageUpdateService({
    clock: () => '2026-07-28T16:00:00.000Z',
    hostVersion: '0.1.2',
    loadOfficialCatalog: async () => verifiedCatalog,
    workspaceRoot,
  });
  const available = await service.check();
  assert.equal(available.checkedAt, '2026-07-28T16:00:00.000Z');
  assert.deepEqual(
    available.checks.map((entry) => ({
      candidate: entry.candidate?.version ?? null,
      packageId: entry.packageId,
      status: entry.status,
    })),
    [
      {
        candidate: '0.11.0',
        packageId: 'design.retake.image-studio',
        status: 'available',
      },
      {
        candidate: '0.1.1',
        packageId: 'design.retake.video-studio',
        status: 'current',
      },
    ],
  );
  const unpublishedService = new PackageUpdateService({
    hostVersion: '0.1.2',
    loadOfficialCatalog: async () => ({
      ...verifiedCatalog,
      catalog: {
        ...verifiedCatalog.catalog,
        packages: [],
      },
    }),
    workspaceRoot,
  });
  const unpublished = await unpublishedService.check();
  assert.deepEqual(
    unpublished.checks.map((entry) => entry.status),
    ['unsupported', 'unsupported'],
  );

  const pinnedSource = path.join(temporaryRoot, 'pinned-image-studio');
  await createPinnedPackageSource(pinnedSource);
  await new LocalPackageManagerService({
    hostVersion: '0.1.2',
    workspaceRoot,
  }).install(pinnedSource);
  const pinned = await service.check();
  const pinnedImage = pinned.checks.find(
    (entry) => entry.packageId === 'design.retake.image-studio',
  );
  assert.equal(pinnedImage?.status, 'pinned');
  assert.equal(pinnedImage?.candidate, null);
  assert.match(pinnedImage?.detail ?? '', /version pin/i);

  let dismissalValue: string | null = null;
  const localStorageFixture = {
    getItem: (key: string) => (
      key === 'retake.package-update-dismissals.v1'
        ? dismissalValue
        : 'en'
    ),
    setItem: (_key: string, value: string) => {
      dismissalValue = value;
    },
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: localStorageFixture },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: localStorageFixture,
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { language: 'en-US' },
  });
  const controller = updateController(available);
  assert.match(renderUpdateBanner(controller), /Plugin updates available/);
  const imageCandidate = available.checks[0]!.candidate!;
  dismissalValue = JSON.stringify([
    `${available.checks[0]!.packageId}:${
      imageCandidate.version
    }:${imageCandidate.digest}`,
  ]);
  assert.equal(renderUpdateBanner(controller), '');

  process.stdout.write(`${JSON.stringify({
    currentDetected: true,
    dismissibleTopBannerRendered: true,
    signedCatalogCandidateProjected: true,
    unpublishedOfficialPackageIsNotAnError: true,
    updateAvailableDetected: true,
    versionPinSuppressesCandidate: true,
  })}\n`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

function renderUpdateBanner(
  controller: PackageLifecycleControllerV1,
): string {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(PackageUpdateBanner, {
        controller,
        onOpen: () => {},
      }),
    ),
  );
}

function updateController(
  snapshot: Awaited<ReturnType<PackageUpdateService['check']>>,
): PackageLifecycleControllerV1 {
  return {
    checkUpdates: async () => snapshot,
    getDevelopmentSnapshot: () => undefined,
    getSnapshot: () => undefined,
    getUpdateSnapshot: () => snapshot,
    mutate: async () => {
      throw new Error('Update banner fixture does not mutate Packages.');
    },
    mutateDevelopment: async () => {
      throw new Error('Update banner fixture does not mutate development links.');
    },
    refresh: async () => {
      throw new Error('Update banner fixture does not refresh Packages.');
    },
    refreshDevelopment: async () => {
      throw new Error('Update banner fixture does not refresh development links.');
    },
    subscribe: () => () => {},
  };
}

function fakeCatalog(
  root: TrustedRegistryRootV1,
  packages: Array<{
    archiveDigest: string;
    digest: string;
    packageId: string;
    version: string;
  }>,
): VerifiedTrustedRegistryCatalog {
  const catalog: RegistryCatalogV1 = {
    advisories: [],
    catalogVersion: 3,
    expiresAt: '2027-07-28T00:00:00.000Z',
    issuedAt: '2026-07-28T00:00:00.000Z',
    packages: packages.map((entry) => {
      const isImage = entry.packageId === 'design.retake.image-studio';
      const version = isImage ? '0.11.0' : entry.version;
      const digest = isImage ? `sha256:${'1'.repeat(64)}` : entry.digest;
      const archiveDigest = isImage
        ? `sha256:${'2'.repeat(64)}`
        : entry.archiveDigest;
      return {
        channels: [{
          archiveDigest,
          channel: 'stable',
          digest,
          version,
        }],
        description: `${entry.packageId} update fixture.`,
        name: entry.packageId,
        packageId: entry.packageId,
        publisher: {
          name: 'Retake',
          publisherId: 'retake.publisher.official',
        },
        releases: [{
          archiveDigest,
          archiveSizeBytes: 1024,
          dependencies: [],
          digest,
          optionalDependencies: [],
          permissions: [],
          publishedAt: '2026-07-28T00:00:00.000Z',
          retakeHostCompatibility: '^0.1.0',
          status: 'active',
          version,
        }],
      };
    }),
    registryId: root.registryId,
    schemaVersion: 1,
    type: 'retake.registry.catalog',
  };
  return {
    catalog,
    root,
    state: {
      catalogDigest: `sha256:${'3'.repeat(64)}`,
      catalogExpiresAt: catalog.expiresAt,
      catalogVersion: catalog.catalogVersion,
      registryId: catalog.registryId,
      releases: [],
      rootExpiresAt: root.expiresAt,
      rootVersion: root.rootVersion,
      schemaVersion: 1,
    },
    validSignatureKeyIds: [root.keys[0]!.keyId],
    verified: true,
  };
}

async function createPinnedPackageSource(outputRoot: string): Promise<void> {
  const manifest: DeclarativePackageManifest = {
    components: {
      agentPresets: [],
      pluginModules: [],
      skills: [],
      workflows: [],
    },
    dependencies: [],
    description: 'Pinned Image Studio update fixture.',
    entrypoints: [],
    files: ['README.md'],
    integrity: 'sha256:auto',
    license: 'MIT',
    name: 'Pinned Image Studio',
    optionalDependencies: [],
    packageId: 'design.retake.image-studio',
    permissions: [],
    publisher: {
      name: 'Retake Test',
      publisherId: 'test.publisher',
    },
    retakeHostCompatibility: '^0.1.0',
    schemaVersion: 1,
    signature: null,
    version: '0.9.9',
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
