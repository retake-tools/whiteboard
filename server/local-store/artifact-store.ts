import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ArtifactRecord,
  ArtifactRevision,
  ArtifactStorePort,
  CreateOrAdvanceArtifactCommand,
  CreateOrAdvanceArtifactResult,
  ProjectArtifactSnapshot,
} from '../../src/core/artifactContracts';
import {
  artifactIdentityKey,
  assertValidCreateOrAdvanceArtifactCommand,
} from '../../src/core/artifactContracts';
import { readAssetMetadata } from './asset-files';
import {
  ensureWorkspace,
  projectsRoot,
  writeJsonAtomic,
} from './context';
import { readProject } from './snapshot-store';

interface StoredArtifactCommandResult {
  artifactId: string;
  artifactRevisionId: string;
  commandHash: string;
  createdAt: string;
  idempotencyKey: string;
}

interface StoredProjectArtifacts extends ProjectArtifactSnapshot {
  commandResults: StoredArtifactCommandResult[];
}

const projectWriteTails = new Map<string, Promise<void>>();

export class ArtifactWriteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArtifactWriteConflictError';
  }
}

export const localArtifactStore: ArtifactStorePort = {
  createOrAdvance: createOrAdvanceArtifact,
  getRevision: getArtifactRevision,
  readProject: readProjectArtifacts,
};

export async function createOrAdvanceArtifact(
  input: CreateOrAdvanceArtifactCommand,
): Promise<CreateOrAdvanceArtifactResult> {
  assertValidCreateOrAdvanceArtifactCommand(input);
  const command = normalizeCommand(input);
  const commandHash = hashCommand(command);
  return withProjectWrite(command.projectId, async () => {
    const stored = await readStoredProjectArtifacts(command.projectId);
    const priorResult = stored.commandResults.find(
      (candidate) => candidate.idempotencyKey === command.idempotencyKey,
    );
    if (priorResult) {
      if (priorResult.commandHash !== commandHash) {
        throw new ArtifactWriteConflictError(
          `Artifact idempotency key was reused with a different command: ${command.idempotencyKey}`,
        );
      }
      return resultForStoredCommand(stored, priorResult, false);
    }

    await validateAssetReferences(command);
    validateSourceRevisionReferences(stored, command);
    const identityKey = artifactIdentityKey(command);
    const existing = stored.artifacts.find(
      (candidate) => artifactIdentityKey(candidate) === identityKey,
    );
    assertExpectedCurrentRevision(existing, command);
    if (existing && existing.artifactType !== command.artifactType) {
      throw new ArtifactWriteConflictError(
        `Artifact identity ${identityKey} already uses type ${existing.artifactType}, not ${command.artifactType}.`,
      );
    }

    const createdAt = new Date().toISOString();
    const artifactId = existing?.artifactId ?? `artifact_${randomUUID().slice(0, 8)}`;
    const revision: ArtifactRevision = {
      artifactId,
      artifactRevisionId: `artrev_${randomUUID().slice(0, 8)}`,
      assetIds: [...command.assetIds],
      createdAt,
      createdByActor: structuredClone(command.createdByActor),
      ...(command.createdByExecutionId
        ? { createdByExecutionId: command.createdByExecutionId }
        : {}),
      ...(command.definitionLocks
        ? { definitionLocks: structuredClone(command.definitionLocks) }
        : {}),
      primaryAssetId: command.primaryAssetId,
      projectId: command.projectId,
      revision: nextRevisionNumber(stored.revisions, artifactId),
      sourceArtifactRevisionIds: [...command.sourceArtifactRevisionIds],
      sourceAssetIds: [...command.sourceAssetIds],
      ...(command.sourceContext
        ? { sourceContext: structuredClone(command.sourceContext) }
        : {}),
    };
    const artifact: ArtifactRecord = existing
      ? {
          ...existing,
          currentRevisionId: revision.artifactRevisionId,
          libraryVisibility: command.libraryVisibility,
          recordVersion: existing.recordVersion + 1,
          updatedAt: createdAt,
        }
      : {
          artifactId,
          artifactType: command.artifactType,
          createdAt,
          currentRevisionId: revision.artifactRevisionId,
          libraryVisibility: command.libraryVisibility,
          projectId: command.projectId,
          recordVersion: 1,
          scope: command.scope,
          semanticKey: command.semanticKey,
          ...(command.sourceContext
            ? { sourceContext: structuredClone(command.sourceContext) }
            : {}),
          updatedAt: createdAt,
        };

    if (existing) {
      stored.artifacts[stored.artifacts.indexOf(existing)] = artifact;
    } else {
      stored.artifacts.push(artifact);
    }
    stored.revisions.push(revision);
    stored.commandResults.push({
      artifactId,
      artifactRevisionId: revision.artifactRevisionId,
      commandHash,
      createdAt,
      idempotencyKey: command.idempotencyKey,
    });
    assertValidStoredProjectArtifacts(stored, command.projectId);
    await writeJsonAtomic(artifactStorePath(command.projectId), stored);
    return {
      artifact: structuredClone(artifact),
      created: true,
      revision: structuredClone(revision),
    };
  });
}

export async function readProjectArtifacts(projectId: string): Promise<ProjectArtifactSnapshot> {
  const stored = await readStoredProjectArtifacts(projectId);
  return {
    artifacts: structuredClone(stored.artifacts),
    projectId: stored.projectId,
    revisions: structuredClone(stored.revisions),
    schemaVersion: 1,
  };
}

export async function getArtifactRevision(
  projectId: string,
  artifactRevisionId: string,
): Promise<ArtifactRevision | undefined> {
  const stored = await readStoredProjectArtifacts(projectId);
  const revision = stored.revisions.find(
    (candidate) => candidate.artifactRevisionId === artifactRevisionId,
  );
  return revision ? structuredClone(revision) : undefined;
}

function normalizeCommand(input: CreateOrAdvanceArtifactCommand): CreateOrAdvanceArtifactCommand {
  return {
    ...structuredClone(input),
    artifactType: input.artifactType.trim(),
    assetIds: input.assetIds.map((value) => value.trim()),
    createdByActor: {
      ...structuredClone(input.createdByActor),
      actorId: input.createdByActor.actorId.trim(),
      ...(input.createdByActor.agentRunId
        ? { agentRunId: input.createdByActor.agentRunId.trim() }
        : {}),
    },
    idempotencyKey: input.idempotencyKey.trim(),
    primaryAssetId: input.primaryAssetId.trim(),
    projectId: input.projectId.trim(),
    semanticKey: input.semanticKey.trim(),
    sourceArtifactRevisionIds: input.sourceArtifactRevisionIds.map((value) => value.trim()),
    sourceAssetIds: input.sourceAssetIds.map((value) => value.trim()),
    ...(input.createdByExecutionId
      ? { createdByExecutionId: input.createdByExecutionId.trim() }
      : {}),
    ...(input.expectedCurrentRevisionId
      ? { expectedCurrentRevisionId: input.expectedCurrentRevisionId.trim() }
      : { expectedCurrentRevisionId: null }),
    ...(input.sourceContext
      ? {
          sourceContext: Object.fromEntries(
            Object.entries(input.sourceContext).map(([key, value]) => [key, value?.trim()]),
          ),
        }
      : {}),
  };
}

async function validateAssetReferences(command: CreateOrAdvanceArtifactCommand): Promise<void> {
  const assetIds = [...new Set([...command.assetIds, ...command.sourceAssetIds])];
  const assets = await Promise.all(assetIds.map(async (assetId) => {
    try {
      return await readAssetMetadata(command.projectId, assetId);
    } catch {
      throw new Error(`Artifact Asset does not exist in Project ${command.projectId}: ${assetId}`);
    }
  }));
  for (const asset of assets) {
    if (asset.projectId !== command.projectId || !assetIds.includes(asset.assetId)) {
      throw new Error(`Artifact Asset is outside Project ${command.projectId}: ${asset.assetId}`);
    }
  }
  if (
    command.createdByExecutionId
    && !assets.some((asset) => asset.sourceExecutionId === command.createdByExecutionId)
  ) {
    throw new ArtifactWriteConflictError(
      `Artifact createdByExecutionId does not match any referenced Asset: ${command.createdByExecutionId}`,
    );
  }
}

function validateSourceRevisionReferences(
  stored: StoredProjectArtifacts,
  command: CreateOrAdvanceArtifactCommand,
): void {
  for (const revisionId of command.sourceArtifactRevisionIds) {
    const revision = stored.revisions.find(
      (candidate) => candidate.artifactRevisionId === revisionId,
    );
    if (!revision || revision.projectId !== command.projectId) {
      throw new Error(`Artifact source Revision does not exist in Project ${command.projectId}: ${revisionId}`);
    }
  }
}

function assertExpectedCurrentRevision(
  existing: ArtifactRecord | undefined,
  command: CreateOrAdvanceArtifactCommand,
): void {
  const currentRevisionId = existing?.currentRevisionId ?? null;
  if (command.expectedCurrentRevisionId !== currentRevisionId) {
    throw new ArtifactWriteConflictError(
      `Artifact current Revision conflict: expected ${command.expectedCurrentRevisionId ?? 'none'}, current ${currentRevisionId ?? 'none'}.`,
    );
  }
}

function nextRevisionNumber(revisions: ArtifactRevision[], artifactId: string): number {
  return revisions.reduce(
    (current, revision) => revision.artifactId === artifactId
      ? Math.max(current, revision.revision)
      : current,
    0,
  ) + 1;
}

function resultForStoredCommand(
  stored: StoredProjectArtifacts,
  result: StoredArtifactCommandResult,
  created: boolean,
): CreateOrAdvanceArtifactResult {
  const artifact = stored.artifacts.find(
    (candidate) => candidate.artifactId === result.artifactId,
  );
  const revision = stored.revisions.find(
    (candidate) => candidate.artifactRevisionId === result.artifactRevisionId,
  );
  if (!artifact || !revision) throw new Error('Artifact idempotency result references missing records.');
  return {
    artifact: structuredClone(artifact),
    created,
    revision: structuredClone(revision),
  };
}

async function readStoredProjectArtifacts(projectId: string): Promise<StoredProjectArtifacts> {
  await ensureWorkspace();
  const project = await readProject(projectId).catch(() => undefined);
  if (!project || project.projectId !== projectId) throw new Error(`Artifact Project not found: ${projectId}`);
  try {
    const stored = JSON.parse(
      await readFile(artifactStorePath(projectId), 'utf8'),
    ) as StoredProjectArtifacts;
    assertValidStoredProjectArtifacts(stored, projectId);
    return stored;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {
      artifacts: [],
      commandResults: [],
      projectId,
      revisions: [],
      schemaVersion: 1,
    };
  }
}

function assertValidStoredProjectArtifacts(
  stored: StoredProjectArtifacts,
  expectedProjectId: string,
): void {
  if (
    stored.schemaVersion !== 1
    || stored.projectId !== expectedProjectId
    || !Array.isArray(stored.artifacts)
    || !Array.isArray(stored.revisions)
    || !Array.isArray(stored.commandResults)
  ) throw new Error(`Invalid Project Artifact Store: ${expectedProjectId}`);
  assertUnique(stored.artifacts.map((artifact) => artifact.artifactId), 'Artifact IDs');
  assertUnique(stored.artifacts.map((artifact) => artifactIdentityKey(artifact)), 'Artifact identities');
  assertUnique(stored.revisions.map((revision) => revision.artifactRevisionId), 'Artifact Revision IDs');
  assertUnique(stored.commandResults.map((result) => result.idempotencyKey), 'Artifact idempotency keys');
  for (const artifact of stored.artifacts) {
    if (
      artifact.projectId !== expectedProjectId
      || artifact.recordVersion < 1
      || (artifact.scope !== 'project' && artifact.libraryVisibility === 'listed')
    ) {
      throw new Error(`Invalid Artifact record: ${artifact.artifactId}`);
    }
    const artifactRevisions = stored.revisions.filter(
      (revision) => revision.artifactId === artifact.artifactId,
    );
    assertUnique(
      artifactRevisions.map((revision) => String(revision.revision)),
      `Artifact ${artifact.artifactId} revision numbers`,
    );
    const current = artifactRevisions.find(
      (revision) => revision.artifactRevisionId === artifact.currentRevisionId,
    );
    const latestRevision = Math.max(...artifactRevisions.map((revision) => revision.revision));
    if (!current || current.revision !== latestRevision) {
      throw new Error(`Artifact current Revision is missing: ${artifact.artifactId}`);
    }
  }
  for (const revision of stored.revisions) {
    if (
      revision.projectId !== expectedProjectId
      || revision.revision < 1
      || !stored.artifacts.some((artifact) => artifact.artifactId === revision.artifactId)
      || revision.assetIds.length === 0
      || !revision.assetIds.includes(revision.primaryAssetId)
    ) throw new Error(`Invalid Artifact Revision: ${revision.artifactRevisionId}`);
    for (const sourceRevisionId of revision.sourceArtifactRevisionIds) {
      if (!stored.revisions.some((source) => source.artifactRevisionId === sourceRevisionId)) {
        throw new Error(`Artifact Revision source is missing: ${sourceRevisionId}`);
      }
    }
  }
  for (const result of stored.commandResults) {
    const revision = stored.revisions.find(
      (candidate) => candidate.artifactRevisionId === result.artifactRevisionId,
    );
    if (
      !revision
      || revision.artifactId !== result.artifactId
      || !stored.artifacts.some((artifact) => artifact.artifactId === result.artifactId)
      || !result.commandHash
    ) throw new Error(`Invalid Artifact command result: ${result.idempotencyKey}`);
  }
}

function assertUnique(values: string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique.`);
}

function hashCommand(command: CreateOrAdvanceArtifactCommand): string {
  return createHash('sha256').update(JSON.stringify(canonicalize(command))).digest('hex');
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

function artifactStorePath(projectId: string): string {
  return path.join(projectsRoot, projectId, 'artifacts', 'index.json');
}

async function withProjectWrite<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = projectWriteTails.get(projectId) ?? Promise.resolve();
  const result = previous.then(task, task);
  const tail = result.then(() => undefined, () => undefined);
  projectWriteTails.set(projectId, tail);
  return result.finally(() => {
    if (projectWriteTails.get(projectId) === tail) projectWriteTails.delete(projectId);
  });
}
