import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { listPackages } from '../../src/core/packageRegistry';
import type { WorkflowDefinition } from '../../src/core/workflowRegistry';
import { workflowDefinitionFor } from '../../src/core/workflowRegistry';
import {
  canonicalWorkflowDefinition,
  forkWorkflowDefinition,
  validateProjectWorkflowDefinition,
  workflowDefinitionIdentity,
  type ProjectWorkflowAuthoringSnapshotV1,
  type ProjectWorkflowDraftV1,
  type ProjectWorkflowRevisionV1,
  type WorkflowAuthoringSourceV1,
  type WorkflowProjectionTemplateV1,
} from '../../src/core/workflowAuthoringContracts';
import type { WorkflowSelectionCaptureProposalV1 } from '../../src/core/workflowSelectionCapture';
import { ensureWorkspace, projectsRoot, writeJsonAtomic } from './context';
import { readProject } from './snapshot-store';

const projectWriteTails = new Map<string, Promise<void>>();

export class WorkflowAuthoringConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkflowAuthoringConflictError';
  }
}

export class WorkflowAuthoringValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues.join('\n'));
    this.name = 'WorkflowAuthoringValidationError';
    this.issues = [...issues];
  }
}

export async function readProjectWorkflowAuthoring(
  projectId: string,
): Promise<ProjectWorkflowAuthoringSnapshotV1> {
  assertScopedId(projectId, 'projectId');
  await ensureWorkspace();
  await readProject(projectId);
  return readStoredSnapshot(projectId);
}

export async function forkProjectWorkflowDraft(input: {
  projectId: string;
  source:
    | { kind: 'installed'; workflowId: string }
    | { kind: 'project_revision'; revisionId: string };
}): Promise<{ draft: ProjectWorkflowDraftV1; snapshot: ProjectWorkflowAuthoringSnapshotV1 }> {
  assertScopedId(input.projectId, 'projectId');
  return withProjectWrite(input.projectId, async () => {
    await readProject(input.projectId);
    const stored = await readStoredSnapshot(input.projectId);
    const resolved = resolveForkSource(stored, input);
    const now = new Date().toISOString();
    const draftId = `workflow_draft_${randomUUID().slice(0, 8)}`;
    const workflowId = createProjectWorkflowId(
      input.projectId,
      resolved.definition.name,
    );
    const draft = forkWorkflowDefinition({
      draftId,
      now,
      projectId: input.projectId,
      source: resolved.source,
      sourceDefinition: resolved.definition,
      workflowId,
    });
    stored.drafts.push(draft);
    await persistSnapshot(stored);
    return { draft: structuredClone(draft), snapshot: structuredClone(stored) };
  });
}

export async function createProjectWorkflowDraftFromSelection(input: {
  proposal: WorkflowSelectionCaptureProposalV1;
}): Promise<{ draft: ProjectWorkflowDraftV1; snapshot: ProjectWorkflowAuthoringSnapshotV1 }> {
  const { proposal } = input;
  assertScopedId(proposal.projectId, 'projectId');
  if (
    !proposal.valid
    || !proposal.definition
    || !proposal.sourceWorkflowRunId
    || !proposal.workflowLock
  ) throw new WorkflowAuthoringValidationError(
    proposal.issues.length > 0 ? proposal.issues : ['Workflow selection capture is invalid.'],
  );
  const definition = proposal.definition;
  const sourceWorkflowRunId = proposal.sourceWorkflowRunId;
  const workflowLock = proposal.workflowLock;
  return withProjectWrite(proposal.projectId, async () => {
    await readProject(proposal.projectId);
    const stored = await readStoredSnapshot(proposal.projectId);
    const now = new Date().toISOString();
    const draftId = `workflow_draft_${randomUUID().slice(0, 8)}`;
    const draft = forkWorkflowDefinition({
      draftId,
      now,
      projectId: proposal.projectId,
      source: {
        blockIds: [...proposal.blockIds],
        boardId: proposal.boardId,
        capturedAt: now,
        kind: 'board_selection',
        sourceWorkflowRunId,
        workflowLock: structuredClone(workflowLock),
      },
      sourceDefinition: definition,
      workflowId: createProjectWorkflowId(proposal.projectId, definition.name),
    });
    stored.drafts.push(draft);
    await persistSnapshot(stored);
    return { draft: structuredClone(draft), snapshot: structuredClone(stored) };
  });
}

export async function saveProjectWorkflowDraft(input: {
  definition: WorkflowDefinition;
  draftId: string;
  expectedRecordVersion: number;
  projectId: string;
  projectionTemplate: WorkflowProjectionTemplateV1;
}): Promise<{ draft: ProjectWorkflowDraftV1; snapshot: ProjectWorkflowAuthoringSnapshotV1 }> {
  assertScopedId(input.projectId, 'projectId');
  assertScopedId(input.draftId, 'draftId');
  return withProjectWrite(input.projectId, async () => {
    const stored = await readStoredSnapshot(input.projectId);
    const draft = requiredDraft(stored, input.draftId);
    if (draft.recordVersion !== input.expectedRecordVersion) {
      throw new WorkflowAuthoringConflictError(
        `Workflow Draft version conflict: expected ${input.expectedRecordVersion}, current ${draft.recordVersion}.`,
      );
    }
    if (input.definition.workflowId !== draft.definition.workflowId) {
      throw new WorkflowAuthoringConflictError('Workflow Draft workflowId is immutable.');
    }
    assertProjectionTemplate(input.projectionTemplate, input.definition);
    const now = new Date().toISOString();
    const definition = canonicalWorkflowDefinition(input.definition);
    const updated: ProjectWorkflowDraftV1 = {
      ...structuredClone(draft),
      definition,
      projectionTemplate: structuredClone(input.projectionTemplate),
      recordVersion: draft.recordVersion + 1,
      updatedAt: now,
      validation: validateProjectWorkflowDefinition(definition, now),
    };
    delete updated.publishedRevisionId;
    stored.drafts[stored.drafts.indexOf(draft)] = updated;
    await persistSnapshot(stored);
    return { draft: structuredClone(updated), snapshot: structuredClone(stored) };
  });
}

export async function publishProjectWorkflowDraft(input: {
  draftId: string;
  expectedRecordVersion: number;
  projectId: string;
}): Promise<{
  draft: ProjectWorkflowDraftV1;
  revision: ProjectWorkflowRevisionV1;
  snapshot: ProjectWorkflowAuthoringSnapshotV1;
}> {
  assertScopedId(input.projectId, 'projectId');
  assertScopedId(input.draftId, 'draftId');
  return withProjectWrite(input.projectId, async () => {
    const stored = await readStoredSnapshot(input.projectId);
    const draft = requiredDraft(stored, input.draftId);
    if (draft.recordVersion !== input.expectedRecordVersion) {
      throw new WorkflowAuthoringConflictError(
        `Workflow Draft version conflict: expected ${input.expectedRecordVersion}, current ${draft.recordVersion}.`,
      );
    }
    const now = new Date().toISOString();
    const definition = canonicalWorkflowDefinition(draft.definition);
    const validation = validateProjectWorkflowDefinition(definition, now);
    if (!validation.valid) throw new WorkflowAuthoringValidationError(validation.issues);
    assertProjectionTemplate(draft.projectionTemplate, definition);
    const conflicting = stored.revisions.find((candidate) => (
      candidate.definition.workflowId === definition.workflowId
      && candidate.definition.version === definition.version
      && candidate.definition.definitionHash !== definition.definitionHash
    ));
    if (conflicting) {
      throw new WorkflowAuthoringConflictError(
        `Published Workflow version already exists with another hash: ${definition.workflowId}@${definition.version}.`,
      );
    }
    const exact = stored.revisions.find((candidate) => (
      candidate.definition.workflowId === definition.workflowId
      && candidate.definition.version === definition.version
      && candidate.definition.definitionHash === definition.definitionHash
    ));
    const revision: ProjectWorkflowRevisionV1 = exact ?? {
      definition,
      projectId: input.projectId,
      projectionTemplate: structuredClone(draft.projectionTemplate),
      publishedAt: now,
      revisionId: `workflow_revision_${randomUUID().slice(0, 8)}`,
      schemaVersion: 1,
      source: structuredClone(draft.source),
      status: 'published',
    };
    if (!exact) stored.revisions.push(revision);
    const updated: ProjectWorkflowDraftV1 = {
      ...structuredClone(draft),
      definition,
      publishedRevisionId: revision.revisionId,
      recordVersion: draft.recordVersion + 1,
      updatedAt: now,
      validation,
    };
    stored.drafts[stored.drafts.indexOf(draft)] = updated;
    await persistSnapshot(stored);
    return {
      draft: structuredClone(updated),
      revision: structuredClone(revision),
      snapshot: structuredClone(stored),
    };
  });
}

export async function archiveProjectWorkflowRevision(input: {
  projectId: string;
  revisionId: string;
}): Promise<ProjectWorkflowAuthoringSnapshotV1> {
  assertScopedId(input.projectId, 'projectId');
  assertScopedId(input.revisionId, 'revisionId');
  return withProjectWrite(input.projectId, async () => {
    const stored = await readStoredSnapshot(input.projectId);
    if (!stored.revisions.some((candidate) => candidate.revisionId === input.revisionId)) {
      throw new Error(`Project Workflow Revision not found: ${input.revisionId}`);
    }
    if (!stored.archivedRevisionIds.includes(input.revisionId)) {
      stored.archivedRevisionIds.push(input.revisionId);
      await persistSnapshot(stored);
    }
    return structuredClone(stored);
  });
}

function resolveForkSource(
  snapshot: ProjectWorkflowAuthoringSnapshotV1,
  input: {
    projectId: string;
    source:
      | { kind: 'installed'; workflowId: string }
      | { kind: 'project_revision'; revisionId: string };
  },
): { definition: WorkflowDefinition; source: WorkflowAuthoringSourceV1 } {
  const source = input.source;
  if (source.kind === 'project_revision') {
    const revision = snapshot.revisions.find(
      (candidate) => candidate.revisionId === source.revisionId,
    );
    if (!revision) throw new Error(`Project Workflow Revision not found: ${source.revisionId}`);
    return {
      definition: structuredClone(revision.definition),
      source: {
        kind: 'project_revision',
        projectId: input.projectId,
        revisionId: revision.revisionId,
        workflowLock: workflowDefinitionIdentity(revision.definition),
      },
    };
  }
  const definition = workflowDefinitionFor(source.workflowId);
  const manifest = listPackages().find((candidate) => (
    candidate.components.workflows.some((workflow) => (
      workflow.workflowDefinitionId === definition.workflowId
      && workflow.version === definition.version
      && workflow.definitionHash === definition.definitionHash
    ))
  ));
  if (!manifest) {
    throw new Error(`Installed Workflow Package authority not found: ${definition.workflowId}`);
  }
  return {
    definition,
    source: {
      kind: 'package',
      packageLock: {
        digest: manifest.digest,
        packageId: manifest.packageId,
        version: manifest.version,
      },
      workflowLock: workflowDefinitionIdentity(definition),
    },
  };
}

async function readStoredSnapshot(
  projectId: string,
): Promise<ProjectWorkflowAuthoringSnapshotV1> {
  try {
    const parsed = JSON.parse(
      await readFile(authoringStorePath(projectId), 'utf8'),
    ) as ProjectWorkflowAuthoringSnapshotV1;
    assertStoredSnapshot(parsed, projectId);
    return structuredClone(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      archivedRevisionIds: [],
      drafts: [],
      projectId,
      revisions: [],
      schemaVersion: 1,
    };
  }
}

async function persistSnapshot(
  snapshot: ProjectWorkflowAuthoringSnapshotV1,
): Promise<void> {
  assertStoredSnapshot(snapshot, snapshot.projectId);
  await writeJsonAtomic(authoringStorePath(snapshot.projectId), snapshot);
}

function requiredDraft(
  snapshot: ProjectWorkflowAuthoringSnapshotV1,
  draftId: string,
): ProjectWorkflowDraftV1 {
  const draft = snapshot.drafts.find((candidate) => candidate.draftId === draftId);
  if (!draft) throw new Error(`Project Workflow Draft not found: ${draftId}`);
  return draft;
}

function assertProjectionTemplate(
  template: WorkflowProjectionTemplateV1,
  definition: WorkflowDefinition,
): void {
  if (template.schemaVersion !== 1 || template.direction !== 'left_to_right') {
    throw new WorkflowAuthoringValidationError(['Workflow Projection Template is invalid.']);
  }
  const stepIds = new Set(definition.steps.map((step) => step.stepId));
  const positioned = new Set<string>();
  for (const position of template.positions) {
    if (
      !stepIds.has(position.stepId)
      || positioned.has(position.stepId)
      || !Number.isFinite(position.x)
      || !Number.isFinite(position.y)
    ) throw new WorkflowAuthoringValidationError([
      `Workflow Projection Template position is invalid: ${position.stepId}.`,
    ]);
    positioned.add(position.stepId);
  }
  if (positioned.size !== stepIds.size) {
    throw new WorkflowAuthoringValidationError([
      'Workflow Projection Template must position every Step exactly once.',
    ]);
  }
}

function assertStoredSnapshot(
  snapshot: ProjectWorkflowAuthoringSnapshotV1,
  projectId: string,
): void {
  if (
    snapshot.schemaVersion !== 1
    || snapshot.projectId !== projectId
    || !Array.isArray(snapshot.drafts)
    || !Array.isArray(snapshot.revisions)
    || !Array.isArray(snapshot.archivedRevisionIds)
  ) throw new Error(`Invalid Project Workflow Authoring Store: ${projectId}`);
  const draftIds = new Set<string>();
  for (const draft of snapshot.drafts) {
    if (
      draft.schemaVersion !== 1
      || draft.projectId !== projectId
      || draft.status !== 'draft'
      || draft.recordVersion < 1
      || draftIds.has(draft.draftId)
    ) throw new Error(`Invalid Project Workflow Draft: ${draft.draftId}`);
    draftIds.add(draft.draftId);
    assertProjectionTemplate(draft.projectionTemplate, draft.definition);
  }
  const revisionIds = new Set<string>();
  for (const revision of snapshot.revisions) {
    if (
      revision.schemaVersion !== 1
      || revision.projectId !== projectId
      || revision.status !== 'published'
      || revisionIds.has(revision.revisionId)
      || canonicalWorkflowDefinition(revision.definition).definitionHash
        !== revision.definition.definitionHash
    ) throw new Error(`Invalid Project Workflow Revision: ${revision.revisionId}`);
    revisionIds.add(revision.revisionId);
    assertProjectionTemplate(revision.projectionTemplate, revision.definition);
  }
  if (snapshot.archivedRevisionIds.some((revisionId) => !revisionIds.has(revisionId))) {
    throw new Error(`Project Workflow archive references an unknown Revision: ${projectId}`);
  }
}

function createProjectWorkflowId(projectId: string, name: string): string {
  const project = slug(projectId) || 'project';
  const workflow = slug(name) || 'workflow';
  return `project.${project}.${workflow}-${randomUUID().slice(0, 8)}`;
}

function slug(value: string): string {
  return value.normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 42);
}

function authoringStorePath(projectId: string): string {
  return path.join(projectsRoot, projectId, 'workflow-authoring', 'index.json');
}

function assertScopedId(value: string, label: string): void {
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`${label} is invalid.`);
}

async function withProjectWrite<T>(
  projectId: string,
  mutate: () => Promise<T>,
): Promise<T> {
  const previous = projectWriteTails.get(projectId) ?? Promise.resolve();
  let resolveTail!: () => void;
  const tail = new Promise<void>((resolve) => { resolveTail = resolve; });
  const queued = previous.catch(() => undefined).then(() => tail);
  projectWriteTails.set(projectId, queued);
  await previous.catch(() => undefined);
  try {
    return await mutate();
  } finally {
    resolveTail();
    if (projectWriteTails.get(projectId) === queued) projectWriteTails.delete(projectId);
  }
}
