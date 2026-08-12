import { layoutAttachmentBlocks } from '../../core/attachmentPlacement';
import { createBlockRecord } from '../../core/blockFactory';
import { fitImageBlockSize } from '../../core/imageFile';
import { createId, nowIso } from '../../core/id';
import type { PackageComposerMention } from '../../core/packageComposer';
import type {
  AssetKind,
  AssetRecord,
  BlockRecord,
  BoardSnapshot,
} from '../../core/types';
import { moveBlockGroupToNearestFreeArea } from '../../core/workflowPlacement';
import type { CanvasHostScopeV1 } from '../../host-kit';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardAgentAttachmentUploadV1 {
  dataUrl: string;
  fileName: string;
  height?: number;
  width?: number;
}

export interface WhiteboardAgentAttachmentCommandsV1 {
  attach(input: {
    placementCenter: { x: number; y: number };
    scope: CanvasHostScopeV1;
    uploads: WhiteboardAgentAttachmentUploadV1[];
  }): Promise<{
    assetIds: string[];
    blockIds: string[];
    mentions: PackageComposerMention[];
  }>;
}

export function createWhiteboardAgentAttachmentCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardAgentAttachmentCommandsV1 {
  return Object.freeze({
    async attach(input: Parameters<WhiteboardAgentAttachmentCommandsV1['attach']>[0]) {
      if (input.uploads.length === 0) {
        return { assetIds: [], blockIds: [], mentions: [] };
      }
      const prepared = input.uploads.map((upload) => prepareAsset(input.scope, upload));
      const persisted: Array<{ asset: AssetRecord; fileName: string }> = [];
      for (const item of prepared) {
        const asset = await transactions.persistProductAsset({
          asset: item.asset,
          options: { fileName: item.fileName },
          scope: input.scope,
        });
        persisted.push({ asset, fileName: item.fileName });
      }

      const transaction = await transactions.executeProductTransaction((snapshot) => {
        assertScope(snapshot, input.scope);
        const blocks: BlockRecord[] = [];
        const mentions: PackageComposerMention[] = [];
        for (const item of persisted) {
          if (snapshot.assets.some((asset) => asset.assetId === item.asset.assetId)) {
            throw new Error(`Agent attachment Asset already exists: ${item.asset.assetId}.`);
          }
          snapshot.assets.unshift(structuredClone(item.asset));
          const block = attachmentBlock(snapshot, item.asset, item.fileName);
          if (block) {
            snapshot.blocks.push(block);
            blocks.push(block);
            mentions.push({
              blockId: block.blockId,
              kind: 'block',
              slotId: 'agent_attachment',
            });
          } else {
            mentions.push({
              assetId: item.asset.assetId,
              kind: 'asset',
              slotId: 'agent_attachment',
            });
          }
        }
        layoutAttachmentBlocks(blocks, input.placementCenter);
        moveBlockGroupToNearestFreeArea(
          snapshot,
          blocks,
          input.placementCenter,
        );
        return {
          assetIds: persisted.map((item) => item.asset.assetId),
          blockIds: blocks.map((block) => block.blockId),
          mentions,
        };
      });
      return transaction.result;
    },
  });
}

function prepareAsset(
  scope: CanvasHostScopeV1,
  upload: WhiteboardAgentAttachmentUploadV1,
): { asset: AssetRecord; fileName: string } {
  const mimeType = mimeTypeFromDataUrl(upload.dataUrl);
  const assetId = createId('asset');
  return {
    asset: {
      assetId,
      createdAt: nowIso(),
      height: upload.height,
      kind: assetKindForMime(mimeType),
      mimeType,
      previewUrl: upload.dataUrl,
      projectId: scope.projectId,
      storageKey: `pending://${assetId}`,
      storageProvider: 'custom',
      width: upload.width,
    },
    fileName: requiredFileName(upload.fileName),
  };
}

function attachmentBlock(
  snapshot: BoardSnapshot,
  asset: AssetRecord,
  fileName: string,
): BlockRecord | undefined {
  if (asset.kind === 'image') {
    const block = createBlockRecord(snapshot, 'image');
    block.size = fitImageBlockSize(asset.width, asset.height);
    block.data = {
      title: fileName,
      assetId: asset.assetId,
      composerSourceAssetId: asset.assetId,
      previewUrl: asset.previewUrl,
    };
    return block;
  }
  if (asset.kind === 'document') {
    const block = createBlockRecord(snapshot, 'document');
    block.data = {
      ...block.data,
      title: fileName,
      assetId: asset.assetId,
    };
    return block;
  }
  if (asset.kind === 'video') {
    const block = createBlockRecord(snapshot, 'video');
    block.data = {
      title: fileName,
      assetId: asset.assetId,
      previewUrl: asset.previewUrl,
    };
    return block;
  }
  return undefined;
}

function mimeTypeFromDataUrl(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  if (!match?.[1]) throw new Error('Agent attachment must use a valid data URL.');
  return match[1].toLowerCase();
}

function assetKindForMime(mimeType: string): AssetKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'text/plain' || mimeType === 'text/markdown') return 'document';
  return 'other';
}

function requiredFileName(fileName: string): string {
  const value = fileName.trim();
  if (!value) throw new Error('Agent attachment fileName is required.');
  return value;
}

function assertScope(
  snapshot: BoardSnapshot,
  scope: CanvasHostScopeV1,
): void {
  if (
    snapshot.project.projectId !== scope.projectId
    || snapshot.board.boardId !== scope.boardId
  ) {
    throw new Error('Agent attachments belong to another Project or Board.');
  }
}
