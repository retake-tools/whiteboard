import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageInspectorPanel } from '../src/components/ImageInspectorPanel';
import { ImageFocusWorkspace } from '../src/components/ImageFocusWorkspace';
import {
  projectFlowEdgeSelection,
  projectFlowNodeSelection,
} from '../src/app/canvasSelectionProjection';
import type { RetakeEdge, RetakeNode } from '../src/canvas/reactFlowTypes';
import { executionImageBrowserItems } from '../src/core/executionImageBrowser';
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
      onCopyPrompt={() => undefined}
      onDownload={() => undefined}
      onRestoreConfiguration={() => undefined}
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
assert.match(markup, /图片工具/);
assert.match(markup, /下载图片/);
assert.doesNotMatch(markup, /Token|Plan|登录|Sign in/);

const firstNode: RetakeNode = {
  id: block.blockId,
  type: 'image',
  position: block.position,
  data: { ...block.data, groupScopeSelected: false },
  selected: false,
};
const secondNode: RetakeNode = {
  id: 'block_other',
  type: 'image',
  position: { x: 800, y: 156 },
  data: { ...block.data, title: '其他图片', groupScopeSelected: false },
  selected: false,
};
const selectedNodes = projectFlowNodeSelection(
  [firstNode, secondNode],
  snapshot,
  [block.blockId],
);
assert.equal(selectedNodes[0].selected, true);
assert.strictEqual(selectedNodes[1], secondNode);

const connectedEdge: RetakeEdge = {
  id: 'edge_connected',
  source: block.blockId,
  target: 'block_other',
  className: 'is-workflow-edge',
  data: { kind: 'execution_output' },
};
const unrelatedEdge: RetakeEdge = {
  id: 'edge_unrelated',
  source: 'block_a',
  target: 'block_b',
  className: 'is-workflow-edge',
  data: { kind: 'execution_output' },
};
const selectedEdges = projectFlowEdgeSelection(
  [connectedEdge, unrelatedEdge],
  snapshot,
  [block.blockId],
);
assert.match(selectedEdges[0].className ?? '', /is-connected-to-selection/);
assert.match(selectedEdges[0].className ?? '', /is-workflow-edge/);
assert.strictEqual(selectedEdges[1], unrelatedEdge);

const firstBrowserItems = executionImageBrowserItems(snapshot, block.blockId);
assert.strictEqual(
  executionImageBrowserItems(snapshot, block.blockId),
  firstBrowserItems,
);

const focusMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ImageFocusWorkspace
      block={block}
      compareMode={false}
      onBackToCanvas={() => undefined}
      onCompareModeChange={() => undefined}
      onSelectBlock={() => undefined}
      snapshot={snapshot}
    />
  </I18nProvider>,
);

assert.match(focusMarkup, /图片聚焦工作区/);
assert.match(focusMarkup, /返回画布/);
assert.match(focusMarkup, /本次候选/);
assert.match(focusMarkup, /本次候选 1 \/ 1/);
assert.match(focusMarkup, /向左移动候选队列/);
assert.match(focusMarkup, /向右移动候选队列/);
assert.match(focusMarkup, /data-candidate-index="0"/);
assert.match(focusMarkup, /execution-result-stage/);

const { readFile } = await import('node:fs/promises');
const [appSource, eventBindingSource, inspectorSource, focusSource, focusStyles] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAppEventBindings.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ImageInspectorPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ImageFocusWorkspace.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/image-focus-workspace.css', import.meta.url), 'utf8'),
]);

assert.match(appSource, /<ImageFocusWorkspace/);
assert.match(appSource, /compareMode=\{imageFocusCompareMode\}/);
assert.match(appSource, /onCompareModeChange=\{setImageFocusCompareMode\}/);
assert.match(appSource, /onSelectOutput=\{executionOutputSelectionController\.selectOutput\}/);
assert.match(appSource, /setImageFocusBlockId\(undefined\)/);
assert.match(appSource, /onBackToCanvas=\{\(\) => \{\s*setImageFocusBlockId\(undefined\);\s*setInspectorBlockId\(undefined\)/);
assert.match(eventBindingSource, /setImageFocusBlockIdRef\.current\(blockId\)/);
assert.match(eventBindingSource, /setInspectorBlockIdRef\.current\(blockId\)/);
assert.match(inspectorSource, /<PluginImageToolbarActions/);
assert.doesNotMatch(inspectorSource, /调整图片|标注图片|裁剪图片|扩图/);
assert.match(inspectorSource, /scrollIntoView/);
assert.match(inspectorSource, /executionDetailsOpen \? \(/);
assert.match(focusSource, /scrollCandidateQueue/);
assert.match(focusSource, /activeCandidate\.offsetLeft/);
assert.match(focusSource, /image-focus-comparison/);
assert.match(focusSource, /selectedOutputImage/);
assert.match(focusSource, /activeExecution\.outputBlockIds/);
assert.match(focusSource, /aria-pressed=\{compareMode\}/);
assert.match(focusSource, /if \(compareMode\) \{/);
assert.match(focusStyles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(focusStyles, /right: var\(--workspace-workbench-width\)/);

console.log(JSON.stringify({
  canonicalFactsProjected: true,
  focusWorkspaceRendered: true,
  pluginRegistryOwnsDynamicTools: true,
  hostedSemanticsExcluded: true,
  imageInspectorRendered: true,
}));
