import type { CSSProperties, ReactElement } from 'react';
import {
  boardBackgroundAsset,
  normalizeBoardBackground,
} from '../core/boardBackground';
import type { BoardSnapshot } from '../core/types';

export function BoardBackgroundLayer({
  snapshot,
}: {
  snapshot: BoardSnapshot;
}): ReactElement {
  const background = normalizeBoardBackground(snapshot.board.background);
  const asset = boardBackgroundAsset(snapshot);
  const style: CSSProperties = background.kind === 'solid'
    ? { backgroundColor: background.color }
    : background.kind === 'image' && asset
      ? {
          backgroundImage: `url(${JSON.stringify(asset.previewUrl).slice(1, -1)})`,
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
          backgroundSize: background.fit,
        }
      : {};
  return (
    <div
      aria-hidden="true"
      className={`board-background-layer is-${background.kind}`}
      data-asset-id={asset?.assetId}
      style={style}
    />
  );
}
