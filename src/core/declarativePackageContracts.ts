import { z } from 'zod';
import type { RetakePackageEntryPoint } from './packageContracts';

export const declarativePackageManifestFile = 'retake.package.json';
export const declarativePackageArchiveExtension = '.retakepkg';
export const declarativePackageMaxFileBytes = 16 * 1024 * 1024;
export const declarativePackageMaxFileCount = 4096;
export const declarativePackageMaxTotalBytes = 64 * 1024 * 1024;

export type DeclarativePackageComponentKind = 'agent_preset' | 'skill' | 'workflow';

export interface DeclarativePackageDependency {
  packageId: string;
  range: string;
}

export interface DeclarativePackagePublisher {
  name: string;
  publisherId: string;
}

export interface DeclarativeSkillComponent {
  definitionHash: string;
  definitionPath: string;
  resourcePaths: string[];
  skillId: string;
  version: string;
}

export interface DeclarativeWorkflowComponent {
  definitionHash: string;
  definitionPath: string;
  resourcePaths: string[];
  version: string;
  workflowDefinitionId: string;
}

export interface DeclarativeAgentPresetComponent {
  agentPresetId: string;
  definitionHash: string;
  definitionPath: string;
  resourcePaths: string[];
  version: string;
}

export interface DeclarativePackageManifest {
  components: {
    agentPresets: DeclarativeAgentPresetComponent[];
    skills: DeclarativeSkillComponent[];
    workflows: DeclarativeWorkflowComponent[];
  };
  dependencies: DeclarativePackageDependency[];
  description: string;
  entrypoints: RetakePackageEntryPoint[];
  files: string[];
  integrity: string;
  license: string;
  name: string;
  optionalDependencies: DeclarativePackageDependency[];
  packageId: string;
  permissions: [];
  publisher: DeclarativePackagePublisher;
  retakeHostCompatibility: string;
  schemaVersion: 1;
  signature: null;
  version: string;
}

export interface DeclarativePackageManifestParseResult {
  issues: string[];
  manifest?: DeclarativePackageManifest;
}

const namespacedIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/;
const exactSemverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const semverRangePattern = /^(?:\*|(?:[~^]|>=?|<=?)?(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\s+(?:>=?|<=?)(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?)*)$/;
const definitionHashPattern = /^sha256:[A-Za-z0-9._-]+$/;
const exactIntegrityPattern = /^sha256:[a-f0-9]{64}$/;

const portablePathSchema = z.string().refine(isPortablePackagePath, {
  message: 'must be a portable, normalized, relative Package path',
});
const namespacedIdSchema = z.string().regex(namespacedIdPattern);
const exactSemverSchema = z.string().regex(exactSemverPattern);
const semverRangeSchema = z.string().regex(semverRangePattern);
const definitionHashSchema = z.string().regex(definitionHashPattern);

const dependencySchema = z.object({
  packageId: namespacedIdSchema,
  range: semverRangeSchema,
}).strict();

const componentBase = {
  definitionHash: definitionHashSchema,
  definitionPath: portablePathSchema,
  resourcePaths: z.array(portablePathSchema),
  version: exactSemverSchema,
};

const skillComponentSchema = z.object({
  ...componentBase,
  skillId: namespacedIdSchema,
}).strict();

const workflowComponentSchema = z.object({
  ...componentBase,
  workflowDefinitionId: namespacedIdSchema,
}).strict();

const agentPresetComponentSchema = z.object({
  ...componentBase,
  agentPresetId: namespacedIdSchema,
}).strict();

const entrypointBase = {
  compatibleStageIds: z.array(z.string().min(1)),
  default: z.boolean().optional(),
  description: z.string().min(1),
  entrypointId: z.string().min(1),
  name: z.string().min(1),
  recommended: z.boolean().optional(),
  requiredInputSlotIds: z.array(z.string().min(1)),
  schemaVersion: z.literal(1),
};

const skillEntrypointSchema = z.object({
  ...entrypointBase,
  kind: z.literal('skill'),
  ref: z.object({
    capabilityId: namespacedIdSchema,
    skillId: namespacedIdSchema,
  }).strict(),
}).strict();

const workflowEntrypointSchema = z.object({
  ...entrypointBase,
  kind: z.literal('workflow'),
  ref: z.object({
    workflowDefinitionId: namespacedIdSchema,
  }).strict(),
}).strict();

const agentPresetEntrypointSchema = z.object({
  ...entrypointBase,
  kind: z.literal('agent_preset'),
  ref: z.object({
    agentPresetId: namespacedIdSchema,
  }).strict(),
}).strict();

const manifestSchema = z.object({
  components: z.object({
    agentPresets: z.array(agentPresetComponentSchema),
    skills: z.array(skillComponentSchema),
    workflows: z.array(workflowComponentSchema),
  }).strict(),
  dependencies: z.array(dependencySchema),
  description: z.string().min(1),
  entrypoints: z.array(z.discriminatedUnion('kind', [
    skillEntrypointSchema,
    workflowEntrypointSchema,
    agentPresetEntrypointSchema,
  ])),
  files: z.array(portablePathSchema),
  integrity: z.union([
    z.literal('sha256:auto'),
    z.string().regex(exactIntegrityPattern),
  ]),
  license: z.string().min(1),
  name: z.string().min(1),
  optionalDependencies: z.array(dependencySchema),
  packageId: namespacedIdSchema,
  permissions: z.array(z.string()).max(0),
  publisher: z.object({
    name: z.string().min(1),
    publisherId: namespacedIdSchema,
  }).strict(),
  retakeHostCompatibility: semverRangeSchema,
  schemaVersion: z.literal(1),
  signature: z.null(),
  version: exactSemverSchema,
}).strict();

export function parseDeclarativePackageManifest(
  input: unknown,
): DeclarativePackageManifestParseResult {
  const parsed = manifestSchema.safeParse(input);
  if (!parsed.success) {
    return {
      issues: parsed.error.issues.map((issue) => (
        `${pathLabel(issue.path)}: ${issue.message}`
      )),
    };
  }
  const manifest = parsed.data as DeclarativePackageManifest;
  return {
    issues: validateDeclarativePackageManifest(manifest),
    manifest,
  };
}

export function validateDeclarativePackageManifest(
  manifest: DeclarativePackageManifest,
): string[] {
  const issues: string[] = [];
  validateUniqueSorted(manifest.files, 'Package files', issues, true);
  if (manifest.files.includes(declarativePackageManifestFile)) {
    issues.push(`Package files must not include ${declarativePackageManifestFile}.`);
  }
  validateDependencies(manifest, issues);

  const skillIds = validateComponents(
    manifest.components.skills,
    (component) => component.skillId,
    'Skill',
    manifest.files,
    issues,
  );
  const workflowIds = validateComponents(
    manifest.components.workflows,
    (component) => component.workflowDefinitionId,
    'Workflow',
    manifest.files,
    issues,
  );
  const agentPresetIds = validateComponents(
    manifest.components.agentPresets,
    (component) => component.agentPresetId,
    'AgentPreset',
    manifest.files,
    issues,
  );

  const entrypointIds = new Set<string>();
  for (const entrypoint of manifest.entrypoints) {
    const expectedPrefix = entrypoint.kind === 'agent_preset'
      ? 'agent:'
      : `${entrypoint.kind}:`;
    if (!entrypoint.entrypointId.startsWith(expectedPrefix)) {
      issues.push(
        `Package EntryPoint ID does not match kind ${entrypoint.kind}: ${entrypoint.entrypointId}`,
      );
    }
    if (entrypointIds.has(entrypoint.entrypointId)) {
      issues.push(`Duplicate Package EntryPoint: ${entrypoint.entrypointId}`);
    }
    entrypointIds.add(entrypoint.entrypointId);
    validateUniqueSorted(
      entrypoint.compatibleStageIds,
      `EntryPoint compatibleStageIds ${entrypoint.entrypointId}`,
      issues,
      false,
    );
    validateUniqueSorted(
      entrypoint.requiredInputSlotIds,
      `EntryPoint requiredInputSlotIds ${entrypoint.entrypointId}`,
      issues,
      false,
    );
    if (entrypoint.kind === 'skill' && !skillIds.has(entrypoint.ref.skillId)) {
      issues.push(`Package Skill EntryPoint is not a component: ${entrypoint.entrypointId}`);
    }
    if (
      entrypoint.kind === 'workflow'
      && !workflowIds.has(entrypoint.ref.workflowDefinitionId)
    ) {
      issues.push(`Package Workflow EntryPoint is not a component: ${entrypoint.entrypointId}`);
    }
    if (
      entrypoint.kind === 'agent_preset'
      && !agentPresetIds.has(entrypoint.ref.agentPresetId)
    ) {
      issues.push(`Package AgentPreset EntryPoint is not a component: ${entrypoint.entrypointId}`);
    }
    if (entrypoint.kind === 'agent_preset' && entrypoint.requiredInputSlotIds.length > 0) {
      issues.push(`Package AgentPreset EntryPoint cannot declare input slots: ${entrypoint.entrypointId}`);
    }
  }
  return issues;
}

export function isPortablePackagePath(value: string): boolean {
  if (
    !value
    || value.startsWith('/')
    || value.endsWith('/')
    || value.includes('\\')
    || value.length >= 100
    || !/^[A-Za-z0-9._/-]+$/.test(value)
  ) return false;
  const segments = value.split('/');
  return segments.every(
    (segment) => segment !== '' && segment !== '.' && segment !== '..' && segment !== '.retake',
  );
}

export function isExactPackageIntegrity(value: string): boolean {
  return exactIntegrityPattern.test(value);
}

function validateDependencies(
  manifest: DeclarativePackageManifest,
  issues: string[],
): void {
  const required = new Set<string>();
  for (const dependency of manifest.dependencies) {
    if (required.has(dependency.packageId)) {
      issues.push(`Duplicate Package dependency: ${dependency.packageId}`);
    }
    required.add(dependency.packageId);
    if (dependency.packageId === manifest.packageId) {
      issues.push(`Package cannot depend on itself: ${manifest.packageId}`);
    }
  }
  const optional = new Set<string>();
  for (const dependency of manifest.optionalDependencies) {
    if (optional.has(dependency.packageId)) {
      issues.push(`Duplicate optional Package dependency: ${dependency.packageId}`);
    }
    optional.add(dependency.packageId);
    if (required.has(dependency.packageId)) {
      issues.push(`Package dependency cannot be both required and optional: ${dependency.packageId}`);
    }
    if (dependency.packageId === manifest.packageId) {
      issues.push(`Package cannot optionally depend on itself: ${manifest.packageId}`);
    }
  }
}

function validateComponents<T extends {
  definitionPath: string;
  resourcePaths: string[];
}>(
  components: T[],
  idFor: (component: T) => string,
  label: string,
  files: string[],
  issues: string[],
): Set<string> {
  const ids = new Set<string>();
  const definitionPaths = new Set<string>();
  const fileSet = new Set(files);
  for (const component of components) {
    const id = idFor(component);
    if (ids.has(id)) issues.push(`Duplicate Package ${label}: ${id}`);
    ids.add(id);
    if (definitionPaths.has(component.definitionPath)) {
      issues.push(`Duplicate Package component definitionPath: ${component.definitionPath}`);
    }
    definitionPaths.add(component.definitionPath);
    if (!fileSet.has(component.definitionPath)) {
      issues.push(`Package ${label} definition is not listed in files: ${id}`);
    }
    validateUniqueSorted(
      component.resourcePaths,
      `Package ${label} resources ${id}`,
      issues,
      true,
    );
    for (const resourcePath of component.resourcePaths) {
      if (!fileSet.has(resourcePath)) {
        issues.push(`Package ${label} resource is not listed in files: ${id}.${resourcePath}`);
      }
      if (resourcePath === component.definitionPath) {
        issues.push(`Package ${label} definition cannot also be a resource: ${id}`);
      }
    }
  }
  return ids;
}

function validateUniqueSorted(
  values: string[],
  label: string,
  issues: string[],
  requireSorted: boolean,
): void {
  if (values.length !== new Set(values).size) issues.push(`${label} contains duplicates.`);
  if (
    requireSorted
    && values.some((value, index) => index > 0 && comparePortablePath(values[index - 1]!, value) > 0)
  ) issues.push(`${label} must be sorted.`);
}

function pathLabel(path: PropertyKey[]): string {
  if (path.length === 0) return '$';
  return `$.${path.map(String).join('.')}`;
}

function comparePortablePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
