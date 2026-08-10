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
import {
  isRetiredDefinitionError,
  retiredGuidedImageSkillId,
} from '../src/core/retiredDefinitions';
import { createFlowNodes } from '../src/core/flowProjection';
import {
  configureSkillRegistry,
  listSkills,
  type RetakeSkillDefinition,
} from '../src/core/skillRegistry';
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
const [operationInlineControlsSource, connectedPluginExecutionSource] = await Promise.all([
  readFile(new URL('../src/nodes/OperationInlineControls.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/runConnectedPluginExecution.ts', import.meta.url), 'utf8'),
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
assert.match(operationInlineControlsSource, /connectionId === 'codex-app-server'/);
assert.match(connectedPluginExecutionSource, /initialConnectionId: 'codex-app-server'/);

const snapshot = await emptySnapshot();
assert.equal(
  createBlockRecord(snapshot, 'operation').data.connectionId,
  'codex-app-server',
  'New image Operations must default to the Codex App Server when no user default overrides it.',
);
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
  capabilityId: imageGenerateCapabilityId,
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
assert.equal(imageToImageResult.operationBlock.data.operationMode, undefined);
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
  capabilityId: imageGenerateCapabilityId,
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
assert.equal(autoDraft.operationBlock.data.generationProfileId, 'codex-managed');
assert.equal(autoRun.execution.generationProfile?.generationProfileId, 'codex-app-server');
assert.equal(
  autoRun.execution.configuration?.generationProfileId,
  'codex-managed',
  'Execution route identity must not replace the Operation generation profile in freshness fingerprints.',
);
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

const workflowSelectionSnapshot = await emptySnapshot();
const staleCandidate = imageAsset(workflowSelectionSnapshot, 'asset_workflow_candidate_a');
staleCandidate.width = 800;
staleCandidate.height = 1200;
staleCandidate.sourceExecutionId = 'exec_workflow_concept';
const selectedCandidate = imageAsset(workflowSelectionSnapshot, 'asset_workflow_candidate_b');
selectedCandidate.width = 1200;
selectedCandidate.height = 800;
selectedCandidate.sourceExecutionId = 'exec_workflow_concept';
workflowSelectionSnapshot.assets.push(staleCandidate, selectedCandidate);
const staleCandidateBlock = createBlockRecord(workflowSelectionSnapshot, 'image');
staleCandidateBlock.blockId = 'block_workflow_static_candidate';
staleCandidateBlock.data = {
  ...staleCandidateBlock.data,
  assetId: staleCandidate.assetId,
  previewUrl: staleCandidate.previewUrl,
  sourceExecutionId: 'exec_workflow_concept',
  title: 'Static projected candidate',
};
const selectedCandidateBlock = createBlockRecord(workflowSelectionSnapshot, 'image');
selectedCandidateBlock.blockId = 'block_workflow_selected_candidate';
selectedCandidateBlock.data = {
  ...selectedCandidateBlock.data,
  assetId: selectedCandidate.assetId,
  previewUrl: selectedCandidate.previewUrl,
  sourceExecutionId: 'exec_workflow_concept',
  title: 'Accepted selected candidate',
};
const workflowPromptBlock = createBlockRecord(workflowSelectionSnapshot, 'text');
workflowPromptBlock.blockId = 'block_workflow_character_sheet_prompt';
workflowPromptBlock.data = {
  ...workflowPromptBlock.data,
  body: '基于已选中的角色方案，生成角色设定表。',
  title: 'Character Sheet prompt',
};
const workflowOperation = createBlockRecord(workflowSelectionSnapshot, 'operation');
workflowOperation.blockId = 'block_workflow_character_sheet_operation';
workflowOperation.data = {
  ...workflowOperation.data,
  capabilityId: imageGenerateCapabilityId,
  connectionId: 'codex-app-server',
  generationParams: {
    aspectRatioPreset: 'source',
    targetResolution: '2K',
    variationCount: 2,
  },
  generationProfileId: 'codex-managed',
  skillId: 'retake.image.ip-character-sheet',
  title: 'Generate character sheet',
  workflowStepId: 'character_sheet',
};
const workflowOutput = createBlockRecord(workflowSelectionSnapshot, 'image');
workflowOutput.blockId = 'block_workflow_character_sheet_output';
workflowOutput.data = {
  ...workflowOutput.data,
  title: 'Character Sheet output',
  workflowStepId: 'character_sheet',
};
const workflowGroup = createBlockRecord(workflowSelectionSnapshot, 'group');
workflowGroup.blockId = 'block_workflow_selected_input_group';
workflowGroup.data = {
  ...workflowGroup.data,
  groupKind: 'workflow',
  workflowAutoLayout: 'step_rows',
};
workflowPromptBlock.parentGroupId = workflowGroup.blockId;
workflowOperation.parentGroupId = workflowGroup.blockId;
workflowOutput.parentGroupId = workflowGroup.blockId;
workflowSelectionSnapshot.blocks.push(
  workflowGroup,
  staleCandidateBlock,
  selectedCandidateBlock,
  workflowPromptBlock,
  workflowOperation,
  workflowOutput,
);
workflowSelectionSnapshot.edges.push(
  {
    edgeId: 'edge_workflow_prompt',
    inputSlotId: 'prompt',
    kind: 'execution_input',
    sourceBlockId: workflowPromptBlock.blockId,
    targetBlockId: workflowOperation.blockId,
  },
  {
    edgeId: 'edge_workflow_source',
    inputSlotId: 'source_image',
    kind: 'execution_input',
    sourceBlockId: staleCandidateBlock.blockId,
    targetBlockId: workflowOperation.blockId,
  },
  {
    edgeId: 'edge_workflow_output',
    kind: 'execution_output',
    sourceBlockId: workflowOperation.blockId,
    targetBlockId: workflowOutput.blockId,
  },
);
workflowSelectionSnapshot.executions.push({
  adapter: 'codex_app_server',
  boardId: workflowSelectionSnapshot.board.boardId,
  capabilityId: imageGenerateCapabilityId,
  completedAt: '2026-08-03T00:01:00.000Z',
  executionId: 'exec_workflow_concept',
  inputBlockIds: [],
  outputAssetIds: [staleCandidate.assetId, selectedCandidate.assetId],
  outputBlockIds: [staleCandidateBlock.blockId, selectedCandidateBlock.blockId],
  outputSlotResults: [{
    assetIds: [staleCandidate.assetId, selectedCandidate.assetId],
    slotId: 'images',
  }],
  projectId: workflowSelectionSnapshot.project.projectId,
  skillId: 'retake.image.ip-concept-directions',
  startedAt: '2026-08-03T00:00:00.000Z',
  status: 'succeeded',
  stepRunId: 'step_run_workflow_concept',
  workflowRunId: 'workflow_run_selected_input',
});
workflowSelectionSnapshot.workflowRuns = [{
  boardId: workflowSelectionSnapshot.board.boardId,
  createdAt: '2026-08-03T00:00:00.000Z',
  createdBy: 'user',
  currentStepIds: ['character_sheet'],
  gateDefinitionLocks: [],
  gateEvaluationIds: [],
  inputBindings: [],
  outputSlotLocks: [],
  projectId: workflowSelectionSnapshot.project.projectId,
  recordVersion: 1,
  status: 'running',
  stepRunIds: ['step_run_workflow_concept', 'step_run_workflow_character_sheet'],
  updatedAt: '2026-08-03T00:01:00.000Z',
  workflowDefinitionLock: {
    definitionHash: 'sha256:test-workflow-selected-input',
    version: '0.1.0',
    workflowId: 'test.workflow-selected-input',
  },
  workflowProjectionId: 'projection_workflow_selected_input',
  workflowRunId: 'workflow_run_selected_input',
}];
workflowSelectionSnapshot.workflowStepRuns = [
  {
    acceptedAt: '2026-08-03T00:02:00.000Z',
    acceptedBy: 'user',
    acceptedOutputAssetIds: [selectedCandidate.assetId],
    capabilityLock: {
      capabilityId: imageGenerateCapabilityId,
      definitionHash: 'sha256:test-image-generate',
      version: '0.1.0',
    },
    createdAt: '2026-08-03T00:00:00.000Z',
    dependsOn: [],
    executionIds: ['exec_workflow_concept'],
    freshness: 'current',
    operationBlockId: 'block_workflow_concept_operation',
    outputAcceptancePolicy: 'manual_single',
    outputArtifactBindings: [{
      artifactId: 'artifact_workflow_candidate_b',
      artifactRevisionId: 'artrev_workflow_candidate_b',
      artifactType: 'character_reference',
      assetIds: [selectedCandidate.assetId],
      boundAt: '2026-08-03T00:02:00.000Z',
      executionIds: ['exec_workflow_concept'],
      outputSlotId: 'images',
      primaryAssetId: selectedCandidate.assetId,
      workflowOutputSlotId: 'accepted_concept',
    }],
    outputAssetIds: [staleCandidate.assetId, selectedCandidate.assetId],
    outputBlockIds: [staleCandidateBlock.blockId, selectedCandidateBlock.blockId],
    outputSlotIds: ['images'],
    recordVersion: 2,
    resolvedInputBindings: [],
    skillLock: {
      definitionHash: 'sha256:test-ip-concept',
      skillId: 'retake.image.ip-concept-directions',
      version: '0.1.0',
    },
    status: 'succeeded',
    stepId: 'concept',
    stepRunId: 'step_run_workflow_concept',
    updatedAt: '2026-08-03T00:02:00.000Z',
    workflowRunId: 'workflow_run_selected_input',
  },
  {
    acceptedOutputAssetIds: [],
    capabilityLock: {
      capabilityId: imageGenerateCapabilityId,
      definitionHash: 'sha256:test-image-generate',
      version: '0.1.0',
    },
    createdAt: '2026-08-03T00:00:00.000Z',
    dependsOn: ['concept'],
    executionIds: [],
    freshness: 'current',
    operationBlockId: workflowOperation.blockId,
    outputAcceptancePolicy: 'manual_single',
    outputArtifactBindings: [],
    outputAssetIds: [],
    outputBlockIds: [workflowOutput.blockId],
    outputSlotIds: ['images'],
    parameters: { variationCount: 2 },
    recordVersion: 1,
    resolvedInputBindings: [
      {
        inputSlotId: 'prompt',
        source: { kind: 'workflow_input', slotId: 'brief' },
        values: [{ blockId: workflowPromptBlock.blockId, kind: 'block' }],
      },
      {
        inputSlotId: 'source_image',
        source: { kind: 'step_output', outputSlotId: 'images', stepId: 'concept' },
        values: [{ assetId: staleCandidate.assetId, blockId: staleCandidateBlock.blockId, kind: 'asset' }],
      },
    ],
    skillLock: {
      definitionHash: 'sha256:test-ip-character-sheet',
      skillId: 'retake.image.ip-character-sheet',
      version: '0.1.0',
    },
    status: 'ready',
    stepId: 'character_sheet',
    stepRunId: 'step_run_workflow_character_sheet',
    updatedAt: '2026-08-03T00:02:00.000Z',
    workflowRunId: 'workflow_run_selected_input',
  },
];
const selectedInputPresentation = createFlowNodes(workflowSelectionSnapshot)
  .find((node) => node.id === workflowOperation.blockId)
  ?.data.operationReferenceInputs?.find((input) => input.inputSlotId === 'source_image');
assert.equal(selectedInputPresentation?.title, 'Accepted selected candidate');
assert.equal(selectedInputPresentation?.previewUrl, selectedCandidate.previewUrl);
const originalSkills = listSkills();
configureSkillRegistry(originalSkills.filter(
  (skill) => skill.skillId !== 'retake.image.ip-character-sheet',
));
const unavailableSkillSnapshot = structuredClone(workflowSelectionSnapshot);
assert.throws(() => executeExistingImageOperationBlock(unavailableSkillSnapshot, {
  capabilityId: imageGenerateCapabilityId,
  connection: autoConnection,
  generationParams: workflowOperation.data.generationParams,
  instruction: '',
  operation: 'image_to_image',
  operationBlockId: workflowOperation.blockId,
}), /Image operation Skill is unavailable or incompatible: retake\.image\.ip-character-sheet/);
assert.equal(unavailableSkillSnapshot.executions.length, 1);
assert.equal(
  unavailableSkillSnapshot.blocks.find(
    (block) => block.blockId === workflowOperation.blockId,
  )?.data.status,
  undefined,
  'An unavailable explicit Skill must fail before mutating the Operation.',
);
const retiredSkillSnapshot = structuredClone(workflowSelectionSnapshot);
const retiredOperation = retiredSkillSnapshot.blocks.find(
  (block) => block.blockId === workflowOperation.blockId,
);
assert.ok(retiredOperation);
retiredOperation.data = {
  ...retiredOperation.data,
  skillId: retiredGuidedImageSkillId,
};
assert.throws(() => executeExistingImageOperationBlock(retiredSkillSnapshot, {
  capabilityId: imageGenerateCapabilityId,
  connection: autoConnection,
  generationParams: retiredOperation.data.generationParams,
  instruction: '',
  operation: 'image_to_image',
  operationBlockId: retiredOperation.blockId,
}), (error) => (
  isRetiredDefinitionError(error)
  && error instanceof Error
  && /read-only/.test(error.message)
));
assert.equal(retiredSkillSnapshot.executions.length, 1);
const workflowCharacterSheetSkill: RetakeSkillDefinition = {
  capabilityBindings: [{
    capabilityId: imageGenerateCapabilityId,
    inputSlots: ['prompt', 'source_image', 'references'],
    outputSlots: ['images'],
  }],
  category: 'production_design',
  definitionHash: 'sha256:test-ip-character-sheet',
  description: 'Test Workflow Character Sheet Skill.',
  instructionTemplate: 'Create a test character sheet from the accepted concept.',
  name: 'Test IP character sheet',
  outputRequirements: ['Return one reviewable character sheet.'],
  schemaVersion: 1,
  skillId: 'retake.image.ip-character-sheet',
  source: { kind: 'package', paths: ['README.md'] },
  version: '0.1.0',
};
configureSkillRegistry([...originalSkills.filter(
  (skill) => skill.skillId !== workflowCharacterSheetSkill.skillId,
), workflowCharacterSheetSkill]);
const workflowSelectionRun = executeExistingImageOperationBlock(workflowSelectionSnapshot, {
  capabilityId: imageGenerateCapabilityId,
  connection: autoConnection,
  generationParams: workflowOperation.data.generationParams,
  instruction: '',
  operation: 'image_to_image',
  operationBlockId: workflowOperation.blockId,
});
assert.deepEqual(workflowSelectionRun.execution.inputAssetIds, [selectedCandidate.assetId]);
assert.equal(workflowSelectionRun.operationBlock.data.sourceAssetId, selectedCandidate.assetId);
assert.equal(
  workflowSelectionRun.execution.configuration?.imageInputs.find(
    (input) => input.inputSlotId === 'source_image',
  )?.assetId,
  selectedCandidate.assetId,
);
assert.deepEqual(
  workflowSelectionRun.execution.params?.inputBindings,
  [{
    assetId: selectedCandidate.assetId,
    blockId: staleCandidateBlock.blockId,
    inputSlotId: 'source_image',
  }],
);
assert.deepEqual(
  workflowSelectionRun.execution.inputBindingsSnapshot?.find(
    (binding) => binding.slotId === 'source_image',
  )?.values,
  [{
    artifactRevisionId: 'artrev_workflow_candidate_b',
    blockId: staleCandidateBlock.blockId,
    kind: 'artifact_revision',
  }],
);
assert.equal(
  (workflowSelectionRun.execution.params?.generation as { targetAspectRatio?: number })
    ?.targetAspectRatio,
  1.5,
  'Source-aware generation must use the accepted candidate dimensions.',
);
assert.equal(
  staleCandidateBlock.data.assetId,
  staleCandidate.assetId,
  'Resolving a Workflow selection must not rewrite the stable canvas projection.',
);
assert.equal(workflowSelectionRun.execution.workflowRunId, 'workflow_run_selected_input');
assert.equal(workflowSelectionRun.execution.stepRunId, 'step_run_workflow_character_sheet');
assert.equal(workflowSelectionRun.resultBlocks.length, 2);
assert.deepEqual(
  workflowSelectionRun.resultBlocks.map((block) => block.parentGroupId),
  [workflowGroup.blockId, workflowGroup.blockId],
  'Workflow candidates must stay as direct children of the Workflow Group.',
);
assert.deepEqual(
  workflowSelectionRun.resultBlocks.map((block) => block.data.workflowStepId),
  ['character_sheet', 'character_sheet'],
  'Every regenerated candidate must inherit its owning Workflow Step.',
);
assert.equal(
  workflowSelectionRun.resultBlocks[0]?.position.x,
  workflowSelectionRun.resultBlocks[1]?.position.x,
  'Candidates from the same Workflow Step must share the output column.',
);
assert.ok(
  (workflowSelectionRun.resultBlocks[1]?.position.y ?? 0)
    > (workflowSelectionRun.resultBlocks[0]?.position.y ?? 0),
  'Candidates from the same Workflow Step must stack vertically.',
);
assert.deepEqual(
  workflowSelectionSnapshot.workflowStepRuns?.find(
    (step) => step.stepRunId === 'step_run_workflow_character_sheet',
  )?.outputBlockIds,
  workflowSelectionRun.resultBlocks.map((block) => block.blockId),
);
assert.equal(
  workflowSelectionRun.execution.skillSnapshot
    && 'instructionTemplate' in workflowSelectionRun.execution.skillSnapshot
    ? workflowSelectionRun.execution.skillSnapshot.instructionTemplate
    : undefined,
  workflowCharacterSheetSkill.instructionTemplate,
);
configureSkillRegistry(originalSkills);

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
  workflowAcceptedOutputResolution: true,
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
