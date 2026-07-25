import type { DeclarativePackageDependency } from '../src/core/declarativePackageContracts';
import {
  comparePackageVersions,
  packageVersionSatisfies,
  parsePackageVersion,
} from './package-semver';
import type { VerifiedTrustedRegistryCatalog } from './trusted-package-registry-client';
import {
  resolveTrustedRegistryCandidate,
  type TrustedRemotePackageCandidate,
} from './trusted-package-registry-resolver';

export interface TrustedRegistryPackageClosure {
  dependencies: TrustedRemotePackageCandidate[];
  root: TrustedRemotePackageCandidate;
  warnings: TrustedRemotePackageCandidate['warnings'];
}

interface ResolverState {
  constraints: Map<string, string[]>;
  edges: Map<string, DeclarativePackageDependency[]>;
  expanded: Set<string>;
  hostVersion: string;
  selected: Map<string, TrustedRemotePackageCandidate>;
  verifiedCatalog: VerifiedTrustedRegistryCatalog;
}

export function resolveTrustedRegistryPackageClosure(input: {
  hostVersion: string;
  root: TrustedRemotePackageCandidate;
  verifiedCatalog: VerifiedTrustedRegistryCatalog;
}): TrustedRegistryPackageClosure {
  parsePackageVersion(input.hostVersion);
  const root = candidateFromCatalog(
    input.root,
    input.hostVersion,
    input.verifiedCatalog,
  );
  const result = resolveRecursively({
    constraints: new Map([[root.packageId, [root.version]]]),
    edges: new Map(),
    expanded: new Set(),
    hostVersion: input.hostVersion,
    selected: new Map([[root.packageId, root]]),
    verifiedCatalog: input.verifiedCatalog,
  });
  if (!result) {
    throw new Error('Trusted Registry dependencies have no eligible single-version resolution.');
  }
  assertNoDependencyCycle(result.edges);
  const dependencies = [...result.selected.values()]
    .filter((candidate) => candidate.packageId !== root.packageId)
    .sort(compareCandidateIdentity);
  return {
    dependencies,
    root: structuredClone(root),
    warnings: [root, ...dependencies]
      .flatMap((candidate) => structuredClone(candidate.warnings)),
  };
}

function resolveRecursively(state: ResolverState): ResolverState | undefined {
  for (const [packageId, candidate] of state.selected) {
    if (!candidateMatches(candidate, state.constraints.get(packageId) ?? [])) {
      return undefined;
    }
  }
  const pending = [...state.selected.keys()]
    .sort(compareText)
    .find((packageId) => !state.expanded.has(packageId));
  if (pending) {
    const candidate = state.selected.get(pending)!;
    const constraints = cloneConstraints(state.constraints);
    for (const dependency of candidate.dependencies) addConstraint(constraints, dependency);
    return resolveOptionalDependencies({
      dependencyIndex: 0,
      edges: [...candidate.dependencies],
      optionalDependencies: candidate.optionalDependencies,
      packageId: pending,
      state: {
        ...state,
        constraints,
        expanded: new Set(state.expanded).add(pending),
      },
    });
  }
  const unresolved = [...state.constraints.keys()]
    .sort(compareText)
    .find((packageId) => !state.selected.has(packageId));
  if (!unresolved) return state;
  const ranges = state.constraints.get(unresolved)!;
  for (const candidate of eligibleCandidates(state, unresolved, ranges)) {
    const selected = new Map(state.selected).set(unresolved, candidate);
    const result = resolveRecursively({ ...state, selected });
    if (result) return result;
  }
  return undefined;
}

function resolveOptionalDependencies(input: {
  dependencyIndex: number;
  edges: DeclarativePackageDependency[];
  optionalDependencies: DeclarativePackageDependency[];
  packageId: string;
  state: ResolverState;
}): ResolverState | undefined {
  const dependency = input.optionalDependencies[input.dependencyIndex];
  if (!dependency) {
    const edges = new Map(input.state.edges).set(input.packageId, input.edges);
    return resolveRecursively({ ...input.state, edges });
  }
  const combinedRanges = [
    ...(input.state.constraints.get(dependency.packageId) ?? []),
    dependency.range,
  ];
  const selected = input.state.selected.get(dependency.packageId);
  const available = selected
    ? candidateMatches(selected, combinedRanges)
    : eligibleCandidates(input.state, dependency.packageId, combinedRanges).length > 0;
  if (available) {
    const constraints = cloneConstraints(input.state.constraints);
    addConstraint(constraints, dependency);
    const included = resolveOptionalDependencies({
      ...input,
      dependencyIndex: input.dependencyIndex + 1,
      edges: [...input.edges, dependency],
      state: { ...input.state, constraints },
    });
    if (included) return included;
  }
  return resolveOptionalDependencies({
    ...input,
    dependencyIndex: input.dependencyIndex + 1,
  });
}

function eligibleCandidates(
  state: ResolverState,
  packageId: string,
  ranges: string[],
): TrustedRemotePackageCandidate[] {
  const registryPackage = state.verifiedCatalog.catalog.packages.find(
    (entry) => entry.packageId === packageId,
  );
  if (!registryPackage) return [];
  return registryPackage.releases
    .filter((release) => ranges.every((range) => packageVersionSatisfies(release.version, range)))
    .sort((left, right) => comparePackageVersions(right.version, left.version))
    .flatMap((release) => {
      const resolution = resolveTrustedRegistryCandidate({
        hostVersion: state.hostVersion,
        packageId,
        selector: { kind: 'exact', version: release.version },
        verifiedCatalog: state.verifiedCatalog,
      });
      return resolution.status === 'resolved' ? [resolution.candidate] : [];
    });
}

function candidateMatches(
  candidate: TrustedRemotePackageCandidate,
  ranges: string[],
): boolean {
  return ranges.every((range) => packageVersionSatisfies(candidate.version, range));
}

function candidateFromCatalog(
  candidate: TrustedRemotePackageCandidate,
  hostVersion: string,
  catalog: VerifiedTrustedRegistryCatalog,
): TrustedRemotePackageCandidate {
  if (
    candidate.registryId !== catalog.catalog.registryId
    || candidate.catalogVersion !== catalog.catalog.catalogVersion
  ) throw new Error('Trusted Registry root candidate does not belong to the verified Catalog.');
  const resolution = resolveTrustedRegistryCandidate({
    hostVersion,
    packageId: candidate.packageId,
    selector: { kind: 'exact', version: candidate.version },
    verifiedCatalog: catalog,
  });
  if (
    resolution.status !== 'resolved'
    || resolution.candidate.digest !== candidate.digest
    || resolution.candidate.archiveDigest !== candidate.archiveDigest
    || resolution.candidate.targetUrl !== candidate.targetUrl
    || resolution.candidate.publisher.publisherId !== candidate.publisher.publisherId
  ) throw new Error('Trusted Registry root candidate does not match the verified Catalog.');
  return structuredClone(resolution.candidate);
}

function addConstraint(
  constraints: Map<string, string[]>,
  dependency: DeclarativePackageDependency,
): void {
  const ranges = constraints.get(dependency.packageId) ?? [];
  if (!ranges.includes(dependency.range)) ranges.push(dependency.range);
  constraints.set(dependency.packageId, ranges);
}

function assertNoDependencyCycle(
  edges: Map<string, DeclarativePackageDependency[]>,
): void {
  const active = new Set<string>();
  const complete = new Set<string>();
  const visit = (packageId: string): void => {
    if (active.has(packageId)) {
      throw new Error(`Trusted Registry Package dependency graph has a cycle at: ${packageId}`);
    }
    if (complete.has(packageId)) return;
    active.add(packageId);
    for (const dependency of edges.get(packageId) ?? []) visit(dependency.packageId);
    active.delete(packageId);
    complete.add(packageId);
  };
  for (const packageId of [...edges.keys()].sort(compareText)) visit(packageId);
}

function cloneConstraints(
  source: Map<string, string[]>,
): Map<string, string[]> {
  return new Map([...source].map(([key, ranges]) => [key, [...ranges]]));
}

function compareCandidateIdentity(
  left: TrustedRemotePackageCandidate,
  right: TrustedRemotePackageCandidate,
): number {
  return compareText(left.packageId, right.packageId)
    || comparePackageVersions(left.version, right.version)
    || compareText(left.digest, right.digest);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
