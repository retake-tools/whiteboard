import assert from 'node:assert/strict';
import { createBlockRecord } from '../src/core/blockFactory';
import type { BoardSnapshot } from '../src/core/types';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import { seedanceModelArkAvailability, type SeedanceModelArkConfig } from './seedance-modelark-client';
import { cancelSeedanceVideoGeneration, startSeedanceVideoGeneration } from './seedance-video-service';

const config: SeedanceModelArkConfig = {
  apiKey: 'test-secret-key',
  baseUrl: 'https://modelark.test/api/v3',
  model: 'dreamina-seedance-2-0-test',
  pollIntervalMs: 1,
  taskTimeoutMs: 2_000,
};

assert.equal(seedanceModelArkAvailability({}).available, false);
assert.equal(seedanceModelArkAvailability({ ARK_API_KEY: 'configured' }).available, true);
assert.equal(JSON.stringify(seedanceModelArkAvailability({ ARK_API_KEY: 'configured' })).includes('configured'), false);

const snapshot = await resetWorkspace();
const firstFrameAsset = await createAssetFromDataUrl({
  projectId: snapshot.project.projectId,
  dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mNk+M8AAQUBAScY42YAAAAASUVORK5CYII=',
  fileName: 'first-frame.png',
  kind: 'image',
});
snapshot.assets.unshift(firstFrameAsset);
const firstFrameBlock = createBlockRecord(snapshot, 'image');
firstFrameBlock.data = { title: 'First frame', assetId: firstFrameAsset.assetId, previewUrl: firstFrameAsset.previewUrl };
snapshot.blocks.push(firstFrameBlock);

const successTarget = addVideoTarget(snapshot, 'block_seedance_success', 'Generate two retained variants.', 2);
snapshot.edges.push({
  edgeId: 'edge_seedance_first_frame',
  sourceBlockId: firstFrameBlock.blockId,
  targetBlockId: successTarget.blockId,
  kind: 'execution_input',
  inputRole: 'first_frame',
});
await saveSnapshot(snapshot);

const successProvider = createFakeProvider({ taskOutcomes: ['succeeded', 'succeeded'] });
const successRun = await startSeedanceVideoGeneration({
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  targetBlockId: successTarget.blockId,
  prompt: successTarget.data.executionDraft!.prompt,
  durationSeconds: 8,
  outputCount: 2,
}, { config, fetchImpl: successProvider.fetch });
await successRun.completion;

const successSnapshot = await loadCurrentSnapshot(successRun.snapshot);
const succeededExecution = findExecution(successSnapshot, successRun.execution.executionId);
assert.equal(succeededExecution.status, 'succeeded');
assert.equal(succeededExecution.adapter, 'direct_api');
assert.equal(succeededExecution.adapterSnapshot?.adapterId, 'retake.video.seedance-modelark');
assert.equal(succeededExecution.outputAssetIds.length, 2);
assert.deepEqual(succeededExecution.resultSummary, { requested: 2, succeeded: 2, failed: 0 });
assert.equal(providerTaskResults(succeededExecution).length, 2);
assert.deepEqual(providerTaskResults(succeededExecution)[0].usage, { total_tokens: 42 });
assert.equal(successProvider.createBodies.length, 2);
assert.equal(successProvider.createBodies[0].model, config.model);
assert.equal(successProvider.createBodies[0].content[1].role, 'first_frame');
assert.match(successProvider.createBodies[0].content[1].image_url.url, /^data:image\/png;base64,/);
assert.equal(successProvider.authorizationHeaders.every((value) => value === 'Bearer test-secret-key'), true);
assert.equal(JSON.stringify(successSnapshot).includes('test-secret-key'), false);

const preservedAssetIds = [...succeededExecution.outputAssetIds];
const partialTarget = addVideoTarget(successSnapshot, 'block_seedance_partial', 'Keep the first result if the second fails.', 2);
await saveSnapshot(successSnapshot);
const partialProvider = createFakeProvider({ taskOutcomes: ['succeeded', 'failed'] });
const partialRun = await startSeedanceVideoGeneration({
  projectId: successSnapshot.project.projectId,
  boardId: successSnapshot.board.boardId,
  targetBlockId: partialTarget.blockId,
  prompt: partialTarget.data.executionDraft!.prompt,
  durationSeconds: 6,
  outputCount: 2,
}, { config, fetchImpl: partialProvider.fetch });
await assert.rejects(partialRun.completion, /fake provider failure/);
const partialSnapshot = await loadCurrentSnapshot(partialRun.snapshot);
const failedExecution = findExecution(partialSnapshot, partialRun.execution.executionId);
assert.equal(failedExecution.status, 'failed');
assert.deepEqual(failedExecution.resultSummary, { requested: 2, succeeded: 1, failed: 1 });
assert.equal(failedExecution.outputAssetIds.length, 1);
assert.equal(failedExecution.outputBlockIds.some((blockId) => {
  const block = partialSnapshot.blocks.find((candidate) => candidate.blockId === blockId);
  return Boolean(block?.data.assetId && block.data.status === 'succeeded');
}), true);
assert.equal(preservedAssetIds.every((assetId) => partialSnapshot.assets.some((asset) => asset.assetId === assetId)), true);

const cancelTarget = addVideoTarget(partialSnapshot, 'block_seedance_cancel', 'Cancel while queued.', 2);
await saveSnapshot(partialSnapshot);
const queuedProvider = createFakeProvider({ taskOutcomes: ['queued_forever'] });
const cancelRun = await startSeedanceVideoGeneration({
  projectId: partialSnapshot.project.projectId,
  boardId: partialSnapshot.board.boardId,
  targetBlockId: cancelTarget.blockId,
  prompt: cancelTarget.data.executionDraft!.prompt,
  durationSeconds: 5,
  outputCount: 2,
}, { config, fetchImpl: queuedProvider.fetch });
await waitUntil(() => queuedProvider.createdTaskIds.length === 1);
const cancellation = await cancelSeedanceVideoGeneration({
  projectId: partialSnapshot.project.projectId,
  boardId: partialSnapshot.board.boardId,
  executionId: cancelRun.execution.executionId,
}, { config, fetchImpl: queuedProvider.fetch });
await cancelRun.completion;
assert.ok(cancellation.snapshot);
const canceledExecution = findExecution(cancellation.snapshot, cancelRun.execution.executionId);
assert.equal(canceledExecution.status, 'canceled');
assert.equal(cancellation.remoteQueuedTasksCanceled, 1);
assert.equal(cancellation.snapshot.blocks.some((block) => block.blockId === cancelTarget.blockId), true);
assert.equal(preservedAssetIds.every((assetId) => cancellation.snapshot.assets.some((asset) => asset.assetId === assetId)), true);

console.log(JSON.stringify({
  ok: true,
  directApiOutputs: succeededExecution.outputAssetIds.length,
  partialSuccessAssetsPreserved: failedExecution.outputAssetIds.length,
  queuedTasksCanceled: cancellation.remoteQueuedTasksCanceled,
  secretPersisted: JSON.stringify(cancellation.snapshot).includes(config.apiKey),
}));

function addVideoTarget(snapshot: BoardSnapshot, blockId: string, prompt: string, outputCount: number) {
  const block = createBlockRecord(snapshot, 'video');
  block.blockId = blockId;
  block.data.executionDraft = {
    schemaVersion: 1,
    capabilityId: 'video.generate',
    executionProfileId: 'video-seedance-modelark',
    prompt,
    parameters: { durationSeconds: 8, outputCount },
  };
  snapshot.blocks.push(block);
  return block;
}

function createFakeProvider(input: { taskOutcomes: Array<'succeeded' | 'failed' | 'queued_forever'> }) {
  const authorizationHeaders: string[] = [];
  const createdTaskIds: string[] = [];
  const createBodies: Array<Record<string, any>> = [];
  const outcomeByTaskId = new Map<string, 'succeeded' | 'failed' | 'queued_forever'>();
  const fetch: typeof globalThis.fetch = async (request, init) => {
    const url = new URL(typeof request === 'string' || request instanceof URL ? request : request.url);
    if (url.hostname === 'video.test') {
      return new Response(Buffer.from(`fake-mp4:${url.pathname}`), { status: 200, headers: { 'Content-Type': 'video/mp4' } });
    }
    authorizationHeaders.push(new Headers(init?.headers).get('Authorization') ?? '');
    if (init?.method === 'POST' && url.pathname.endsWith('/contents/generations/tasks')) {
      const taskId = `task_${createdTaskIds.length + 1}`;
      createdTaskIds.push(taskId);
      outcomeByTaskId.set(taskId, input.taskOutcomes[createdTaskIds.length - 1] ?? 'succeeded');
      createBodies.push(JSON.parse(String(init.body)) as Record<string, any>);
      return Response.json({ id: taskId });
    }
    const taskId = url.pathname.split('/').pop()!;
    if (init?.method === 'DELETE') return Response.json({});
    const outcome = outcomeByTaskId.get(taskId) ?? 'succeeded';
    if (outcome === 'failed') {
      return Response.json({ id: taskId, status: 'failed', error: { message: 'fake provider failure' } });
    }
    if (outcome === 'queued_forever') return Response.json({ id: taskId, status: 'queued' });
    return Response.json({
      id: taskId,
      status: 'succeeded',
      duration: 8,
      content: { video_url: `https://video.test/${taskId}.mp4` },
      usage: { total_tokens: 42 },
    });
  };
  return { authorizationHeaders, createBodies, createdTaskIds, fetch };
}

async function loadCurrentSnapshot(snapshot: BoardSnapshot): Promise<BoardSnapshot> {
  const { loadSnapshot } = await import('./local-store/snapshot-store');
  return loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
}

function findExecution(snapshot: BoardSnapshot, executionId: string) {
  const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
  assert.ok(execution);
  return execution;
}

function providerTaskResults(execution: ReturnType<typeof findExecution>): Array<Record<string, unknown>> {
  const modelArk = execution.params?.modelArk;
  if (!modelArk || typeof modelArk !== 'object' || Array.isArray(modelArk)) return [];
  const results = (modelArk as Record<string, unknown>).taskResults;
  return Array.isArray(results)
    ? results.filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value))
    : [];
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for fake provider request.');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
