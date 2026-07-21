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
let concurrentCalls = 0;
let maxConcurrentCalls = 0;
let releaseConcurrentCalls: (() => void) | undefined;
const candidatePrompts = new Set<string>();
const bothCallsStarted = new Promise<void>((resolve) => {
  releaseConcurrentCalls = resolve;
});
const concurrentCallsReady = Promise.race([
  bothCallsStarted,
  new Promise<never>((_resolve, reject) => setTimeout(
    () => reject(new Error('Seedream candidates did not start concurrently.')),
    1_000,
  )),
]);
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
    const callIndex = calls;
    concurrentCalls += 1;
    maxConcurrentCalls = Math.max(maxConcurrentCalls, concurrentCalls);
    if (calls === 2) releaseConcurrentCalls?.();
    await concurrentCallsReady;
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.equal(body.size, '1152x2048');
    assert.equal(body.sequential_image_generation, 'disabled');
    assert.match(String(body.prompt), /Required output aspect ratio: 9:16/);
    assert.match(String(body.prompt), /hard output-canvas requirement/);
    const candidate = String(body.prompt).match(/candidate ([12]) of 2/)?.[1];
    assert.ok(candidate);
    candidatePrompts.add(candidate);
    concurrentCalls -= 1;
    return new Response(JSON.stringify({
      model: connection.modelId,
      data: [{ b64_json: Buffer.from(`image-${callIndex}`).toString('base64'), size: '1152x2048' }],
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
assert.equal(completedExecution?.requestPrompts?.length, 2);
assert.match(completedExecution?.requestPrompts?.[0]?.prompt ?? '', /^Generate exactly one image/);
assert.equal(completedExecution?.resultSummary?.succeeded, 2);
assert.equal(calls, 2, 'Each requested candidate must be an independent paid draw.');
assert.equal(maxConcurrentCalls, 2, 'Seedream candidates must start concurrently.');
assert.deepEqual([...candidatePrompts].sort(), ['1', '2']);
for (const resultBlockId of completedExecution?.outputBlockIds ?? []) {
  const block = completed.blocks.find((candidate) => candidate.blockId === resultBlockId);
  assert.equal(block?.data.status, 'succeeded');
  assert.equal(typeof block?.data.assetId, 'string');
}

const partialDraft = createDraftTextToImageOperation(completed, {
  operationTitle: 'Generate partial batch',
  textBlockBody: 'A second two-card draw where one provider request fails.',
  textBlockTitle: 'Prompt',
  generationParams: {
    aspectRatioPreset: '9:16',
    targetWidth: 1152,
    targetHeight: 2048,
    variationCount: 2,
  },
});
partialDraft.operationBlock.data.connectionId = connection.connectionId;
const partialRun = executeExistingImageOperationBlock(completed, {
  connection,
  generationParams: partialDraft.operationBlock.data.generationParams,
  instruction: '',
  operation: 'text_to_image',
  operationBlockId: partialDraft.operationBlock.blockId,
});
await saveSnapshot(completed);
let partialCalls = 0;
const partialStarted = await startVolcengineArkImageGeneration({
  projectId: completed.project.projectId,
  boardId: completed.board.boardId,
  executionId: partialRun.execution.executionId,
  connectionId: connection.connectionId,
}, {
  config: {
    apiKey: 'ark-test-key',
    baseUrl: 'https://ark.example/api/v3',
    model: connection.modelId!,
  },
  fetchImpl: async () => {
    partialCalls += 1;
    if (partialCalls === 2) {
      return new Response(JSON.stringify({ error: { message: 'Synthetic candidate failure.' } }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({
      model: connection.modelId,
      data: [{ b64_json: Buffer.from('partial-success').toString('base64'), size: '1152x2048' }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  },
});
await assert.rejects(partialStarted.completion, /Synthetic candidate failure/);
const partialCompleted = await loadSnapshot(completed.project.projectId, completed.board.boardId);
const partialExecution = partialCompleted.executions.find(
  (candidate) => candidate.executionId === partialRun.execution.executionId,
);
assert.equal(partialExecution?.status, 'failed');
assert.equal(partialExecution?.outputAssetIds.length, 1, 'A successful paid draw must survive a sibling failure.');
assert.equal(partialExecution?.resultSummary?.succeeded, 1);
assert.equal(partialExecution?.resultSummary?.failed, 1);
assert.equal(
  partialExecution?.outputBlockIds.filter((blockId) =>
    typeof partialCompleted.blocks.find((block) => block.blockId === blockId)?.data.assetId === 'string').length,
  1,
);

await rm(retakeRoot, { recursive: true, force: true });
console.log(JSON.stringify({
  ok: true,
  independentDraws: calls,
  maxConcurrentDraws: maxConcurrentCalls,
  preservedAssets: completedExecution?.outputAssetIds.length,
  partialSuccessAssets: partialExecution?.outputAssetIds.length,
}));
