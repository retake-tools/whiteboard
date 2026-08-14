import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageInspectorPanel } from '../src/components/ImageInspectorPanel';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../src/core/types';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { I18nProvider } from '../src/i18n';

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => 'zh',
    setItem: () => undefined,
  },
});

const asset: AssetRecord = {
  assetId: 'asset_product',
  projectId: defaultSnapshot.project.projectId,
  kind: 'image',
  mimeType: 'image/png',
  storageProvider: 'local',
  storageKey: 'assets/product.png',
  previewUrl: 'data:image/png;base64,AA==',
  width: 1080,
  height: 1440,
  createdAt: '2026-08-14T08:00:00.000Z',
};

const block: BlockRecord = {
  blockId: 'block_product',
  boardId: defaultSnapshot.board.boardId,
  type: 'image',
  layerId: defaultSnapshot.layers[0].id,
  position: { x: 372, y: 156 },
  size: { width: 360, height: 480 },
  zIndex: 3,
  data: {
    assetId: asset.assetId,
    title: '原始商品图',
  },
  createdAt: asset.createdAt,
  updatedAt: asset.createdAt,
};

const snapshot: BoardSnapshot = {
  ...structuredClone(defaultSnapshot),
  assets: [asset],
  blocks: [block],
  historyEvents: [{
    eventId: 'history_import',
    type: 'asset_imported',
    createdAt: asset.createdAt,
    actor: 'user',
    blockIds: [block.blockId],
    assetIds: [asset.assetId],
    summary: '商品图已导入',
  }],
};

const markup = renderToStaticMarkup(
  <I18nProvider>
    <ImageInspectorPanel
      asset={asset}
      block={block}
      contentLocked={false}
      onClose={() => undefined}
      onOpenExecutionDetails={() => undefined}
      previewUrl={asset.previewUrl}
      snapshot={snapshot}
    />
  </I18nProvider>,
);

assert.match(markup, /图片检查器/);
assert.match(markup, /当前选择/);
assert.match(markup, /原始商品图/);
assert.match(markup, /1080 × 1440 px/);
assert.match(markup, /位置与尺寸/);
assert.match(markup, />372</);
assert.match(markup, />156</);
assert.match(markup, /图像信息/);
assert.match(markup, /导入素材/);
assert.match(markup, /PNG/);
assert.match(markup, /商品图已导入/);
assert.doesNotMatch(markup, /图片工具|下载图片|替换图片/);
assert.doesNotMatch(markup, /Token|Plan|登录|Sign in/);

console.log(JSON.stringify({
  canonicalFactsProjected: true,
  contextualToolbarOwnsDynamicTools: true,
  hostedSemanticsExcluded: true,
  imageInspectorRendered: true,
}));
