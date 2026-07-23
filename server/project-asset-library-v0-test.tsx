import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBlockRecord } from '../src/core/blockFactory';
import {
  assetIdsForBindingValue,
  compatibleArtifactInputSlots,
  insertArtifactReference,
} from '../src/core/artifactLibrary';
import { textDocumentInputBindings } from '../src/core/textOperations';
import { createVideoGenerationExecution } from '../src/core/videoGeneration';
import { ArtifactLibraryPanel } from '../src/components/ArtifactLibraryPanelView';
import type { BoardSnapshot } from '../src/core/types';
import { I18nProvider } from '../src/i18n';
import {
  promoteProjectAsset,
  readProjectArtifactLibrary,
} from './artifact-library-service';
import { createAssetFromDataUrl } from './local-store/asset-store';
import {
  loadSnapshot,
  resetWorkspace,
  saveSnapshot,
} from './local-store/snapshot-store';
import { createBoard } from './local-store/workspace-store';

let sourceBoard = await resetWorkspace();
const projectId = sourceBoard.project.projectId;
const firstImageAsset = await createAssetFromDataUrl({
  dataUrl: svgDataUrl('#2563eb'),
  fileName: 'hero-v1.svg',
  kind: 'image',
  projectId,
});
const firstImageBlock = addAssetBlock(
  sourceBoard,
  'image',
  firstImageAsset.assetId,
  'Hero reference',
);
sourceBoard.assets.push(firstImageAsset);
await saveSnapshot(sourceBoard);

const firstPromotion = await promoteProjectAsset({
  artifactType: 'character_reference',
  assetId: firstImageAsset.assetId,
  blockId: firstImageBlock.blockId,
  boardId: sourceBoard.board.boardId,
  expectedCurrentRevisionId: null,
  idempotencyKey: 'library-hero-v1',
  projectId,
  semanticKey: 'character_reference:hero',
});
assert.equal(firstPromotion.revision.revision, 1);

const secondImageAsset = await createAssetFromDataUrl({
  dataUrl: svgDataUrl('#16a34a'),
  fileName: 'hero-v2.svg',
  kind: 'image',
  projectId,
});
const secondImageBlock = addAssetBlock(
  sourceBoard,
  'image',
  secondImageAsset.assetId,
  'Hero reference v2',
);
sourceBoard.assets.push(secondImageAsset);
await saveSnapshot(sourceBoard);
const secondPromotion = await promoteProjectAsset({
  artifactType: 'character_reference',
  assetId: secondImageAsset.assetId,
  blockId: secondImageBlock.blockId,
  boardId: sourceBoard.board.boardId,
  expectedCurrentRevisionId: firstPromotion.revision.artifactRevisionId,
  idempotencyKey: 'library-hero-v2',
  projectId,
  semanticKey: 'character_reference:hero',
});
assert.equal(secondPromotion.artifact.artifactId, firstPromotion.artifact.artifactId);
assert.equal(secondPromotion.revision.revision, 2);

await assert.rejects(
  promoteProjectAsset({
    artifactType: 'screenplay_master',
    assetId: secondImageAsset.assetId,
    blockId: secondImageBlock.blockId,
    boardId: sourceBoard.board.boardId,
    expectedCurrentRevisionId: null,
    idempotencyKey: 'library-invalid-kind',
    projectId,
    semanticKey: 'screenplay_master:not-an-image',
  }),
  /not compatible with Asset kind image/,
);
await assert.rejects(
  promoteProjectAsset({
    artifactType: 'character_reference',
    assetId: secondImageAsset.assetId,
    blockId: secondImageBlock.blockId,
    boardId: sourceBoard.board.boardId,
    expectedCurrentRevisionId: secondPromotion.revision.artifactRevisionId,
    idempotencyKey: 'library-mismatched-source-revision',
    projectId,
    semanticKey: 'character_reference:hero',
    sourceArtifactRevisionId: firstPromotion.revision.artifactRevisionId,
  }),
  /source Revision does not match/,
);

const screenplayAsset = await createAssetFromDataUrl({
  dataUrl: 'data:text/markdown,%23%20Hero%20Screenplay',
  fileName: 'hero-screenplay.md',
  kind: 'document',
  projectId,
});
const screenplayBlock = addAssetBlock(
  sourceBoard,
  'document',
  screenplayAsset.assetId,
  'Hero screenplay',
);
sourceBoard.assets.push(screenplayAsset);
await saveSnapshot(sourceBoard);
const screenplayPromotion = await promoteProjectAsset({
  artifactType: 'screenplay_master',
  assetId: screenplayAsset.assetId,
  blockId: screenplayBlock.blockId,
  boardId: sourceBoard.board.boardId,
  expectedCurrentRevisionId: null,
  idempotencyKey: 'library-screenplay-v1',
  projectId,
  semanticKey: 'screenplay_master:hero-screenplay',
});

sourceBoard.executions.unshift({
  adapter: 'direct_api',
  boardId: sourceBoard.board.boardId,
  capabilityId: 'image.text_to_image',
  capabilityLock: {
    capabilityId: 'image.text_to_image',
    definitionHash: 'legacy:image.text_to_image:schema-v1',
    version: '0.1.0',
  },
  executionId: 'exec_library_generated_scene',
  inputAssetIds: [firstImageAsset.assetId],
  inputBlockIds: [firstImageBlock.blockId],
  outputAssetIds: [],
  outputBlockIds: [],
  outputSlotResults: [{ assetIds: [], slotId: 'images' }],
  params: { operationBlockId: 'operation_library_scene' },
  projectId,
  skillId: 'image.general_concept',
  skillSnapshot: {
    definitionHash: 'legacy:skill:image.general_concept:v1',
    skillId: 'image.general_concept',
    version: '0.1.0',
  },
  startedAt: '2026-07-23T00:00:00.000Z',
  status: 'running',
});
await saveSnapshot(sourceBoard);
const generatedSceneAsset = await createAssetFromDataUrl({
  dataUrl: svgDataUrl('#f97316'),
  fileName: 'generated-scene.svg',
  kind: 'image',
  projectId,
  sourceExecutionId: 'exec_library_generated_scene',
});
sourceBoard = await loadSnapshot(projectId, sourceBoard.board.boardId);
const generatedExecution = required(
  sourceBoard.executions.find((execution) => execution.executionId === 'exec_library_generated_scene'),
);
generatedExecution.outputAssetIds = [generatedSceneAsset.assetId];
generatedExecution.outputSlotResults = [{ assetIds: [generatedSceneAsset.assetId], slotId: 'images' }];
const generatedSceneBlock = addAssetBlock(
  sourceBoard,
  'image',
  generatedSceneAsset.assetId,
  'Generated scene',
);
await saveSnapshot(sourceBoard);
const generatedScenePromotion = await promoteProjectAsset({
  artifactType: 'scene_reference',
  assetId: generatedSceneAsset.assetId,
  blockId: generatedSceneBlock.blockId,
  boardId: sourceBoard.board.boardId,
  expectedCurrentRevisionId: null,
  idempotencyKey: 'library-generated-scene-v1',
  projectId,
  semanticKey: 'scene_reference:generated-scene',
});
assert.deepEqual(generatedScenePromotion.revision.sourceAssetIds, [firstImageAsset.assetId]);
assert.equal(
  generatedScenePromotion.revision.definitionLocks?.capability?.capabilityId,
  'image.text_to_image',
);
assert.equal(
  generatedScenePromotion.revision.definitionLocks?.skill?.skillId,
  'image.general_concept',
);
assert.equal(generatedScenePromotion.revision.sourceContext?.outputSlotId, 'images');

const library = await readProjectArtifactLibrary(projectId);
assert.equal(library.items.length, 3);
const heroItem = required(
  library.items.find((item) => item.artifact.artifactId === firstPromotion.artifact.artifactId),
);
assert.equal(heroItem.primaryAsset.assetId, secondImageAsset.assetId);
assert.deepEqual(heroItem.revisions.map((revision) => revision.revision), [2, 1]);
const screenplayItem = required(
  library.items.find((item) => item.artifact.artifactId === screenplayPromotion.artifact.artifactId),
);

const targetBoardResult = await createBoard({
  name: '[TEST] project asset library cross-board',
  projectId,
});
const targetBoard = targetBoardResult.snapshot;
const videoOperation = createBlockRecord(targetBoard, 'operation');
videoOperation.data = {
  ...videoOperation.data,
  capabilityId: 'video.generate',
  title: 'Generate video from project references',
};
targetBoard.blocks.push(videoOperation);
const compatibleSlots = compatibleArtifactInputSlots(targetBoard, videoOperation, heroItem);
assert.equal(compatibleSlots.some((slot) => slot.slotId === 'character_references'), true);
const heroReference = insertArtifactReference(targetBoard, {
  item: heroItem,
  position: { x: 80, y: 80 },
  targetOperationId: videoOperation.blockId,
  targetSlotId: 'character_references',
});
assert.equal(heroReference.data.artifactId, heroItem.artifact.artifactId);
assert.equal(heroReference.data.artifactRevisionId, secondPromotion.revision.artifactRevisionId);
assert.equal(heroReference.data.assetId, secondImageAsset.assetId);
assert.equal(
  targetBoard.assets.filter((asset) => asset.assetId === secondImageAsset.assetId).length,
  1,
);
assert.equal(
  targetBoard.edges.some((edge) =>
    edge.sourceBlockId === heroReference.blockId
    && edge.targetBlockId === videoOperation.blockId
    && edge.inputSlotId === 'character_references'
    && edge.inputRole === 'character_reference'),
  true,
);
assert.equal(
  compatibleArtifactInputSlots(targetBoard, videoOperation, heroItem)
    .some((slot) => slot.slotId === 'character_references'),
  true,
  'Many-cardinality project references remain available after one binding.',
);
const legacyOccupiedOperation = createBlockRecord(targetBoard, 'operation');
legacyOccupiedOperation.data = {
  ...legacyOccupiedOperation.data,
  capabilityId: 'video.generate',
  title: 'Legacy occupied slot',
};
targetBoard.blocks.push(legacyOccupiedOperation);
targetBoard.edges.push({
  edgeId: 'edge_legacy_first_frame',
  inputRole: 'first_frame',
  kind: 'execution_input',
  sourceBlockId: heroReference.blockId,
  targetBlockId: legacyOccupiedOperation.blockId,
});
assert.equal(
  compatibleArtifactInputSlots(targetBoard, legacyOccupiedOperation, heroItem)
    .some((slot) => slot.slotId === 'first_frame'),
  false,
  'A legacy role-only Edge still occupies a one-cardinality typed Slot.',
);

const videoTarget = createBlockRecord(targetBoard, 'video');
videoTarget.data.executionDraft = {
  schemaVersion: 1,
  capabilityId: 'video.generate',
  executionProfileId: 'video-mock',
  parameters: {
    aspectRatio: '9:16',
    durationSeconds: 8,
    outputCount: 1,
    qualityTier: 'preview',
  },
  prompt: 'Hero crosses the frame.',
};
targetBoard.blocks.push(videoTarget);
targetBoard.edges.push({
  edgeId: 'edge_library_reference_to_video',
  inputRole: 'character_reference',
  inputSlotId: 'character_references',
  kind: 'execution_input',
  sourceBlockId: heroReference.blockId,
  targetBlockId: videoTarget.blockId,
});
const videoExecution = createVideoGenerationExecution(targetBoard, {
  durationSeconds: 8,
  outputCount: 1,
  prompt: 'Hero crosses the frame.',
  targetBlockId: videoTarget.blockId,
});
const videoReferenceBinding = videoExecution.request.inputBindings.find(
  (binding) => binding.slotId === 'character_references',
);
assert.deepEqual(videoReferenceBinding?.values, [{
  artifactRevisionId: secondPromotion.revision.artifactRevisionId,
  blockId: heroReference.blockId,
  kind: 'artifact_revision',
}]);
assert.equal(videoExecution.execution.inputAssetIds.includes(secondImageAsset.assetId), true);

const screenplayOperation = createBlockRecord(targetBoard, 'operation');
screenplayOperation.data = {
  ...screenplayOperation.data,
  capabilityId: 'story.screenplay.normalize',
  title: 'Organize screenplay',
};
targetBoard.blocks.push(screenplayOperation);
const screenplayReference = insertArtifactReference(targetBoard, {
  item: screenplayItem,
  position: { x: 80, y: 420 },
  targetOperationId: screenplayOperation.blockId,
  targetSlotId: 'source_screenplay',
});
const screenplayBindings = textDocumentInputBindings(
  targetBoard,
  screenplayOperation.blockId,
  'story.screenplay.normalize',
  [screenplayReference],
);
assert.deepEqual(screenplayBindings, [{
  slotId: 'source_screenplay',
  values: [{
    artifactRevisionId: screenplayPromotion.revision.artifactRevisionId,
    blockId: screenplayReference.blockId,
    kind: 'artifact_revision',
  }],
}]);
assert.deepEqual(
  screenplayBindings.flatMap((binding) =>
    binding.values.flatMap((value) => assetIdsForBindingValue(targetBoard, value))),
  [screenplayAsset.assetId],
);

screenplayOperation.data.workflowProjectionId = 'workflow_projection_locked';
assert.deepEqual(
  compatibleArtifactInputSlots(targetBoard, screenplayOperation, screenplayItem),
  [],
  'Workflow projection topology is not mutated by manual Library binding.',
);
delete screenplayOperation.data.workflowProjectionId;
screenplayOperation.data.status = 'running';
assert.deepEqual(
  compatibleArtifactInputSlots(targetBoard, screenplayOperation, screenplayItem),
  [],
  'Running Operations cannot receive new Library bindings.',
);

await saveSnapshot(targetBoard);

const localStorageValues = new Map<string, string>([['retake.locale', 'en']]);
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => localStorageValues.get(key) ?? null,
    setItem: (key: string, value: string) => localStorageValues.set(key, value),
  },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'en-US' },
});
const operationPanelMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ArtifactLibraryPanel
      isLoading={false}
      isPromoting={false}
      library={library}
      selectedBlock={videoOperation}
      snapshot={targetBoard}
      onClose={() => undefined}
      onInsertReference={() => undefined}
      onPromoteSelectedAsset={() => undefined}
      onRefresh={() => undefined}
    />
  </I18nProvider>,
);
assert.match(operationPanelMarkup, /aria-label="Asset Library"/);
assert.match(operationPanelMarkup, /Generate video from project references/);
assert.match(operationPanelMarkup, /character_references/);
assert.match(operationPanelMarkup, /Add to board/);
assert.match(operationPanelMarkup, /Revisions 2/);

const promotionPanelMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ArtifactLibraryPanel
      isLoading={false}
      isPromoting={false}
      library={library}
      selectedBlock={secondImageBlock}
      snapshot={sourceBoard}
      onClose={() => undefined}
      onInsertReference={() => undefined}
      onPromoteSelectedAsset={() => undefined}
      onRefresh={() => undefined}
    />
  </I18nProvider>,
);
assert.match(promotionPanelMarkup, /Selected board asset/);
assert.match(promotionPanelMarkup, /Promote to project/);
assert.match(promotionPanelMarkup, /Character reference/);

const [appSource, topBarSource, panelCss] = await Promise.all([
  readFile('src/App.tsx', 'utf8'),
  readFile('src/components/TopBar.tsx', 'utf8'),
  readFile('src/components/artifact-library-panel.css', 'utf8'),
]);
assert.match(appSource, /lazy\(\(\) => import\('\.\/components\/ArtifactLibraryPanel'\)/);
assert.match(appSource, /setIsArtifactLibraryOpen\(false\)/);
assert.match(topBarSource, /label=\{t\('artifactLibrary\.open'\)\}/);
assert.match(panelCss, /content-visibility:\s*auto/);

console.log(JSON.stringify({
  ok: true,
  projectPromotionAndRevision: true,
  incompatiblePromotionRejected: true,
  crossBoardReferencePinned: true,
  typedSlotBinding: true,
  artifactRevisionResolvedToAsset: true,
  workflowAndRunningMutationGuard: true,
  libraryPanelContract: true,
  lazyLibraryPanel: true,
}));

function addAssetBlock(
  snapshot: BoardSnapshot,
  type: 'document' | 'image',
  assetId: string,
  title: string,
) {
  const block = createBlockRecord(snapshot, type);
  block.data = { ...block.data, assetId, title };
  snapshot.blocks.push(block);
  return block;
}

function required<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  return value as T;
}

function svgDataUrl(color: string): string {
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${color}"/></svg>`,
  )}`;
}
