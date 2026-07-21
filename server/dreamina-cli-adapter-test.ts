import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBlockRecord } from '../src/core/blockFactory';
import type { BoardSnapshot } from '../src/core/types';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { loadSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import {
  dreaminaCliAvailability,
  type DreaminaCliConfig,
  type DreaminaCommandRunner,
} from './dreamina-cli-client';
import { cancelDreaminaCliVideoGeneration, startDreaminaCliVideoGeneration } from './dreamina-cli-video-service';

const config: DreaminaCliConfig = {
  executablePath: '/fixed/whitelist/dreamina',
  modelVersion: 'seedance2.0_vip',
  videoResolution: '720p',
  sessionId: 0,
  pollIntervalMs: 1,
  taskTimeoutMs: 2_000,
  commandTimeoutMs: 2_000,
};

const availability = await dreaminaCliAvailability({ DREAMINA_CLI_PATH: fileURLToPath(import.meta.url) });
assert.equal(availability.available, true);
assert.equal(availability.credentialRefType, 'dreamina_oauth_session');

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

const imageTarget = addVideoTarget(snapshot, 'block_dreamina_image', 'Animate the retained first frame.', 2);
snapshot.edges.push({
  edgeId: 'edge_dreamina_first_frame',
  sourceBlockId: firstFrameBlock.blockId,
  targetBlockId: imageTarget.blockId,
  kind: 'execution_input',
  inputRole: 'first_frame',
});
await saveSnapshot(snapshot);

const successCli = createFakeDreaminaCli(['succeeded', 'succeeded']);
const successRun = await startDreaminaCliVideoGeneration({
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  targetBlockId: imageTarget.blockId,
  prompt: imageTarget.data.executionDraft!.prompt,
  durationSeconds: 8,
  outputCount: 2,
  aspectRatio: '9:16',
}, { config, runner: successCli.runner });
await successRun.completion;

const successSnapshot = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
const succeededExecution = findExecution(successSnapshot, successRun.execution.executionId);
assert.equal(succeededExecution.status, 'succeeded');
assert.equal(succeededExecution.adapter, 'provider_cli');
assert.equal(succeededExecution.adapterSnapshot?.adapterId, 'retake.video.dreamina-cli');
assert.equal(succeededExecution.outputAssetIds.length, 2);
assert.deepEqual(succeededExecution.resultSummary, { requested: 2, succeeded: 2, failed: 0 });
assert.equal(successCli.submitCommands.length, 2);
assert.equal(successCli.submitCommands.every((command) => command[0] === 'image2video'), true);
assert.equal(successCli.submitCommands[0].includes('--image'), true);
assert.equal(successCli.submitCommands[0].includes('--model_version'), true);
assert.equal(successCli.submitCommands[0].includes('seedance2.0_vip'), true);
assert.equal(JSON.stringify(successSnapshot).includes(config.executablePath), false);

const textTarget = addVideoTarget(successSnapshot, 'block_dreamina_text', 'Create a vertical video from text.', 2);
await saveSnapshot(successSnapshot);
const partialCli = createFakeDreaminaCli(['succeeded', 'failed']);
const partialRun = await startDreaminaCliVideoGeneration({
  projectId: successSnapshot.project.projectId,
  boardId: successSnapshot.board.boardId,
  targetBlockId: textTarget.blockId,
  prompt: textTarget.data.executionDraft!.prompt,
  durationSeconds: 6,
  outputCount: 2,
  aspectRatio: '16:9',
}, { config, runner: partialCli.runner });
await assert.rejects(partialRun.completion, /fake Dreamina failure/);
const partialSnapshot = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
const failedExecution = findExecution(partialSnapshot, partialRun.execution.executionId);
assert.equal(failedExecution.status, 'failed');
assert.deepEqual(failedExecution.resultSummary, { requested: 2, succeeded: 1, failed: 1 });
assert.equal(failedExecution.outputAssetIds.length, 1);
assert.equal(partialCli.submitCommands[0][0], 'text2video');
assert.equal(valueAfter(partialCli.submitCommands[0], '--ratio'), '16:9');

const cancelTarget = addVideoTarget(partialSnapshot, 'block_dreamina_cancel', 'Cancel local tracking while provider runs.', 1);
await saveSnapshot(partialSnapshot);
const queuedCli = createFakeDreaminaCli(['queued_forever']);
const cancelRun = await startDreaminaCliVideoGeneration({
  projectId: partialSnapshot.project.projectId,
  boardId: partialSnapshot.board.boardId,
  targetBlockId: cancelTarget.blockId,
  prompt: cancelTarget.data.executionDraft!.prompt,
  durationSeconds: 5,
  outputCount: 1,
  aspectRatio: '9:16',
}, { config, runner: queuedCli.runner });
await waitUntil(() => queuedCli.queryCount > 0);
const cancellation = await cancelDreaminaCliVideoGeneration({
  projectId: partialSnapshot.project.projectId,
  boardId: partialSnapshot.board.boardId,
  executionId: cancelRun.execution.executionId,
});
await cancelRun.completion;
assert.ok(cancellation.snapshot);
assert.equal(findExecution(cancellation.snapshot, cancelRun.execution.executionId).status, 'canceled');
assert.equal(cancellation.providerTaskCancelable, false);

console.log(JSON.stringify({
  ok: true,
  membershipModel: config.modelVersion,
  imageModeOutputs: succeededExecution.outputAssetIds.length,
  partialSuccessAssetsPreserved: failedExecution.outputAssetIds.length,
  localCancelOnly: cancellation.providerTaskCancelable === false,
  realCliInvoked: false,
}));

function addVideoTarget(snapshot: BoardSnapshot, blockId: string, prompt: string, outputCount: number) {
  const block = createBlockRecord(snapshot, 'video');
  block.blockId = blockId;
  block.data.executionDraft = {
    schemaVersion: 1,
    capabilityId: 'video.generate',
    executionProfileId: 'video-dreamina-cli',
    prompt,
    parameters: { aspectRatio: '9:16', durationSeconds: 8, outputCount },
  };
  snapshot.blocks.push(block);
  return block;
}

function createFakeDreaminaCli(outcomes: Array<'succeeded' | 'failed' | 'queued_forever'>): {
  runner: DreaminaCommandRunner;
  submitCommands: string[][];
  readonly queryCount: number;
} {
  const submitCommands: string[][] = [];
  const outcomeBySubmitId = new Map<string, 'succeeded' | 'failed' | 'queued_forever'>();
  let queryCount = 0;
  const runner: DreaminaCommandRunner = async (_executablePath, args, options) => {
    if (options.signal?.aborted) throw options.signal.reason;
    if (args[0] !== 'query_result') {
      submitCommands.push([...args]);
      const submitId = `dreamina_${submitCommands.length}`;
      outcomeBySubmitId.set(submitId, outcomes[submitCommands.length - 1] ?? 'succeeded');
      return result({ submit_id: submitId, status: 'submitted' });
    }
    queryCount += 1;
    const submitId = valueAfter(args, '--submit_id');
    const outcome = outcomeBySubmitId.get(submitId) ?? 'succeeded';
    if (outcome === 'failed') return result({ submit_id: submitId, status: 'failed', message: 'fake Dreamina failure' });
    if (outcome === 'queued_forever') return result({ submit_id: submitId, status: 'running' });
    const downloadDir = valueAfter(args, '--download_dir');
    if (downloadDir) {
      await mkdir(downloadDir, { recursive: true });
      await writeFile(path.join(downloadDir, `${submitId}.mp4`), Buffer.from(`fake-dreamina-video:${submitId}`));
    }
    return result({ submit_id: submitId, status: 'success' });
  };
  return {
    runner,
    submitCommands,
    get queryCount() { return queryCount; },
  };
}

function result(payload: unknown) {
  return { payload, stdout: JSON.stringify(payload), stderr: '' };
}

function valueAfter(args: string[], flag: string): string {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? '' : '';
}

function findExecution(snapshot: BoardSnapshot, executionId: string) {
  const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
  assert.ok(execution);
  return execution;
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for fake Dreamina CLI query.');
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}
