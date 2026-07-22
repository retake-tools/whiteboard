import type { BlockType } from './types';

export interface BlockSize {
  height: number;
  width: number;
}

const defaultBlockSizes: Record<BlockType, BlockSize> = {
  document: { width: 320, height: 240 },
  group: { width: 520, height: 320 },
  image: { width: 300, height: 230 },
  operation: { width: 320, height: 190 },
  text: { width: 260, height: 170 },
  video: { width: 300, height: 180 },
};

export const mediaBlockMaxSide = 380;
export const mediaBlockMinSide = 160;
export const imageResultColumnGap = 32;

export function defaultBlockSize(type: BlockType): BlockSize {
  return { ...defaultBlockSizes[type] };
}

export function fitImageBlockSize(width?: number, height?: number): BlockSize {
  if (!width || !height || width <= 0 || height <= 0) return defaultBlockSize('image');
  return fitMediaBlockSize(width / height);
}

export function fitMediaBlockSize(
  aspectRatio: number | undefined,
  fallback: BlockSize = defaultBlockSizes.image,
): BlockSize {
  if (!aspectRatio || !Number.isFinite(aspectRatio) || aspectRatio <= 0) return { ...fallback };

  if (aspectRatio >= 1) {
    return {
      width: mediaBlockMaxSide,
      height: Math.max(mediaBlockMinSide, Math.round(mediaBlockMaxSide / aspectRatio)),
    };
  }

  return {
    width: Math.max(mediaBlockMinSide, Math.round(mediaBlockMaxSide * aspectRatio)),
    height: mediaBlockMaxSide,
  };
}
