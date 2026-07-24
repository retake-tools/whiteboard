import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBlockRecord } from '../src/core/blockFactory';
import {
  createImageComposerDraft,
  defaultImageComposerGenerationParams,
  imageComposerGenerationParams,
  listImageComposerReferenceOptions,
  type ImageComposerReferenceRole,
} from '../src/core/imageComposer';
import type { AssetRecord, BoardSnapshot } from '../src/core/types';
import { resetWorkspace } from './local-store/snapshot-store';

const [composerSource, controlsSource, providerSource] = await Promise.all([
  readFile(new URL('../src/components/SkillQuickInputComposer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ImageComposerControls.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/UnifiedComposerProvider.tsx', import.meta.url), 'utf8'),
]);

assert.match(composerSource, /<option value="image">/);
assert.doesNotMatch(composerSource, /<option value="image" disabled>/);
assert.match(composerSource, /listImageComposerReferenceOptions/);
assert.match(composerSource, /onCreateImageDraft/);
assert.match(composerSource, /resetImageSubmission/);
assert.match(controlsSource, /image\.text_to_image/);
assert.match(controlsSource, /currentExecutionProviderSettings/);
assert.match(controlsSource, /imageComposerAspectRatios/);
assert.match(controlsSource, /imageComposerResolutions/);
assert.match(providerSource, /composerMode/);
assert.match(providerSource, /imageReferenceRoles/);

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
      mention: { kind: 'block', blockId: referenceBlock.blockId, slotId: 'references' },
      role: 'character_reference',
    },
    {
      mention: { kind: 'asset', assetId: secondAsset.assetId, slotId: 'references' },
      role: 'style_reference',
    },
  ],
  slotBlockId: outputSlot.blockId,
  textBlockTitle: '提示词',
});

assert.equal(result.operationBlock.data.capabilityId, 'image.text_to_image');
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
assert.ok(snapshot.edges.some((edge) =>
  edge.sourceBlockId === referenceBlock.blockId
  && edge.targetBlockId === result.operationBlock.blockId
  && edge.inputRole === 'character_reference'));
assert.ok(snapshot.edges.some((edge) =>
  edge.sourceBlockId === result.referenceBlockIds[1]
  && edge.targetBlockId === result.operationBlock.blockId
  && edge.inputRole === 'style_reference'));
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
    mention: { kind: 'asset', assetId: foreignAsset.assetId, slotId: 'references' },
    role: 'general_reference',
  }],
  textBlockTitle: '提示词',
}), /reference is invalid/);
assert.equal(invalidSnapshot.blocks.length, initialBlockCount);

const invalidRole = 'source' as ImageComposerReferenceRole;
const roleSnapshot = await emptySnapshot();
const roleAsset = imageAsset(roleSnapshot, 'asset_invalid_role');
roleSnapshot.assets.push(roleAsset);
assert.throws(() => createImageComposerDraft(roleSnapshot, {
  connectionId: 'codex-managed',
  generationParams: defaultImageComposerGenerationParams(),
  instruction: '测试',
  operationTitle: '生成图片',
  references: [{
    mention: { kind: 'asset', assetId: roleAsset.assetId, slotId: 'references' },
    role: invalidRole,
  }],
  textBlockTitle: '提示词',
}), /role is invalid/);
assert.equal(roleSnapshot.blocks.length, 0);

console.log(JSON.stringify({
  ok: true,
  imageModeEnabled: true,
  typedImageReferences: true,
  explicitConnection: true,
  normalizedGenerationParameters: true,
  operationDraftOnly: true,
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
