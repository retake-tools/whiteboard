import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkspaceMaterials } from '../src/components/WorkspaceMaterials';
import { insertProjectAssetReference } from '../src/core/projectAssetCatalog';
import { I18nProvider } from '../src/i18n';
import {
  createAssetFromDataUrl,
  getBoardSnapshot,
  listProjectAssets,
  relinkAssetFromDataUrl,
  resetWorkspace,
  resolveAssetStoragePath,
  saveSnapshot,
} from './local-store';

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => 'zh', setItem: () => undefined },
});

const snapshot = await resetWorkspace();
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+XwX9WQAAAABJRU5ErkJggg==';
const asset = await createAssetFromDataUrl({
  dataUrl: png,
  deferSnapshotRegistration: true,
  fileName: 'product-source.png',
  height: 1,
  projectId: snapshot.project.projectId,
  width: 1,
});

let catalog = await listProjectAssets(snapshot.project.projectId);
const availableItem = catalog.items.find((item) => item.asset.assetId === asset.assetId);
assert.equal(availableItem?.available, true);
assert.equal(availableItem?.fileName, 'product-source.png');
if (!availableItem) throw new Error('Expected the uploaded material in the Project catalog.');

const block = insertProjectAssetReference(snapshot, {
  item: availableItem,
  position: { x: 120, y: 80 },
});
assert.equal(block.data.assetId, asset.assetId);
assert.equal(snapshot.assets.filter((candidate) => candidate.assetId === asset.assetId).length, 1);
assert.equal(snapshot.historyEvents[0]?.detail?.source, 'project_materials');
await saveSnapshot(snapshot);

await rm(await resolveAssetStoragePath(snapshot.project.projectId, asset.assetId));
catalog = await listProjectAssets(snapshot.project.projectId);
const missingItem = catalog.items.find((item) => item.asset.assetId === asset.assetId);
assert.equal(missingItem?.available, false);

const relinked = await relinkAssetFromDataUrl({
  assetId: asset.assetId,
  dataUrl: png,
  height: 1,
  projectId: snapshot.project.projectId,
  width: 1,
});
assert.equal(relinked.assetId, asset.assetId);
catalog = await listProjectAssets(snapshot.project.projectId);
assert.equal(catalog.items.find((item) => item.asset.assetId === asset.assetId)?.available, true);
const reopened = await getBoardSnapshot({
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
});
assert.equal(reopened.assets.find((candidate) => candidate.assetId === asset.assetId)?.assetId, asset.assetId);
assert.equal(reopened.historyEvents[0]?.type, 'asset_replaced');

const markup = renderToStaticMarkup(
  <I18nProvider>
    <WorkspaceMaterials
      catalog={catalog}
      isLoading={false}
      onAdd={() => undefined}
      onRefresh={() => undefined}
      onRelink={() => undefined}
      onUpload={() => undefined}
      projectName="商品图项目"
    />
  </I18nProvider>,
);
assert.match(markup, /素材/);
assert.match(markup, /上传素材/);
assert.match(markup, /加入当前画板/);
assert.match(markup, /product-source\.png/);
assert.doesNotMatch(markup, /Token|Plan|登录|云同步|Cloudflare/);

console.log(JSON.stringify({
  availableFileDetected: true,
  localOnlySemantics: true,
  missingFileDetected: true,
  relinkPreservesAssetIdentity: true,
  sameAssetInsertedWithoutDuplication: true,
}));
