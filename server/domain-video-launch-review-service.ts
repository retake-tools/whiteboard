import { readFile } from 'node:fs/promises';
import {
  domainVideoGenerationCapabilityId,
  normalizeDomainVideoGenerationParameters,
  type DomainVideoLaunchReviewV1,
} from '../src/core/domainVideoGenerationContracts';
import { resolveDomainVideoLaunchReview } from '../src/core/domainVideoLaunchReview';
import { isVideoGenerationPackageArtifactRevisionMetadataV2 } from '../src/core/generationPreparationContracts';
import type { AssetRecord, BlockRecord } from '../src/core/types';
import { readProjectArtifactAuthority } from './artifact-library-service';
import { readAssetMetadata, resolveAssetStoragePath } from './local-store/asset-files';
import { listExecutionProviderSettings } from './local-store/execution-provider-store';
import {
  listProjectBoards,
  loadSnapshot,
} from './local-store/snapshot-store';

export async function reviewDomainVideoLaunch(input: {
  blockId: string;
  boardId: string;
  projectId: string;
}): Promise<DomainVideoLaunchReviewV1> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const operation = domainVideoOperation(snapshot.blocks, input.blockId);
  const packageBlock = generationPackageInputBlock(snapshot.blocks, snapshot.edges, input.blockId);
  const revisionId = requiredString(
    packageBlock.data.artifactRevisionId,
    'Connect one asset-backed Generation Package ArtifactRevision.',
  );

  const [artifactLibrary, boardRecords, providerSettings] = await Promise.all([
    readProjectArtifactAuthority(input.projectId),
    listProjectBoards(input.projectId),
    listExecutionProviderSettings(input.projectId),
  ]);
  const gateSnapshots = await Promise.all(
    boardRecords.map((board) => loadSnapshot(input.projectId, board.boardId)),
  );
  const packageItem = artifactLibrary.items.find(
    (item) => item.currentRevision.artifactRevisionId === revisionId,
  );
  const packageAssetId = packageItem?.currentRevision.primaryAssetId
    ?? requiredString(
      packageBlock.data.assetId,
      'Generation Package document file is unavailable.',
    );
  const packageMarkdown = await readFile(
    await resolveAssetStoragePath(input.projectId, packageAssetId),
    'utf8',
  );
  const referenceAssets = packageItem
    ? await readReferenceAssets(input.projectId, packageItem.currentRevision.metadata, artifactLibrary)
    : [];
  const connectionId = optionalString(operation.data.connectionId);
  const connection = connectionId
    ? providerSettings.connections.find((candidate) => candidate.connectionId === connectionId)
    : undefined;

  return resolveDomainVideoLaunchReview({
    artifactLibrary,
    connection,
    gateSnapshots,
    generationPackageArtifactRevisionId: revisionId,
    packageMarkdown,
    parameters: {
      ...normalizeDomainVideoGenerationParameters(
        objectValue(operation.data.domainVideoGenerationParameters),
      ),
    },
    referenceAssets,
    snapshot,
  });
}

async function readReferenceAssets(
  projectId: string,
  metadata: unknown,
  artifactLibrary: Awaited<ReturnType<typeof readProjectArtifactAuthority>>,
): Promise<AssetRecord[]> {
  if (!isVideoGenerationPackageArtifactRevisionMetadataV2(metadata)) return [];
  const assetIds = metadata.referenceManifest.items.flatMap((item) => {
    const identity = item.bindingIdentity;
    if (!identity) return [];
    if (identity.startsWith('asset:')) return [identity.slice('asset:'.length)];
    const revisionId = identity.slice('artifact_revision:'.length);
    const revision = artifactLibrary.items
      .flatMap((candidate) => candidate.revisions)
      .find((candidate) => candidate.artifactRevisionId === revisionId);
    return revision ? [revision.primaryAssetId] : [];
  });
  const assets = await Promise.all(
    [...new Set(assetIds)].map((assetId) =>
      readAssetMetadata(projectId, assetId).catch(() => undefined),
    ),
  );
  return assets.filter((asset): asset is AssetRecord => Boolean(asset));
}

function domainVideoOperation(blocks: BlockRecord[], blockId: string): BlockRecord {
  const operation = blocks.find((block) =>
    block.blockId === blockId
    && block.type === 'operation'
    && block.data.capabilityId === domainVideoGenerationCapabilityId,
  );
  if (!operation) throw new Error(`Domain Video Operation not found: ${blockId}`);
  return operation;
}

function generationPackageInputBlock(
  blocks: BlockRecord[],
  edges: Array<{
    inputSlotId?: string;
    kind: string;
    sourceBlockId: string;
    targetBlockId: string;
  }>,
  operationBlockId: string,
): BlockRecord {
  const edge = edges.find((candidate) =>
    candidate.kind === 'execution_input'
    && candidate.targetBlockId === operationBlockId
    && candidate.inputSlotId === 'generation_package',
  );
  const block = edge
    ? blocks.find((candidate) => candidate.blockId === edge.sourceBlockId)
    : undefined;
  if (
    !block
    || block.type !== 'document'
    || block.data.artifactType !== 'video_generation_package'
  ) {
    throw new Error('Connect one asset-backed Generation Package ArtifactRevision.');
  }
  return block;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function requiredString(value: unknown, message: string): string {
  const resolved = optionalString(value);
  if (!resolved) throw new Error(message);
  return resolved;
}
