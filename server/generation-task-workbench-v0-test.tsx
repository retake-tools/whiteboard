import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GenerationCandidateDock } from '../src/components/GenerationCandidateDock';
import {
  GenerationTaskPanel,
  generationExecutionForBlock,
} from '../src/components/GenerationTaskPanel';
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

const now = '2026-08-14T09:00:00.000Z';
const operation: BlockRecord = {
  blockId: 'operation_generate',
  boardId: defaultSnapshot.board.boardId,
  type: 'operation',
  layerId: defaultSnapshot.layers[0].id,
  position: { x: 500, y: 200 },
  size: { width: 280, height: 320 },
  zIndex: 2,
  data: {
    capabilityId: 'image.generate',
    generationParams: {
      aspectRatioPreset: '3:4',
      targetHeight: 1440,
      targetWidth: 1080,
      variationCount: 4,
    },
    sourceExecutionId: 'execution_generate',
    title: '商品海报生成',
  },
  createdAt: now,
  updatedAt: now,
};
const sourceAsset = imageAsset('asset_source', 'data:image/png;base64,SOURCE');
const resultAsset = imageAsset('asset_result_1', 'data:image/png;base64,RESULT');
const source = imageBlock('source_image', '原始商品图', sourceAsset.assetId, 0);
const result1 = imageBlock('result_1', '方案 1', resultAsset.assetId, 1);
const result2 = imageBlock('result_2', '方案 2', undefined, 2, 'running');
const result3 = imageBlock('result_3', '方案 3', undefined, 3, 'running');
const result4 = imageBlock('result_4', '方案 4', undefined, 4, 'running');
const execution: ExecutionRecord = {
  executionId: 'execution_generate',
  projectId: defaultSnapshot.project.projectId,
  boardId: defaultSnapshot.board.boardId,
  capabilityId: 'image.generate',
  adapter: 'direct_api',
  status: 'running',
  inputBlockIds: [source.blockId],
  inputAssetIds: [sourceAsset.assetId],
  outputBlockIds: [result1.blockId, result2.blockId, result3.blockId, result4.blockId],
  outputAssetIds: [resultAsset.assetId],
  connectionId: 'connection_image',
  provider: 'Image provider',
  model: 'Image model',
  prompt: '换背景，保留商品、Logo、文字',
  params: {
    operationBlockId: operation.blockId,
    variationCount: 4,
  },
  resultSummary: { requested: 4, succeeded: 1, failed: 0 },
  startedAt: now,
};
const snapshot: BoardSnapshot = {
  ...structuredClone(defaultSnapshot),
  assets: [sourceAsset, resultAsset],
  blocks: [source, operation, result1, result2, result3, result4],
  executions: [execution],
};

assert.equal(generationExecutionForBlock(snapshot, operation)?.executionId, execution.executionId);
assert.equal(generationExecutionForBlock(snapshot, result1)?.executionId, execution.executionId);

const panelMarkup = renderToStaticMarkup(
  <I18nProvider>
    <GenerationTaskPanel
      block={operation}
      onCancelExecution={() => undefined}
      onClose={() => undefined}
      onContinueFromResult={() => undefined}
      onOpenExecutionDetails={() => undefined}
      onRetryExecution={() => undefined}
      selectedBlockId={result1.blockId}
      snapshot={snapshot}
    />
  </I18nProvider>,
);
assert.match(panelMarkup, /图生图/);
assert.match(panelMarkup, /商品海报生成/);
assert.match(panelMarkup, />1\/4</);
assert.match(panelMarkup, /原始商品图/);
assert.match(panelMarkup, /换背景，保留商品、Logo、文字/);
assert.match(panelMarkup, /3:4/);
assert.match(panelMarkup, /1080 × 1440/);
assert.match(panelMarkup, /Image provider/);
assert.match(panelMarkup, /不伪造 Token 或授权结论/);
assert.match(panelMarkup, /取消生成/);
assert.match(panelMarkup, /基于此图继续编辑/);

const dockMarkup = renderToStaticMarkup(
  <I18nProvider>
    <GenerationCandidateDock
      execution={execution}
      onSelectBlock={() => undefined}
      selectedBlockId={result1.blockId}
      snapshot={snapshot}
    />
  </I18nProvider>,
);
assert.match(dockMarkup, /候选结果/);
assert.match(dockMarkup, /原图/);
assert.match(dockMarkup, /方案 1/);
assert.match(dockMarkup, /方案 4/);
assert.match(dockMarkup, /预览中/);
assert.doesNotMatch(dockMarkup, /已选|selected authority/);

const [appSource, eventBindingSource, imageInspectorSource, taskStyles] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAppEventBindings.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ImageInspectorPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/generation-task-panel.css', import.meta.url), 'utf8'),
]);
assert.match(appSource, /workspaceSurface\.kind === 'task'/);
assert.match(appSource, /<GenerationTaskPanel/);
assert.match(appSource, /<GenerationCandidateDock/);
assert.match(appSource, /<ImageFocusWorkspace/);
assert.match(imageInspectorSource, /<ExecutionPromptDetails/);
assert.match(eventBindingSource, /block\.type === 'operation' && block\.data\.capabilityId === imageGenerateCapabilityId/);
assert.match(eventBindingSource, /setTaskBlockIdRef\.current\(blockId\)/);
assert.match(eventBindingSource, /setImageFocusBlockIdRef\.current\(blockId\)/);
assert.match(eventBindingSource, /setInspectorBlockIdRef\.current\(blockId\)/);
assert.match(taskStyles, /right: calc\(var\(--workspace-workbench-width\) \+ 20px\)/);

console.log(JSON.stringify({
  agentAuthorityUntouched: true,
  candidateDockIsProjectionOnly: true,
  generationTaskUsesWorkbench: true,
  realExecutionFactsProjected: true,
}));

function imageAsset(assetId: string, previewUrl: string): AssetRecord {
  return {
    assetId,
    projectId: defaultSnapshot.project.projectId,
    kind: 'image',
    mimeType: 'image/png',
    storageProvider: 'local',
    storageKey: `assets/${assetId}.png`,
    previewUrl,
    width: 1080,
    height: 1440,
    createdAt: now,
  };
}

function imageBlock(
  blockId: string,
  title: string,
  assetId: string | undefined,
  index: number,
  status: 'running' | 'succeeded' = assetId ? 'succeeded' : 'running',
): BlockRecord {
  return {
    blockId,
    boardId: defaultSnapshot.board.boardId,
    type: 'image',
    layerId: defaultSnapshot.layers[0].id,
    position: { x: index * 320, y: 620 },
    size: { width: 280, height: 360 },
    zIndex: index + 3,
    data: {
      ...(assetId ? { assetId } : {}),
      ...(blockId.startsWith('result') ? {
        operationBlockId: operation.blockId,
        sourceExecutionId: 'execution_generate',
      } : {}),
      status,
      title,
    },
    createdAt: now,
    updatedAt: now,
  };
}
