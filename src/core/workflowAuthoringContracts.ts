import type { PackageLock } from './packageContracts';
import { sha256Hex } from './sha256';
import {
  validateWorkflowDefinition,
  type WorkflowDefinition,
} from './workflowRegistry';

export interface WorkflowDefinitionIdentityV1 {
  definitionHash: string;
  version: string;
  workflowId: string;
}

export type WorkflowAuthoringSourceV1 =
  | {
    kind: 'package';
    packageLock: PackageLock;
    workflowLock: WorkflowDefinitionIdentityV1;
  }
  | {
    kind: 'project_revision';
    projectId: string;
    revisionId: string;
    workflowLock: WorkflowDefinitionIdentityV1;
  }
  | {
    blockIds: string[];
    boardId: string;
    capturedAt: string;
    kind: 'board_selection';
    sourceWorkflowRunId: string;
    workflowLock: WorkflowDefinitionIdentityV1;
  };

export interface WorkflowProjectionTemplatePositionV1 {
  stepId: string;
  x: number;
  y: number;
}

export interface WorkflowProjectionTemplateV1 {
  direction: 'left_to_right';
  positions: WorkflowProjectionTemplatePositionV1[];
  schemaVersion: 1;
}

export interface WorkflowAuthoringValidationV1 {
  checkedAt: string;
  definitionHash: string;
  issues: string[];
  valid: boolean;
}

export interface ProjectWorkflowDraftV1 {
  createdAt: string;
  definition: WorkflowDefinition;
  draftId: string;
  projectId: string;
  projectionTemplate: WorkflowProjectionTemplateV1;
  publishedRevisionId?: string;
  recordVersion: number;
  schemaVersion: 1;
  source: WorkflowAuthoringSourceV1;
  status: 'draft';
  updatedAt: string;
  validation: WorkflowAuthoringValidationV1;
}

export interface ProjectWorkflowRevisionV1 {
  definition: WorkflowDefinition;
  projectId: string;
  projectionTemplate: WorkflowProjectionTemplateV1;
  publishedAt: string;
  revisionId: string;
  schemaVersion: 1;
  source: WorkflowAuthoringSourceV1;
  status: 'published';
}

export interface ProjectWorkflowAuthoringSnapshotV1 {
  archivedRevisionIds: string[];
  drafts: ProjectWorkflowDraftV1[];
  projectId: string;
  revisions: ProjectWorkflowRevisionV1[];
  schemaVersion: 1;
}

export interface ResolvedWorkflowDefinitionV1 {
  definition: WorkflowDefinition;
  source:
    | { kind: 'installed' }
    | { kind: 'project_revision'; revisionId: string };
}

export function workflowDefinitionIdentity(
  definition: WorkflowDefinition,
): WorkflowDefinitionIdentityV1 {
  return {
    definitionHash: definition.definitionHash,
    version: definition.version,
    workflowId: definition.workflowId,
  };
}

export function canonicalWorkflowDefinition(
  input: WorkflowDefinition,
): WorkflowDefinition {
  const definition = structuredClone(input);
  const { definitionHash: _definitionHash, ...hashable } = definition;
  definition.definitionHash = `sha256:${sha256Hex(stableStringify(hashable))}`;
  return definition;
}

export function createWorkflowProjectionTemplate(
  definition: WorkflowDefinition,
): WorkflowProjectionTemplateV1 {
  const levelByStepId = new Map<string, number>();
  const rowByLevel = new Map<number, number>();
  for (const step of topologicalWorkflowSteps(definition)) {
    const level = step.dependsOn.length === 0
      ? 0
      : Math.max(...step.dependsOn.map((stepId) => levelByStepId.get(stepId) ?? 0)) + 1;
    const row = rowByLevel.get(level) ?? 0;
    levelByStepId.set(step.stepId, level);
    rowByLevel.set(level, row + 1);
  }
  return {
    direction: 'left_to_right',
    positions: definition.steps.map((step) => {
      const level = levelByStepId.get(step.stepId) ?? 0;
      const siblings = definition.steps.filter(
        (candidate) => levelByStepId.get(candidate.stepId) === level,
      );
      const row = siblings.findIndex((candidate) => candidate.stepId === step.stepId);
      return { stepId: step.stepId, x: level * 340, y: Math.max(row, 0) * 180 };
    }),
    schemaVersion: 1,
  };
}

export function validateProjectWorkflowDefinition(
  input: WorkflowDefinition,
  checkedAt = new Date().toISOString(),
): WorkflowAuthoringValidationV1 {
  const definition = canonicalWorkflowDefinition(input);
  const issues: string[] = [];
  if (!/^project\.[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+$/.test(definition.workflowId)) {
    issues.push(`Project Workflow ID is invalid: ${definition.workflowId}`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(definition.version)) {
    issues.push(`Project Workflow version is invalid: ${definition.version}`);
  }
  try {
    issues.push(...validateWorkflowDefinition(definition));
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }
  return {
    checkedAt,
    definitionHash: definition.definitionHash,
    issues: [...new Set(issues)],
    valid: issues.length === 0,
  };
}

export function forkWorkflowDefinition(input: {
  draftId: string;
  now: string;
  projectId: string;
  source: WorkflowAuthoringSourceV1;
  sourceDefinition: WorkflowDefinition;
  workflowId: string;
}): ProjectWorkflowDraftV1 {
  const definition = canonicalWorkflowDefinition({
    ...structuredClone(input.sourceDefinition),
    description: input.sourceDefinition.description,
    name: `${input.sourceDefinition.name} Copy`,
    version: '0.1.0',
    workflowId: input.workflowId,
  });
  return {
    createdAt: input.now,
    definition,
    draftId: input.draftId,
    projectId: input.projectId,
    projectionTemplate: createWorkflowProjectionTemplate(definition),
    recordVersion: 1,
    schemaVersion: 1,
    source: structuredClone(input.source),
    status: 'draft',
    updatedAt: input.now,
    validation: validateProjectWorkflowDefinition(definition, input.now),
  };
}

export function resolveWorkflowDefinitionV1(input: {
  archivedRevisionIds?: string[];
  definitionHash?: string;
  installedDefinitions: WorkflowDefinition[];
  projectRevisions: ProjectWorkflowRevisionV1[];
  version?: string;
  workflowId: string;
}): ResolvedWorkflowDefinitionV1 | undefined {
  const installed = input.installedDefinitions.filter(
    (definition) => definition.workflowId === input.workflowId,
  );
  const archived = new Set(input.archivedRevisionIds ?? []);
  const project = input.projectRevisions.filter(
    (revision) => !archived.has(revision.revisionId)
      && revision.definition.workflowId === input.workflowId,
  );
  if (installed.length + project.length > 1 && !input.version && !input.definitionHash) {
    throw new Error(`Workflow Definition is ambiguous: ${input.workflowId}`);
  }
  const matchesLock = (definition: WorkflowDefinition) => (
    (!input.version || definition.version === input.version)
    && (!input.definitionHash || definition.definitionHash === input.definitionHash)
  );
  const installedMatch = installed.find(matchesLock);
  const projectMatch = project.find((revision) => matchesLock(revision.definition));
  if (installedMatch && projectMatch) {
    throw new Error(`Project Workflow cannot override Installed Workflow: ${input.workflowId}`);
  }
  if (installedMatch) {
    return { definition: structuredClone(installedMatch), source: { kind: 'installed' } };
  }
  return projectMatch ? {
    definition: structuredClone(projectMatch.definition),
    source: { kind: 'project_revision', revisionId: projectMatch.revisionId },
  } : undefined;
}

function topologicalWorkflowSteps(
  workflow: WorkflowDefinition,
): WorkflowDefinition['steps'] {
  const remaining = new Map(workflow.steps.map((step) => [step.stepId, step]));
  const resolved = new Set<string>();
  const ordered: WorkflowDefinition['steps'] = [];
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter(
      (step) => step.dependsOn.every((stepId) => resolved.has(stepId)),
    );
    if (ready.length === 0) return workflow.steps;
    for (const step of ready) {
      ordered.push(step);
      remaining.delete(step.stepId);
      resolved.add(step.stepId);
    }
  }
  return ordered;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
