import { capabilityDefinitionFor } from './capabilityRegistry';
import {
  agentPresetDefinitionFor,
  agentPresetDefinitionLock,
} from './agentPresetRegistry';
import type {
  PackageAgentPresetEntryPoint,
  PackageLock,
  PackageSkillEntryPoint,
  PackageWorkflowEntryPoint,
  RetakePackageEntryPoint,
  RetakePackageManifest,
} from './packageContracts';
import { skillDefinitionFor } from './skillRegistry';
import { workflowDefinitionFor } from './workflowRegistry';

export interface RegisteredPackageEntryPoint {
  entrypoint: RetakePackageEntryPoint;
  packageLock: PackageLock;
}

export interface RetakePackageRegistry {
  manifests: RetakePackageManifest[];
}

export type ResolvedPackageEntryPointTarget =
  | {
      capabilityLock: {
        capabilityId: string;
        definitionHash: string;
        version: string;
      };
      entrypoint: PackageSkillEntryPoint;
      kind: 'skill';
      packageLock: PackageLock;
      skillLock: {
        definitionHash: string;
        skillId: string;
        version: string;
      };
    }
  | {
      entrypoint: PackageWorkflowEntryPoint;
      kind: 'workflow';
      packageLock: PackageLock;
      workflowDefinitionLock: {
        definitionHash: string;
        version: string;
        workflowDefinitionId: string;
      };
    };

export interface ResolvedPackageAgentPresetEntryPointTarget {
  agentPresetLock: {
    agentPresetId: string;
    definitionHash: string;
    version: string;
  };
  entrypoint: PackageAgentPresetEntryPoint;
  kind: 'agent_preset';
  packageLock: PackageLock;
}

export type PackageEntryPointResolution =
  | { status: 'resolved'; target: ResolvedPackageEntryPointTarget }
  | { status: 'needs_target'; target: ResolvedPackageAgentPresetEntryPointTarget }
  | { candidates: RegisteredPackageEntryPoint[]; status: 'needs_selection' }
  | { status: 'not_found' }
  | { entrypoint: RegisteredPackageEntryPoint; status: 'unsupported' };

export interface PackageEntryPointQuery {
  entrypointId?: string;
  kind?: RetakePackageEntryPoint['kind'];
  refId?: string;
}

let activePackageRegistry = createPackageRegistry([]);

export function createPackageRegistry(manifests: RetakePackageManifest[]): RetakePackageRegistry {
  const packageIds = new Set<string>();
  const entrypointIds = new Set<string>();
  for (const manifest of manifests) {
    const issues = validatePackageManifest(manifest);
    if (issues.length > 0) throw new Error(issues.join('\n'));
    if (packageIds.has(manifest.packageId)) throw new Error(`Duplicate Package ID: ${manifest.packageId}`);
    packageIds.add(manifest.packageId);
    for (const entrypoint of manifest.entrypoints) {
      if (entrypointIds.has(entrypoint.entrypointId)) {
        throw new Error(`Duplicate Package EntryPoint ID: ${entrypoint.entrypointId}`);
      }
      entrypointIds.add(entrypoint.entrypointId);
    }
  }
  return { manifests: structuredClone(manifests) };
}

export function listPackages(registry: RetakePackageRegistry = activePackageRegistry): RetakePackageManifest[] {
  return structuredClone(registry.manifests);
}

export function configurePackageRegistry(
  manifests: RetakePackageManifest[],
): void {
  activePackageRegistry = createPackageRegistry(manifests);
}

export function listPackageEntryPoints(
  registry: RetakePackageRegistry = activePackageRegistry,
): RegisteredPackageEntryPoint[] {
  return registry.manifests.flatMap((manifest) => manifest.entrypoints.map((entrypoint) => ({
    entrypoint: structuredClone(entrypoint),
    packageLock: packageLock(manifest),
  })));
}

export function listRecommendedPackageEntryPoints(
  registry: RetakePackageRegistry = activePackageRegistry,
): RegisteredPackageEntryPoint[] {
  return listPackageEntryPoints(registry).filter(({ entrypoint }) => entrypoint.recommended === true);
}

export function resolvePackageEntryPoint(
  query: PackageEntryPointQuery,
  registry: RetakePackageRegistry = activePackageRegistry,
): PackageEntryPointResolution {
  const candidates = listPackageEntryPoints(registry).filter((candidate) => matchesQuery(candidate.entrypoint, query));
  if (candidates.length === 0) return { status: 'not_found' };
  if (candidates.length > 1) return { status: 'needs_selection', candidates };
  const candidate = candidates[0];
  if (candidate.entrypoint.kind === 'agent_preset') {
    const definition = agentPresetDefinitionFor(candidate.entrypoint.ref.agentPresetId);
    return {
      status: 'needs_target',
      target: {
        agentPresetLock: agentPresetDefinitionLock(definition),
        entrypoint: candidate.entrypoint,
        kind: 'agent_preset',
        packageLock: candidate.packageLock,
      },
    };
  }
  if (candidate.entrypoint.kind === 'skill') {
    const skill = skillDefinitionFor(candidate.entrypoint.ref.skillId);
    const capability = capabilityDefinitionFor(candidate.entrypoint.ref.capabilityId);
    return {
      status: 'resolved',
      target: {
        kind: 'skill',
        entrypoint: candidate.entrypoint,
        packageLock: candidate.packageLock,
        skillLock: {
          skillId: skill.skillId,
          version: skill.version,
          definitionHash: skill.definitionHash,
        },
        capabilityLock: {
          capabilityId: capability.capabilityId,
          version: capability.version,
          definitionHash: capability.definitionHash,
        },
      },
    };
  }
  const workflow = workflowDefinitionFor(candidate.entrypoint.ref.workflowDefinitionId);
  return {
    status: 'resolved',
    target: {
      kind: 'workflow',
      entrypoint: candidate.entrypoint,
      packageLock: candidate.packageLock,
      workflowDefinitionLock: {
        workflowDefinitionId: workflow.workflowId,
        version: workflow.version,
        definitionHash: workflow.definitionHash,
      },
    },
  };
}

export function validatePackageManifest(manifest: RetakePackageManifest): string[] {
  const issues: string[] = [];
  if (!manifest.packageId || !manifest.version || !manifest.digest) issues.push('Package lock is incomplete.');
  const skillLocks = uniqueBy(manifest.components.skills, (lock) => lock.skillId, 'Package Skill', issues);
  const workflowLocks = uniqueBy(
    manifest.components.workflows,
    (lock) => lock.workflowDefinitionId,
    'Package Workflow',
    issues,
  );
  const agentPresetLocks = uniqueBy(
    manifest.components.agentPresets,
    (lock) => lock.agentPresetId,
    'Package AgentPreset',
    issues,
  );
  const entrypointIds = new Set<string>();
  for (const lock of skillLocks.values()) {
    try {
      const definition = skillDefinitionFor(lock.skillId);
      if (definition.version !== lock.version || definition.definitionHash !== lock.definitionHash) {
        issues.push(`Package Skill lock mismatch: ${lock.skillId}`);
      }
    } catch {
      issues.push(`Package Skill is not registered: ${lock.skillId}`);
    }
  }
  for (const lock of workflowLocks.values()) {
    try {
      const definition = workflowDefinitionFor(lock.workflowDefinitionId);
      if (definition.version !== lock.version || definition.definitionHash !== lock.definitionHash) {
        issues.push(`Package Workflow lock mismatch: ${lock.workflowDefinitionId}`);
      }
    } catch {
      issues.push(`Package Workflow is not registered: ${lock.workflowDefinitionId}`);
    }
  }
  for (const lock of agentPresetLocks.values()) {
    try {
      const definition = agentPresetDefinitionFor(lock.agentPresetId);
      if (definition.version !== lock.version || definition.definitionHash !== lock.definitionHash) {
        issues.push(`Package AgentPreset lock mismatch: ${lock.agentPresetId}`);
      }
    } catch {
      issues.push(`Package AgentPreset is not registered: ${lock.agentPresetId}`);
    }
  }
  for (const entrypoint of manifest.entrypoints) {
    if (entrypointIds.has(entrypoint.entrypointId)) issues.push(`Duplicate Package EntryPoint: ${entrypoint.entrypointId}`);
    entrypointIds.add(entrypoint.entrypointId);
    if (entrypoint.kind === 'agent_preset') {
      if (!agentPresetLocks.has(entrypoint.ref.agentPresetId)) {
        issues.push(`Package AgentPreset EntryPoint is not a component: ${entrypoint.entrypointId}`);
      }
      if (entrypoint.requiredInputSlotIds.length > 0) {
        issues.push(`Package AgentPreset EntryPoint cannot declare input slots: ${entrypoint.entrypointId}`);
      }
      continue;
    }
    if (entrypoint.kind === 'skill') {
      if (!skillLocks.has(entrypoint.ref.skillId)) {
        issues.push(`Package Skill EntryPoint is not a component: ${entrypoint.entrypointId}`);
        continue;
      }
      try {
        const skill = skillDefinitionFor(entrypoint.ref.skillId);
        const capability = capabilityDefinitionFor(entrypoint.ref.capabilityId);
        if (!skill.capabilityBindings.some((binding) => binding.capabilityId === capability.capabilityId)) {
          issues.push(`Package Skill EntryPoint capability mismatch: ${entrypoint.entrypointId}`);
        }
        validateRequiredInputs(
          entrypoint.entrypointId,
          entrypoint.requiredInputSlotIds,
          capability.inputSlots.filter((slot) => slot.required).map((slot) => slot.slotId),
          issues,
        );
      } catch {
        issues.push(`Package Skill EntryPoint target is not registered: ${entrypoint.entrypointId}`);
      }
      continue;
    }
    if (!workflowLocks.has(entrypoint.ref.workflowDefinitionId)) {
      issues.push(`Package Workflow EntryPoint is not a component: ${entrypoint.entrypointId}`);
      continue;
    }
    try {
      const workflow = workflowDefinitionFor(entrypoint.ref.workflowDefinitionId);
      validateRequiredInputs(
        entrypoint.entrypointId,
        entrypoint.requiredInputSlotIds,
        workflow.inputSlots.filter((slot) => slot.required).map((slot) => slot.slotId),
        issues,
      );
    } catch {
      issues.push(`Package Workflow EntryPoint target is not registered: ${entrypoint.entrypointId}`);
    }
  }
  return issues;
}

function packageLock(manifest: RetakePackageManifest): PackageLock {
  return { packageId: manifest.packageId, version: manifest.version, digest: manifest.digest };
}

function matchesQuery(entrypoint: RetakePackageEntryPoint, query: PackageEntryPointQuery): boolean {
  if (query.entrypointId && entrypoint.entrypointId !== query.entrypointId) return false;
  if (query.kind && entrypoint.kind !== query.kind) return false;
  if (!query.refId) return true;
  if (entrypoint.kind === 'skill') {
    return entrypoint.ref.skillId === query.refId || entrypoint.ref.capabilityId === query.refId;
  }
  if (entrypoint.kind === 'workflow') return entrypoint.ref.workflowDefinitionId === query.refId;
  return entrypoint.ref.agentPresetId === query.refId;
}

function uniqueBy<T>(
  values: T[],
  idFor: (value: T) => string,
  label: string,
  issues: string[],
): Map<string, T> {
  const byId = new Map<string, T>();
  for (const value of values) {
    const id = idFor(value);
    if (byId.has(id)) issues.push(`Duplicate ${label}: ${id}`);
    byId.set(id, value);
  }
  return byId;
}

function validateRequiredInputs(
  entrypointId: string,
  declared: string[],
  required: string[],
  issues: string[],
): void {
  if (declared.length !== new Set(declared).size) {
    issues.push(`Duplicate Package EntryPoint required input: ${entrypointId}`);
  }
  if (declared.length !== required.length || required.some((slotId) => !declared.includes(slotId))) {
    issues.push(`Package EntryPoint required inputs mismatch: ${entrypointId}`);
  }
}
