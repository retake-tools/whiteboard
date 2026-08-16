import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageInspectorPanel } from '../src/components/ImageInspectorPanel';
import { ImageFocusWorkspace } from '../src/components/ImageFocusWorkspace';
import { OperationFeedback } from '../src/components/OperationFeedback';
import { isImageFocusEditableTarget } from '../src/components/imageFocusKeyboard';
import {
  projectFlowEdgeSelection,
  projectFlowNodeSelection,
} from '../src/app/canvasSelectionProjection';
import type { RetakeEdge, RetakeNode } from '../src/canvas/reactFlowTypes';
import { executionImageBrowserItems } from '../src/core/executionImageBrowser';
import {
  imageEditorOpeningExpired,
  imageEditorPanelVisibilityChanged,
  resolveImageEditorInspectorBlock,
  startImageEditorSession,
} from '../src/app/imageEditorSession';
import type { AssetRecord, BlockRecord, BoardSnapshot, ExecutionRecord } from '../src/core/types';
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
assert.doesNotMatch(markup, /当前版本|>V\d+</);
assert.match(markup, /商品图已导入/);
assert.match(markup, /图片工具/);
assert.match(markup, /导出图片/);
assert.doesNotMatch(markup, /准备交付|验证并导出|导出项目/);
assert.doesNotMatch(markup, /Token|Plan|登录|Sign in/);

const singleOutputExecution: ExecutionRecord = {
  executionId: 'execution_single_output',
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  capabilityId: 'image.local_crop',
  adapter: 'local_canvas',
  status: 'succeeded',
  inputBlockIds: [],
  outputBlockIds: [block.blockId],
  outputAssetIds: [asset.assetId],
  params: {},
  startedAt: asset.createdAt,
  completedAt: asset.createdAt,
};
const singleOutputMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ImageInspectorPanel
      asset={asset}
      block={block}
      contentLocked={false}
      onClose={() => undefined}
      onCopyPrompt={() => undefined}
      onDownload={() => undefined}
      onRestoreConfiguration={() => undefined}
      onSelectOutput={() => undefined}
      previewUrl={asset.previewUrl}
      snapshot={{ ...snapshot, executions: [singleOutputExecution] }}
    />
  </I18nProvider>,
);
assert.doesNotMatch(singleOutputMarkup, /当前结果|设为当前结果/);

const secondAsset: AssetRecord = {
  ...asset,
  assetId: 'asset_product_second',
  storageKey: 'assets/product-second.png',
};
const secondBlock: BlockRecord = {
  ...block,
  blockId: 'block_product_second',
  data: { ...block.data, assetId: secondAsset.assetId, title: '商品图方案 2' },
};
const multiOutputExecution: ExecutionRecord = {
  ...singleOutputExecution,
  executionId: 'execution_multi_output',
  outputAssetIds: [asset.assetId, secondAsset.assetId],
  outputBlockIds: [block.blockId, secondBlock.blockId],
};
const multiOutputMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ImageInspectorPanel
      asset={asset}
      block={block}
      contentLocked={false}
      onClose={() => undefined}
      onCopyPrompt={() => undefined}
      onDownload={() => undefined}
      onRestoreConfiguration={() => undefined}
      onSelectOutput={() => undefined}
      previewUrl={asset.previewUrl}
      snapshot={{
        ...snapshot,
        assets: [asset, secondAsset],
        blocks: [block, secondBlock],
        executions: [multiOutputExecution],
      }}
    />
  </I18nProvider>,
);
assert.match(multiOutputMarkup, /当前结果/);
assert.match(multiOutputMarkup, /设为当前结果/);
assert.doesNotMatch(multiOutputMarkup, /选用当前方案/);

const completionFeedbackMarkup = renderToStaticMarkup(
  <I18nProvider>
    <OperationFeedback
      onClosePromptPreview={() => undefined}
      onCloseToast={() => undefined}
      onCopyPrompt={() => undefined}
      toast={{
        actionLabel: '查看结果',
        id: 'image-edit-completed',
        onAction: () => undefined,
        title: '图片编辑完成',
      }}
    />
  </I18nProvider>,
);
assert.match(completionFeedbackMarkup, /查看结果/);

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
assert.match(focusMarkup, /候选与版本/);
assert.match(focusMarkup, /候选与版本 1 \/ 1/);
assert.match(focusMarkup, /向左移动候选队列/);
assert.match(focusMarkup, /向右移动候选队列/);
assert.match(focusMarkup, /data-candidate-index="0"/);
assert.match(focusMarkup, /execution-result-stage/);
assert.equal(isImageFocusEditableTarget(null), false);
assert.equal(
  isImageFocusEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget),
  true,
);
assert.equal(
  isImageFocusEditableTarget({ tagName: 'input' } as unknown as EventTarget),
  true,
);
assert.equal(
  isImageFocusEditableTarget({ isContentEditable: true, tagName: 'DIV' } as unknown as EventTarget),
  true,
);
assert.equal(
  isImageFocusEditableTarget({ tagName: 'BUTTON' } as unknown as EventTarget),
  false,
);

const { readFile } = await import('node:fs/promises');
const [
  appSource,
  eventBindingSource,
  inspectorSource,
  focusSource,
  focusStyles,
  historySource,
  shellStyles,
] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAppEventBindings.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ImageInspectorPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ImageFocusWorkspace.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/image-focus-workspace.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/BoardHistoryPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/workspace-shell.css', import.meta.url), 'utf8'),
]);

assert.match(appSource, /<ImageFocusWorkspace/);
assert.match(appSource, /compareMode=\{imageFocusCompareMode\}/);
assert.match(appSource, /onCompareModeChange=\{setImageFocusCompareMode\}/);
assert.match(appSource, /onSelectOutput=\{executionOutputSelectionController\.selectOutput\}/);
assert.match(appSource, /<ImageInspectorPanel[\s\S]*beginImageEditorSession\([\s\S]*imageFocusBlock \? 'image-focus' : 'image-inspector'/);
assert.match(appSource, /presentation=\{imageEditorOpen \? 'focus-editor' : 'overlay'\}/);
assert.match(appSource, /suspended=\{imageEditorOpen\}/);
assert.doesNotMatch(appSource, /onBeforePluginOperationAction=\{async \(\) => \{[\s\S]*setInspectorBlockId\(undefined\)/);
assert.match(appSource, /setImageFocusBlockId\(undefined\)/);
assert.match(appSource, /onBackToCanvas=\{\(\) => \{\s*setImageFocusBlockId\(undefined\);\s*setInspectorBlockId\(undefined\)/);
assert.match(appSource, /plugin-execution-completed:/);
assert.match(appSource, /imageEditorSessionRef\.current = undefined;[\s\S]*window\.requestAnimationFrame\(openResult\)/);
assert.doesNotMatch(appSource, /retake-debug/);
assert.match(eventBindingSource, /setImageFocusBlockIdRef\.current\(blockId\)/);
assert.match(eventBindingSource, /setInspectorBlockIdRef\.current\(blockId\)/);
assert.match(inspectorSource, /<PluginImageToolbarActions/);
assert.doesNotMatch(inspectorSource, /调整图片|标注图片|裁剪图片|扩图/);
assert.doesNotMatch(inspectorSource, /relatedExecutions\.length/);
assert.match(inspectorSource, /onInvoke=\{\(\) => onBeforePluginOperationAction\?\.\(block\.blockId\)\}/);
assert.match(inspectorSource, /scrollIntoView/);
assert.match(inspectorSource, /executionDetailsOpen \? \(/);
assert.match(focusSource, /scrollCandidateQueue/);
assert.match(focusSource, /activeCandidate\.offsetLeft/);
assert.match(focusSource, /image-focus-comparison/);
assert.match(focusSource, /selectedOutputImage/);
assert.match(focusSource, /comparisonCandidates/);
assert.match(focusSource, /activeExecution\.outputBlockIds/);
assert.match(focusSource, /aria-pressed=\{compareMode\}/);
assert.match(focusSource, /if \(compareMode\) \{/);
assert.match(focusStyles, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
assert.match(focusStyles, /right: var\(--workspace-workbench-width\)/);
assert.match(focusStyles, /\.workspace-shell\.is-focus-editor \.image-focus-workspace/);
assert.doesNotMatch(
  shellStyles,
  /\.workspace-shell\.is-focus-editor \.workspace-workbench/,
);
assert.match(
  shellStyles,
  /\.workspace-shell\.is-focus-editor \.plugin-panel-host\.is-focus-editor\s*\{[^}]*right: var\(--workspace-workbench-width\)/s,
);
assert.match(
  shellStyles,
  /\.workspace-shell\.has-workbench \.operation-toast,[\s\S]*right: calc\(var\(--workspace-workbench-width\) \+ 16px\)/,
);
assert.match(historySource, /onBeforePluginOperationAction=\{\s*onBeforePluginOperationAction\s*\}/);
assert.doesNotMatch(historySource, /onLocateBlock\(operationBlockId\)/);

const openingSession = startImageEditorSession({
  origin: 'image-focus',
  sourceBlockId: block.blockId,
  startedAt: 1_000,
});
assert.deepEqual(openingSession, {
  origin: 'image-focus',
  phase: 'opening',
  returnSelectedBlockIds: [block.blockId],
  sourceBlockId: block.blockId,
  startedAt: 1_000,
});
assert.strictEqual(
  imageEditorPanelVisibilityChanged(openingSession, false),
  openingSession,
);
const visibleSession = imageEditorPanelVisibilityChanged(openingSession, true);
assert.equal(visibleSession?.phase, 'visible');
assert.equal(
  imageEditorPanelVisibilityChanged(visibleSession, false)?.phase,
  'restoring',
);
assert.equal(imageEditorOpeningExpired(openingSession, 4_999), false);
assert.equal(imageEditorOpeningExpired(openingSession, 5_000), true);

const operationBlock: BlockRecord = {
  ...block,
  blockId: 'operation_annotation',
  type: 'operation',
  data: {
    capabilityId: 'image.annotation_edit',
    status: 'succeeded',
    title: '标注编辑',
  },
};
const operationExecution: ExecutionRecord = {
  executionId: 'execution_annotation',
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  capabilityId: 'image.annotation_edit',
  adapter: 'codex_app_server',
  status: 'succeeded',
  inputBlockIds: [block.blockId],
  inputAssetIds: [asset.assetId],
  outputBlockIds: [],
  outputAssetIds: [],
  params: { operationBlockId: operationBlock.blockId },
  startedAt: asset.createdAt,
  completedAt: asset.createdAt,
};
const editorSnapshot: BoardSnapshot = {
  ...snapshot,
  blocks: [block, operationBlock],
  executions: [operationExecution],
};
assert.equal(
  resolveImageEditorInspectorBlock(editorSnapshot, operationBlock.blockId)?.blockId,
  block.blockId,
);

console.log(JSON.stringify({
  canonicalFactsProjected: true,
  focusWorkspaceRendered: true,
  pluginRegistryOwnsDynamicTools: true,
  hostedSemanticsExcluded: true,
  imageInspectorRendered: true,
}));
