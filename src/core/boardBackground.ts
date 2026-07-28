import type { AssetRecord, BoardBackgroundV1, BoardSnapshot } from './types';

const solidColorPattern = /^#[0-9a-f]{6}$/i;

export function normalizeBoardBackground(
  value: unknown,
): BoardBackgroundV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { kind: 'default' };
  }
  const candidate = value as Partial<BoardBackgroundV1>;
  if (candidate.kind === 'solid' && solidColorPattern.test(candidate.color ?? '')) {
    return { color: candidate.color!.toLowerCase(), kind: 'solid' };
  }
  if (
    candidate.kind === 'image'
    && typeof candidate.assetId === 'string'
    && candidate.assetId.length > 0
  ) {
    return {
      assetId: candidate.assetId,
      fit: candidate.fit === 'contain' ? 'contain' : 'cover',
      kind: 'image',
    };
  }
  return { kind: 'default' };
}

export function setBoardBackground(
  snapshot: BoardSnapshot,
  background: BoardBackgroundV1,
  now = new Date().toISOString(),
): BoardSnapshot {
  const normalized = normalizeBoardBackground(background);
  if (normalized.kind === 'image') {
    requireBackgroundAsset(snapshot, normalized.assetId);
  }
  const next = structuredClone(snapshot);
  next.board.background = normalized;
  next.board.updatedAt = now;
  return next;
}

export function boardBackgroundAsset(
  snapshot: BoardSnapshot,
): AssetRecord | undefined {
  const background = normalizeBoardBackground(snapshot.board.background);
  if (background.kind !== 'image') return undefined;
  return snapshot.assets.find((asset) => (
    asset.assetId === background.assetId
    && asset.projectId === snapshot.project.projectId
    && asset.kind === 'image'
  ));
}

export function exportBoardBackground(snapshot: BoardSnapshot): {
  background: BoardBackgroundV1;
  asset?: AssetRecord;
} {
  const background = normalizeBoardBackground(snapshot.board.background);
  const asset = background.kind === 'image'
    ? requireBackgroundAsset(snapshot, background.assetId)
    : undefined;
  return {
    background,
    ...(asset ? { asset: structuredClone(asset) } : {}),
  };
}

function requireBackgroundAsset(
  snapshot: BoardSnapshot,
  assetId: string,
): AssetRecord {
  const asset = snapshot.assets.find((candidate) => (
    candidate.assetId === assetId
    && candidate.projectId === snapshot.project.projectId
    && candidate.kind === 'image'
  ));
  if (!asset) {
    throw new Error(
      'Board image background must reference an Image Asset in the current Project.',
    );
  }
  return asset;
}
