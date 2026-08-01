import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBlockRecord } from '../src/core/blockFactory';
import {
  createImageComposerDraft,
  defaultImageComposerGenerationParams,
  imageComposerGenerationParams,
  listImageComposerReferenceOptions,
} from '../src/core/imageComposer';
import { createReferenceIntent } from '../src/core/referenceIntent';
import { imageComposerReferencePresentation } from '../src/components/ImageComposerReferenceTray';
import {
  imageComposerWorkflowGeometry,
  imageComposerWorkflowLayoutBlockIds,
} from '../src/app/imageComposerWorkflowLayout';
import { executeExistingImageOperationBlock } from '../src/core/imageOperations';
import { imageGenerateCapabilityId } from '../src/core/imageGenerateContracts';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import type { AssetRecord, BoardSnapshot } from '../src/core/types';
import { resetWorkspace } from './local-store/snapshot-store';

const [
  appSource,
  attachmentControllerSource,
  canvasControllerSource,
  composerSource,
  controllerSource,
  controlsSource,
  providerSource,
  referenceEditorSource,
  operationFromImagePickerSource,
  referenceTraySource,
  toolbarStyles,
] = await Promise.all([
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useAgentAttachmentController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useCanvasController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SkillQuickInputComposer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/useImageOperationController.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ImageComposerControls.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/UnifiedComposerProvider.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ReferenceIntentEditor.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/OperationFromImagePicker.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ImageComposerReferenceTray.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/toolbars.css', import.meta.url), 'utf8'),
]);

assert.match(composerSource, /listAvailableComposerModes/);
assert.doesNotMatch(composerSource, /<option value="image" disabled>/);
assert.match(composerSource, /listImageComposerReferenceOptions/);
assert.match(composerSource, /onCreateImage/);
assert.match(composerSource, /ImageComposerReferenceTray/);
assert.match(composerSource, /resetImageSubmission/);
assert.match(appSource, /onCreateImage=\{\(input\) => createAndStartImageComposerOperation/);
assert.match(controllerSource, /persist: false,\s*reveal: false,/);
assert.match(controllerSource, /void startExistingOperationBlock\(\{/);
assert.match(controllerSource, /imageComposerWorkflowLayoutBlockIds/);
assert.match(controllerSource, /focusWorkflowBlocks\(revealBlockIds, \{ maxZoom: 1 \}\)/);
assert.match(attachmentControllerSource, /composerSourceAssetId: asset\.assetId/);
assert.match(attachmentControllerSource, /layoutAttachmentBlocks\(attachmentBlocks, center\)/);
assert.match(attachmentControllerSource, /moveBlockGroupToNearestFreeArea\(current, attachmentBlocks, center\)/);
assert.match(canvasControllerSource, /block\?\.type === 'image'/);
assert.match(appSource, /referenceBlockIds: \[sourceBlock\.blockId\]/);
assert.match(appSource, /maxZoom: 0\.95/);
assert.match(canvasControllerSource, /safeViewportForBounds/);
assert.match(controlsSource, /imageGenerateCapabilityId/);
assert.match(controlsSource, /connection\.connectorId !== 'codex-managed'/);
assert.match(controlsSource, /currentExecutionProviderSettings/);
assert.match(controlsSource, /resolveAgentExecutionConnection/);
assert.match(controlsSource, /initialConnectionId: 'codex-app-server'/);
assert.match(controlsSource, /imageComposerAspectRatios/);
assert.match(controlsSource, /imageComposerResolutions/);
assert.match(controlsSource, /image-composer-popover is-parameters/);
assert.match(controlsSource, /setImageGenerationParamsTouched\(true\)/);
assert.doesNotMatch(controlsSource, /<select/);
assert.match(providerSource, /composerMode/);
assert.match(providerSource, /imageReferenceSettings/);
assert.match(providerSource, /imageGenerationParamsTouched/);
assert.match(referenceTraySource, /useDismissiblePopover/);
assert.match(referenceTraySource, /onPointerEnter/);
assert.match(referenceTraySource, /onFocusCapture/);
assert.match(referenceTraySource, /aria-pressed/);
assert.match(referenceTraySource, /image-composer-reference-preview/);
assert.match(referenceTraySource, /function dismissFloatingContent\(\): void/);
assert.match(referenceTraySource, /onKeyDownCapture=\{dismissOnEscape\}/);
assert.match(referenceTraySource, /dispatchOpenImageDetails/);
assert.match(referenceTraySource, /referenceSettingBadgeLabel/);
assert.match(referenceEditorSource, /referenceModeSource/);
assert.match(referenceEditorSource, /referenceIntentPlaceholder/);
assert.match(referenceEditorSource, /referenceIntentSuggestions/);
assert.match(referenceEditorSource, /toggleReferenceSuggestion/);
assert.match(operationFromImagePickerSource, /onSelect\('similar'\)/);
assert.match(appSource, /mode === 'similar' \? 'create_similar' : 'quick_edit'/);
assert.match(toolbarStyles, /\.image-composer-reference-thumbnail/);
assert.match(toolbarStyles, /\.image-composer-reference-preview/);

const snapshot = await emptySnapshot();
const firstAsset = imageAsset(snapshot, 'asset_image_composer_block');
const secondAsset = imageAsset(snapshot, 'asset_image_composer_asset');
snapshot.assets.push(firstAsset, secondAsset);
const referenceBlock = createBlockRecord(snapshot, 'image');
referenceBlock.blockId = 'block_image_composer_reference';
referenceBlock.data = {
  ...referenceBlock.data,
  assetId: firstAsset.assetId,
  previewUrl: firstAsset.previewUrl,
  title: '角色参考',
};
const outputSlot = createBlockRecord(snapshot, 'image');
outputSlot.blockId = 'block_image_composer_output';
outputSlot.data = { ...outputSlot.data, title: '图片输出' };
snapshot.blocks.push(referenceBlock, outputSlot);

const referencePresentation = imageComposerReferencePresentation(
  snapshot,
  { kind: 'block', blockId: referenceBlock.blockId, slotId: 'references' },
);
assert.deepEqual(referencePresentation, {
  blockId: referenceBlock.blockId,
  mentionId: `block:${referenceBlock.blockId}:references`,
  previewUrl: firstAsset.previewUrl,
  title: '角色参考',
});
const assetPresentation = imageComposerReferencePresentation(
  snapshot,
  { kind: 'asset', assetId: secondAsset.assetId, slotId: 'references' },
);
assert.equal(assetPresentation.previewUrl, secondAsset.previewUrl);
assert.equal(assetPresentation.title, `${secondAsset.assetId}.png`);

const options = listImageComposerReferenceOptions(snapshot);
assert.ok(options.some((option) => option.kind === 'block' && option.blockId === referenceBlock.blockId));
assert.ok(options.some((option) => option.kind === 'asset' && option.assetId === secondAsset.assetId));
assert.equal(options.some((option) => option.kind === 'block' && option.blockId === outputSlot.blockId), false);

const result = createImageComposerDraft(snapshot, {
  connectionId: 'codex-managed',
  generationParams: imageComposerGenerationParams({
    aspectRatioPreset: '16:9',
    targetResolution: '4K',
    variationCount: 3,
  }),
  instruction: '让角色站在雨夜霓虹街道中央，电影感构图。',
  operationTitle: '生成图片',
  references: [
    {
      bindingKind: 'reference',
      inputSlotId: 'references',
      mention: { kind: 'block', blockId: referenceBlock.blockId, slotId: 'references' },
      referenceIntent: createReferenceIntent('保持角色身份和服装设计。', 'user'),
    },
    {
      bindingKind: 'reference',
      inputSlotId: 'references',
      mention: { kind: 'asset', assetId: secondAsset.assetId, slotId: 'references' },
      referenceIntent: createReferenceIntent('参考霓虹雨夜的质感。', 'user'),
    },
  ],
  slotBlockId: outputSlot.blockId,
  textBlockTitle: '提示词',
});

assert.equal(result.operationBlock.data.capabilityId, imageGenerateCapabilityId);
assert.equal(result.operationBlock.data.connectionId, 'codex-managed');
assert.equal(result.textBlock.data.body, '让角色站在雨夜霓虹街道中央，电影感构图。');
assert.deepEqual(result.operationBlock.data.generationParams, {
  aspectRatioPreset: '16:9',
  targetAspectRatio: 16 / 9,
  targetHeight: 2304,
  targetResolution: '4K',
  targetWidth: 4096,
  variationCount: 3,
});
assert.equal(result.referenceBlockIds.length, 2);
assert.deepEqual(imageComposerWorkflowLayoutBlockIds({
  operationBlockId: result.operationBlock.blockId,
  referenceBlockIds: result.referenceBlockIds,
  textBlockId: result.textBlock.blockId,
}), [
  ...result.referenceBlockIds,
  result.textBlock.blockId,
  result.operationBlock.blockId,
]);
assert.deepEqual(imageComposerWorkflowLayoutBlockIds({
  operationBlockId: result.operationBlock.blockId,
  outputSlotBlockId: outputSlot.blockId,
  referenceBlockIds: result.referenceBlockIds,
  textBlockId: result.textBlock.blockId,
}), [
  ...result.referenceBlockIds,
  result.textBlock.blockId,
  result.operationBlock.blockId,
  outputSlot.blockId,
]);

const portraitReference = { blockId: 'portrait_reference', size: { width: 160, height: 380 } };
const secondPortraitReference = { blockId: 'portrait_reference_2', size: { width: 160, height: 380 } };
const landscapeReference = { blockId: 'landscape_reference', size: { width: 380, height: 200 } };
const promptBlock = { blockId: 'prompt', size: { width: 260, height: 170 } };
const operationBlock = { blockId: 'operation', size: { width: 320, height: 190 } };
const resultBlock = { blockId: 'result', size: { width: 300, height: 230 } };
const mixedReferenceGeometry = imageComposerWorkflowGeometry({
  center: { x: 0, y: 0 },
  operationBlock,
  outputSlotBlock: resultBlock,
  referenceBlocks: [portraitReference, secondPortraitReference, landscapeReference],
  textBlock: promptBlock,
});
assert.ok(
  mixedReferenceGeometry.positions.prompt.y
  < mixedReferenceGeometry.positions.portrait_reference.y,
  'Prompt stays above the reference shelf.',
);
assert.equal(
  mixedReferenceGeometry.positions.portrait_reference.y,
  mixedReferenceGeometry.positions.portrait_reference_2.y,
  'Portrait references share a row when their widths fit.',
);
assert.ok(
  mixedReferenceGeometry.positions.operation.x
  > mixedReferenceGeometry.positions.landscape_reference.x + landscapeReference.size.width,
  'Operation stays to the right of the complete input stage.',
);
assert.ok(
  mixedReferenceGeometry.positions.result.x
  > mixedReferenceGeometry.positions.operation.x + operationBlock.size.width,
  'Result stays to the right of the Operation.',
);

const landscapeRowsGeometry = imageComposerWorkflowGeometry({
  center: { x: 0, y: 0 },
  operationBlock,
  referenceBlocks: [
    landscapeReference,
    { blockId: 'landscape_reference_2', size: { width: 380, height: 200 } },
  ],
  textBlock: promptBlock,
});
assert.ok(
  landscapeRowsGeometry.positions.landscape_reference_2.y
  > landscapeRowsGeometry.positions.landscape_reference.y,
  'Wide references wrap vertically instead of stretching the input stage.',
);
assert.ok(snapshot.edges.some((edge) =>
  edge.sourceBlockId === referenceBlock.blockId
  && edge.targetBlockId === result.operationBlock.blockId
  && edge.inputSlotId === 'references'
  && edge.referenceIntent?.instruction === '保持角色身份和服装设计。'));
assert.ok(snapshot.edges.some((edge) =>
  edge.sourceBlockId === result.referenceBlockIds[1]
  && edge.targetBlockId === result.operationBlock.blockId
  && edge.inputSlotId === 'references'
  && edge.referenceIntent?.instruction === '参考霓虹雨夜的质感。'));
assert.ok(snapshot.edges.some((edge) =>
  edge.sourceBlockId === result.operationBlock.blockId
  && edge.targetBlockId === outputSlot.blockId
  && edge.kind === 'execution_output'));
assert.equal(snapshot.executions.length, 0);
assert.equal(snapshot.agentRuns?.length ?? 0, 0);
assert.equal(snapshot.agentSessions?.length ?? 0, 0);
assert.equal(snapshot.changeProposals?.length ?? 0, 0);
assert.equal(snapshot.workflowRuns?.length ?? 0, 0);

assert.deepEqual(defaultImageComposerGenerationParams(), {
  aspectRatioPreset: '9:16',
  targetAspectRatio: 9 / 16,
  targetHeight: 2048,
  targetResolution: '2K',
  targetWidth: 1152,
  variationCount: 1,
});

const invalidSnapshot = await emptySnapshot();
const foreignAsset = imageAsset(invalidSnapshot, 'asset_foreign');
foreignAsset.projectId = 'project_foreign';
invalidSnapshot.assets.push(foreignAsset);
const initialBlockCount = invalidSnapshot.blocks.length;
assert.throws(() => createImageComposerDraft(invalidSnapshot, {
  connectionId: 'codex-managed',
  generationParams: defaultImageComposerGenerationParams(),
  instruction: '测试',
  operationTitle: '生成图片',
  references: [{
    bindingKind: 'reference',
    inputSlotId: 'references',
    mention: { kind: 'asset', assetId: foreignAsset.assetId, slotId: 'references' },
  }],
  textBlockTitle: '提示词',
}), /reference is invalid/);
assert.equal(invalidSnapshot.blocks.length, initialBlockCount);

const slotSnapshot = await emptySnapshot();
const slotAsset = imageAsset(slotSnapshot, 'asset_invalid_slot');
slotSnapshot.assets.push(slotAsset);
assert.throws(() => createImageComposerDraft(slotSnapshot, {
  connectionId: 'codex-managed',
  generationParams: defaultImageComposerGenerationParams(),
  instruction: '测试',
  operationTitle: '生成图片',
  references: [{
    bindingKind: 'reference',
    inputSlotId: '',
    mention: { kind: 'asset', assetId: slotAsset.assetId, slotId: 'references' },
  }],
  textBlockTitle: '提示词',
}), /slot is invalid/);
assert.equal(slotSnapshot.blocks.length, 0);

const imageToImageSnapshot = await emptySnapshot();
const sourceAsset = imageAsset(imageToImageSnapshot, 'asset_image_composer_source');
const styleAsset = imageAsset(imageToImageSnapshot, 'asset_image_composer_style');
imageToImageSnapshot.assets.push(sourceAsset, styleAsset);
const sourceBlock = createBlockRecord(imageToImageSnapshot, 'image');
sourceBlock.blockId = 'block_image_composer_source';
sourceBlock.data = {
  ...sourceBlock.data,
  assetId: sourceAsset.assetId,
  previewUrl: sourceAsset.previewUrl,
  title: '原图',
};
imageToImageSnapshot.blocks.push(sourceBlock);
const imageToImageResult = createImageComposerDraft(imageToImageSnapshot, {
  capabilityId: 'image.image_to_image',
  connectionId: 'codex-app-server',
  generationParams: {
    aspectRatioPreset: 'source',
    targetResolution: '2K',
    variationCount: 1,
  },
  instruction: '保持构图，把窗外改成月色。',
  operationTitle: '编辑图片',
  references: [
    {
      bindingKind: 'source',
      inputSlotId: 'source_image',
      mention: { kind: 'block', blockId: sourceBlock.blockId, slotId: 'references' },
    },
    {
      bindingKind: 'reference',
      inputSlotId: 'references',
      mention: { kind: 'asset', assetId: styleAsset.assetId, slotId: 'references' },
      referenceIntent: createReferenceIntent('只参考冷色月夜光线。', 'user'),
    },
  ],
  textBlockTitle: '修改要求',
});
assert.equal(imageToImageResult.operationBlock.data.capabilityId, imageGenerateCapabilityId);
assert.equal(imageToImageResult.operationBlock.data.operationMode, 'image_to_image');
assert.equal(imageToImageResult.operationBlock.data.connectionId, 'codex-app-server');
assert.deepEqual(imageToImageResult.operationBlock.data.generationParams, {
  aspectRatioPreset: 'source',
  targetAspectRatio: 1,
  targetResolution: '2K',
  variationCount: 1,
});
assert.ok(imageToImageSnapshot.edges.some((edge) => (
  edge.sourceBlockId === sourceBlock.blockId
  && edge.targetBlockId === imageToImageResult.operationBlock.blockId
  && edge.inputSlotId === 'source_image'
)));
assert.ok(imageToImageSnapshot.edges.some((edge) => (
  edge.targetBlockId === imageToImageResult.operationBlock.blockId
  && edge.inputSlotId === 'references'
  && edge.referenceIntent?.instruction === '只参考冷色月夜光线。'
)));

const autoExecuteSnapshot = await emptySnapshot();
const autoReferenceAsset = imageAsset(autoExecuteSnapshot, 'asset_auto_execute_reference');
autoExecuteSnapshot.assets.push(autoReferenceAsset);
const autoReferenceBlock = createBlockRecord(autoExecuteSnapshot, 'image');
autoReferenceBlock.blockId = 'block_auto_execute_reference';
autoReferenceBlock.data = {
  ...autoReferenceBlock.data,
  assetId: autoReferenceAsset.assetId,
  previewUrl: autoReferenceAsset.previewUrl,
  title: '风格参考',
};
autoExecuteSnapshot.blocks.push(autoReferenceBlock);
const autoDraft = createImageComposerDraft(autoExecuteSnapshot, {
  capabilityId: 'image.text_to_image',
  connectionId: 'codex-app-server',
  generationParams: defaultImageComposerGenerationParams(),
  instruction: '生成一张白天的家具图。',
  operationTitle: '生成图片',
  references: [{
    bindingKind: 'reference',
    inputSlotId: 'references',
    mention: { kind: 'block', blockId: autoReferenceBlock.blockId, slotId: 'references' },
    referenceIntent: createReferenceIntent('参考家具摄影光线。', 'user'),
  }],
  textBlockTitle: '提示词',
});
assert.equal(autoExecuteSnapshot.blocks.length, 3, 'Reference + prompt + operation exist before execution.');
const autoConnection: ExecutionConnectionSummary = {
  connectionId: 'codex-app-server',
  connectorId: 'codex-app-server',
  providerLabel: 'Codex',
  displayName: 'Codex App Server',
  description: 'Automated image composer contract test.',
  connectionKind: 'agent_host',
  implementationKind: 'agent_bridge',
  supportedCapabilityIds: [imageGenerateCapabilityId],
  enabledUseCases: ['image'],
  configurable: true,
  deletable: false,
  enabled: true,
  status: 'ready',
  hasCredential: true,
  modelId: 'gpt-test',
};
const autoRun = executeExistingImageOperationBlock(autoExecuteSnapshot, {
  capabilityId: imageGenerateCapabilityId,
  connection: autoConnection,
  generationParams: autoDraft.operationBlock.data.generationParams,
  instruction: '',
  operation: 'text_to_image',
  operationBlockId: autoDraft.operationBlock.blockId,
});
assert.equal(autoExecuteSnapshot.blocks.length, 4, 'Execution creates one independent result block.');
assert.equal(autoRun.resultBlocks.length, 1);
assert.notEqual(autoRun.resultBlocks[0]?.blockId, autoReferenceBlock.blockId);
assert.ok(autoExecuteSnapshot.edges.some((edge) => (
  edge.sourceBlockId === autoReferenceBlock.blockId
  && edge.targetBlockId === autoDraft.operationBlock.blockId
  && edge.kind === 'execution_input'
  && edge.inputSlotId === 'references'
  && edge.referenceIntent?.instruction === '参考家具摄影光线。'
)));
assert.ok(autoExecuteSnapshot.edges.some((edge) => (
  edge.sourceBlockId === autoDraft.operationBlock.blockId
  && edge.targetBlockId === autoRun.resultBlocks[0]?.blockId
  && edge.kind === 'execution_output'
)));
assert.equal(autoRun.execution.outputBlockIds[0], autoRun.resultBlocks[0]?.blockId);
assert.equal(autoRun.execution.capabilityId, imageGenerateCapabilityId);
assert.equal(autoRun.execution.inputBlockIds.includes(autoReferenceBlock.blockId), true);
assert.equal(autoRun.execution.status, 'queued');
assert.deepEqual(
  autoRun.execution.inputBindingsSnapshot?.map((binding) => binding.slotId),
  ['prompt', 'references'],
);
assert.equal(
  autoRun.execution.inputBindingsSnapshot?.find((binding) => binding.slotId === 'references')
    ?.values[0]?.referenceIntent?.instruction,
  '参考家具摄影光线。',
);

console.log(JSON.stringify({
  ok: true,
  autoExecutionLaunchWired: true,
  imageModeEnabled: true,
  imageToImageCompilation: true,
  independentResultProjection: true,
  typedImageReferences: true,
  explicitConnection: true,
  normalizedGenerationParameters: true,
  operationDraftOnly: false,
  reusableOutputSlot: true,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const snapshot = await resetWorkspace();
  snapshot.blocks = [];
  snapshot.edges = [];
  snapshot.assets = [];
  snapshot.executions = [];
  snapshot.agentRuns = [];
  snapshot.agentSessions = [];
  snapshot.changeProposals = [];
  snapshot.workflowRuns = [];
  snapshot.workflowStepRuns = [];
  snapshot.historyEvents = [];
  return snapshot;
}

function imageAsset(snapshot: BoardSnapshot, assetId: string): AssetRecord {
  return {
    assetId,
    projectId: snapshot.project.projectId,
    kind: 'image',
    mimeType: 'image/png',
    storageProvider: 'local_mock',
    storageKey: `${assetId}.png`,
    previewUrl: `data:image/svg+xml,${assetId}`,
    width: 1024,
    height: 1024,
    createdAt: '2026-07-24T00:00:00.000Z',
  };
}
