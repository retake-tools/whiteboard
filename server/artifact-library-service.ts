import type {
  ArtifactDefinitionLocks,
  ProjectArtifactLibrarySnapshot,
  PromoteProjectAssetCommand,
} from '../src/core/artifactContracts';
import type { ExecutionRecord } from '../src/core/types';
import type { WorkflowDefinitionLock } from '../src/core/workflowRuntimeContracts';
import { promotionOptionsForAssetKind } from '../src/core/artifactLibrary';
import { readAssetMetadata } from './local-store/asset-files';
import {
  createOrAdvanceArtifact,
  readProjectArtifacts,
} from './local-store/artifact-store';
import {
  listProjectBoards,
  loadSnapshot,
} from './local-store/snapshot-store';

export async function readProjectArtifactLibrary(
  projectId: string,
): Promise<ProjectArtifactLibrarySnapshot> {
  const snapshot = await readProjectArtifacts(projectId);
  return hydrateProjectArtifactItems(projectId, snapshot, (artifact) =>
    artifact.scope === 'project' && artifact.libraryVisibility === 'listed',
  );
}

export async function readProjectArtifactAuthority(
  projectId: string,
): Promise<ProjectArtifactLibrarySnapshot> {
  const snapshot = await readProjectArtifacts(projectId);
  return hydrateProjectArtifactItems(projectId, snapshot, () => true);
}

async function hydrateProjectArtifactItems(
  projectId: string,
  snapshot: Awaited<ReturnType<typeof readProjectArtifacts>>,
  include: (artifact: Awaited<ReturnType<typeof readProjectArtifacts>>['artifacts'][number]) => boolean,
): Promise<ProjectArtifactLibrarySnapshot> {
  const artifacts = snapshot.artifacts.filter(
    include,
  );
  const items = await Promise.all(artifacts.map(async (artifact) => {
    const currentRevision = snapshot.revisions.find(
      (revision) => revision.artifactRevisionId === artifact.currentRevisionId,
    );
    if (!currentRevision) throw new Error(`Artifact current Revision is missing: ${artifact.artifactId}`);
    const primaryAsset = await readAssetMetadata(projectId, currentRevision.primaryAssetId);
    return {
      artifact: structuredClone(artifact),
      currentRevision: structuredClone(currentRevision),
      primaryAsset,
      revisions: snapshot.revisions
        .filter((revision) => revision.artifactId === artifact.artifactId)
        .sort((left, right) => right.revision - left.revision)
        .map((revision) => structuredClone(revision)),
    };
  }));
  items.sort((left, right) => right.artifact.updatedAt.localeCompare(left.artifact.updatedAt));
  return {
    items,
    projectId,
    schemaVersion: 1,
  };
}

export async function promoteProjectAsset(command: PromoteProjectAssetCommand) {
  const boardSnapshot = await loadSnapshot(command.projectId, command.boardId);
  const sourceBlock = boardSnapshot.blocks.find(
    (block) => block.blockId === command.blockId && block.data.assetId === command.assetId,
  );
  if (!sourceBlock) {
    throw new Error(`Artifact promotion source Block is not asset-backed in this Board: ${command.blockId}`);
  }
  const asset = await readAssetMetadata(command.projectId, command.assetId);
  if (asset.projectId !== command.projectId) {
    throw new Error(`Artifact promotion Asset is outside Project ${command.projectId}: ${command.assetId}`);
  }
  if (
    !promotionOptionsForAssetKind(asset.kind)
      .some((option) => option.artifactType === command.artifactType)
  ) {
    throw new Error(
      `Artifact type ${command.artifactType} is not compatible with Asset kind ${asset.kind}.`,
    );
  }
  const pinnedSourceRevisionId = typeof sourceBlock.data.artifactRevisionId === 'string'
    ? sourceBlock.data.artifactRevisionId
    : undefined;
  if (
    command.sourceArtifactRevisionId
    && command.sourceArtifactRevisionId !== pinnedSourceRevisionId
  ) {
    throw new Error('Artifact promotion source Revision does not match the selected Block.');
  }

  const executionContext = asset.sourceExecutionId
    ? await findProjectExecution(command.projectId, asset.sourceExecutionId)
    : undefined;
  const definitionLocks = definitionLocksForExecution(executionContext?.execution, executionContext?.workflowLock);
  return createOrAdvanceArtifact({
    artifactType: command.artifactType,
    assetIds: [asset.assetId],
    createdByActor: {
      actorId: 'user_local',
      actorType: 'user',
    },
    ...(asset.sourceExecutionId
      ? { createdByExecutionId: asset.sourceExecutionId }
      : {}),
    ...(definitionLocks ? { definitionLocks } : {}),
    expectedCurrentRevisionId: command.expectedCurrentRevisionId,
    idempotencyKey: command.idempotencyKey,
    libraryVisibility: 'listed',
    primaryAssetId: asset.assetId,
    projectId: command.projectId,
    schemaVersion: 1,
    scope: 'project',
    semanticKey: command.semanticKey,
    sourceArtifactRevisionIds: pinnedSourceRevisionId
      ? [pinnedSourceRevisionId]
      : [],
    sourceAssetIds: executionContext?.execution.inputAssetIds
      ? [...new Set(executionContext.execution.inputAssetIds)]
      : [],
    sourceContext: {
      boardId: command.boardId,
      operationBlockId: operationBlockIdFor(executionContext?.execution),
      outputSlotId: outputSlotIdFor(executionContext?.execution, asset.assetId),
      stepRunId: executionContext?.execution.stepRunId,
      workflowRunId: executionContext?.execution.workflowRunId,
    },
  });
}

async function findProjectExecution(projectId: string, executionId: string): Promise<{
  execution: ExecutionRecord;
  workflowLock?: WorkflowDefinitionLock;
} | undefined> {
  const boards = await listProjectBoards(projectId);
  const snapshots = await Promise.all(
    boards.map((board) => loadSnapshot(projectId, board.boardId)),
  );
  for (const snapshot of snapshots) {
    const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
    if (!execution) continue;
    const workflowLock = execution.workflowRunId
      ? snapshot.workflowRuns?.find((run) => run.workflowRunId === execution.workflowRunId)?.workflowDefinitionLock
      : undefined;
    return { execution, workflowLock };
  }
  return undefined;
}

function definitionLocksForExecution(
  execution?: ExecutionRecord,
  workflow?: WorkflowDefinitionLock,
): ArtifactDefinitionLocks | undefined {
  if (!execution) return undefined;
  const skill = execution.skillSnapshot && 'skillId' in execution.skillSnapshot
    ? {
        definitionHash: execution.skillSnapshot.definitionHash,
        skillId: execution.skillSnapshot.skillId,
        version: execution.skillSnapshot.version,
      }
    : undefined;
  if (!execution.capabilityLock && !skill && !workflow) return undefined;
  return {
    ...(execution.capabilityLock
      ? { capability: structuredClone(execution.capabilityLock) }
      : {}),
    ...(skill ? { skill } : {}),
    ...(workflow ? { workflow: structuredClone(workflow) } : {}),
  };
}

function operationBlockIdFor(execution?: ExecutionRecord): string | undefined {
  return typeof execution?.params?.operationBlockId === 'string'
    ? execution.params.operationBlockId
    : undefined;
}

function outputSlotIdFor(execution: ExecutionRecord | undefined, assetId: string): string | undefined {
  return execution?.outputSlotResults?.find((slot) => slot.assetIds.includes(assetId))?.slotId;
}
