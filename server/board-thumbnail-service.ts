import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';
import { projectsRoot } from './local-store/context';
import { loadSnapshot } from './local-store/snapshot-store';

const thumbnailWidth = 168;
const thumbnailHeight = 136;
const thumbnailCache = new Map<string, Buffer>();

export async function readBoardThumbnail(input: {
  boardId: string;
  projectId: string;
}): Promise<{ bytes: Buffer; revision: string }> {
  assertSafeIdentifier(input.projectId, 'projectId');
  assertSafeIdentifier(input.boardId, 'boardId');
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const revision = snapshot.board.updatedAt;
  const cacheKey = `${input.projectId}/${input.boardId}/${revision}`;
  const cached = thumbnailCache.get(cacheKey);
  if (cached) return { bytes: cached, revision };

  const bytes = await renderBoardThumbnail(snapshot);
  thumbnailCache.set(cacheKey, bytes);
  while (thumbnailCache.size > 100) {
    const oldestKey = thumbnailCache.keys().next().value;
    if (typeof oldestKey !== 'string') break;
    thumbnailCache.delete(oldestKey);
  }
  return { bytes, revision };
}

export async function renderBoardThumbnail(snapshot: BoardSnapshot): Promise<Buffer> {
  const blocks = visibleThumbnailBlocks(snapshot.blocks);
  const bounds = boardBounds(blocks);
  const geometry = createGeometry(bounds);
  const baseSvg = renderBaseSvg(snapshot, blocks, geometry);
  const imageLayers = await Promise.all(
    blocks
      .filter((block) => block.type === 'image' && typeof block.data.assetId === 'string')
      .sort((left, right) => left.zIndex - right.zIndex)
      .slice(-12)
      .map(async (block) => {
        const asset = snapshot.assets.find((candidate) => candidate.assetId === block.data.assetId);
        if (!asset || asset.kind !== 'image') return undefined;
        const rect = geometry.rect(block);
        if (rect.width < 3 || rect.height < 3) return undefined;
        const source = await readLocalAssetBytes(asset).catch(() => undefined);
        if (!source) return undefined;
        const input = await sharp(source, { failOn: 'none' })
          .rotate()
          .resize({ width: rect.width, height: rect.height, fit: 'cover' })
          .png()
          .toBuffer();
        return { input, left: rect.left, top: rect.top };
      }),
  );

  return sharp(Buffer.from(baseSvg))
    .composite(imageLayers.filter((layer): layer is NonNullable<typeof layer> => Boolean(layer)))
    .webp({ quality: 72, smartSubsample: true })
    .toBuffer();
}

function visibleThumbnailBlocks(blocks: BlockRecord[]): BlockRecord[] {
  const visible = blocks.filter((block) => block.type !== 'group');
  return [...(visible.length > 0 ? visible : blocks)]
    .sort((left, right) => left.zIndex - right.zIndex)
    .slice(-80);
}

function boardBounds(blocks: BlockRecord[]): { height: number; width: number; x: number; y: number } {
  if (blocks.length === 0) return { x: 0, y: 0, width: 1000, height: 800 };
  const left = Math.min(...blocks.map((block) => block.position.x));
  const top = Math.min(...blocks.map((block) => block.position.y));
  const right = Math.max(...blocks.map((block) => block.position.x + block.size.width));
  const bottom = Math.max(...blocks.map((block) => block.position.y + block.size.height));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const padding = Math.max(width, height) * 0.08;
  return {
    x: left - padding,
    y: top - padding,
    width: width + padding * 2,
    height: height + padding * 2,
  };
}

function createGeometry(bounds: ReturnType<typeof boardBounds>): {
  rect: (block: BlockRecord) => { height: number; left: number; top: number; width: number };
} {
  const scale = Math.min(thumbnailWidth / bounds.width, thumbnailHeight / bounds.height);
  const offsetX = (thumbnailWidth - bounds.width * scale) / 2;
  const offsetY = (thumbnailHeight - bounds.height * scale) / 2;
  return {
    rect: (block) => {
      const left = Math.min(thumbnailWidth - 1, Math.max(0, Math.round(offsetX + (block.position.x - bounds.x) * scale)));
      const top = Math.min(thumbnailHeight - 1, Math.max(0, Math.round(offsetY + (block.position.y - bounds.y) * scale)));
      return {
        left,
        top,
        width: Math.max(1, Math.min(thumbnailWidth - left, Math.round(block.size.width * scale))),
        height: Math.max(1, Math.min(thumbnailHeight - top, Math.round(block.size.height * scale))),
      };
    },
  };
}

function renderBaseSvg(
  snapshot: BoardSnapshot,
  blocks: BlockRecord[],
  geometry: ReturnType<typeof createGeometry>,
): string {
  const blockById = new Map(blocks.map((block) => [block.blockId, block]));
  const edges = snapshot.edges.flatMap((edge) => {
    const source = blockById.get(edge.sourceBlockId);
    const target = blockById.get(edge.targetBlockId);
    if (!source || !target) return [];
    const sourceRect = geometry.rect(source);
    const targetRect = geometry.rect(target);
    return [`<line x1="${sourceRect.left + sourceRect.width / 2}" y1="${sourceRect.top + sourceRect.height / 2}" x2="${targetRect.left + targetRect.width / 2}" y2="${targetRect.top + targetRect.height / 2}" stroke="#AEB1BB" stroke-width="1.5"/>`];
  }).join('');
  const shapes = blocks.map((block) => {
    const rect = geometry.rect(block);
    const palette = blockPalette(block.type);
    const radius = Math.min(5, Math.max(1, Math.round(Math.min(rect.width, rect.height) * 0.08)));
    const detail = block.type === 'text' || block.type === 'document'
      ? `<line x1="${rect.left + rect.width * 0.18}" y1="${rect.top + rect.height * 0.38}" x2="${rect.left + rect.width * 0.82}" y2="${rect.top + rect.height * 0.38}" stroke="${palette.detail}" stroke-width="1.5"/><line x1="${rect.left + rect.width * 0.18}" y1="${rect.top + rect.height * 0.61}" x2="${rect.left + rect.width * 0.66}" y2="${rect.top + rect.height * 0.61}" stroke="${palette.detail}" stroke-width="1.5"/>`
      : '';
    return `<rect x="${rect.left}" y="${rect.top}" width="${rect.width}" height="${rect.height}" rx="${radius}" fill="${palette.fill}" stroke="${palette.stroke}" stroke-width="1"/>${detail}`;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${thumbnailWidth}" height="${thumbnailHeight}" viewBox="0 0 ${thumbnailWidth} ${thumbnailHeight}"><defs><pattern id="dots" width="12" height="12" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="#D4D5DB"/></pattern></defs><rect width="100%" height="100%" fill="#EEEFF2"/><rect width="100%" height="100%" fill="url(#dots)"/>${edges}${shapes}</svg>`;
}

function blockPalette(type: BlockRecord['type']): { detail: string; fill: string; stroke: string } {
  if (type === 'operation') return { fill: '#ECE9FF', stroke: '#8A7AE8', detail: '#7056EF' };
  if (type === 'image' || type === 'video') return { fill: '#E6E8ED', stroke: '#A9ADB8', detail: '#7E828D' };
  if (type === 'document') return { fill: '#FAF7EF', stroke: '#D5CBB5', detail: '#A59B86' };
  return { fill: '#FFFFFF', stroke: '#C9CAD2', detail: '#9396A1' };
}

async function readLocalAssetBytes(asset: AssetRecord): Promise<Buffer | undefined> {
  if (asset.storageProvider !== 'local') return undefined;
  const projectRoot = path.resolve(projectsRoot, asset.projectId);
  const assetPath = path.resolve(projectRoot, asset.storageKey);
  if (assetPath !== projectRoot && !assetPath.startsWith(`${projectRoot}${path.sep}`)) return undefined;
  return readFile(assetPath);
}

function assertSafeIdentifier(value: string, field: string): void {
  if (!/^[A-Za-z0-9._-]+$/u.test(value)) throw new Error(`${field} is invalid.`);
}
