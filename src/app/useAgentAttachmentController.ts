import type { RefObject } from 'react';
import { createAssetFromDataUrl } from '../core/assetStore';
import { createBlockRecord, touchBoard } from '../core/blockFactory';
import { fitImageBlockSize, readFileAsDataUrl, readImageDimensions } from '../core/imageFile';
import type { PackageComposerMention } from '../core/packageComposer';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../core/types';

const maxAttachmentBytes = 30 * 1024 * 1024;

interface AgentAttachmentControllerOptions {
  centeredBlockPosition: (size: { height: number; width: number }) => { x: number; y: number };
  persistSnapshot: (
    snapshot: BoardSnapshot,
    options?: { requireLocalApi?: boolean },
  ) => Promise<void>;
  snapshotRef: RefObject<BoardSnapshot>;
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { history?: boolean; persist?: boolean; syncFlow?: boolean },
  ) => BoardSnapshot;
}

interface ImportedAttachment {
  asset: AssetRecord;
  block?: BlockRecord;
  fileName: string;
}

export function useAgentAttachmentController(
  options: AgentAttachmentControllerOptions,
) {
  async function attachFiles(files: File[]): Promise<PackageComposerMention[]> {
    if (files.length === 0) return [];
    for (const file of files) {
      if (file.size > maxAttachmentBytes) {
        throw new Error(`${file.name} exceeds the 30 MB attachment limit.`);
      }
    }

    const projectId = options.snapshotRef.current.project.projectId;
    const imported = await Promise.all(files.map(async (file): Promise<ImportedAttachment> => {
      const dataUrl = await readFileAsDataUrl(file);
      const imageSize = file.type.startsWith('image/')
        ? await readImageDimensions(dataUrl)
        : undefined;
      const asset = await createAssetFromDataUrl({
        dataUrl,
        fileName: file.name,
        height: imageSize?.height,
        projectId,
        width: imageSize?.width,
      });
      return {
        asset,
        block: attachmentBlock(options.snapshotRef.current, asset, file.name),
        fileName: file.name,
      };
    }));

    const next = options.updateSnapshot((current) => {
      const origin = options.centeredBlockPosition({ height: 180, width: 240 });
      imported.forEach((item, index) => {
        if (!current.assets.some((candidate) => candidate.assetId === item.asset.assetId)) {
          current.assets.unshift(item.asset);
        }
        if (!item.block) return;
        item.block.position = {
          x: origin.x + index * 28,
          y: origin.y + index * 28,
        };
        current.blocks.push(item.block);
      });
      return touchBoard(current);
    }, { history: true, persist: false, syncFlow: true });
    await options.persistSnapshot(next, { requireLocalApi: true });

    return imported.map((item): PackageComposerMention => item.block
      ? { blockId: item.block.blockId, kind: 'block', slotId: 'agent_attachment' }
      : { assetId: item.asset.assetId, kind: 'asset', slotId: 'agent_attachment' });
  }

  return { attachFiles };
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
