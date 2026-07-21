import { createId, nowIso } from './id';
import { defaultGenerationProfileId } from './generationProfiles';
import { defaultBlockSize } from './blockSizing';
import { executionConnection, executionDefaultSelection } from './executionProviderPreferences';
import type { BlockRecord, BlockType, BoardSnapshot } from './types';

export function createBlockRecord(
  snapshot: BoardSnapshot,
  type: BlockType,
): BlockRecord {
  const index = snapshot.blocks.length;
  const createdAt = nowIso();

  return {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type,
    layerId: 'layer_default',
    position: { x: 80 + index * 36, y: 80 + index * 24 },
    size: defaultBlockSize(type),
    zIndex: maxZIndex(snapshot.blocks) + 1,
    data: dataForType(type, snapshot.project.projectId),
    createdAt,
    updatedAt: createdAt,
  };
}

export function touchBoard(snapshot: BoardSnapshot): BoardSnapshot {
  const updatedAt = nowIso();
  snapshot.project.updatedAt = updatedAt;
  snapshot.board.updatedAt = updatedAt;
  return snapshot;
}

export function maxZIndex(blocks: BlockRecord[]): number {
  return blocks.reduce((max, block) => Math.max(max, block.zIndex), 0);
}

function dataForType(type: BlockType, projectId: string): BlockRecord['data'] {
  if (type === 'operation') {
    return {
      title: 'New operation',
      body: 'Choose capability, inputs, and execution adapter.',
      capabilityId: 'image.text_to_image',
      generationProfileId: defaultGenerationProfileId,
    };
  }

  if (type === 'group') {
    return {
      title: 'Group',
      groupColor: 'neutral',
      groupKind: 'manual',
      groupLayoutMode: 'free',
    };
  }

  if (type === 'image') {
    return {
      title: 'Image block',
      body: 'Import or generate an asset to attach assetId.',
    };
  }

  if (type === 'video') {
    const selection = executionDefaultSelection('video', projectId);
    const connection = executionConnection(selection?.connectionId, projectId);
    const executionProfileId = videoProfileForConnector(connection?.connectorId);
    return {
      title: 'Video block',
      body: 'Connect optional image references, then generate through the selected video profile.',
      executionDraft: {
        schemaVersion: 1,
        capabilityId: 'video.generate',
        executionProfileId,
        ...(selection?.connectionId ? { connectionId: selection.connectionId } : {}),
        ...(selection?.model ? { model: selection.model } : {}),
        prompt: '',
        parameters: {
          aspectRatio: '9:16',
          durationSeconds: 8,
          outputCount: 1,
          qualityTier: 'preview',
        },
      },
    };
  }

  return {
    title: 'Text block',
    body: 'Prompt, script note, reference, or story fragment.',
  };
}

function videoProfileForConnector(connectorId: string | undefined): string {
  if (connectorId === 'dreamina') return 'video-dreamina-cli';
  if (connectorId === 'byteplus-modelark') return 'video-seedance-modelark';
  return 'video-mock';
}
