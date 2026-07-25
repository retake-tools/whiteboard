import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  open,
  rm,
  unlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  materializeDeclarativePackage,
  type MaterializedDeclarativePackage,
} from './declarative-package-service';
import {
  LocalPackageManagerService,
  type LocalPackageInstallResult,
  type VerifiedRemotePackageArchive,
} from './local-package-manager-service';
import { comparePackageVersions } from './package-semver';
import type { VerifiedTrustedRegistryCatalog } from './trusted-package-registry-client';
import type { TrustedRegistryCandidateSelector } from './trusted-package-registry-contracts';
import {
  resolveTrustedRegistryPackageClosure,
} from './trusted-package-registry-dependency-resolver';
import {
  resolveTrustedRegistryCandidate,
  trustedRegistryTargetUrl,
  type TrustedRemotePackageCandidate,
} from './trusted-package-registry-resolver';

export const trustedRegistryPackageMediaType = 'application/vnd.retake.package';
const defaultPackageDownloadTimeoutMs = 30_000;

export interface TrustedRegistryRemoteInstallResult
  extends LocalPackageInstallResult {
  action: 'install' | 'update';
  catalogVersion: number;
  installedCandidates: Array<{
    archiveDigest: string;
    digest: string;
    packageId: string;
    version: string;
  }>;
  registryId: string;
  warnings: TrustedRemotePackageCandidate['warnings'];
}

export async function installTrustedRegistryPackage(input: {
  action: 'install' | 'update';
  fetchImpl?: typeof fetch;
  manager: LocalPackageManagerService;
  packageId: string;
  selector: TrustedRegistryCandidateSelector;
  signal?: AbortSignal;
  temporaryRoot?: string;
  timeoutMs?: number;
  verifiedCatalog: VerifiedTrustedRegistryCatalog;
}): Promise<TrustedRegistryRemoteInstallResult> {
  const resolution = resolveTrustedRegistryCandidate({
    hostVersion: input.manager.hostVersion,
    packageId: input.packageId,
    selector: input.selector,
    verifiedCatalog: input.verifiedCatalog,
  });
  if (resolution.status !== 'resolved') {
    throw new Error(
      `Trusted Registry Package cannot be installed: ${input.packageId} (${resolution.reason}).`,
    );
  }
  await assertExplicitInstallAction(input.action, input.manager, resolution.candidate);
  const closure = resolveTrustedRegistryPackageClosure({
    hostVersion: input.manager.hostVersion,
    root: resolution.candidate,
    verifiedCatalog: input.verifiedCatalog,
  });
  const parent = path.resolve(input.temporaryRoot ?? tmpdir());
  await mkdir(parent, { recursive: true });
  const temporaryDirectory = await mkdtemp(path.join(parent, 'retake-registry-download-'));
  try {
    const downloaded: VerifiedRemotePackageArchive[] = [];
    for (const candidate of [closure.root, ...closure.dependencies]) {
      downloaded.push(await downloadVerifiedTrustedRegistryArchive({
        candidate,
        fetchImpl: input.fetchImpl,
        hostVersion: input.manager.hostVersion,
        outputDirectory: temporaryDirectory,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        verifiedCatalog: input.verifiedCatalog,
      }));
    }
    const installed = await input.manager.installVerifiedRemote(
      downloaded[0]!,
      downloaded.slice(1),
      input.action,
    );
    return {
      ...installed,
      action: input.action,
      catalogVersion: input.verifiedCatalog.catalog.catalogVersion,
      installedCandidates: [closure.root, ...closure.dependencies].map((candidate) => ({
        archiveDigest: candidate.archiveDigest,
        digest: candidate.digest,
        packageId: candidate.packageId,
        version: candidate.version,
      })),
      registryId: input.verifiedCatalog.catalog.registryId,
      warnings: closure.warnings,
    };
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

export async function downloadVerifiedTrustedRegistryArchive(input: {
  candidate: TrustedRemotePackageCandidate;
  fetchImpl?: typeof fetch;
  hostVersion: string;
  outputDirectory: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  verifiedCatalog: VerifiedTrustedRegistryCatalog;
}): Promise<VerifiedRemotePackageArchive> {
  const candidate = assertCandidateMatchesCatalog(
    input.candidate,
    input.hostVersion,
    input.verifiedCatalog,
  );
  const expectedUrl = trustedRegistryTargetUrl(
    input.verifiedCatalog.root,
    candidate.archiveDigest,
  );
  const outputPath = path.join(
    path.resolve(input.outputDirectory),
    `${candidate.archiveDigest.slice('sha256:'.length)}.retakepkg`,
  );
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener('abort', forwardAbort, { once: true });
  if (input.signal?.aborted) forwardAbort();
  const timeout = setTimeout(
    () => controller.abort(new Error('timeout')),
    input.timeoutMs ?? defaultPackageDownloadTimeoutMs,
  );
  try {
    let response: Response;
    try {
      response = await (input.fetchImpl ?? fetch)(expectedUrl, {
        credentials: 'omit',
        headers: {
          accept: `${trustedRegistryPackageMediaType}, application/octet-stream`,
        },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          input.signal?.aborted
            ? 'Trusted Registry Package download was cancelled.'
            : 'Trusted Registry Package download timed out.',
        );
      }
      throw new Error(`Trusted Registry Package download failed: ${errorMessage(error)}`);
    }
    assertDownloadResponse(response, expectedUrl, candidate.archiveSizeBytes);
    let archiveDigest: string;
    try {
      archiveDigest = await writeVerifiedResponseBody({
        expectedBytes: candidate.archiveSizeBytes,
        outputPath,
        response,
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error(
          input.signal?.aborted
            ? 'Trusted Registry Package download was cancelled.'
            : 'Trusted Registry Package download timed out.',
        );
      }
      throw error;
    }
    if (archiveDigest !== candidate.archiveDigest) {
      throw new Error(`Trusted Registry Package archive digest mismatch: ${candidate.packageId}`);
    }
    if (controller.signal.aborted) {
      throw new Error(
        input.signal?.aborted
          ? 'Trusted Registry Package download was cancelled.'
          : 'Trusted Registry Package download timed out.',
      );
    }
    const materialized = await materializeDeclarativePackage(outputPath);
    assertCatalogManifestParity(candidate, materialized);
    return {
      source: {
        catalogVersion: candidate.catalogVersion,
        kind: 'remote_registry',
        publisherId: candidate.publisher.publisherId,
        registryId: candidate.registryId,
        rootVersion: input.verifiedCatalog.root.rootVersion,
        targetDigest: candidate.archiveDigest,
      },
      sourcePath: outputPath,
    };
  } catch (error) {
    await unlink(outputPath).catch(() => undefined);
    throw error;
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener('abort', forwardAbort);
  }
}

async function assertExplicitInstallAction(
  action: 'install' | 'update',
  manager: LocalPackageManagerService,
  candidate: TrustedRemotePackageCandidate,
): Promise<void> {
  const lockfile = await manager.list();
  const active = lockfile.resolvedPackages.find(
    (entry) => entry.packageId === candidate.packageId,
  );
  if (action === 'install') {
    if (active) {
      throw new Error(
        `Package is already active; use an explicit update or rollback: ${candidate.packageId}`,
      );
    }
    return;
  }
  if (!active) {
    throw new Error(`Package update requires an active Installation: ${candidate.packageId}`);
  }
  if (comparePackageVersions(candidate.version, active.version) <= 0) {
    throw new Error(
      `Package update must select a newer version; use rollback for older versions: ${candidate.packageId}`,
    );
  }
}

function assertCandidateMatchesCatalog(
  candidate: TrustedRemotePackageCandidate,
  hostVersion: string,
  verifiedCatalog: VerifiedTrustedRegistryCatalog,
): TrustedRemotePackageCandidate {
  const resolution = resolveTrustedRegistryCandidate({
    hostVersion,
    packageId: candidate.packageId,
    selector: { kind: 'exact', version: candidate.version },
    verifiedCatalog,
  });
  if (resolution.status !== 'resolved') {
    throw new Error(`Trusted Registry candidate is no longer eligible: ${candidate.packageId}`);
  }
  const expected = resolution.candidate;
  if (
    expected.registryId !== candidate.registryId
    || expected.catalogVersion !== candidate.catalogVersion
    || expected.archiveDigest !== candidate.archiveDigest
    || expected.archiveSizeBytes !== candidate.archiveSizeBytes
    || expected.digest !== candidate.digest
    || expected.targetUrl !== candidate.targetUrl
    || expected.publisher.publisherId !== candidate.publisher.publisherId
  ) throw new Error(`Trusted Registry candidate does not match its verified Catalog: ${candidate.packageId}`);
  return expected;
}

function assertDownloadResponse(
  response: Response,
  expectedUrl: string,
  expectedBytes: number,
): void {
  if (!response.ok) {
    throw new Error(`Trusted Registry Package download failed with HTTP ${response.status}.`);
  }
  if (response.redirected || (response.url && response.url !== expectedUrl)) {
    throw new Error('Trusted Registry Package redirects or response URL changes are not allowed.');
  }
  const contentEncoding = response.headers.get('content-encoding');
  if (contentEncoding && contentEncoding !== 'identity') {
    throw new Error('Trusted Registry Package HTTP content encoding is not allowed.');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
  if (
    contentType !== trustedRegistryPackageMediaType
    && contentType !== 'application/octet-stream'
  ) throw new Error('Trusted Registry Package Content-Type is invalid.');
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    if (!/^(?:0|[1-9]\d*)$/.test(contentLength) || Number(contentLength) !== expectedBytes) {
      throw new Error('Trusted Registry Package Content-Length does not match signed metadata.');
    }
  }
}

async function writeVerifiedResponseBody(input: {
  expectedBytes: number;
  outputPath: string;
  response: Response;
  signal: AbortSignal;
}): Promise<string> {
  const handle = await open(input.outputPath, 'wx', 0o600);
  const hash = createHash('sha256');
  let totalBytes = 0;
  try {
    const reader = input.response.body?.getReader();
    if (!reader) {
      const bytes = new Uint8Array(await input.response.arrayBuffer());
      await writeChunk(bytes);
    } else {
      while (true) {
        if (input.signal.aborted) throw new Error('Trusted Registry Package download was aborted.');
        const result = await reader.read();
        if (result.done) break;
        if (totalBytes + result.value.byteLength > input.expectedBytes) {
          await reader.cancel();
          throw new Error('Trusted Registry Package exceeds its signed byte length.');
        }
        await writeChunk(result.value);
      }
    }
    if (totalBytes !== input.expectedBytes) {
      throw new Error('Trusted Registry Package byte length does not match signed metadata.');
    }
    return `sha256:${hash.digest('hex')}`;
  } finally {
    await handle.close();
  }

  async function writeChunk(bytes: Uint8Array): Promise<void> {
    totalBytes += bytes.byteLength;
    if (totalBytes > input.expectedBytes) {
      throw new Error('Trusted Registry Package exceeds its signed byte length.');
    }
    hash.update(bytes);
    let offset = 0;
    while (offset < bytes.byteLength) {
      const result = await handle.write(
        bytes,
        offset,
        bytes.byteLength - offset,
        null,
      );
      if (result.bytesWritten === 0) {
        throw new Error('Trusted Registry Package temporary file write made no progress.');
      }
      offset += result.bytesWritten;
    }
  }
}

function assertCatalogManifestParity(
  candidate: TrustedRemotePackageCandidate,
  materialized: MaterializedDeclarativePackage,
): void {
  const manifest = materialized.manifest;
  const parity: Array<[unknown, unknown, string]> = [
    [materialized.archiveDigest, candidate.archiveDigest, 'archiveDigest'],
    [materialized.digest, candidate.digest, 'content digest'],
    [manifest.packageId, candidate.packageId, 'packageId'],
    [manifest.version, candidate.version, 'version'],
    [manifest.publisher.publisherId, candidate.publisher.publisherId, 'publisher identity'],
    [manifest.retakeHostCompatibility, candidate.retakeHostCompatibility, 'host compatibility'],
    [manifest.dependencies, candidate.dependencies, 'dependencies'],
    [manifest.optionalDependencies, candidate.optionalDependencies, 'optional dependencies'],
    [manifest.permissions, [], 'permissions'],
  ];
  for (const [actual, expected, label] of parity) {
    if (!sameJson(actual, expected)) {
      throw new Error(
        `Trusted Registry Package manifest does not match Catalog ${label}: ${candidate.packageId}`,
      );
    }
  }
}

function sameJson(
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
