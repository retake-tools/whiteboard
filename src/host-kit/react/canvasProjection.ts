import type { BoardSnapshot } from '../../core/types';
import type { DeepReadonly } from '../contracts';
import type { HostReactPluginSurfaceV1 } from './pluginSurface';
import type { StandardCanvasNode } from './StandardBlockNode';

type ReadonlyAsset = DeepReadonly<BoardSnapshot['assets'][number]>;

interface CachedNodeProjection {
  readonly node: StandardCanvasNode;
  readonly signature: string;
}

export interface CanvasNodeProjectorV1 {
  project(input: {
    readonly assetById: ReadonlyMap<string, ReadonlyAsset>;
    readonly pluginSurface?: HostReactPluginSurfaceV1;
    readonly selectedIds: readonly string[];
    readonly snapshot: DeepReadonly<BoardSnapshot>;
  }): StandardCanvasNode[];
}

export function createCanvasNodeProjector(): CanvasNodeProjectorV1 {
  const cache = new Map<string, CachedNodeProjection>();
  return {
    project({ assetById, pluginSurface, selectedIds, snapshot }) {
      const selected = new Set(selectedIds);
      const activeIds = new Set(snapshot.blocks.map((block) => block.blockId));
      for (const blockId of cache.keys()) {
        if (!activeIds.has(blockId)) cache.delete(blockId);
      }
      const blockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
      const orderedBlocks = [...snapshot.blocks].sort((left, right) => (
        blockDepth(left.blockId, blockById) - blockDepth(right.blockId, blockById)
        || (left.type === 'group' ? -1 : right.type === 'group' ? 1 : 0)
        || left.zIndex - right.zIndex
      ));
      return orderedBlocks.map((block) => {
        const asset = block.data.assetId ? assetById.get(block.data.assetId) : undefined;
        const signature = JSON.stringify([
          block,
          asset?.assetId,
          asset?.previewUrl,
          pluginSurface?.revision,
          selected.has(block.blockId),
        ]);
        const cached = cache.get(block.blockId);
        if (cached?.signature === signature) return cached.node;
        const renderer = pluginSurface?.renderers.find(
          (candidate) => candidate.supportedBlockTypes.includes(block.type),
        );
        const parent = block.parentGroupId ? blockById.get(block.parentGroupId) : undefined;
        const node: StandardCanvasNode = {
          data: {
            assetPreviewUrl: asset?.previewUrl ?? block.data.previewUrl,
            body: block.data.body,
            pluginBody: renderer?.render(block),
            title: block.data.title,
          },
          height: block.size.height,
          id: block.blockId,
          parentId: block.parentGroupId,
          position: parent
            ? {
                x: block.position.x - parent.position.x,
                y: block.position.y - parent.position.y,
              }
            : { ...block.position },
          selected: selected.has(block.blockId),
          style: { height: block.size.height, width: block.size.width, zIndex: block.zIndex },
          type: block.type,
          width: block.size.width,
        };
        cache.set(block.blockId, { node, signature });
        return node;
      });
    },
  };
}

function blockDepth(
  blockId: string,
  blockById: ReadonlyMap<string, DeepReadonly<BoardSnapshot['blocks'][number]>>,
): number {
  let depth = 0;
  let current = blockById.get(blockId);
  const visited = new Set<string>();
  while (current?.parentGroupId && !visited.has(current.parentGroupId)) {
    visited.add(current.parentGroupId);
    current = blockById.get(current.parentGroupId);
    depth += 1;
  }
  return depth;
}
