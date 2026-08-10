import {
  resolveGitPackageSource,
  type PackageInstallationRecord,
  type ResolvedGitPackageSource,
  type WorkspacePackageLock,
} from '@retake-tools/package-sdk';
import { comparePackageVersions } from '@retake-tools/package-contracts';
import path from 'node:path';
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
  OfficialPackagePreferenceStore,
} from './official-package-preference-store';

type Clock = () => string;
type GitSourceResolver = typeof resolveGitPackageSource;
type SourceInstaller = (source: string) => Promise<void>;

export class PackageUpdateService {
  private readonly clock: Clock;
  private readonly installSource: SourceInstaller;
  private readonly manager: LocalPackageManagerService;
  private readonly resolveGitSource: GitSourceResolver;

  constructor(input: {
    clock?: Clock;
    hostVersion: string;
    installSource?: SourceInstaller;
    resolveGitSource?: GitSourceResolver;
    workspaceRoot: string;
  }) {
    this.clock = input.clock ?? (() => new Date().toISOString());
    this.manager = new LocalPackageManagerService(input);
    this.installSource = input.installSource
      ?? (async (source) => {
        await this.manager.install(source);
      });
    this.resolveGitSource = input.resolveGitSource ?? resolveGitPackageSource;
  }

  async check(): Promise<PackageUpdateSnapshotV1> {
    const [lockfile, profile] = await Promise.all([
      this.manager.list(),
      readBootstrapProfile(defaultBootstrapProfilePath),
    ]);
    const preferences = await new OfficialPackagePreferenceStore(
      this.manager.packagesRoot,
    ).read();
    const checks = await Promise.all(
      lockfile.roots.map(async (root): Promise<PackageUpdateCheckV1> => {
        const installation = activeRootInstallation(lockfile, root.packageId);
        try {
          const officialProfile = profile.packages.find(
            (entry) => entry.packageId === root.packageId,
          );
          if (installation.source.kind === 'git') {
            const source = officialProfile
              && preferences.upstreamManagedPackageIds.includes(
                installation.packageId,
              )
              ? officialProfile.updateSource
              : undefined;
            return await checkGitUpdate(
              installation,
              this.resolveGitSource,
              source,
            );
          }
          if (officialProfile) {
            if (
              (
                installation.version !== officialProfile.version
                || installation.digest !== officialProfile.digest
              )
              && !isBundledOfficialInstallation(installation)
            ) {
              return baseCheck(installation, {
                detail: 'User version pin is active.',
                status: 'pinned',
              });
            }
            return checkGitUpdate(
              installation,
              this.resolveGitSource,
              officialProfile.updateSource,
            );
          }
          return baseCheck(installation, {
            detail: 'This Package source has no update discovery provider.',
            status: 'unsupported',
          });
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
      const preferences = new OfficialPackagePreferenceStore(
        this.manager.packagesRoot,
      );
      const [profile, preferenceState] = await Promise.all([
        readBootstrapProfile(defaultBootstrapProfilePath),
        preferences.read(),
      ]);
      const policy = profile.packages.find(
        (entry) => entry.packageId === packageId,
      );
      if (
        policy
        && preferenceState.upstreamManagedPackageIds.includes(packageId)
      ) {
        await this.installOfficialGitUpdate(
          installation,
          policy.updateSource,
        );
        return;
      }
      await this.manager.updateGit(packageId);
      return;
    }
    const profile = await readBootstrapProfile(defaultBootstrapProfilePath);
    const policy = profile.packages.find(
      (entry) => entry.packageId === packageId,
    );
    if (!policy) {
      throw new Error(
        `Package update is unsupported for this source: ${packageId}`,
      );
    }
    if (
      installation.version !== policy.version
      || installation.digest !== policy.digest
    ) {
      throw new Error(
        `Pinned official Package must be unpinned before update: ${packageId}`,
      );
    }
    await this.installOfficialGitUpdate(
      installation,
      policy.updateSource,
    );
  }

  private async installOfficialGitUpdate(
    installation: PackageInstallationRecord,
    updateSource: string,
  ): Promise<void> {
    const resolved = await this.resolveGitSource(updateSource);
    if (resolved.materialized.manifest.packageId !== installation.packageId) {
      throw new Error('Git update candidate changed Package identity.');
    }
    if (
      comparePackageVersions(
        resolved.materialized.manifest.version,
        installation.version,
      ) < 0
    ) {
      throw new Error('Git update candidate is older than the installed version.');
    }
    if (resolved.materialized.digest === installation.digest) {
      throw new Error(`Package is already current: ${installation.packageId}`);
    }
    await this.installSource(exactGitSource(resolved));
    await new OfficialPackagePreferenceStore(
      this.manager.packagesRoot,
    ).setPackageUpstreamManaged(installation.packageId, true);
  }
}

function isBundledOfficialInstallation(
  installation: PackageInstallationRecord,
): boolean {
  return installation.source.kind === 'local_archive'
    && path.dirname(path.resolve(installation.source.path))
      === path.dirname(path.resolve(defaultBootstrapProfilePath));
}

async function checkGitUpdate(
  installation: PackageInstallationRecord,
  resolver: GitSourceResolver,
  updateSource?: string,
): Promise<PackageUpdateCheckV1> {
  if (!updateSource && installation.source.kind !== 'git') {
    throw new Error('Git update check requires an upstream source.');
  }
  const resolved = await resolver(
    updateSource ?? {
      repository: installation.source.kind === 'git'
        ? installation.source.repository
        : '',
      requestedRef: installation.source.kind === 'git'
        ? installation.source.requestedRef
        : null,
      subdirectory: installation.source.kind === 'git'
        ? installation.source.subdirectory
        : '',
    },
  );
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
  if (
    comparePackageVersions(candidate.version, installation.version) < 0
  ) {
    return baseCheck(installation, {
      candidate,
      detail: 'Git upstream is older than the installed version.',
      status: 'current',
    });
  }
  const current = candidate.digest === installation.digest
    && (
      updateSource !== undefined
      || (
        installation.source.kind === 'git'
        && candidate.commit === installation.source.commit
      )
    );
  return baseCheck(installation, {
    candidate,
    detail: current ? null : 'Git source resolved to a new exact commit.',
    status: current ? 'current' : 'available',
  });
}

function exactGitSource(resolved: ResolvedGitPackageSource): string {
  if (resolved.materialized.source.kind !== 'git') {
    throw new Error('Resolved Git Package has invalid provenance.');
  }
  const parameters = new URLSearchParams({
    ref: resolved.materialized.source.commit,
  });
  if (resolved.spec.subdirectory) {
    parameters.set('subdirectory', resolved.spec.subdirectory);
  }
  return `git+${resolved.spec.repository}#${parameters.toString()}`;
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
