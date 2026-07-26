import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  DeclarativePackageDependency,
  DeclarativePackageManifest,
} from '../src/core/declarativePackageContracts';
import {
  materializeDeclarativePackage,
  packDeclarativePackage,
} from './declarative-package-service';
import {
  LocalPackageManagerService,
  workspacePackageLockFile,
} from './local-package-manager-service';
import {
  registryCatalogSigningBytes,
  trustedRegistryKeyId,
  verifyTrustedRegistryCatalog,
} from './trusted-package-registry-client';
import type {
  RegistryCatalogV1,
  SignedRegistryCatalogV1,
  TrustedRegistryRootV1,
} from './trusted-package-registry-contracts';
import {
  downloadVerifiedTrustedRegistryArchive,
  installTrustedRegistryPackage,
  trustedRegistryPackageMediaType,
} from './trusted-package-registry-installer';
import {
  resolveTrustedRegistryCandidate,
  type TrustedRemotePackageCandidate,
} from './trusted-package-registry-resolver';
import {
  fetchTrustedRegistryCatalogWithState,
  TrustedPackageRegistryStateStore,
} from './trusted-package-registry-state-store';
import { parseWorkspacePackageLock } from './workspace-package-lock';

const hostVersion = '0.1.2';
const now = new Date('2026-07-25T12:00:00.000Z');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'retake-trusted-remote-install-v0-'));

try {
  const publisher = {
    name: 'Registry Test Publisher',
    publisherId: 'retake.publisher.remote-test',
  };
  const dependencyV1 = await createArchive('retake.package.remote-dependency', '1.0.0', {
    description: 'Remote dependency fixture.',
    publisher,
  });
  const dependencyV11 = await createArchive('retake.package.remote-dependency', '1.1.0', {
    description: 'Remote dependency fixture.',
    publisher,
  });
  const localOnlyDependencyV12 = await createArchive('retake.package.remote-dependency', '1.2.0', {
    description: 'Remote dependency fixture.',
    publisher,
  });
  const rootV1 = await createArchive('retake.package.remote-root', '1.0.0', {
    dependencies: [{ packageId: 'retake.package.remote-dependency', range: '^1.0.0' }],
    description: 'Remote root fixture.',
    publisher,
  });
  const rootV2 = await createArchive('retake.package.remote-root', '2.0.0', {
    dependencies: [{ packageId: 'retake.package.remote-dependency', range: '^1.0.0' }],
    description: 'Remote root fixture.',
    publisher,
  });
  const key = registryKeyPair();
  const root = registryRoot(key);
  const catalog = registryCatalog({
    dependency: [dependencyV1, dependencyV11],
    root: [rootV1, rootV2],
  });
  const verifiedCatalog = verifyTrustedRegistryCatalog({
    envelope: signedCatalog(catalog, key),
    now,
    root,
  });
  const archiveByDigest = new Map(
    [dependencyV1, dependencyV11, rootV1, rootV2].map((fixture) => [
      fixture.materialized.archiveDigest,
      fixture.materialized.archive,
    ]),
  );
  const requests: Array<{
    acceptEncoding: string | null;
    credentials?: RequestCredentials;
    redirect?: RequestRedirect;
    url: string;
  }> = [];
  const fetchImpl = packageFetch(archiveByDigest, requests);
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  const downloadRoot = path.join(temporaryRoot, 'downloads');
  const manager = new LocalPackageManagerService({ hostVersion, workspaceRoot });
  const stateStore = new TrustedPackageRegistryStateStore({
    workspaceRoot: path.join(temporaryRoot, 'state-workspace'),
  });

  const statefulCatalog = await fetchTrustedRegistryCatalogWithState({
    fetchImpl: async () => new Response(JSON.stringify(signedCatalog(catalog, key)), {
      headers: { 'content-type': 'application/vnd.retake.registry+json' },
      status: 200,
    }),
    now,
    root,
    stateStore,
  });
  assert.deepEqual(
    await stateStore.read(root.registryId),
    statefulCatalog.state,
  );
  const stateLockPath = path.join(
    stateStore.stateRoot,
    `${root.registryId}.state.lock`,
  );
  await writeFile(stateLockPath, 'occupied\n');
  await assert.rejects(
    stateStore.write(statefulCatalog.state),
    /Another Trusted Registry state update is active/,
  );
  assert.equal(await readFile(stateLockPath, 'utf8'), 'occupied\n');
  await rm(stateLockPath);
  const equivocationCatalog = structuredClone(catalog);
  equivocationCatalog.issuedAt = '2026-07-25T11:30:00.000Z';
  await assert.rejects(
    fetchTrustedRegistryCatalogWithState({
      fetchImpl: async () => new Response(JSON.stringify(
        signedCatalog(equivocationCatalog, key),
      ), {
        headers: { 'content-type': 'application/vnd.retake.registry+json' },
        status: 200,
      }),
      now,
      root,
      stateStore,
    }),
    /catalog equivocation/,
  );
  assert.deepEqual(
    await stateStore.read(root.registryId),
    statefulCatalog.state,
  );

  const migrated = parseWorkspacePackageLock({
    hostVersion,
    installations: [],
    resolvedPackages: [],
    revision: 0,
    roots: [],
    schemaVersion: 1,
    updatedAt: new Date(0).toISOString(),
  });
  assert.equal(migrated.schemaVersion, 2);

  const installed = await installTrustedRegistryPackage({
    action: 'install',
    fetchImpl,
    manager,
    packageId: rootV1.manifest.packageId,
    selector: { kind: 'exact', version: rootV1.manifest.version },
    temporaryRoot: downloadRoot,
    verifiedCatalog,
  });
  assert.equal(installed.changed, true);
  assert.equal(installed.lockfile.schemaVersion, 2);
  assert.deepEqual(
    installed.lockfile.resolvedPackages.map((entry) => `${entry.packageId}@${entry.version}`),
    [
      'retake.package.remote-dependency@1.1.0',
      'retake.package.remote-root@1.0.0',
    ],
  );
  assert.equal(installed.installedCandidates.length, 2);
  assert.equal(requests.length, 2);
  assert.equal(requests.every((request) => (
    request.acceptEncoding === 'identity'
    && request.credentials === 'omit'
    && request.redirect === 'error'
  )), true);
  for (const installation of installed.lockfile.installations) {
    assert.equal(installation.source.kind, 'remote_registry');
    if (installation.source.kind !== 'remote_registry') throw new Error('Remote source expected.');
    assert.equal(installation.source.registryId, root.registryId);
    assert.equal(installation.source.rootVersion, root.rootVersion);
    assert.equal(installation.source.catalogVersion, catalog.catalogVersion);
    assert.equal(installation.source.targetDigest, installation.archiveDigest);
    assert.equal(JSON.stringify(installation.source).includes('https://'), false);
  }
  assert.deepEqual(await readdir(downloadRoot), []);

  const pinWorkspaceRoot = path.join(temporaryRoot, 'pin-workspace');
  const pinManager = new LocalPackageManagerService({
    hostVersion,
    workspaceRoot: pinWorkspaceRoot,
  });
  await pinManager.install(localOnlyDependencyV12.archivePath);
  await pinManager.remove(localOnlyDependencyV12.manifest.packageId);
  const pinnedRemoteInstall = await installTrustedRegistryPackage({
    action: 'install',
    fetchImpl,
    manager: pinManager,
    packageId: rootV1.manifest.packageId,
    selector: { kind: 'exact', version: rootV1.manifest.version },
    temporaryRoot: downloadRoot,
    verifiedCatalog,
  });
  assert.equal(
    pinnedRemoteInstall.lockfile.resolvedPackages.find(
      (entry) => entry.packageId === dependencyV11.manifest.packageId,
    )?.version,
    '1.1.0',
  );

  const callsBeforeDuplicate = requests.length;
  await assert.rejects(
    installTrustedRegistryPackage({
      action: 'install',
      fetchImpl,
      manager,
      packageId: rootV1.manifest.packageId,
      selector: { kind: 'exact', version: rootV1.manifest.version },
      temporaryRoot: downloadRoot,
      verifiedCatalog,
    }),
    /already active.*explicit update or rollback/,
  );
  assert.equal(requests.length, callsBeforeDuplicate);

  const updated = await installTrustedRegistryPackage({
    action: 'update',
    fetchImpl,
    manager,
    packageId: rootV2.manifest.packageId,
    selector: { kind: 'exact', version: rootV2.manifest.version },
    temporaryRoot: downloadRoot,
    verifiedCatalog,
  });
  assert.equal(updated.root.version, '2.0.0');
  assert.equal(updated.lockfile.installations.length, 3);
  await assert.rejects(
    installTrustedRegistryPackage({
      action: 'update',
      fetchImpl,
      manager,
      packageId: rootV1.manifest.packageId,
      selector: { kind: 'exact', version: rootV1.manifest.version },
      temporaryRoot: downloadRoot,
      verifiedCatalog,
    }),
    /must select a newer version.*rollback/,
  );
  const rolledBack = await manager.rollback(rootV1.manifest.packageId, rootV1.manifest.version);
  assert.equal(rolledBack.root.version, '1.0.0');

  const lockPath = path.join(workspaceRoot, 'packages', workspacePackageLockFile);
  const lockBeforeFailures = await readFile(lockPath);
  const rootCandidate = requiredCandidate(verifiedCatalog, rootV2.manifest.packageId, '2.0.0');
  const badDigestFetch: typeof fetch = async () => {
    const tampered = Buffer.from(rootV2.materialized.archive);
    tampered[Math.floor(tampered.byteLength / 2)]! ^= 0xff;
    return packageResponse(tampered);
  };
  await assert.rejects(
    installTrustedRegistryPackage({
      action: 'update',
      fetchImpl: badDigestFetch,
      manager,
      packageId: rootV2.manifest.packageId,
      selector: { kind: 'exact', version: rootV2.manifest.version },
      temporaryRoot: downloadRoot,
      verifiedCatalog,
    }),
    /archive digest mismatch/,
  );
  assert.deepEqual(await readFile(lockPath), lockBeforeFailures);
  assert.deepEqual(await readdir(downloadRoot), []);

  const invalidProfileCatalog = structuredClone(catalog);
  invalidProfileCatalog.catalogVersion += 1;
  invalidProfileCatalog.issuedAt = '2026-07-25T12:30:00.000Z';
  invalidProfileCatalog.packages.find(
    (entry) => entry.packageId === rootV2.manifest.packageId,
  )!.releases.find(
    (entry) => entry.version === rootV2.manifest.version,
  )!.dependencies[0]!.range = '~1.0.0';
  const invalidProfileVerified = verifyTrustedRegistryCatalog({
    envelope: signedCatalog(invalidProfileCatalog, key),
    now,
    root,
  });
  const parityCandidate = requiredCandidate(
    invalidProfileVerified,
    rootV2.manifest.packageId,
    rootV2.manifest.version,
  );
  await assert.rejects(
    downloadVerifiedTrustedRegistryArchive({
      candidate: parityCandidate,
      fetchImpl: packageFetch(archiveByDigest, []),
      hostVersion,
      outputDirectory: downloadRoot,
      verifiedCatalog: invalidProfileVerified,
    }),
    /does not match Catalog dependencies/,
  );

  await assert.rejects(
    downloadVerifiedTrustedRegistryArchive({
      candidate: rootCandidate,
      fetchImpl: async () => new Response(responseBody(rootV2.materialized.archive), {
        headers: { 'content-type': 'text/plain' },
        status: 200,
      }),
      hostVersion,
      outputDirectory: downloadRoot,
      verifiedCatalog,
    }),
    /Content-Type is invalid/,
  );
  await assert.rejects(
    downloadVerifiedTrustedRegistryArchive({
      candidate: rootCandidate,
      fetchImpl: async () => packageResponse(
        rootV2.materialized.archive,
        { 'content-encoding': 'gzip' },
      ),
      hostVersion,
      outputDirectory: downloadRoot,
      verifiedCatalog,
    }),
    /content encoding is not allowed/,
  );
  await assert.rejects(
    downloadVerifiedTrustedRegistryArchive({
      candidate: rootCandidate,
      fetchImpl: async () => packageResponse(
        rootV2.materialized.archive,
        { 'content-length': String(rootV2.materialized.archive.byteLength + 1) },
      ),
      hostVersion,
      outputDirectory: downloadRoot,
      verifiedCatalog,
    }),
    /Content-Length does not match/,
  );
  await assert.rejects(
    downloadVerifiedTrustedRegistryArchive({
      candidate: rootCandidate,
      fetchImpl: async () => {
        const response = packageResponse(rootV2.materialized.archive);
        Object.defineProperty(response, 'redirected', { value: true });
        return response;
      },
      hostVersion,
      outputDirectory: downloadRoot,
      verifiedCatalog,
    }),
    /redirects.*not allowed/,
  );
  await assert.rejects(
    downloadVerifiedTrustedRegistryArchive({
      candidate: rootCandidate,
      fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      }),
      hostVersion,
      outputDirectory: downloadRoot,
      timeoutMs: 5,
      verifiedCatalog,
    }),
    /timed out/,
  );
  const cancellationController = new AbortController();
  const cancelledDownload = downloadVerifiedTrustedRegistryArchive({
    candidate: rootCandidate,
    fetchImpl: async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    }),
    hostVersion,
    outputDirectory: downloadRoot,
    signal: cancellationController.signal,
    verifiedCatalog,
  });
  cancellationController.abort();
  await assert.rejects(cancelledDownload, /was cancelled/);
  assert.deepEqual(await readdir(downloadRoot), []);

  console.log(JSON.stringify({
    ok: true,
    archiveVerification: {
      digest: true,
      manifestCatalogParity: true,
      size: true,
    },
    explicitActions: ['install', 'update', 'rollback'],
    legacyLockMigration: 'v1-to-v2',
    networkBoundaries: {
      contentType: true,
      cancellation: true,
      credentialsOmitted: true,
      redirect: true,
      timeout: true,
    },
    remoteDependencyClosure: true,
    remoteProvenance: true,
    trustedStatePersistence: true,
    workspaceWrites: 'disposable-only',
  }));
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

interface ArchiveFixture {
  archivePath: string;
  manifest: DeclarativePackageManifest;
  materialized: Awaited<ReturnType<typeof materializeDeclarativePackage>>;
}

async function createArchive(
  packageId: string,
  version: string,
  options: {
    dependencies?: DeclarativePackageDependency[];
    description: string;
    publisher: DeclarativePackageManifest['publisher'];
  },
): Promise<ArchiveFixture> {
  const sourceRoot = path.join(
    temporaryRoot,
    'sources',
    `${packageId}-${version}`,
  );
  const archivePath = path.join(
    temporaryRoot,
    'archives',
    `${packageId}-${version}.retakepkg`,
  );
  const manifest: DeclarativePackageManifest = {
    components: {
      agentPresets: [],
      skills: [],
      workflows: [],
    },
    dependencies: options.dependencies ?? [],
    description: options.description,
    entrypoints: [],
    files: ['README.md'],
    integrity: 'sha256:auto',
    license: 'MIT',
    name: packageId,
    optionalDependencies: [],
    packageId,
    permissions: [],
    publisher: options.publisher,
    retakeHostCompatibility: '^0.1.0',
    schemaVersion: 1,
    signature: null,
    version,
  };
  await mkdir(sourceRoot, { recursive: true });
  await mkdir(path.dirname(archivePath), { recursive: true });
  await writeFile(
    path.join(sourceRoot, 'retake.package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(path.join(sourceRoot, 'README.md'), `${options.description}\n`);
  await packDeclarativePackage(sourceRoot, archivePath);
  return {
    archivePath,
    manifest,
    materialized: await materializeDeclarativePackage(archivePath),
  };
}

function registryCatalog(input: {
  dependency: ArchiveFixture[];
  root: ArchiveFixture[];
}): RegistryCatalogV1 {
  return {
    advisories: [],
    catalogVersion: 1,
    expiresAt: '2026-08-25T00:00:00.000Z',
    issuedAt: '2026-07-25T11:00:00.000Z',
    packages: [
      registryPackage(input.dependency, 'stable'),
      registryPackage(input.root, 'stable'),
    ],
    registryId: 'retake.registry.remote-install-test',
    schemaVersion: 1,
    type: 'retake.registry.catalog',
  };
}

function registryPackage(
  fixtures: ArchiveFixture[],
  channel: string,
): RegistryCatalogV1['packages'][number] {
  const latest = fixtures.at(-1)!;
  const channelFixture = latest;
  return {
    channels: [{
      archiveDigest: channelFixture.materialized.archiveDigest,
      channel,
      digest: channelFixture.materialized.digest,
      version: channelFixture.materialized.manifest.version,
    }],
    description: latest.materialized.manifest.description,
    name: latest.materialized.manifest.name,
    packageId: latest.materialized.manifest.packageId,
    publisher: latest.materialized.manifest.publisher,
    releases: fixtures.map((fixture) => ({
      archiveDigest: fixture.materialized.archiveDigest,
      archiveSizeBytes: fixture.materialized.archive.byteLength,
      dependencies: fixture.materialized.manifest.dependencies,
      digest: fixture.materialized.digest,
      optionalDependencies: fixture.materialized.manifest.optionalDependencies,
      permissions: [],
      publishedAt: '2026-07-01T00:00:00.000Z',
      retakeHostCompatibility: fixture.materialized.manifest.retakeHostCompatibility,
      status: 'active',
      version: fixture.materialized.manifest.version,
    })),
  };
}

function registryKeyPair(): {
  keyId: string;
  privateKey: KeyObject;
  publicKeyPem: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  return {
    keyId: trustedRegistryKeyId(publicKeyPem),
    privateKey,
    publicKeyPem,
  };
}

function registryRoot(
  key: { keyId: string; publicKeyPem: string },
): TrustedRegistryRootV1 {
  return {
    baseUrl: 'https://registry.example.test/v1/',
    expiresAt: '2027-07-25T00:00:00.000Z',
    keys: [{
      algorithm: 'ed25519',
      keyId: key.keyId,
      publicKeyPem: key.publicKeyPem,
    }],
    registryId: 'retake.registry.remote-install-test',
    roles: {
      catalog: {
        keyIds: [key.keyId],
        threshold: 1,
      },
    },
    rootVersion: 1,
    schemaVersion: 1,
  };
}

function signedCatalog(
  catalog: RegistryCatalogV1,
  key: { keyId: string; privateKey: KeyObject },
): SignedRegistryCatalogV1 {
  return {
    schemaVersion: 1,
    signatures: [{
      algorithm: 'ed25519',
      keyId: key.keyId,
      signatureBase64: sign(
        null,
        registryCatalogSigningBytes(catalog),
        key.privateKey,
      ).toString('base64'),
    }],
    signed: structuredClone(catalog),
  };
}

function packageFetch(
  archives: Map<string, Buffer>,
  requests: Array<{
    acceptEncoding: string | null;
    credentials?: RequestCredentials;
    redirect?: RequestRedirect;
    url: string;
  }>,
): typeof fetch {
  return async (url, init) => {
    const href = String(url);
    requests.push({
      acceptEncoding: new Headers(init?.headers).get('accept-encoding'),
      credentials: init?.credentials,
      redirect: init?.redirect,
      url: href,
    });
    const digest = /\/([a-f0-9]{64})\.retakepkg$/.exec(href)?.[1];
    const archive = digest ? archives.get(`sha256:${digest}`) : undefined;
    if (!archive) return new Response(null, { status: 404 });
    return packageResponse(archive);
  };
}

function packageResponse(
  archive: Buffer,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(responseBody(archive), {
    headers: {
      'content-length': String(archive.byteLength),
      'content-type': trustedRegistryPackageMediaType,
      ...extraHeaders,
    },
    status: 200,
  });
}

function responseBody(archive: Buffer): ArrayBuffer {
  return Uint8Array.from(archive).buffer;
}

function requiredCandidate(
  verifiedCatalog: ReturnType<typeof verifyTrustedRegistryCatalog>,
  packageId: string,
  version: string,
): TrustedRemotePackageCandidate {
  const resolution = resolveTrustedRegistryCandidate({
    hostVersion,
    packageId,
    selector: { kind: 'exact', version },
    verifiedCatalog,
  });
  if (resolution.status !== 'resolved') throw new Error(`Candidate missing: ${packageId}@${version}`);
  return resolution.candidate;
}
