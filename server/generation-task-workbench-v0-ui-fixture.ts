import { rm } from 'node:fs/promises';
import { createBlockRecord } from '../src/core/blockFactory';
import { nowIso } from '../src/core/id';
import type { AssetRecord } from '../src/core/types';
import { retakeRoot } from './local-store/context';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-generation-task-v0')) {
  throw new Error('Generation Task fixture requires a disposable RETAKE_WORKSPACE_DIR.');
}

await rm(retakeRoot, { recursive: true, force: true });
const snapshot = await resetWorkspace();
const timestamp = nowIso();
snapshot.project.name = '[TEST] Generation Task V0';
snapshot.board.name = '[TEST] Image Campaign';
snapshot.blocks = [];
snapshot.edges = [];
snapshot.assets = [];
snapshot.executions = [];
snapshot.historyEvents = [];
snapshot.agentRuns = [];
snapshot.agentSessions = [];
snapshot.agentMessages = [];
snapshot.agentRuntimeBindings = [];
snapshot.agentRuntimeEvents = [];
snapshot.board.viewport = { x: 110, y: 215, zoom: 0.72 };

const source = createBlockRecord(snapshot, 'image');
source.blockId = 'block_s03_source';
source.position = { x: -350, y: -120 };
source.size = { width: 280, height: 360 };
source.data = {
  assetId: 'asset_s03_source',
  title: '原始商品图',
};

const operation = createBlockRecord(snapshot, 'operation');
operation.blockId = 'block_s03_operation';
operation.position = { x: 25, y: -70 };
operation.size = { width: 300, height: 300 };
operation.data = {
  adapter: 'direct_api',
  capabilityId: 'image.generate',
  connectionId: 'fixture-image-connection',
  generationParams: {
    aspectRatioPreset: '3:4',
    targetHeight: 1440,
    targetWidth: 1080,
    variationCount: 4,
  },
  operationMode: 'image_to_image',
  promptBody: '换成温暖的生活方式背景，保留商品、Logo 和包装文字。',
  sourceExecutionId: 'execution_s03_generation',
  status: 'running',
  title: '换背景 · 生成中 2/4',
};

const results = Array.from({ length: 4 }, (_, index) => {
  const result = createBlockRecord(snapshot, 'image');
  result.blockId = `block_s03_result_${index + 1}`;
  result.position = { x: 430 + (index % 2) * 310, y: -220 + Math.floor(index / 2) * 390 };
  result.size = { width: 260, height: 340 };
  result.data = {
    ...(index < 2 ? { assetId: `asset_s03_result_${index + 1}` } : {}),
    operationBlockId: operation.blockId,
    sourceExecutionId: 'execution_s03_generation',
    status: index < 2 ? 'succeeded' : 'running',
    title: `方案 ${index + 1}`,
  };
  return result;
});

snapshot.blocks.push(source, operation, ...results);
snapshot.edges.push({
  edgeId: 'edge_s03_source_operation',
  kind: 'execution_input',
  sourceBlockId: source.blockId,
  targetBlockId: operation.blockId,
  inputSlotId: 'source_image',
});
for (const result of results) {
  snapshot.edges.push({
    edgeId: `edge_s03_${result.blockId}`,
    kind: 'execution_output',
    sourceBlockId: operation.blockId,
    targetBlockId: result.blockId,
  });
}

const assetPaths = [
  '/brand/retake-github-avatar.png',
  '/brand/retake-favicon-master.png',
  '/brand/apple-touch-icon.png',
];
snapshot.assets.push(
  imageAsset('asset_s03_source', assetPaths[0], timestamp),
  imageAsset('asset_s03_result_1', assetPaths[1], timestamp),
  imageAsset('asset_s03_result_2', assetPaths[2], timestamp),
);
snapshot.executions.push({
  adapter: 'direct_api',
  boardId: snapshot.board.boardId,
  capabilityId: 'image.generate',
  connectionId: 'fixture-image-connection',
  executionId: 'execution_s03_generation',
  inputAssetIds: ['asset_s03_source'],
  inputBlockIds: [source.blockId],
  model: 'Retake Image Model',
  outputAssetIds: ['asset_s03_result_1', 'asset_s03_result_2'],
  outputBlockIds: results.map((result) => result.blockId),
  params: {
    aspectRatioPreset: '3:4',
    operationBlockId: operation.blockId,
    targetHeight: 1440,
    targetWidth: 1080,
    variationCount: 4,
  },
  projectId: snapshot.project.projectId,
  prompt: '换成温暖的生活方式背景，保留商品、Logo 和包装文字。',
  provider: 'Fixture image provider',
  resultSummary: { requested: 4, succeeded: 2, failed: 0 },
  startedAt: timestamp,
  status: 'running',
});
await saveSnapshot(snapshot);

console.log(JSON.stringify({
  boardId: snapshot.board.boardId,
  operationBlockId: operation.blockId,
  projectId: snapshot.project.projectId,
  workspaceDirectory,
}));

function imageAsset(assetId: string, previewUrl: string, createdAt: string): AssetRecord {
  return {
    assetId,
    createdAt,
    height: 1440,
    kind: 'image',
    mimeType: 'image/png',
    previewUrl,
    projectId: snapshot.project.projectId,
    storageKey: previewUrl,
    storageProvider: 'local',
    width: 1080,
  };
}
