import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TrustedPackageRegistryStateStore,
  fetchTrustedRegistryCatalogWithState,
  resolveGitPackageSource,
  resolveTrustedRegistryCandidate,
  resolveTrustedRegistryPackageClosure,
  type PackageInstallationRecord,
  type TrustedRemotePackageCandidate,
  type VerifiedTrustedRegistryCatalog,
  type WorkspacePackageLock,
} from '@retake-tools/package-sdk';
import { comparePackageVersions } from '@retake-tools/package-contracts';
import type {
  PackageUpdateCandidateV1,
  PackageUpdateCheckV1,
  PackageUpdateSnapshotV1,
} from '../src/core/packageLifecycleContracts';
import {
  defaultBootstrapProfilePath,
  readBootstrapProfile,
} from './declarative-package-bootstrap-service';
import { LocalPackageManagerService } from './local-package-manager-service';
import {
  officialDefaultPackageIds,
} from './official-package-preference-store';
import {
  installTrustedRegistryPackage,
} from './trusted-package-registry-installer';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const officialRegistryRootPath = path.join(
  repositoryRoot,
  'vendor',
  'package-toolchain',
  '0.1.1',
  'official-registry-root.v1.json',
);
const officialRegistryId = 'retake.registry.official';

type Clock = () => string;
type OfficialCatalogLoader = () => Promise<VerifiedTrustedRegistryCatalog>;

export class PackageUpdateService {
  private readonly clock: Clock;
  private readonly hostVersion: string;
  private readonly loadCatalogOverride: OfficialCatalogLoader | undefined;
  private readonly manager: LocalPackageManagerService;
  private readonly workspaceRoot: string;

  constructor(input: {
    clock?: Clock;
    hostVersion: string;
    loadOfficialCatalog?: OfficialCatalogLoader;
    workspaceRoot: string;
  }) {
    this.clock = input.clock ?? (() => new Date().toISOString());
    this.hostVersion = input.hostVersion;
    this.loadCatalogOverride = input.loadOfficialCatalog;
    this.manager = new LocalPackageManagerService(input);
    this.workspaceRoot = input.workspaceRoot;
  }

  async check(): Promise<PackageUpdateSnapshotV1> {
    const [lockfile, profile] = await Promise.all([
      this.manager.list(),
      readBootstrapProfile(defaultBootstrapProfilePath),
    ]);
    let officialCatalog:
      | Promise<VerifiedTrustedRegistryCatalog>
      | undefined;
    const catalog = (): Promise<VerifiedTrustedRegistryCatalog> => {
      officialCatalog ??= this.loadOfficialCatalog();
      return officialCatalog;
    };
    const checks = await Promise.all(
      lockfile.roots.map(async (root): Promise<PackageUpdateCheckV1> => {
        const installation = activeRootInstallation(lockfile, root.packageId);
        try {
          if (installation.source.kind === 'git') {
            return await checkGitUpdate(installation);
          }
          const officialProfile = profile.packages.find(
            (entry) => entry.packageId === root.packageId,
          );
          const isOfficialRemote =
            installation.source.kind === 'remote_registry'
            && installation.source.registryId === officialRegistryId;
          if (officialProfile && !isOfficialRemote) {
            if (
              installation.version !== officialProfile.version
              || installation.digest !== officialProfile.digest
            ) {
              return baseCheck(installation, {
                detail: 'User version pin is active.',
                status: 'pinned',
              });
            }
          }
          if (
            !officialProfile
            && !isOfficialRemote
          ) {
            return baseCheck(installation, {
              detail: 'This Package source has no update discovery provider.',
              status: 'unsupported',
            });
          }
          return checkRegistryUpdate(
            installation,
            await catalog(),
            this.hostVersion,
          );
        } catch (error) {
          return baseCheck(installation, {
            detail: errorMessage(error),
            status: 'error',
          });
        }
      }),
    );
    return {
      checkedAt: this.clock(),
      checks: checks.sort((left, right) => (
        compareText(left.packageId, right.packageId)
      )),
      schemaVersion: 1,
    };
  }

  async update(packageId: string): Promise<void> {
    const lockfile = await this.manager.list();
    const installation = activeRootInstallation(lockfile, packageId);
    if (installation.source.kind === 'git') {
      await this.manager.updateGit(packageId);
      return;
    }
    const profile = await readBootstrapProfile(defaultBootstrapProfilePath);
    const isOfficialPackage = officialDefaultPackageIds.includes(
      packageId as typeof officialDefaultPackageIds[number],
    );
    const isOfficialRemote =
      installation.source.kind === 'remote_registry'
      && installation.source.registryId === officialRegistryId;
    if (!isOfficialPackage && !isOfficialRemote) {
      throw new Error(
        `Package update is unsupported for this source: ${packageId}`,
      );
    }
    if (isOfficialPackage && !isOfficialRemote) {
      const policy = profile.packages.find(
        (entry) => entry.packageId === packageId,
      );
      if (
        !policy
        || installation.version !== policy.version
        || installation.digest !== policy.digest
      ) {
        throw new Error(
          `Pinned official Package must be unpinned before update: ${packageId}`,
        );
      }
    }
    const verifiedCatalog = await this.loadOfficialCatalog();
    const resolution = resolveTrustedRegistryCandidate({
      hostVersion: this.hostVersion,
      packageId,
      selector: { channel: 'stable', kind: 'channel' },
      verifiedCatalog,
    });
    if (resolution.status !== 'resolved') {
      throw new Error(
        `No eligible stable update candidate exists: ${packageId}`,
      );
    }
    if (
      resolution.candidate.version === installation.version
      && resolution.candidate.digest === installation.digest
    ) {
      throw new Error(`Package is already current: ${packageId}`);
    }
    await installTrustedRegistryPackage({
      action: 'update',
      manager: this.manager,
      packageId,
      selector: {
        kind: 'exact',
        version: resolution.candidate.version,
      },
      verifiedCatalog,
    });
  }

  private async loadOfficialCatalog(): Promise<
    VerifiedTrustedRegistryCatalog
  > {
    if (this.loadCatalogOverride) return this.loadCatalogOverride();
    const root = JSON.parse(
      await readFile(officialRegistryRootPath, 'utf8'),
    ) as unknown;
    return fetchTrustedRegistryCatalogWithState({
      root,
      stateStore: new TrustedPackageRegistryStateStore({
        workspaceRoot: this.workspaceRoot,
      }),
    });
  }
}

async function checkGitUpdate(
  installation: PackageInstallationRecord,
): Promise<PackageUpdateCheckV1> {
  if (installation.source.kind !== 'git') {
    throw new Error('Git update check received a non-Git installation.');
  }
  const resolved = await resolveGitPackageSource({
    repository: installation.source.repository,
    requestedRef: installation.source.requestedRef,
    subdirectory: installation.source.subdirectory,
  });
  if (resolved.materialized.manifest.packageId !== installation.packageId) {
    throw new Error('Git update candidate changed Package identity.');
  }
  const candidate: PackageUpdateCandidateV1 = {
    archiveDigest: null,
    commit: resolved.materialized.source.kind === 'git'
      ? resolved.materialized.source.commit
      : null,
    digest: resolved.materialized.digest,
    notices: [],
    version: resolved.materialized.manifest.version,
  };
  const current = candidate.commit === installation.source.commit
    && candidate.digest === installation.digest;
  return baseCheck(installation, {
    candidate,
    detail: current ? null : 'Git source resolved to a new exact commit.',
    status: current ? 'current' : 'available',
  });
}

function checkRegistryUpdate(
  installation: PackageInstallationRecord,
  verifiedCatalog: VerifiedTrustedRegistryCatalog,
  hostVersion: string,
): PackageUpdateCheckV1 {
  const resolution = resolveTrustedRegistryCandidate({
    hostVersion,
    packageId: installation.packageId,
    selector: { channel: 'stable', kind: 'channel' },
    verifiedCatalog,
  });
  if (resolution.status !== 'resolved') {
    return baseCheck(installation, {
      detail: `Stable candidate is unavailable: ${resolution.reason}.`,
      status: resolution.reason === 'package_not_found'
        ? 'unsupported'
        : 'error',
    });
  }
  const closure = resolveTrustedRegistryPackageClosure({
    hostVersion,
    root: resolution.candidate,
    verifiedCatalog,
  });
  const candidate = projectRegistryCandidate(
    closure.root,
    closure.warnings,
  );
  if (
    candidate.version === installation.version
    && candidate.digest !== installation.digest
  ) {
    return baseCheck(installation, {
      detail: 'Registry returned different content for the installed version.',
      status: 'error',
    });
  }
  if (comparePackageVersions(candidate.version, installation.version) < 0) {
    return baseCheck(installation, {
      detail: 'Registry stable channel is older than the installed version.',
      status: 'current',
    });
  }
  const current = candidate.version === installation.version
    && candidate.digest === installation.digest;
  return baseCheck(installation, {
    candidate,
    detail: null,
    status: current ? 'current' : 'available',
  });
}

function projectRegistryCandidate(
  candidate: TrustedRemotePackageCandidate,
  warnings: TrustedRemotePackageCandidate['warnings'] = candidate.warnings,
): PackageUpdateCandidateV1 {
  return {
    archiveDigest: candidate.archiveDigest,
    commit: null,
    digest: candidate.digest,
    notices: warnings.map((notice) => ({ ...notice })),
    version: candidate.version,
  };
}

function activeRootInstallation(
  lockfile: WorkspacePackageLock,
  packageId: string,
): PackageInstallationRecord {
  const root = lockfile.roots.find((entry) => entry.packageId === packageId);
  const installation = root
    ? lockfile.installations.find(
      (entry) => entry.installationId === root.installationId,
    )
    : undefined;
  if (!installation) {
    throw new Error(`Active root Package is unavailable: ${packageId}`);
  }
  return installation;
}

function baseCheck(
  installation: PackageInstallationRecord,
  input: Pick<PackageUpdateCheckV1, 'detail' | 'status'> & {
    candidate?: PackageUpdateCandidateV1;
  },
): PackageUpdateCheckV1 {
  return {
    candidate: input.candidate ?? null,
    currentDigest: installation.digest,
    currentVersion: installation.version,
    detail: input.detail,
    packageId: installation.packageId,
    sourceKind: installation.source.kind,
    status: input.status,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
