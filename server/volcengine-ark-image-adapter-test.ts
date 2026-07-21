import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { createDraftTextToImageOperation, executeExistingImageOperationBlock } from '../src/core/imageOperations';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type { BoardSnapshot } from '../src/core/types';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import { retakeRoot } from './local-store/context';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';
import { startVolcengineArkImageGeneration } from './volcengine-ark-image-service';

assert.ok(retakeRoot.endsWith('.retake-test-volcengine-image'), 'Ark image tests must use a disposable workspace.');
await rm(retakeRoot, { recursive: true, force: true });

const snapshot = structuredClone(defaultSnapshot) as BoardSnapshot;
snapshot.project.projectId = 'project_ark_image_test';
snapshot.board.projectId = snapshot.project.projectId;
snapshot.board.boardId = 'board_ark_image_test';
snapshot.project.defaultBoardId = snapshot.board.boardId;
snapshot.blocks = [];
snapshot.edges = [];
snapshot.assets = [];
snapshot.executions = [];
snapshot.historyEvents = [];
const draft = createDraftTextToImageOperation(snapshot, {
  operationTitle: 'Generate image',
  textBlockBody: 'A cinematic orange cat in a rainy Hong Kong alley.',
  textBlockTitle: 'Prompt',
  generationParams: {
    aspectRatioPreset: '9:16',
    targetResolution: '2K',
    targetWidth: 1152,
    targetHeight: 2048,
    variationCount: 2,
  },
});
draft.operationBlock.data.connectionId = 'connection_seedream_test';
const connection: ExecutionConnectionSummary = {
  connectionId: 'connection_seedream_test',
  connectorId: 'volcengine-ark',
  templateId: 'volcengine-ark-seedream',
  providerLabel: 'Volcengine Ark',
  displayName: 'Seedream Test',
  description: 'test',
  connectionKind: 'model_provider',
  implementationKind: 'native_api',
  supportedCapabilityIds: ['image.image_to_image', 'image.text_to_image'],
  enabledUseCases: ['image'],
  configurable: true,
  deletable: true,
  enabled: true,
  status: 'ready',
  hasCredential: true,
  baseUrl: 'https://ark.example/api/v3',
  modelId: 'doubao-seedream-5-0-260128',
};
const run = executeExistingImageOperationBlock(snapshot, {
  connection,
  generationParams: draft.operationBlock.data.generationParams,
  instruction: '',
  operation: 'text_to_image',
  operationBlockId: draft.operationBlock.blockId,
});
assert.equal(run.execution.adapter, 'direct_api');
assert.equal(run.execution.triggerMode, 'server_worker');
assert.equal(run.execution.connectionId, connection.connectionId);
assert.equal(run.execution.model, connection.modelId);
assert.equal(run.execution.agentPrompt, undefined);
await saveSnapshot(snapshot);

let calls = 0;
const started = await startVolcengineArkImageGeneration({
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  executionId: run.execution.executionId,
  connectionId: connection.connectionId,
}, {
  config: {
    apiKey: 'ark-test-key',
    baseUrl: 'https://ark.example/api/v3',
    model: connection.modelId!,
  },
  fetchImpl: async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.size, '1152x2048');
    assert.equal(body.sequential_image_generation, 'disabled');
    assert.match(String(body.prompt), /Required output aspect ratio: 9:16/);
    assert.match(String(body.prompt), /hard output-canvas requirement/);
    assert.match(String(body.prompt), new RegExp(`candidate ${calls} of 2`));
    return new Response(JSON.stringify({
      model: connection.modelId,
      data: [{ b64_json: Buffer.from(`image-${calls}`).toString('base64'), size: '1152x2048' }],
      usage: { generated_images: 1 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
});
assert.equal(started.execution.status, 'running');
await started.completion;

const completed = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
const completedExecution = completed.executions.find((candidate) => candidate.executionId === run.execution.executionId);
assert.equal(completedExecution?.status, 'succeeded');
assert.equal(completedExecution?.outputAssetIds.length, 2);
assert.equal(completedExecution?.resultSummary?.succeeded, 2);
assert.equal(calls, 2, 'Each requested candidate must be an independent paid draw.');
for (const resultBlockId of completedExecution?.outputBlockIds ?? []) {
  const block = completed.blocks.find((candidate) => candidate.blockId === resultBlockId);
  assert.equal(block?.data.status, 'succeeded');
  assert.equal(typeof block?.data.assetId, 'string');
}

await rm(retakeRoot, { recursive: true, force: true });
console.log(JSON.stringify({
  ok: true,
  independentDraws: calls,
  preservedAssets: completedExecution?.outputAssetIds.length,
}));
