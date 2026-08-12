import { createBlockRecord, touchBoard, videoProfileForConnector } from '../../core/blockFactory';
import type { CompiledCreativeRequest } from '../../core/creativeRequestCompiler';
import { executionConnection } from '../../core/executionProviderPreferences';
import { blockLockedByGroup } from '../../core/grouping';
import { createId, nowIso } from '../../core/id';
import type { PackageComposerMention } from '../../core/packageComposer';
import type { ReferenceIntentV1 } from '../../core/referenceIntent';
import type { BlockRecord, BoardSnapshot } from '../../core/types';
import { runDeterministicMockVideoGeneration } from '../../core/videoGeneration';
import type { CanvasHostScopeV1 } from '../../host-kit';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardVideoDraftUpdateV1 {
  aspectRatio?: string;
  blockId: string;
  connectionId?: string | null;
  durationSeconds?: number;
  executionProfileId?: string;
  outputCount?: number;
  prompt?: string;
}

export interface WhiteboardVideoGenerationCommandsV1 {
  createDraft(input: {
    aspectRatio: string;
    connectionId: string;
    creativeRequest: CompiledCreativeRequest;
    durationSeconds: number;
    instruction: string;
    outputCount: number;
    placementCenter: { x: number; y: number };
    references: Array<{
      inputSlotId: string;
      mention: PackageComposerMention;
      referenceIntent?: ReferenceIntentV1;
    }>;
    title: string;
  }): Promise<{ blockId: string }>;
  generateMock(input: {
    blockId: string;
    expectedScope: CanvasHostScopeV1;
  }): Promise<{
    executionId: string;
    outputBlockIds: string[];
    scope: CanvasHostScopeV1;
  }>;
  updateDraft(input: WhiteboardVideoDraftUpdateV1): Promise<{
    committed: boolean;
    updated: boolean;
  }>;
}

export function createWhiteboardVideoGenerationCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardVideoGenerationCommandsV1 {
  return Object.freeze({
    async createDraft(input: Parameters<WhiteboardVideoGenerationCommandsV1['createDraft']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const block = createBlockRecord(snapshot, 'video');
        const connection = executionConnection(input.connectionId, snapshot.project.projectId);
        block.position = {
          x: input.placementCenter.x - block.size.width / 2,
          y: input.placementCenter.y - block.size.height / 2,
        };
        block.data = {
          title: input.title,
          creativeRequest: structuredClone(input.creativeRequest),
          executionDraft: {
            schemaVersion: 1,
            capabilityId: 'video.generate',
            connectionId: input.connectionId,
            executionProfileId: videoProfileForConnector(connection?.connectorId),
            prompt: input.instruction,
            parameters: {
              aspectRatio: input.aspectRatio,
              durationSeconds: input.durationSeconds,
              outputCount: input.outputCount,
              qualityTier: 'preview',
            },
          },
        };
        block.updatedAt = nowIso();
        snapshot.blocks.push(block);
        for (const [index, reference] of input.references.entries()) {
          const source = resolveReferenceBlock(snapshot, reference.mention, block, index);
          snapshot.edges.push({
            edgeId: createId('edge'),
            inputSlotId: reference.inputSlotId,
            kind: 'execution_input',
            ...(reference.referenceIntent
              ? { referenceIntent: structuredClone(reference.referenceIntent) }
              : {}),
            sourceBlockId: source.blockId,
            targetBlockId: block.blockId,
          });
        }
        touchBoard(snapshot);
        return { blockId: block.blockId };
      });
      return transaction.result;
    },
    async generateMock(input: Parameters<WhiteboardVideoGenerationCommandsV1['generateMock']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        const block = requireEditableVideoBlock(snapshot, input.blockId);
        const draft = block.data.executionDraft;
        if (draft?.executionProfileId !== 'video-mock') {
          throw new Error(`Video Block is not configured for the local Mock profile: ${block.blockId}`);
        }
        const run = runDeterministicMockVideoGeneration(snapshot, {
          aspectRatio: stringParam(draft.parameters.aspectRatio, '9:16'),
          connectionId: draft.connectionId ?? undefined,
          durationSeconds: numberParam(draft.parameters.durationSeconds, 8),
          outputCount: numberParam(draft.parameters.outputCount, 1),
          prompt: draft.prompt,
          targetBlockId: block.blockId,
        });
        return {
          executionId: run.execution.executionId,
          outputBlockIds: [...run.execution.outputBlockIds],
          scope: scopeFor(snapshot),
        };
      });
      return transaction.result;
    },
    async updateDraft(input: WhiteboardVideoDraftUpdateV1) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        const block = snapshot.blocks.find(
          (candidate) => candidate.blockId === input.blockId && candidate.type === 'video',
        );
        if (!block || blockLockedByGroup(snapshot, block.blockId)) {
          return { changed: false, result: { updated: false } };
        }
        const currentDraft = block.data.executionDraft ?? {
          schemaVersion: 1 as const,
          capabilityId: 'video.generate',
          executionProfileId: 'video-mock',
          prompt: '',
          parameters: {},
        };
        block.data.executionDraft = {
          ...currentDraft,
          executionProfileId: input.executionProfileId ?? currentDraft.executionProfileId,
          ...connectionField(input.connectionId, currentDraft.connectionId),
          prompt: input.prompt ?? currentDraft.prompt,
          parameters: {
            ...currentDraft.parameters,
            ...(input.durationSeconds === undefined ? {} : { durationSeconds: input.durationSeconds }),
            ...(input.outputCount === undefined ? {} : { outputCount: input.outputCount }),
            ...(input.aspectRatio === undefined ? {} : { aspectRatio: input.aspectRatio }),
          },
        };
        block.updatedAt = nowIso();
        return { changed: true, result: { updated: true } };
      });
      return { ...transaction.result, committed: transaction.committed };
    },
  });
}

function resolveReferenceBlock(
  snapshot: BoardSnapshot,
  mention: PackageComposerMention,
  targetBlock: BlockRecord,
  index: number,
): BlockRecord {
  if (mention.kind === 'block') {
    const block = snapshot.blocks.find(
      (candidate) => candidate.blockId === mention.blockId && candidate.type === 'image',
    );
    if (!block) throw new Error(`Video reference Image Block not found: ${mention.blockId}`);
    return block;
  }
  const asset = snapshot.assets.find(
    (candidate) => candidate.assetId === mention.assetId
      && candidate.projectId === snapshot.project.projectId
      && candidate.kind === 'image',
  );
  if (!asset) throw new Error(`Video reference Image Asset not found: ${mention.assetId}`);
  const block = createBlockRecord(snapshot, 'image');
  block.position = {
    x: targetBlock.position.x - block.size.width - 80,
    y: targetBlock.position.y + index * (block.size.height + 28),
  };
  block.data = {
    ...block.data,
    assetId: asset.assetId,
    composerSourceAssetId: asset.assetId,
    previewUrl: asset.previewUrl,
    title: `Video reference ${index + 1}`,
  };
  snapshot.blocks.push(block);
  return block;
}

function requireEditableVideoBlock(snapshot: BoardSnapshot, blockId: string): BlockRecord {
  const block = snapshot.blocks.find(
    (candidate) => candidate.blockId === blockId && candidate.type === 'video',
  );
  if (!block) throw new Error(`Video Block not found: ${blockId}`);
  if (blockLockedByGroup(snapshot, block.blockId)) {
    throw new Error(`Video Block is locked by its Group: ${blockId}`);
  }
  return block;
}

function assertScope(snapshot: BoardSnapshot, scope: CanvasHostScopeV1): void {
  if (
    snapshot.project.projectId !== scope.projectId
    || snapshot.board.boardId !== scope.boardId
  ) {
    throw new Error('Video generation belongs to another Project or Board.');
  }
}

function scopeFor(snapshot: BoardSnapshot): CanvasHostScopeV1 {
  return { boardId: snapshot.board.boardId, projectId: snapshot.project.projectId };
}

function connectionField(
  value: string | null | undefined,
  fallback: string | null | undefined,
): { connectionId?: string | null } {
  if (value === undefined) return fallback ? { connectionId: fallback } : {};
  return value ? { connectionId: value } : { connectionId: null };
}

function numberParam(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function stringParam(value: unknown, fallback: string): string {
  return typeof value === 'string' && value ? value : fallback;
}
