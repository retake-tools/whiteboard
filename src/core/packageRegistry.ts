import { capabilityDefinitionFor } from './capabilityRegistry';
import type {
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

export type PackageEntryPointResolution =
  | { status: 'resolved'; target: ResolvedPackageEntryPointTarget }
  | { candidates: RegisteredPackageEntryPoint[]; status: 'needs_selection' }
  | { status: 'not_found' }
  | { entrypoint: RegisteredPackageEntryPoint; status: 'unsupported' };

export interface PackageEntryPointQuery {
  entrypointId?: string;
  kind?: RetakePackageEntryPoint['kind'];
  refId?: string;
}

export const storyProductionStarterPackage: RetakePackageManifest = {
  schemaVersion: 1,
  packageId: 'retake.package.story-production-starter',
  version: '0.1.0',
  digest: 'sha256:retake-package-story-production-starter-v1',
  name: 'Retake Story Production Starter',
  description: 'Built-in screenplay, production-design, and storyboard planning methods with one manual workflow.',
  source: { kind: 'builtin' },
  components: {
    skills: [
      {
        skillId: 'retake.screenplay.from-brief',
        version: '0.1.0',
        definitionHash: 'sha256:retake-screenplay-from-brief-catmeme-v1',
      },
      {
        skillId: 'retake.screenplay.normalize',
        version: '0.1.0',
        definitionHash: 'sha256:retake-screenplay-normalize-catmeme-v1',
      },
      {
        skillId: 'retake.character-bible.from-screenplay',
        version: '0.1.0',
        definitionHash: 'sha256:retake-character-bible-from-screenplay-catmeme-v1',
      },
      {
        skillId: 'retake.scene-bible.from-screenplay',
        version: '0.1.0',
        definitionHash: 'sha256:retake-scene-bible-from-screenplay-catmeme-v1',
      },
      {
        skillId: 'retake.storyboard-plan.from-production-design',
        version: '0.1.0',
        definitionHash: 'sha256:retake-storyboard-plan-from-production-design-catmeme-v1',
      },
    ],
    workflows: [{
      workflowDefinitionId: 'retake.workflow.story-to-storyboard',
      version: '0.1.0',
      definitionHash: 'sha256:retake-workflow-story-to-storyboard-v1',
    }],
    agentPresets: [],
    capabilityPlugins: [],
    adapterPlugins: [],
    uiPlugins: [],
  },
  entrypoints: [
    skillEntryPoint({
      skillId: 'retake.screenplay.from-brief',
      capabilityId: 'story.screenplay.generate',
      name: 'Generate screenplay',
      description: 'Turn a creative brief into an executable screenplay.',
      compatibleStageIds: ['story_screenplay'],
      requiredInputSlotIds: ['brief'],
      recommended: true,
    }),
    skillEntryPoint({
      skillId: 'retake.screenplay.normalize',
      capabilityId: 'story.screenplay.normalize',
      name: 'Organize screenplay',
      description: 'Organize an existing screenplay without changing its facts.',
      compatibleStageIds: ['story_screenplay'],
      requiredInputSlotIds: ['source_screenplay'],
      recommended: true,
    }),
    skillEntryPoint({
      skillId: 'retake.character-bible.from-screenplay',
      capabilityId: 'design.character.define',
      name: 'Define characters',
      description: 'Create a production-ready Character Bible from a screenplay.',
      compatibleStageIds: ['production_design'],
      requiredInputSlotIds: ['screenplay'],
    }),
    skillEntryPoint({
      skillId: 'retake.scene-bible.from-screenplay',
      capabilityId: 'design.scene.define',
      name: 'Define scenes',
      description: 'Create a production-ready Scene Bible from a screenplay.',
      compatibleStageIds: ['production_design'],
      requiredInputSlotIds: ['screenplay'],
    }),
    skillEntryPoint({
      skillId: 'retake.storyboard-plan.from-production-design',
      capabilityId: 'previs.storyboard.plan',
      name: 'Generate storyboard plan',
      description: 'Create a shot-level plan from screenplay and production-design bibles.',
      compatibleStageIds: ['storyboard_previsualization'],
      requiredInputSlotIds: ['screenplay', 'character_bible', 'scene_bible'],
    }),
    {
      schemaVersion: 1,
      entrypointId: 'workflow:retake.workflow.story-to-storyboard',
      kind: 'workflow',
      name: 'Story to storyboard plan',
      description: 'Project a manual workflow from creative brief through storyboard planning.',
      ref: { workflowDefinitionId: 'retake.workflow.story-to-storyboard' },
      compatibleStageIds: ['story_screenplay', 'production_design', 'storyboard_previsualization'],
      requiredInputSlotIds: ['brief'],
      default: true,
    },
  ],
};

export const builtInPackageRegistry = createPackageRegistry([storyProductionStarterPackage]);

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

export function listPackages(registry: RetakePackageRegistry = builtInPackageRegistry): RetakePackageManifest[] {
  return structuredClone(registry.manifests);
}

export function listPackageEntryPoints(
  registry: RetakePackageRegistry = builtInPackageRegistry,
): RegisteredPackageEntryPoint[] {
  return registry.manifests.flatMap((manifest) => manifest.entrypoints.map((entrypoint) => ({
    entrypoint: structuredClone(entrypoint),
    packageLock: packageLock(manifest),
  })));
}

export function listRecommendedPackageEntryPoints(
  registry: RetakePackageRegistry = builtInPackageRegistry,
): RegisteredPackageEntryPoint[] {
  return listPackageEntryPoints(registry).filter(({ entrypoint }) => entrypoint.recommended === true);
}

export function resolvePackageEntryPoint(
  query: PackageEntryPointQuery,
  registry: RetakePackageRegistry = builtInPackageRegistry,
): PackageEntryPointResolution {
  const candidates = listPackageEntryPoints(registry).filter((candidate) => matchesQuery(candidate.entrypoint, query));
  if (candidates.length === 0) return { status: 'not_found' };
  if (candidates.length > 1) return { status: 'needs_selection', candidates };
  const candidate = candidates[0];
  if (candidate.entrypoint.kind === 'agent_preset') {
    return { status: 'unsupported', entrypoint: candidate };
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
  for (const entrypoint of manifest.entrypoints) {
    if (entrypointIds.has(entrypoint.entrypointId)) issues.push(`Duplicate Package EntryPoint: ${entrypoint.entrypointId}`);
    entrypointIds.add(entrypoint.entrypointId);
    if (entrypoint.kind === 'agent_preset') {
      if (!manifest.components.agentPresets.some((lock) => lock.componentId === entrypoint.ref.agentPresetId)) {
        issues.push(`Package AgentPreset EntryPoint is not a component: ${entrypoint.entrypointId}`);
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

function skillEntryPoint(input: Omit<PackageSkillEntryPoint, 'entrypointId' | 'kind' | 'ref' | 'schemaVersion'> & {
  capabilityId: string;
  skillId: string;
}): PackageSkillEntryPoint {
  return {
    schemaVersion: 1,
    entrypointId: `skill:${input.skillId}`,
    kind: 'skill',
    name: input.name,
    description: input.description,
    ref: { skillId: input.skillId, capabilityId: input.capabilityId },
    compatibleStageIds: input.compatibleStageIds,
    requiredInputSlotIds: input.requiredInputSlotIds,
    ...(input.default === undefined ? {} : { default: input.default }),
    ...(input.recommended === undefined ? {} : { recommended: input.recommended }),
  };
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
