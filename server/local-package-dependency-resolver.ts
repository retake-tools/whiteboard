import type { DeclarativePackageDependency } from '../src/core/declarativePackageContracts';
import type { MaterializedDeclarativePackage } from './declarative-package-service';
import {
  comparePackageVersions,
  packageVersionSatisfies,
} from './package-semver';
import type {
  PackageInstallationRecord,
  ResolvedPackageDependency,
  WorkspacePackageRoot,
} from './workspace-package-lock';

export interface PackageCandidate {
  installation: PackageInstallationRecord;
  materialized: MaterializedDeclarativePackage;
}

export interface PackageDependencyResolution {
  edges: Map<string, ResolvedPackageDependency[]>;
  selected: Map<string, PackageCandidate>;
}

export function resolvePackageClosure(
  roots: WorkspacePackageRoot[],
  candidates: Map<string, PackageCandidate[]>,
  hostVersion: string,
  pinnedCandidates: PackageCandidate[] = [],
): PackageDependencyResolution {
  const selected = new Map<string, PackageCandidate>();
  const constraints = new Map<string, string[]>();
  for (const root of roots) {
    const candidate = candidates.get(root.packageId)?.find(
      (entry) => entry.installation.installationId === root.installationId,
    );
    if (!candidate) throw new Error(`Root Package Installation is unavailable: ${root.packageId}`);
    const existing = selected.get(root.packageId);
    if (existing && existing.installation.installationId !== candidate.installation.installationId) {
      throw new Error(`Multiple root versions selected for Package: ${root.packageId}`);
    }
    selected.set(root.packageId, candidate);
    constraints.set(root.packageId, [root.requestedRange]);
  }
  for (const candidate of pinnedCandidates) {
    const packageId = candidate.installation.packageId;
    const existing = selected.get(packageId);
    if (
      existing
      && existing.installation.installationId !== candidate.installation.installationId
    ) throw new Error(`Pinned Package conflicts with another selection: ${packageId}`);
    selected.set(packageId, candidate);
    constraints.set(packageId, [candidate.installation.version]);
  }
  const result = resolveRecursively({
    candidates,
    constraints,
    edges: new Map(),
    expanded: new Set(),
    hostVersion,
    selected,
  });
  if (!result) throw new Error('Package dependencies have no compatible single-version resolution.');
  assertNoDependencyCycle(result.edges);
  return result;
}

export function comparePackageCandidateVersion(
  left: PackageCandidate,
  right: PackageCandidate,
): number {
  return comparePackageVersions(right.installation.version, left.installation.version)
    || compareText(left.installation.digest, right.installation.digest);
}

function resolveRecursively(input: {
  candidates: Map<string, PackageCandidate[]>;
  constraints: Map<string, string[]>;
  edges: Map<string, ResolvedPackageDependency[]>;
  expanded: Set<string>;
  hostVersion: string;
  selected: Map<string, PackageCandidate>;
}): PackageDependencyResolution | undefined {
  for (const [packageId, candidate] of input.selected) {
    if (!candidateMatches(candidate, input.constraints.get(packageId) ?? [], input.hostVersion)) {
      return undefined;
    }
  }
  const pendingExpansion = [...input.selected.keys()]
    .sort(compareText)
    .find((packageId) => !input.expanded.has(packageId));
  if (pendingExpansion) {
    const candidate = input.selected.get(pendingExpansion)!;
    const constraints = cloneStringMap(input.constraints);
    const expanded = new Set(input.expanded).add(pendingExpansion);
    const requiredDependencies: ResolvedPackageDependency[] = [];
    for (const dependency of candidate.materialized.manifest.dependencies) {
      addConstraint(constraints, dependency);
      requiredDependencies.push(unresolvedEdge(dependency, false));
    }
    return resolveOptionalDependencies({
      dependencies: requiredDependencies,
      dependencyIndex: 0,
      optionalDependencies: candidate.materialized.manifest.optionalDependencies,
      packageId: pendingExpansion,
      resolverInput: { ...input, constraints, expanded },
    });
  }
  const unresolvedPackageId = [...input.constraints.keys()]
    .sort(compareText)
    .find((packageId) => !input.selected.has(packageId));
  if (unresolvedPackageId) {
    const ranges = input.constraints.get(unresolvedPackageId)!;
    const packageCandidates = input.candidates.get(unresolvedPackageId) ?? [];
    for (const candidate of packageCandidates) {
      if (!candidateMatches(candidate, ranges, input.hostVersion)) continue;
      const selected = new Map(input.selected).set(unresolvedPackageId, candidate);
      const result = resolveRecursively({ ...input, selected });
      if (result) return result;
    }
    return undefined;
  }
  const edges = new Map<string, ResolvedPackageDependency[]>();
  for (const [packageId, dependencies] of input.edges) {
    edges.set(packageId, dependencies.map((dependency) => {
      const resolved = input.selected.get(dependency.packageId);
      if (!resolved) throw new Error(`Resolved Package dependency is missing: ${dependency.packageId}`);
      return {
        ...dependency,
        resolvedInstallationId: resolved.installation.installationId,
      };
    }));
  }
  return { edges, selected: input.selected };
}

function resolveOptionalDependencies(input: {
  dependencies: ResolvedPackageDependency[];
  dependencyIndex: number;
  optionalDependencies: DeclarativePackageDependency[];
  packageId: string;
  resolverInput: {
    candidates: Map<string, PackageCandidate[]>;
    constraints: Map<string, string[]>;
    edges: Map<string, ResolvedPackageDependency[]>;
    expanded: Set<string>;
    hostVersion: string;
    selected: Map<string, PackageCandidate>;
  };
}): PackageDependencyResolution | undefined {
  const dependency = input.optionalDependencies[input.dependencyIndex];
  if (!dependency) {
    const edges = new Map(input.resolverInput.edges);
    edges.set(input.packageId, input.dependencies);
    return resolveRecursively({ ...input.resolverInput, edges });
  }
  const combined = [
    ...(input.resolverInput.constraints.get(dependency.packageId) ?? []),
    dependency.range,
  ];
  const selectedOptional = input.resolverInput.selected.get(dependency.packageId);
  const available = selectedOptional
    ? candidateMatches(selectedOptional, combined, input.resolverInput.hostVersion)
    : (input.resolverInput.candidates.get(dependency.packageId) ?? []).some(
        (entry) => candidateMatches(entry, combined, input.resolverInput.hostVersion),
      );
  if (available) {
    const constraints = cloneStringMap(input.resolverInput.constraints);
    addConstraint(constraints, dependency);
    const included = resolveOptionalDependencies({
      ...input,
      dependencies: [...input.dependencies, unresolvedEdge(dependency, true)],
      dependencyIndex: input.dependencyIndex + 1,
      resolverInput: { ...input.resolverInput, constraints },
    });
    if (included) return included;
  }
  return resolveOptionalDependencies({
    ...input,
    dependencyIndex: input.dependencyIndex + 1,
  });
}

function candidateMatches(
  candidate: PackageCandidate,
  ranges: string[],
  hostVersion: string,
): boolean {
  return ranges.every((range) => packageVersionSatisfies(candidate.installation.version, range))
    && packageVersionSatisfies(
      hostVersion,
      candidate.materialized.manifest.retakeHostCompatibility,
    );
}

function addConstraint(
  constraints: Map<string, string[]>,
  dependency: DeclarativePackageDependency,
): void {
  const ranges = constraints.get(dependency.packageId) ?? [];
  if (!ranges.includes(dependency.range)) ranges.push(dependency.range);
  constraints.set(dependency.packageId, ranges);
}

function unresolvedEdge(
  dependency: DeclarativePackageDependency,
  optional: boolean,
): ResolvedPackageDependency {
  return {
    optional,
    packageId: dependency.packageId,
    range: dependency.range,
    resolvedInstallationId: '',
  };
}

function assertNoDependencyCycle(
  edges: Map<string, ResolvedPackageDependency[]>,
): void {
  const active = new Set<string>();
  const complete = new Set<string>();
  const visit = (packageId: string): void => {
    if (active.has(packageId)) throw new Error(`Package dependency graph has a cycle at: ${packageId}`);
    if (complete.has(packageId)) return;
    active.add(packageId);
    for (const dependency of edges.get(packageId) ?? []) visit(dependency.packageId);
    active.delete(packageId);
    complete.add(packageId);
  };
  for (const packageId of [...edges.keys()].sort(compareText)) visit(packageId);
}

function cloneStringMap(source: Map<string, string[]>): Map<string, string[]> {
  return new Map([...source].map(([key, values]) => [key, [...values]]));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
