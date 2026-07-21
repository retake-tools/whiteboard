import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { createDraftTextToImageOperation, executeExistingImageOperationBlock } from '../src/core/imageOperations';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { createDraftTextGenerationOperation, executeExistingTextGenerationOperation } from '../src/core/textOperations';
import type { BoardSnapshot } from '../src/core/types';
import { startCodexAppServerImageGeneration } from './codex-app-server-image-service';
import { checkExecutionConnection } from './local-store/execution-provider-store';
import { resolveAssetStoragePath } from './local-store/asset-files';
import { retakeRoot } from './local-store/context';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';
import { startTextGeneration } from './text-generation-service';

assert.ok(retakeRoot.endsWith('.retake-test-codex-app-server'), 'Codex App Server tests must use a disposable workspace.');
await rm(retakeRoot, { recursive: true, force: true });

const settings = await checkExecutionConnection('codex-app-server', undefined, {
  probeCodexAppServer: async () => ({
    authMode: 'chatgpt',
    capabilities: { imageGeneration: true, namespaceTools: true, webSearch: true },
  }),
});
const connection = settings.connections.find((candidate) => candidate.connectionId === 'codex-app-server');
assert.equal(connection?.status, 'ready');
assert.equal(connection?.modelId, 'gpt-5.4');
assert.deepEqual(connection?.supportedCapabilityIds, ['text.generate', 'image.image_to_image', 'image.text_to_image']);

const snapshot = structuredClone(defaultSnapshot) as BoardSnapshot;
snapshot.project.projectId = 'project_codex_app_server_test';
snapshot.board.projectId = snapshot.project.projectId;
snapshot.board.boardId = 'board_codex_app_server_test';
snapshot.project.defaultBoardId = snapshot.board.boardId;
snapshot.blocks = [];
snapshot.edges = [];
snapshot.assets = [];
snapshot.executions = [];
snapshot.historyEvents = [];

const textDraft = createDraftTextGenerationOperation(snapshot, {
  connectionId: connection!.connectionId,
  operationTitle: 'Generate text',
  promptPlaceholder: 'Write Markdown.',
  promptTitle: 'Prompt',
  resultTitle: 'Generated text',
  waitingBody: 'Waiting',
});
textDraft.promptBlock.data.body = 'Write a cat scene.';
const textRun = executeExistingTextGenerationOperation(snapshot, {
  connection: connection!,
  labels: {
    operationTitle: 'Generate text',
    promptPlaceholder: 'Write Markdown.',
    promptTitle: 'Prompt',
    resultTitle: 'Generated text',
    waitingBody: 'Waiting',
  },
  operationBlockId: textDraft.operationBlock.blockId,
});
assert.equal(textRun.execution.adapter, 'codex_app_server');
assert.equal(textRun.execution.adapterSnapshot?.routeKind, 'codex_app_server');
await saveSnapshot(snapshot);

const deltas: string[] = [];
const textStarted = await startTextGeneration({
  projectId: snapshot.project.projectId,
  boardId: snapshot.board.boardId,
  executionId: textRun.execution.executionId,
  connectionId: connection!.connectionId,
}, {
  runCodexAppServer: async (input) => {
    assert.equal(input.model, 'gpt-5.4');
    input.onTextDelta?.('# Cat Scene\n\n');
    input.onTextDelta?.('A concise draft.');
    deltas.push('# Cat Scene\n\n', 'A concise draft.');
    return {
      threadId: 'thread_text_test',
      turnId: 'turn_text_test',
      text: deltas.join(''),
    };
  },
});
await textStarted.completion;
let completed = await loadSnapshot(snapshot.project.projectId, snapshot.board.boardId);
const textExecution = completed.executions.find((candidate) => candidate.executionId === textRun.execution.executionId);
const textResult = completed.blocks.find((candidate) => candidate.blockId === textRun.resultBlock.blockId);
assert.equal(textExecution?.status, 'succeeded');
assert.equal(textResult?.data.body, '# Cat Scene\n\nA concise draft.');
const textAsset = completed.assets.find((candidate) => candidate.assetId === textResult?.data.assetId);
assert.equal(textAsset?.mimeType, 'text/markdown');
assert.equal(
  await readFile(await resolveAssetStoragePath(snapshot.project.projectId, textAsset!.assetId), 'utf8'),
  '# Cat Scene\n\nA concise draft.',
);

const imageDraft = createDraftTextToImageOperation(completed, {
  operationTitle: 'Generate image',
  textBlockBody: 'A cinematic orange cat director.',
  textBlockTitle: 'Prompt',
  generationParams: { targetWidth: 1024, targetHeight: 1024, variationCount: 1 },
});
imageDraft.operationBlock.data.connectionId = connection!.connectionId;
const imageRun = executeExistingImageOperationBlock(completed, {
  connection: connection!,
  generationParams: imageDraft.operationBlock.data.generationParams,
  instruction: '',
  operation: 'text_to_image',
  operationBlockId: imageDraft.operationBlock.blockId,
});
assert.equal(imageRun.execution.adapter, 'codex_app_server');
assert.equal(imageRun.execution.triggerMode, 'agent_bridge');
assert.equal(imageRun.execution.adapterSnapshot?.routeKind, 'codex_app_server');
assert.equal(imageRun.execution.agentPrompt, undefined);
await saveSnapshot(completed);

const imageStarted = await startCodexAppServerImageGeneration({
  projectId: completed.project.projectId,
  boardId: completed.board.boardId,
  executionId: imageRun.execution.executionId,
  connectionId: connection!.connectionId,
}, {
  runTurn: async (input) => {
    assert.match(input.prompt, /^\$imagegen Generate exactly one image/);
    assert.equal(input.localImagePaths?.length, 0);
    input.onImageGenerationStarted?.();
    return {
      threadId: 'thread_image_test',
      turnId: 'turn_image_test',
      text: '',
      image: {
        itemId: 'image_item_test',
        dataUrl: `data:image/png;base64,${Buffer.from('codex-image-test').toString('base64')}`,
      },
    };
  },
});
await imageStarted.completion;
completed = await loadSnapshot(completed.project.projectId, completed.board.boardId);
const imageExecution = completed.executions.find((candidate) => candidate.executionId === imageRun.execution.executionId);
const imageResult = completed.blocks.find((candidate) => candidate.blockId === imageRun.resultBlock.blockId);
assert.equal(imageExecution?.status, 'succeeded');
assert.ok(imageResult?.data.assetId);
assert.equal(completed.assets.some((candidate) => candidate.assetId === imageResult.data.assetId), true);
assert.equal(imageExecution?.params?.codexAppServer && typeof imageExecution.params.codexAppServer, 'object');

console.log(JSON.stringify({
  ok: true,
  capabilities: connection?.supportedCapabilityIds,
  routes: [textExecution?.adapter, imageExecution?.adapter],
}));
