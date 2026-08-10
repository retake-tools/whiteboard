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
import type { ResolvedGitPackageSource } from '@retake-tools/package-sdk';
import {
  bootstrapDeclarativePackages,
  defaultBootstrapProfilePath,
  readBootstrapProfile,
} from './declarative-package-bootstrap-service';
import {
  readMaterializedPackageArchive,
} from './declarative-package-service';
import { LocalPackageManagerService } from './local-package-manager-service';
import { PackageUpdateService } from './package-update-service';
import {
  PackageFailureBanner,
  PackageUpdateBanner,
} from '../src/components/TopBar';
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
  const resolveGitSource = gitResolverFixture(profile);
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  await bootstrapDeclarativePackages({
    hostVersion: '0.1.4',
    profilePath: defaultBootstrapProfilePath,
    workspaceRoot,
  });
  const service = new PackageUpdateService({
    clock: () => '2026-07-28T16:00:00.000Z',
    hostVersion: '0.1.4',
    resolveGitSource,
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
        candidate: '0.13.0',
        packageId: 'design.retake.image-studio',
        status: 'available',
      },
    ],
  );
  const pinnedSource = path.join(temporaryRoot, 'pinned-image-studio');
  await createPinnedPackageSource(pinnedSource);
  await new LocalPackageManagerService({
    hostVersion: '0.1.4',
    workspaceRoot,
  }).install(pinnedSource);
  const pinned = await service.check();
  const pinnedImage = pinned.checks.find(
    (entry) => entry.packageId === 'design.retake.image-studio',
  );
  assert.equal(pinnedImage?.status, 'pinned');
  assert.equal(pinnedImage?.candidate, null);
  assert.match(pinnedImage?.detail ?? '', /version pin/i);

  const updateWorkspace = path.join(temporaryRoot, 'update-workspace');
  await bootstrapDeclarativePackages({
    hostVersion: '0.1.4',
    profilePath: defaultBootstrapProfilePath,
    workspaceRoot: updateWorkspace,
  });
  let installedSource: string | null = null;
  const updateService = new PackageUpdateService({
    hostVersion: '0.1.4',
    installSource: async (source) => {
      installedSource = source;
    },
    resolveGitSource,
    workspaceRoot: updateWorkspace,
  });
  await updateService.update('design.retake.image-studio');
  assert.equal(
    installedSource,
    `git+https://github.com/retake-tools/image-studio.git#${
      new URLSearchParams({
        ref: '1'.repeat(40),
        subdirectory: 'plugin',
      }).toString()
    }`,
  );

  let dismissalValue: string | null = null;
  let localeValue = 'en';
  const localStorageFixture = {
    getItem: (key: string) => (
      key === 'retake.package-update-dismissals.v1'
        ? dismissalValue
        : key === 'retake.locale'
          ? localeValue
          : null
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
  const candidateFailureBanner = renderFailureBanner([{
    error: 'Unknown Workflow semantic key.',
    packageId: 'design.retake.image-studio',
    source: 'distribution',
    stage: 'candidate',
    version: '0.13.0',
  }]);
  assert.match(
    candidateFailureBanner,
    /1 Package update\(s\) not enabled; the current version remains available/,
  );
  assert.doesNotMatch(candidateFailureBanner, /were isolated/);
  assert.match(candidateFailureBanner, /View reason/);
  localeValue = 'zh';
  assert.match(
    renderFailureBanner([{
      error: 'Workflow 参数不受支持。',
      packageId: 'design.retake.image-studio',
      source: 'distribution',
      stage: 'candidate',
      version: '0.13.0',
    }]),
    /1个 Package 更新暂未启用，当前版本仍可使用/,
  );
  localeValue = 'en';
  assert.match(
    renderFailureBanner([{
      error: 'Installed Package cannot be loaded.',
      packageId: 'design.retake.image-studio',
      source: 'active',
      stage: 'load',
      version: '0.12.3',
    }]),
    /1 Package\(s\) failed to load and were isolated; Whiteboard remains available/,
  );
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
    isolatedFailureBannerRendered: true,
    githubUpstreamCandidateProjected: true,
    officialUpdatePinsExactGitCommit: true,
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

function renderFailureBanner(
  failures: Parameters<typeof PackageFailureBanner>[0]['failures'],
): string {
  return renderToStaticMarkup(
    createElement(
      I18nProvider,
      null,
      createElement(PackageFailureBanner, { failures }),
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

function gitResolverFixture(
  profile: Awaited<ReturnType<typeof readBootstrapProfile>>,
): (source: string | {
  repository: string;
  requestedRef: string | null;
  subdirectory: string;
}) => Promise<ResolvedGitPackageSource> {
  return async (source) => {
    const sourceText = typeof source === 'string'
      ? source
      : source.repository;
    const isImage = sourceText.includes('image-studio');
    const reference = profile.packages.find((entry) => (
      entry.packageId === (
        isImage
          ? 'design.retake.image-studio'
          : 'design.retake.video-studio'
      )
    ))!;
    const materialized = await readMaterializedPackageArchive(path.join(
      repositoryRoot,
      'packages',
      'bootstrap',
      reference.archivePath,
    ));
    const repository = isImage
      ? 'https://github.com/retake-tools/image-studio.git'
      : 'https://github.com/retake-tools/video-studio.git';
    const subdirectory = isImage ? 'plugin' : 'package';
    const version = isImage ? '0.13.0' : reference.version;
    const digest = isImage ? `sha256:${'1'.repeat(64)}` : reference.digest;
    return {
      materialized: {
        ...materialized,
        digest,
        manifest: {
          ...materialized.manifest,
          version,
        },
        source: {
          commit: isImage ? '1'.repeat(40) : '2'.repeat(40),
          kind: 'git',
          path: repository,
          repository,
          requestedRef: 'main',
          resolvedAt: '2026-07-28T16:00:00.000Z',
          sourceDigest: `sha256:${'4'.repeat(64)}`,
          subdirectory,
        },
      },
      spec: {
        repository,
        requestedRef: 'main',
        subdirectory,
      },
    };
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
