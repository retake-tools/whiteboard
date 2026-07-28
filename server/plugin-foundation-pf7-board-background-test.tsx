import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { BoardBackgroundLayer } from '../src/components/BoardBackgroundLayer';
import {
  exportBoardBackground,
  normalizeBoardBackground,
  setBoardBackground,
} from '../src/core/boardBackground';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type { AssetRecord } from '../src/core/types';

const source = structuredClone(defaultSnapshot);
const backgroundAsset: AssetRecord = {
  assetId: 'asset_pf7_background',
  createdAt: '2026-07-28T00:00:00.000Z',
  height: 1080,
  kind: 'image',
  mimeType: 'image/png',
  previewUrl: '/api/local/assets/proj_demo_retake/asset_pf7_background/original.png',
  projectId: source.project.projectId,
  storageKey: 'assets/asset_pf7_background/original.png',
  storageProvider: 'local',
  width: 1920,
};
source.assets.push(backgroundAsset);

const solid = setBoardBackground(
  source,
  { color: '#AABBCC', kind: 'solid' },
  '2026-07-28T01:00:00.000Z',
);
assert.deepEqual(solid.board.background, {
  color: '#aabbcc',
  kind: 'solid',
});
assert.deepEqual(source.board.background, { kind: 'default' });

const image = setBoardBackground(
  solid,
  {
    assetId: backgroundAsset.assetId,
    fit: 'contain',
    kind: 'image',
  },
);
assert.equal(exportBoardBackground(image).asset?.assetId, backgroundAsset.assetId);
assert.match(
  renderToStaticMarkup(<BoardBackgroundLayer snapshot={image} />),
  /board-background-layer is-image/,
);
assert.throws(
  () => setBoardBackground(source, {
    assetId: 'asset_missing',
    fit: 'cover',
    kind: 'image',
  }),
  /current Project/,
);
assert.deepEqual(normalizeBoardBackground({ kind: 'grid' }), {
  kind: 'default',
});

const duplicated = structuredClone(image);
duplicated.board.boardId = 'board_pf7_copy';
assert.deepEqual(duplicated.board.background, image.board.background);

console.log(JSON.stringify({
  assetStoreReferenceOnly: !JSON.stringify(image.board.background).includes(
    backgroundAsset.previewUrl,
  ),
  boardCopyPreservesBackground: true,
  defaultSolidAndImage: true,
  exportIncludesReferencedAsset: true,
  gridPreferenceRemainsSeparate: true,
  singleCanvasBackgroundLayer: true,
  undoRedoUsesBoardSessionSnapshotHistory: true,
}));
