import assert from 'node:assert/strict';
import { readFile, rm } from 'node:fs/promises';
import { addImageCodexOperation, createDraftTextToImageOperation, executeExistingImageOperationBlock } from '../src/core/imageOperations';
import { textDocumentCapabilityIds } from '../src/core/capabilityRegistry';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { createDraftTextGenerationOperation, executeExistingTextGenerationOperation } from '../src/core/textOperations';
import type { BoardSnapshot } from '../src/core/types';
import { startCodexAppServerImageGeneration } from './codex-app-server-image-service';
import { createProviderImagePrompt, imageExecutionInputAssignments } from './image-execution-prompt';
import { checkExecutionConnection, listExecutionProviderSettings, updateExecutionConnection } from './local-store/execution-provider-store';
import { resolveAssetStoragePath } from './local-store/asset-files';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { retakeRoot } from './local-store/context';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';
import { startTextGeneration } from './text-generation-service';
import { cliUpgradeMessage, cliVersionAtLeast } from './cli-runtime-diagnostic';
import {
  createDraftStoryboardSheetOperation,
  executeExistingStoryboardSheetOperation,
} from '../src/core/storyboardSheetOperations';

assert.ok(retakeRoot.endsWith('.retake-test-codex-app-server'), 'Codex App Server tests must use a disposable workspace.');
await rm(retakeRoot, { recursive: true, force: true });

assert.equal(cliVersionAtLeast('0.144.6', '0.136.0'), true);
assert.equal(cliVersionAtLeast('0.120.0', '0.136.0'), false);
assert.match(cliUpgradeMessage({
  runtimeName: 'Claude CLI',
  version: '1.0.0',
  upgradeCommands: ['claude update'],
}), /Claude CLI.*1\.0\.0.*claude update/);

const initialSettings = await listExecutionProviderSettings();
assert.equal(
  initialSettings.connections.find((candidate) => candidate.connectionId === 'codex-app-server')?.modelId,
  undefined,
  'A fresh App Server connection must wait for model/list instead of using a hard-coded model.',
);
await updateExecutionConnection('codex-app-server', { modelId: 'gpt-5.6-terra' });
const settings = await checkExecutionConnection('codex-app-server', undefined, {
  probeCodexAppServer: async (selectedModelId) => ({
    version: '0.144.6',
    authMode: 'chatgpt',
    capabilities: { imageGeneration: true, namespaceTools: true, webSearch: true },
    models: [{
      id: selectedModelId ?? 'gpt-5.6-terra',
      displayName: 'GPT-5.6-Terra',
      description: 'Test model',
      isDefault: true,
      inputModalities: ['text', 'image'],
    }],
    selectedModel: {
      id: selectedModelId ?? 'gpt-5.6-terra',
      displayName: 'GPT-5.6-Terra',
      description: 'Test model',
      isDefault: true,
      inputModalities: ['text', 'image'],
    },
  }),
});
const connection = settings.connections.find((candidate) => candidate.connectionId === 'codex-app-server');
assert.equal(connection?.status, 'ready');
assert.equal(connection?.modelId, 'gpt-5.6-terra');
assert.deepEqual(connection?.supportedCapabilityIds, [
  ...textDocumentCapabilityIds,
  'image.annotation_edit',
  'image.image_to_image',
  'image.text_to_image',
  'previs.storyboard_sheet.generate',
]);

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
    assert.equal(input.model, 'gpt-5.6-terra');
    assert.match(input.prompt, /Return only the requested Markdown document/);
    assert.match(input.prompt, /Do not call tools and do not add process commentary/);
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
assert.equal(textExecution?.requestPrompts?.[0]?.outputBlockId, textRun.resultBlock.blockId);
assert.match(textExecution?.requestPrompts?.[0]?.prompt ?? '', /Do not call tools and do not add process commentary/);
assert.equal(textResult?.type, 'document');
assert.equal(textResult?.data.body, undefined, 'Full Markdown must remain in the Asset, not BoardSnapshot.');
assert.equal(textResult?.data.title, 'Cat Scene');
assert.equal(textResult?.data.documentExcerpt, 'Cat Scene\n\nA concise draft.');
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
  generationParams: {
    aspectRatioPreset: '9:16',
    targetAspectRatio: 9 / 16,
    targetWidth: 1152,
    targetHeight: 2048,
    variationCount: 4,
  },
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

let imageCalls = 0;
let concurrentImageCalls = 0;
let maxConcurrentImageCalls = 0;
let releaseConcurrentImages: (() => void) | undefined;
const allImagesStarted = new Promise<void>((resolve) => {
  releaseConcurrentImages = resolve;
});
const concurrentImagesReady = Promise.race([
  allImagesStarted,
  new Promise<never>((_resolve, reject) => setTimeout(
    () => reject(new Error('Codex App Server candidates did not start concurrently.')),
    1_000,
  )),
]);
const imageCandidatePrompts = new Set<string>();
const imageStarted = await startCodexAppServerImageGeneration({
  projectId: completed.project.projectId,
  boardId: completed.board.boardId,
  executionId: imageRun.execution.executionId,
  connectionId: connection!.connectionId,
}, {
  runTurn: async (input) => {
    imageCalls += 1;
    const callIndex = imageCalls;
    concurrentImageCalls += 1;
    maxConcurrentImageCalls = Math.max(maxConcurrentImageCalls, concurrentImageCalls);
    if (imageCalls === 4) releaseConcurrentImages?.();
    await concurrentImagesReady;
    assert.match(input.prompt, /^\$imagegen Generate exactly one image/);
    assert.match(input.prompt, /Required output aspect ratio: 9:16 \(portrait, width:height\)/);
    assert.match(input.prompt, /hard output-canvas requirement/);
    assert.match(input.prompt, /do not simulate the requested ratio with letterboxing or padding/);
    const candidate = input.prompt.match(/candidate ([1-4]) of 4/)?.[1];
    assert.ok(candidate);
    imageCandidatePrompts.add(candidate);
    assert.equal(input.localImagePaths?.length, 0);
    input.onImageGenerationStarted?.();
    concurrentImageCalls -= 1;
    return {
      threadId: `thread_image_test_${callIndex}`,
      turnId: `turn_image_test_${callIndex}`,
      text: '',
      image: {
        itemId: `image_item_test_${callIndex}`,
        dataUrl: `data:image/png;base64,${Buffer.from(`codex-image-test-${callIndex}`).toString('base64')}`,
      },
    };
  },
});
await imageStarted.completion;
completed = await loadSnapshot(completed.project.projectId, completed.board.boardId);
const imageExecution = completed.executions.find((candidate) => candidate.executionId === imageRun.execution.executionId);
const imageResult = completed.blocks.find((candidate) => candidate.blockId === imageRun.resultBlock.blockId);
assert.equal(imageExecution?.status, 'succeeded');
assert.equal(imageExecution?.outputAssetIds.length, 4);
assert.equal(imageExecution?.requestPrompts?.length, 4);
assert.match(imageExecution?.requestPrompts?.[0]?.prompt ?? '', /^\$imagegen Generate exactly one image/);
assert.match(imageExecution?.requestPrompts?.[1]?.prompt ?? '', /candidate 2 of 4/);
assert.equal(maxConcurrentImageCalls, 4, 'Every requested Codex App Server candidate must start concurrently.');
assert.deepEqual([...imageCandidatePrompts].sort(), ['1', '2', '3', '4']);
assert.ok(imageResult?.data.assetId);
assert.equal(completed.assets.some((candidate) => candidate.assetId === imageResult.data.assetId), true);
assert.equal(imageExecution?.params?.codexAppServer && typeof imageExecution.params.codexAppServer, 'object');

const partialImageDraft = createDraftTextToImageOperation(completed, {
  operationTitle: 'Generate partial App Server batch',
  textBlockBody: 'Generate two candidates and preserve a successful paid draw.',
  textBlockTitle: 'Prompt',
  generationParams: {
    aspectRatioPreset: '1:1',
    targetAspectRatio: 1,
    variationCount: 2,
  },
});
partialImageDraft.operationBlock.data.connectionId = connection!.connectionId;
const partialImageRun = executeExistingImageOperationBlock(completed, {
  connection: connection!,
  generationParams: partialImageDraft.operationBlock.data.generationParams,
  instruction: '',
  operation: 'text_to_image',
  operationBlockId: partialImageDraft.operationBlock.blockId,
});
const preservedAppServerAssetId = 'asset_app_server_preserved';
const preservedAppServerResultBlock = partialImageRun.resultBlocks[0];
const failedAppServerResultBlockId = partialImageRun.resultBlocks[1].blockId;
const failedAppServerResultIndex = 1;
const partialImageCompletedAt = new Date().toISOString();
completed.assets.unshift({
  assetId: preservedAppServerAssetId,
  projectId: completed.project.projectId,
  kind: 'image',
  mimeType: 'image/png',
  storageProvider: 'local_mock',
  storageKey: 'local-mock://app-server-preserved.png',
  previewUrl: `data:image/png;base64,${Buffer.from('codex-partial-success').toString('base64')}`,
  sourceExecutionId: partialImageRun.execution.executionId,
  createdAt: partialImageCompletedAt,
});
preservedAppServerResultBlock.data.assetId = preservedAppServerAssetId;
preservedAppServerResultBlock.data.previewUrl = completed.assets[0].previewUrl;
preservedAppServerResultBlock.data.status = 'succeeded';
preservedAppServerResultBlock.updatedAt = partialImageCompletedAt;
partialImageRun.resultBlocks[1].data.status = 'failed';
partialImageRun.resultBlocks[1].updatedAt = partialImageCompletedAt;
partialImageRun.operationBlock.data.status = 'failed';
partialImageRun.operationBlock.updatedAt = partialImageCompletedAt;
partialImageRun.execution.status = 'failed';
partialImageRun.execution.completedAt = partialImageCompletedAt;
partialImageRun.execution.errorMessage = 'Synthetic partial App Server failure.';
partialImageRun.execution.outputAssetIds = [preservedAppServerAssetId];
partialImageRun.execution.resultSummary = { requested: 2, succeeded: 1, failed: 1 };
await saveSnapshot(completed);
let appServerRetryCalls = 0;
const retriedImage = await startCodexAppServerImageGeneration({
  projectId: completed.project.projectId,
  boardId: completed.board.boardId,
  executionId: partialImageRun.execution.executionId,
  connectionId: connection!.connectionId,
  resultBlockId: failedAppServerResultBlockId,
}, {
  runTurn: async (input) => {
    appServerRetryCalls += 1;
    assert.match(input.prompt, new RegExp(`candidate ${failedAppServerResultIndex + 1} of 2`));
    return {
      threadId: 'thread_retry_image',
      turnId: 'turn_retry_image',
      text: '',
      image: {
        itemId: 'image_retry_success',
        dataUrl: `data:image/png;base64,${Buffer.from('codex-retry-success').toString('base64')}`,
      },
    };
  },
});
await retriedImage.completion;
const partialImageSnapshot = await loadSnapshot(completed.project.projectId, completed.board.boardId);
const retriedImageExecution = partialImageSnapshot.executions.find(
  (candidate) => candidate.executionId === partialImageRun.execution.executionId,
);
assert.equal(appServerRetryCalls, 1, 'Retrying one App Server candidate must issue exactly one paid draw.');
assert.equal(retriedImageExecution?.status, 'succeeded');
assert.equal(retriedImageExecution?.outputAssetIds.length, 2);
assert.equal(retriedImageExecution?.outputAssetIds.includes(preservedAppServerAssetId), true);

const referenceOnlyExecution = structuredClone(imageRun.execution);
referenceOnlyExecution.inputAssetIds = ['asset_reference_prompt_test'];
referenceOnlyExecution.params = {
  ...referenceOnlyExecution.params,
  referenceAssetIds: ['asset_reference_prompt_test'],
};
const referenceAssignments = imageExecutionInputAssignments(referenceOnlyExecution);
assert.deepEqual(referenceAssignments, [{
  assetId: 'asset_reference_prompt_test',
  inputRole: 'general_reference',
}]);
const referencedTextToImagePrompt = createProviderImagePrompt(referenceOnlyExecution, referenceAssignments, {
  dialect: 'codex_imagegen',
  variantIndex: 0,
  variantCount: 1,
});
assert.match(referencedTextToImagePrompt, /^\$imagegen Generate exactly one image/);
assert.match(referencedTextToImagePrompt, /create a new image instead of treating any reference as the editable output base/);
assert.doesNotMatch(referencedTextToImagePrompt, /\.\./);
assert.match(referencedTextToImagePrompt, /attachment 1 \[general_reference\]/);
assert.doesNotMatch(referencedTextToImagePrompt, /^\$imagegen Edit/);

const roleAwareEditExecution = structuredClone(imageRun.execution);
roleAwareEditExecution.capabilityId = 'image.image_to_image';
roleAwareEditExecution.inputAssetIds = ['asset_source_prompt_test', 'asset_style_prompt_test'];
roleAwareEditExecution.params = {
  ...roleAwareEditExecution.params,
  inputBindings: [
    { assetId: 'asset_source_prompt_test', blockId: 'block_source_prompt_test', inputRole: 'source' },
    { assetId: 'asset_style_prompt_test', blockId: 'block_style_prompt_test', inputRole: 'style_reference' },
  ],
};
const editAssignments = imageExecutionInputAssignments(roleAwareEditExecution);
assert.deepEqual(editAssignments.map((assignment) => assignment.inputRole), ['source', 'style_reference']);
const roleAwareEditPrompt = createProviderImagePrompt(roleAwareEditExecution, editAssignments, {
  dialect: 'codex_imagegen',
  variantIndex: 1,
  variantCount: 2,
});
assert.match(roleAwareEditPrompt, /^\$imagegen Edit attachment 1/);
assert.match(roleAwareEditPrompt, /attachment 2 \[style_reference\]/);
assert.match(roleAwareEditPrompt, /Do not reassign these roles/);
assert.match(roleAwareEditPrompt, /candidate 2 of 2/);
assert.doesNotMatch(roleAwareEditPrompt, /\.\./);

const annotatedComposite = await createAssetFromDataUrl({
  projectId: completed.project.projectId,
  dataUrl: `data:image/png;base64,${Buffer.from('annotated-composite-test').toString('base64')}`,
  fileName: 'annotated-composite.png',
  kind: 'image',
});
const annotationRun = addImageCodexOperation(completed, {
  connection: connection!,
  operation: 'annotation_edit',
  sourceBlockId: imageResult!.blockId,
  instruction: 'Make the marked collar blue.',
  annotatedCompositeAsset: annotatedComposite,
  annotationManifest: {
    schemaVersion: 1,
    compositeAssetId: annotatedComposite.assetId,
    globalInstruction: 'Keep the cat unchanged outside the marked region.',
    marks: [{
      id: 'R1',
      kind: 'rect',
      color: '#2563eb',
      strokeSize: 'm',
      intent: 'Change only the collar to royal blue.',
      start: { x: 0.35, y: 0.55 },
      end: { x: 0.65, y: 0.72 },
    }],
  },
});
assert.equal(annotationRun.execution.adapter, 'codex_app_server');
assert.equal(annotationRun.execution.capabilityId, 'image.annotation_edit');
assert.equal(annotationRun.execution.params?.annotatedCompositeAssetId, annotatedComposite.assetId);
assert.equal(annotationRun.execution.agentPrompt, undefined);
assert.equal(annotationRun.operationBlock.data.agentPrompt, undefined);
await saveSnapshot(completed);

const annotationStarted = await startCodexAppServerImageGeneration({
  projectId: completed.project.projectId,
  boardId: completed.board.boardId,
  executionId: annotationRun.execution.executionId,
  connectionId: connection!.connectionId,
}, {
  runTurn: async (input) => {
    assert.equal(input.localImagePaths?.length, 2, 'Annotation edit must attach the clean source and annotated composite.');
    assert.match(input.prompt, /final attached annotated composite/);
    assert.match(input.prompt, /attachment 1 \[source\]/);
    assert.match(input.prompt, /attachment 2 \[annotated_composite\]/);
    assert.match(input.prompt, /Change only the collar to royal blue/);
    assert.match(input.prompt, /do not retain them in the final image/);
    assert.match(input.prompt, /Preserve the source subject, composition, style, and all unmentioned content/);
    return {
      threadId: 'thread_annotation_test',
      turnId: 'turn_annotation_test',
      text: '',
      image: {
        itemId: 'annotation_image_item_test',
        dataUrl: `data:image/png;base64,${Buffer.from('annotation-image-test').toString('base64')}`,
      },
    };
  },
});
await annotationStarted.completion;
completed = await loadSnapshot(completed.project.projectId, completed.board.boardId);
assert.equal(
  completed.executions.find((candidate) => candidate.executionId === annotationRun.execution.executionId)?.status,
  'succeeded',
);
const completedAnnotationExecution = completed.executions.find(
  (candidate) => candidate.executionId === annotationRun.execution.executionId,
);
assert.match(completedAnnotationExecution?.requestPrompts?.[0]?.prompt ?? '', /final attached annotated composite/);

const storyboardPlanMarkdown = [
  '# Storyboard Plan',
  '',
  '## Unit: U03',
  '',
  '- U03-P01: wide station setup.',
  '- U03-P02: courier cat reaction.',
  '- U03-P03: parcel insert.',
  '- U03-P04: dog blocks the exit.',
  '- U03-P05: cat jumps.',
  '- U03-P06: landing bridge.',
].join('\n');
const storyboardPlanAsset = await createAssetFromDataUrl({
  projectId: completed.project.projectId,
  dataUrl: `data:text/markdown;base64,${Buffer.from(storyboardPlanMarkdown).toString('base64')}`,
  fileName: 'storyboard-plan.md',
  kind: 'document',
});
const storyboardReferenceAsset = await createAssetFromDataUrl({
  projectId: completed.project.projectId,
  dataUrl: `data:image/png;base64,${Buffer.from('storyboard-reference').toString('base64')}`,
  fileName: 'storyboard-reference.png',
  kind: 'image',
});
completed.assets.push(storyboardPlanAsset, storyboardReferenceAsset);
const storyboardPlanBlock = {
  ...structuredClone(completed.blocks[0]),
  blockId: 'block_storyboard_plan_codex_test',
  type: 'document' as const,
  data: {
    title: 'Storyboard Plan',
    assetId: storyboardPlanAsset.assetId,
    documentKind: 'storyboard_plan',
  },
};
const storyboardReferenceBlock = {
  ...structuredClone(completed.blocks[0]),
  blockId: 'block_storyboard_reference_codex_test',
  type: 'image' as const,
  data: {
    title: 'Courier Cat Reference',
    assetId: storyboardReferenceAsset.assetId,
    previewUrl: storyboardReferenceAsset.previewUrl,
  },
};
completed.blocks.push(storyboardPlanBlock, storyboardReferenceBlock);
const storyboardDraft = createDraftStoryboardSheetOperation(completed, {
  connectionId: connection!.connectionId,
  explicitInputBindings: [
    { kind: 'block', blockId: storyboardPlanBlock.blockId, inputSlotId: 'storyboard_plan' },
    { kind: 'block', blockId: storyboardReferenceBlock.blockId, inputSlotId: 'references' },
  ],
  labels: {
    operationTitle: 'Generate storyboard sheet',
    promptTitle: 'Storyboard Plan',
    promptPlaceholder: 'Connect a Storyboard Plan.',
    resultTitle: 'Storyboard sheet',
    waitingBody: 'Waiting.',
  },
  parameters: {
    panelCount: 6,
    gridLayout: '3x2',
    panelAspectRatio: '16:9',
    renderMode: 'panel_grid',
    outputCount: 2,
  },
  unitId: 'U03',
});
const storyboardRun = executeExistingStoryboardSheetOperation(completed, {
  connection: connection!,
  operationBlockId: storyboardDraft.operationBlock.blockId,
});
await saveSnapshot(completed);
let storyboardImageCalls = 0;
const storyboardStarted = await startCodexAppServerImageGeneration({
  projectId: completed.project.projectId,
  boardId: completed.board.boardId,
  executionId: storyboardRun.execution.executionId,
  connectionId: connection!.connectionId,
}, {
  runTurn: async (input) => {
    storyboardImageCalls += 1;
    assert.equal(input.localImagePaths?.length, 1, 'Only bound image references may become image attachments.');
    assert.match(input.prompt, /^\$imagegen Generate exactly one image/);
    assert.match(input.prompt, /Locked unit ID: U03/);
    assert.match(input.prompt, /Authoritative Storyboard Plan/);
    assert.match(input.prompt, /title="Courier Cat Reference"/);
    assert.match(input.prompt, /type=bound_image_reference/);
    assert.match(input.prompt, /U03-P06: landing bridge/);
    assert.match(input.prompt, /Render only the exact Unit ID U03/);
    assert.match(input.prompt, /Required output aspect ratio: 16:9/);
    return {
      threadId: `thread_storyboard_sheet_${storyboardImageCalls}`,
      turnId: `turn_storyboard_sheet_${storyboardImageCalls}`,
      text: '',
      image: {
        itemId: `storyboard_sheet_item_${storyboardImageCalls}`,
        dataUrl: `data:image/png;base64,${Buffer.from(`storyboard-sheet-${storyboardImageCalls}`).toString('base64')}`,
      },
    };
  },
});
await storyboardStarted.completion;
completed = await loadSnapshot(completed.project.projectId, completed.board.boardId);
const completedStoryboardExecution = completed.executions.find(
  (candidate) => candidate.executionId === storyboardRun.execution.executionId,
);
assert.equal(storyboardImageCalls, 2);
assert.equal(completedStoryboardExecution?.capabilityId, 'previs.storyboard_sheet.generate');
assert.equal(completedStoryboardExecution?.requestPrompts?.length, 2);
assert.deepEqual(completedStoryboardExecution?.outputSlotResults, [{
  slotId: 'storyboard_sheet',
  assetIds: completedStoryboardExecution.outputAssetIds,
}]);
assert.equal(
  completed.blocks.find((block) => block.blockId === storyboardRun.resultBlocks[0]?.blockId)?.data.title,
  'Storyboard sheet · U03 · same-unit candidate 1/2',
);

console.log(JSON.stringify({
  ok: true,
  capabilities: connection?.supportedCapabilityIds,
  concurrentImageCandidates: maxConcurrentImageCalls,
  retriedFailedCandidateCalls: appServerRetryCalls,
  storyboardSheetCandidates: storyboardImageCalls,
  routes: [textExecution?.adapter, imageExecution?.adapter, annotationRun.execution.adapter],
}));
