import {
  comparePackageVersions,
  packageVersionSatisfies,
  parsePackageVersion,
} from './package-semver';
import type { VerifiedTrustedRegistryCatalog } from './trusted-package-registry-client';
import {
  validateRegistryRootBaseUrl,
  type RegistryAdvisoryV1,
  type RegistryPackageV1,
  type RegistryReleaseV1,
  type TrustedRegistryCandidateSelector,
  type TrustedRegistryRootV1,
} from './trusted-package-registry-contracts';

export interface TrustedRemotePackageCandidate {
  advisories: RegistryAdvisoryV1[];
  archiveDigest: string;
  archiveSizeBytes: number;
  catalogVersion: number;
  dependencies: RegistryReleaseV1['dependencies'];
  description: string;
  digest: string;
  name: string;
  optionalDependencies: RegistryReleaseV1['optionalDependencies'];
  packageId: string;
  publisher: RegistryPackageV1['publisher'];
  registryId: string;
  releaseStatus: RegistryReleaseV1['status'];
  retakeHostCompatibility: string;
  targetUrl: string;
  version: string;
  warnings: Array<{
    advisoryId?: string;
    kind: 'deprecated' | 'security_advisory';
    message: string;
  }>;
}

export type TrustedRegistryCandidateResolution =
  | {
    advisoryIds: string[];
    packageId: string;
    reason: 'release_yanked' | 'security_advisory';
    status: 'blocked';
    version?: string;
  }
  | {
    packageId: string;
    reason: 'channel_not_found' | 'no_eligible_release' | 'package_not_found' | 'release_not_found';
    status: 'not_found';
  }
  | {
    candidate: TrustedRemotePackageCandidate;
    status: 'resolved';
  };

export function resolveTrustedRegistryCandidate(input: {
  hostVersion: string;
  packageId: string;
  selector: TrustedRegistryCandidateSelector;
  verifiedCatalog: VerifiedTrustedRegistryCatalog;
}): TrustedRegistryCandidateResolution {
  parsePackageVersion(input.hostVersion);
  const selector = input.selector;
  const registryPackage = input.verifiedCatalog.catalog.packages.find(
    (entry) => entry.packageId === input.packageId,
  );
  if (!registryPackage) {
    return {
      packageId: input.packageId,
      reason: 'package_not_found',
      status: 'not_found',
    };
  }
  if (selector.kind === 'channel') {
    const channel = registryPackage.channels.find(
      (entry) => entry.channel === selector.channel,
    );
    if (!channel) {
      return {
        packageId: input.packageId,
        reason: 'channel_not_found',
        status: 'not_found',
      };
    }
    return resolutionForRelease(
      input.verifiedCatalog,
      registryPackage,
      requiredRelease(registryPackage, channel.version),
      input.hostVersion,
    );
  }
  if (selector.kind === 'exact') {
    parsePackageVersion(selector.version);
    const release = registryPackage.releases.find(
      (entry) => entry.version === selector.version,
    );
    if (!release) {
      return {
        packageId: input.packageId,
        reason: 'release_not_found',
        status: 'not_found',
      };
    }
    return resolutionForRelease(
      input.verifiedCatalog,
      registryPackage,
      release,
      input.hostVersion,
    );
  }
  packageVersionSatisfies(input.hostVersion, selector.range);
  const releases = [...registryPackage.releases]
    .filter((release) => (
      release.status !== 'yanked'
      && packageVersionSatisfies(release.version, selector.range)
      && packageVersionSatisfies(input.hostVersion, release.retakeHostCompatibility)
    ))
    .sort((left, right) => comparePackageVersions(right.version, left.version));
  for (const release of releases) {
    const resolution = resolutionForRelease(
      input.verifiedCatalog,
      registryPackage,
      release,
      input.hostVersion,
    );
    if (resolution.status === 'resolved') return resolution;
  }
  return {
    packageId: input.packageId,
    reason: 'no_eligible_release',
    status: 'not_found',
  };
}

export function trustedRegistryTargetUrl(
  root: TrustedRegistryRootV1,
  archiveDigest: string,
): string {
  if (!/^sha256:[a-f0-9]{64}$/.test(archiveDigest)) {
    throw new Error('Trusted Registry archive digest is invalid.');
  }
  const baseUrl = validateRegistryRootBaseUrl(root.baseUrl);
  return new URL(
    `targets/sha256/${archiveDigest.slice('sha256:'.length)}.retakepkg`,
    baseUrl,
  ).href;
}

function resolutionForRelease(
  verifiedCatalog: VerifiedTrustedRegistryCatalog,
  registryPackage: RegistryPackageV1,
  release: RegistryReleaseV1,
  hostVersion: string,
): TrustedRegistryCandidateResolution {
  if (release.status === 'yanked') {
    return {
      advisoryIds: [],
      packageId: registryPackage.packageId,
      reason: 'release_yanked',
      status: 'blocked',
      version: release.version,
    };
  }
  if (!packageVersionSatisfies(hostVersion, release.retakeHostCompatibility)) {
    return {
      packageId: registryPackage.packageId,
      reason: 'no_eligible_release',
      status: 'not_found',
    };
  }
  const advisories = verifiedCatalog.catalog.advisories.filter((advisory) => (
    advisory.packageId === registryPackage.packageId
    && packageVersionSatisfies(release.version, advisory.affectedRange)
  ));
  const blocking = advisories.filter((advisory) => advisory.policy === 'block');
  if (blocking.length > 0) {
    return {
      advisoryIds: blocking.map((advisory) => advisory.advisoryId).sort(compareText),
      packageId: registryPackage.packageId,
      reason: 'security_advisory',
      status: 'blocked',
      version: release.version,
    };
  }
  const warnings: TrustedRemotePackageCandidate['warnings'] = [];
  if (release.status === 'deprecated') {
    warnings.push({
      kind: 'deprecated',
      message: `${registryPackage.packageId}@${release.version} is deprecated.`,
    });
  }
  for (const advisory of advisories) {
    if (advisory.policy === 'inform' || advisory.policy === 'warn') {
      warnings.push({
        advisoryId: advisory.advisoryId,
        kind: 'security_advisory',
        message: advisory.summary,
      });
    }
  }
  return {
    candidate: {
      advisories: structuredClone(advisories),
      archiveDigest: release.archiveDigest,
      archiveSizeBytes: release.archiveSizeBytes,
      catalogVersion: verifiedCatalog.catalog.catalogVersion,
      dependencies: structuredClone(release.dependencies),
      description: registryPackage.description,
      digest: release.digest,
      name: registryPackage.name,
      optionalDependencies: structuredClone(release.optionalDependencies),
      packageId: registryPackage.packageId,
      publisher: structuredClone(registryPackage.publisher),
      registryId: verifiedCatalog.catalog.registryId,
      releaseStatus: release.status,
      retakeHostCompatibility: release.retakeHostCompatibility,
      targetUrl: trustedRegistryTargetUrl(verifiedCatalog.root, release.archiveDigest),
      version: release.version,
      warnings,
    },
    status: 'resolved',
  };
}

function requiredRelease(
  registryPackage: RegistryPackageV1,
  version: string,
): RegistryReleaseV1 {
  const release = registryPackage.releases.find((entry) => entry.version === version);
  if (!release) throw new Error(`Trusted Registry channel release is missing: ${version}`);
  return release;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
