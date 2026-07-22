import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createDraftTextGenerationOperation,
  executeExistingTextGenerationOperation,
} from '../src/core/textOperations';
import {
  checkExecutionConnection,
  createExecutionConnection,
} from './local-store/execution-provider-store';
import { resolveAssetStoragePath } from './local-store/asset-files';
import { loadSnapshot, resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import { startTextGeneration } from './text-generation-service';

const initial = await resetWorkspace();
let settings = await createExecutionConnection({
  templateId: 'custom-openai-compatible',
  displayName: 'Text API test',
  baseUrl: 'https://text.example/v1',
  modelId: 'text-test-model',
  apiKey: 'text-test-secret',
});
const openAIConnection = settings.connections.find((connection) => connection.displayName === 'Text API test');
assert.ok(openAIConnection);
settings = await checkExecutionConnection(openAIConnection.connectionId, undefined, {
  probeOpenAICompatible: async () => undefined,
});
const readyOpenAIConnection = settings.connections.find((connection) => connection.connectionId === openAIConnection.connectionId);
assert.equal(readyOpenAIConnection?.status, 'ready');
assert.deepEqual(readyOpenAIConnection?.supportedCapabilityIds, ['text.generate']);

const labels = {
  operationTitle: 'Generate text',
  promptPlaceholder: 'Write a short scene.',
  promptTitle: 'Prompt',
  resultTitle: 'Generated text',
  waitingBody: 'Waiting for text generation.',
};
const draft = createDraftTextGenerationOperation(initial, {
  ...labels,
  connectionId: readyOpenAIConnection!.connectionId,
});
assert.equal(draft.resultBlock.type, 'document');
draft.promptBlock.data.body = 'Write a short Markdown scene about a cat director.';
const firstRun = executeExistingTextGenerationOperation(initial, {
  connection: readyOpenAIConnection!,
  labels,
  operationBlockId: draft.operationBlock.blockId,
});
await saveSnapshot(initial);
const firstStarted = await startTextGeneration({
  projectId: initial.project.projectId,
  boardId: initial.board.boardId,
  executionId: firstRun.execution.executionId,
  connectionId: readyOpenAIConnection!.connectionId,
}, {
  generateOpenAICompatible: async (config, input) => {
    assert.equal(config.apiKey, 'text-test-secret');
    assert.equal(config.model, 'text-test-model');
    assert.match(input.prompt, /cat director/);
    assert.match(input.prompt, /Return only the requested Markdown document/);
    assert.match(input.prompt, /Do not call tools and do not add process commentary/);
    return {
      text: '# Cat Director\n\nA concise first draft.',
      finishReason: 'stop',
      usage: { inputTokens: 12, outputTokens: 9 },
    };
  },
});
await firstStarted.completion;

let completed = await loadSnapshot(initial.project.projectId, initial.board.boardId);
const completedFirstExecution = completed.executions.find((execution) => execution.executionId === firstRun.execution.executionId);
const firstResultBlock = completed.blocks.find((block) => block.blockId === firstRun.resultBlock.blockId);
assert.equal(completedFirstExecution?.status, 'succeeded');
assert.equal(firstResultBlock?.type, 'document');
assert.equal(firstResultBlock?.data.body, undefined, 'Full Markdown must not be copied into BoardSnapshot.');
assert.equal(firstResultBlock?.data.title, 'Cat Director');
assert.equal(firstResultBlock?.data.documentExcerpt, 'Cat Director\n\nA concise first draft.');
assert.deepEqual(firstResultBlock?.data.documentOutline, ['Cat Director']);
assert.equal(firstResultBlock?.data.contentFormat, 'markdown');
assert.equal(firstResultBlock?.data.status, 'succeeded');
assert.ok(firstResultBlock?.data.assetId);
const firstAsset = completed.assets.find((asset) => asset.assetId === firstResultBlock.data.assetId);
assert.equal(firstAsset?.kind, 'document');
assert.equal(firstAsset?.mimeType, 'text/markdown');
assert.equal(
  await readFile(await resolveAssetStoragePath(initial.project.projectId, firstAsset!.assetId), 'utf8'),
  '# Cat Director\n\nA concise first draft.',
);

settings = await createExecutionConnection({
  templateId: 'google-native',
  displayName: 'Gemini text test',
  modelId: 'gemini-test-model',
  apiKey: 'gemini-test-secret',
});
const googleConnection = settings.connections.find((connection) => connection.displayName === 'Gemini text test');
assert.ok(googleConnection);
settings = await checkExecutionConnection(googleConnection.connectionId, undefined, {
  probeNativeText: async () => undefined,
});
const readyGoogleConnection = settings.connections.find((connection) => connection.connectionId === googleConnection.connectionId);
assert.equal(readyGoogleConnection?.status, 'ready');

const operationBlock = completed.blocks.find((block) => block.blockId === draft.operationBlock.blockId);
assert.ok(operationBlock);
operationBlock.data.connectionId = readyGoogleConnection!.connectionId;
const secondRun = executeExistingTextGenerationOperation(completed, {
  connection: readyGoogleConnection!,
  labels,
  operationBlockId: operationBlock.blockId,
});
await saveSnapshot(completed);
const secondStarted = await startTextGeneration({
  projectId: completed.project.projectId,
  boardId: completed.board.boardId,
  executionId: secondRun.execution.executionId,
  connectionId: readyGoogleConnection!.connectionId,
}, {
  generateNative: async (providerId, config, input) => {
    assert.equal(providerId, 'google-native');
    assert.equal(config.apiKey, 'gemini-test-secret');
    assert.match(input.prompt, /Return only the requested Markdown document/);
    assert.match(input.prompt, /Do not call tools and do not add process commentary/);
    return {
      text: '# Cat Director\n\nA revised second draft.',
      finishReason: 'stop',
      usage: { inputTokens: 12, outputTokens: 10 },
    };
  },
});
await secondStarted.completion;

completed = await loadSnapshot(completed.project.projectId, completed.board.boardId);
const completedSecondExecution = completed.executions.find((execution) => execution.executionId === secondRun.execution.executionId);
const secondResultBlock = completed.blocks.find((block) => block.blockId === secondRun.resultBlock.blockId);
assert.equal(completedSecondExecution?.status, 'succeeded');
assert.notEqual(secondResultBlock?.blockId, firstResultBlock.blockId, 'A paid prior result must not be overwritten.');
assert.notEqual(secondResultBlock?.data.assetId, firstResultBlock.data.assetId);
assert.equal(completed.assets.some((asset) => asset.assetId === firstAsset!.assetId), true);
assert.equal(completed.assets.filter((asset) => asset.sourceExecutionId === firstRun.execution.executionId || asset.sourceExecutionId === secondRun.execution.executionId).length, 2);

console.log(JSON.stringify({
  ok: true,
  capabilityId: completedSecondExecution?.capabilityId,
  preservedMarkdownAssets: 2,
  providerRoutes: ['openai-compatible', 'google-native'],
}));
