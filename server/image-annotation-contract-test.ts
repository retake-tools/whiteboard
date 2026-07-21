import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  annotationColorOptions,
  annotationDraftContentEquals,
  annotationDraftHasContent,
  annotationDraftMatches,
  annotationManifestFromDraft,
  annotationMarksMissingIntent,
  compileAnnotationInstruction,
  hasExecutableAnnotationIntent,
  nextAnnotationMarkId,
  type AnnotationDraft,
  type AnnotationManifest,
} from '../src/core/imageAnnotations';
import {
  annotationEditControlsFromManifest,
  readAnnotationEditControlManifest,
} from '../src/core/annotationEditControls';
import { addImageCodexOperation, executeExistingImageOperationBlock } from '../src/core/imageOperations';
import { schemaForCapability } from '../src/core/capabilities';
import { generationParamsForSchema } from '../src/nodes/OperationInlineControls';
import { createFlowNodes } from '../src/core/flowProjection';
import {
  annotationDraftRestoreContext,
} from '../src/core/restoreAnnotationDraft';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type { AssetRecord, BlockRecord } from '../src/core/types';

assert.deepEqual(
  annotationColorOptions.map((option) => option.name),
  ['red', 'yellow', 'green', 'blue', 'purple'],
);
assert.equal(new Set(annotationColorOptions.map((option) => option.value)).size, 5);
assert.deepEqual(
  generationParamsForSchema(
    {
      aspectRatioPreset: '9:16',
      durationSeconds: 6,
      motion: 'auto',
      strength: 0.65,
      targetAspectRatio: 9 / 16,
      targetHeight: 2048,
      targetResolution: '2K',
      targetWidth: 1152,
      variationCount: 2,
    },
    schemaForCapability('image.annotation_edit').paramsSchema,
  ),
  { variationCount: 2 },
);

const editorSource = await readFile('src/components/ImageAnnotationEditor.tsx', 'utf8');
const geometrySource = await readFile('src/components/imageAnnotationGeometry.ts', 'utf8');
const compositeSource = await readFile('src/components/imageAnnotationComposite.ts', 'utf8');
const overlaySource = await readFile('src/components/ImageAnnotationOverlay.tsx', 'utf8');
const controlsSource = await readFile('src/components/ImageAnnotationControls.tsx', 'utf8');
const annotationControllerSource = await readFile('src/app/useAnnotationController.ts', 'utf8');
const toolbarSource = await readFile('src/components/ContextToolbar.tsx', 'utf8');
const canvasSource = await readFile('src/app/WhiteboardCanvas.tsx', 'utf8');
const blockNodeSource = await readFile('src/nodes/BlockNode.tsx', 'utf8');
const annotationOperationPreviewSource = await readFile('src/nodes/AnnotationOperationPreviewButton.tsx', 'utf8');
const operationControlsSource = await readFile('src/nodes/OperationInlineControls.tsx', 'utf8');
const executionDetailSource = await readFile('src/components/ExecutionDetailContent.tsx', 'utf8');
const executionInspectorSource = await readFile('src/components/ExecutionInspector.tsx', 'utf8');
const historyPanelSource = await readFile('src/components/BoardHistoryPanel.tsx', 'utf8');
const annotationEditorStylesSource = await readFile('src/styles/annotation-editor.css', 'utf8');
const annotationControlStylesSource = await readFile('src/styles/annotation-controls.css', 'utf8');
assert.doesNotMatch(
  editorSource,
  /annotation-current-color/,
  'annotation colors should only be edited from the selected-mark controls',
);
assert.match(editorSource, /fixedShapeYScale={renderMetrics\.displayWidth \/ renderMetrics\.displayHeight}/);
assert.match(controlsSource, /disabled={!selectedMark}/);
assert.match(controlsSource, /<textarea[\s\S]*?data-mark-id=\{mark\.id\}[\s\S]*?rows=\{2\}/);
assert.match(editorSource, /onDraftChangeRef\.current/);
assert.match(editorSource, /onInstructionChange\(''\)/);
assert.match(editorSource, /hoveredMarkId/);
assert.match(overlaySource, /function AnnotationQuickDelete/);
assert.match(editorSource, /function selectMarkFromList/);
assert.match(geometrySource, /function annotationMarkFocusPoint/);
assert.match(controlsSource, /function markColorLabel/);
assert.match(controlsSource, /aria-label={`\$\{markColorLabel\(option, t\)\} · \$\{option\}`}/);
assert.match(editorSource, /setViewPan\(clampImageViewPan\(metrics, viewZoom, nextPan\)\)/);
assert.match(overlaySource, /vectorEffect="non-scaling-stroke"/);
assert.match(overlaySource, /startXEndY/);
assert.match(editorSource, /function supportedInitialMarks/);
assert.match(editorSource, /function annotationHoverPromptStyle/);
assert.match(geometrySource, /function annotationBrushStrokeWidthPixels/);
assert.match(editorSource, /brushStrokeWidth={annotationBrushStrokeWidthPixels\(/);
assert.match(compositeSource, /context\.lineWidth = annotationBrushStrokeWidthPixels\(mark\.strokeSize, width, height\)/);
assert.doesNotMatch(editorSource, /mark\.kind === 'brush' \? screenStrokeWidth \* 9/);
assert.doesNotMatch(editorSource, /Math\.max\(context\.lineWidth \* 9/);
assert.match(editorSource, /hoveredMark\?\.intent\.trim\(\)/);
assert.match(editorSource, /className="annotation-result-count"/);
assert.match(editorSource, /variationCount/);
assert.match(canvasSource, /generationParams: \{ variationCount \}/);
assert.match(editorSource, /closest\('\.annotation-stage'\)/);
assert.doesNotMatch(editorSource, /closest\('\.annotation-editor'\).*preventDefault/);
assert.match(annotationEditorStylesSource, /\.annotation-hover-prompt \{[\s\S]*?pointer-events: none;/);
assert.match(annotationControlStylesSource, /\.annotation-side-panel \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/);
assert.match(annotationControlStylesSource, /\.annotation-run-controls > \.primary-popover-button \{[\s\S]*?background: var\(--retake-accent\);/);
assert.doesNotMatch(editorSource, /diamondPath/);
assert.doesNotMatch(editorSource, /handleStageDoubleClick|createMark\('text'|annotation-label-input|textMarkTool/);
assert.match(annotationControllerSource, /function updateAnnotationDraft/);
assert.match(annotationControllerSource, /scheduleAnnotationDraftPersist\(\)/);
assert.match(toolbarSource, /initialDraft={annotationDraft}/);
assert.match(executionDetailSource, /function AnnotationManifestDetail/);
assert.match(executionDetailSource, /inspector\.restoreAnnotationDraft/);
assert.match(executionInspectorSource, /onOpenAnnotationEditor\(context\.execution\.executionId\)/);
assert.match(toolbarSource, /setActiveTool\('annotation-edit'\)/);
assert.match(annotationControllerSource, /setAnnotationEditorOpenRequest\(/);
assert.match(canvasSource, /updateAnnotationDraft\(selectedBlock\.blockId, \{ schemaVersion: 1, globalInstruction: '', marks: \[\] \}\)/);
assert.match(blockNodeSource, /AnnotationOperationPreviewButton/);
assert.match(annotationOperationPreviewSource, /retake:open-annotation-editor/);
assert.match(operationControlsSource, /generationParamsForSchema\(nextParams, paramsSchema\)/);
assert.match(operationControlsSource, /selectedConnection\.connectorId === 'codex-managed'/);
assert.match(operationControlsSource, /operationToolbar\.generateImage/);
assert.match(blockNodeSource, /onCompositionStart/);
assert.match(blockNodeSource, /if \(!composingRef\.current\) dispatchPreviewTextBlock/);
assert.doesNotMatch(annotationControllerSource, /window\.confirm\(t\('inspector\.annotationDraftRestoreConfirm'\)\)/);
assert.match(toolbarSource, /historicalAnnotationDraft \?\? annotationDraftForBlock/);
assert.match(toolbarSource, /if \(historicalAnnotationDraft\)[\s\S]*?setHistoricalAnnotationDraft/);
assert.match(toolbarSource, /isHistoricalAnnotationSession=\{Boolean\(historicalAnnotationDraft\)\}/);
assert.match(toolbarSource, /annotation-history-session-notice/);
assert.match(toolbarSource, /context\.historicalAnnotationSessionBody/);
assert.match(historyPanelSource, /onOpenAnnotationEditor/);

const manifest: AnnotationManifest = {
  schemaVersion: 1,
  globalInstruction: 'Keep the surrounding room unchanged.',
  marks: [
    {
      id: 'R1',
      kind: 'rect',
      color: '#dc2626',
      strokeSize: 'm',
      intent: 'Replace the cup with a small green plant.',
      start: { x: 0.2, y: 0.3 },
      end: { x: 0.4, y: 0.6 },
    },
    {
      id: 'A1',
      kind: 'arrow',
      color: '#2563eb',
      strokeSize: 'm',
      intent: 'Move the plant to the arrow endpoint.',
      start: { x: 0.4, y: 0.5 },
      end: { x: 0.7, y: 0.5 },
    },
  ],
};

const prompt = compileAnnotationInstruction(manifest);
assert.match(prompt, /R1: red rectangle/);
assert.match(prompt, /A1: blue directional arrow/);
assert.match(prompt, /R1:[\s\S]*geometry: rectangle region; center \(x 30\.0%, y 45\.0%\)/);
assert.match(
  prompt,
  /A1:[\s\S]*start \(x 40\.0%, y 50\.0%\); end \(x 70\.0%, y 50\.0%\); delta \(\+30\.0% x, \+0\.0% y\)/,
);
assert.match(prompt, /Geometry coordinates are normalized to the clean source image/);
assert.match(prompt, /Replace the cup with a small green plant/);
assert.match(prompt, /Keep the surrounding room unchanged/);
assert.match(prompt, /Annotation colors identify marks only/);
assert.match(prompt, /the tail is the start and the arrowhead is the destination or direction/);
assert.match(prompt, /without annotation IDs/);
assert.equal(hasExecutableAnnotationIntent(manifest), true);
assert.deepEqual(annotationMarksMissingIntent(manifest), []);
assert.equal(nextAnnotationMarkId(manifest.marks, 'rect'), 'R2');
assert.equal(nextAnnotationMarkId(manifest.marks, 'brush'), 'B1');

const editControls = annotationEditControlsFromManifest(manifest);
assert.equal(editControls.coordinateSpace, 'normalized_source_image');
assert.deepEqual(editControls.controls[0], {
  markId: 'R1',
  sourceKind: 'rect',
  controlType: 'region',
  shape: 'rectangle',
  bounds: { x: 0.2, y: 0.3, width: 0.2, height: 0.3 },
  center: { x: 0.3, y: 0.45 },
});
assert.deepEqual(editControls.controls[1], {
  markId: 'A1',
  sourceKind: 'arrow',
  controlType: 'vector',
  start: { x: 0.4, y: 0.5 },
  end: { x: 0.7, y: 0.5 },
  delta: { x: 0.3, y: 0 },
});
assert.deepEqual(readAnnotationEditControlManifest(JSON.parse(JSON.stringify(editControls))), editControls);
assert.equal(
  readAnnotationEditControlManifest({ ...editControls, coordinateSpace: 'display_pixels' }),
  undefined,
);

const mixedGeometryControls = annotationEditControlsFromManifest({
  schemaVersion: 1,
  globalInstruction: '',
  marks: [
    {
      id: 'M1', kind: 'marker', color: '#facc15', strokeSize: 'm', intent: '',
      point: { x: 0.1, y: 0.2 },
    },
    {
      id: 'C1', kind: 'ellipse', color: '#22c55e', strokeSize: 'm', intent: '',
      start: { x: 0.8, y: 0.7 }, end: { x: 0.4, y: 0.3 },
    },
    {
      id: 'B1', kind: 'brush', color: '#a855f7', strokeSize: 'l', intent: '',
      points: [{ x: 0.2, y: 0.4 }, { x: 0.5, y: 0.8 }],
    },
  ],
});
assert.deepEqual(
  mixedGeometryControls.controls.map((control) => control.controlType),
  ['point', 'region', 'region'],
);
assert.deepEqual(mixedGeometryControls.controls[1], {
  markId: 'C1',
  sourceKind: 'ellipse',
  controlType: 'region',
  shape: 'ellipse',
  bounds: { x: 0.4, y: 0.3, width: 0.4, height: 0.4 },
  center: { x: 0.6, y: 0.5 },
});
assert.deepEqual(mixedGeometryControls.controls[2], {
  markId: 'B1',
  sourceKind: 'brush',
  controlType: 'region',
  shape: 'brush',
  bounds: { x: 0.2, y: 0.4, width: 0.3, height: 0.4 },
  center: { x: 0.35, y: 0.6 },
  points: [{ x: 0.2, y: 0.4 }, { x: 0.5, y: 0.8 }],
  strokeSize: 'l',
});

const draft: AnnotationDraft = {
  ...annotationManifestFromDraft(manifest),
  sourceAssetId: 'asset_annotation_source',
  updatedAt: '2026-07-17T00:00:00.000Z',
};
assert.equal(annotationDraftHasContent(draft), true);
assert.equal(annotationDraftMatches(draft, draft.sourceAssetId), true);
assert.equal(annotationDraftMatches(draft, 'asset_replaced'), false);
assert.equal(annotationDraftContentEquals(draft, manifest), true);
const frozenManifest = annotationManifestFromDraft(draft);
draft.marks[0].intent = 'This later draft edit must not mutate the execution snapshot.';
assert.notEqual(draft.marks[0].intent, frozenManifest.marks[0].intent);

const incomplete: AnnotationManifest = {
  schemaVersion: 1,
  globalInstruction: '',
  marks: [{ ...manifest.marks[0], intent: '' }],
};
assert.equal(hasExecutableAnnotationIntent(incomplete), false);
assert.deepEqual(annotationMarksMissingIntent(incomplete), ['R1']);

const addExactText: AnnotationManifest = {
  schemaVersion: 1,
  globalInstruction: '',
  marks: [{
    id: 'R2',
    kind: 'rect',
    color: '#a855f7',
    strokeSize: 'm',
    intent: 'Add the exact text "Retake Studio" inside this sign and preserve the sign material.',
    start: { x: 0.35, y: 0.4 },
    end: { x: 0.65, y: 0.6 },
  }],
};
assert.equal(hasExecutableAnnotationIntent(addExactText), true);
assert.match(compileAnnotationInstruction(addExactText), /Add the exact text "Retake Studio"/);
assert.match(compileAnnotationInstruction(addExactText), /preserve the sign material/);

const snapshot = structuredClone(defaultSnapshot);
const sourceAsset: AssetRecord = {
  assetId: 'asset_annotation_source',
  projectId: snapshot.project.projectId,
  kind: 'image',
  mimeType: 'image/png',
  storageProvider: 'local_mock',
  storageKey: 'local-mock://annotation-source.png',
  previewUrl: 'data:image/png;base64,source',
  width: 800,
  height: 600,
  createdAt: '2026-07-16T00:00:00.000Z',
};
const compositeAsset: AssetRecord = {
  ...sourceAsset,
  assetId: 'asset_annotation_composite',
  storageKey: 'local-mock://annotation-composite.png',
  previewUrl: 'data:image/png;base64,composite',
};
const sourceBlock: BlockRecord = {
  blockId: 'block_annotation_source',
  boardId: snapshot.board.boardId,
  type: 'image',
  layerId: 'layer_default',
  position: { x: 0, y: 0 },
  size: { width: 320, height: 240 },
  zIndex: 20,
  data: { title: 'Source image', assetId: sourceAsset.assetId, annotationDraft: draft },
  createdAt: sourceAsset.createdAt,
  updatedAt: sourceAsset.createdAt,
};
snapshot.assets.unshift(sourceAsset);
snapshot.blocks.push(sourceBlock);
const nearbyBlocker: BlockRecord = {
  blockId: 'block_annotation_result_blocker',
  boardId: snapshot.board.boardId,
  type: 'text',
  layerId: 'layer_default',
  position: { x: 760, y: -80 },
  size: { width: 1100, height: 400 },
  zIndex: 21,
  data: { title: 'Nearby occupied area', body: '' },
  createdAt: sourceAsset.createdAt,
  updatedAt: sourceAsset.createdAt,
};
snapshot.blocks.push(nearbyBlocker);
const persistedManifest = { ...frozenManifest, compositeAssetId: compositeAsset.assetId };
const operation = addImageCodexOperation(snapshot, {
  operation: 'annotation_edit',
  sourceBlockId: sourceBlock.blockId,
  instruction: prompt,
  annotatedCompositeAsset: compositeAsset,
  annotationManifest: persistedManifest,
  generationParams: { variationCount: 3 },
});
assert.deepEqual(operation.operationBlock.data.annotationManifest, persistedManifest);
assert.deepEqual(operation.execution.params?.annotationManifest, persistedManifest);
assert.deepEqual(operation.execution.params?.annotationEditControls, editControls);
assert.match(operation.execution.prompt ?? '', /R1: red rectangle/);
assert.match(operation.prompt, /annotated composite/);
assert.equal(operation.resultBlocks.length, 3);
assert.equal(operation.execution.params?.generation && (operation.execution.params.generation as { variationCount?: number }).variationCount, 3);
assert.equal(operation.resultBlock.data.body, 'Waiting for Codex to generate an image result.');
assert.doesNotMatch(operation.resultBlock.data.body ?? '', /R1: red rectangle/);
const annotationOperationNode = createFlowNodes(snapshot).find((node) => node.id === operation.operationBlock.blockId);
assert.equal(annotationOperationNode?.data.annotatedCompositePreviewUrl, compositeAsset.previewUrl);
assert.equal(annotationOperationNode?.data.annotationMarkCount, persistedManifest.marks.length);
const operationResultGroup = snapshot.blocks.find(
  (block) => block.type === 'group' && block.data.groupExecutionId === operation.execution.executionId,
);
assert.ok(operationResultGroup);
assert.equal(rectanglesOverlap(operationResultGroup, nearbyBlocker, 28), false);
operation.operationBlock.data.status = 'succeeded';
operation.execution.status = 'succeeded';
operation.resultBlocks.forEach((resultBlock, index) => {
  resultBlock.data.assetId = `asset_annotation_result_${index + 1}`;
  resultBlock.data.status = 'succeeded';
});
const repeatedOperation = executeExistingImageOperationBlock(snapshot, {
  operationBlockId: operation.operationBlock.blockId,
  operation: 'text_to_image',
  instruction: '',
  generationParams: { variationCount: 2 },
});
assert.equal(repeatedOperation.execution.capabilityId, 'image.annotation_edit');
assert.equal(repeatedOperation.resultBlocks.length, 2);
assert.deepEqual(repeatedOperation.execution.inputBlockIds, [sourceBlock.blockId]);
assert.deepEqual(repeatedOperation.execution.params?.annotationManifest, persistedManifest);
assert.match(repeatedOperation.prompt, /annotated composite/);
sourceBlock.data.annotationDraft!.marks[0].intent = 'Continue editing after execution.';
assert.notEqual(
  sourceBlock.data.annotationDraft!.marks[0].intent,
  (operation.execution.params?.annotationManifest as AnnotationManifest).marks[0].intent,
);

const restoreContext = annotationDraftRestoreContext(snapshot, operation.execution);
assert.equal(restoreContext.state, 'available');
assert.equal(restoreContext.sourceBlock?.blockId, sourceBlock.blockId);
const retiredTextExecution = structuredClone(operation.execution);
retiredTextExecution.executionId = 'execution_retired_text_annotation';
retiredTextExecution.params = {
  ...retiredTextExecution.params,
  operationBlockId: 'missing_operation_block',
  annotationManifest: {
    schemaVersion: 1,
    globalInstruction: '',
    marks: [{
      id: 'T1',
      kind: 'text',
      color: '#dc2626',
      strokeSize: 'm',
      intent: 'Legacy text note',
      point: { x: 0.5, y: 0.5 },
      text: 'Legacy text note',
      textMode: 'annotation_note',
    }],
  },
};
assert.equal(annotationDraftRestoreContext(snapshot, retiredTextExecution).state, 'manifest_missing');
const legacyManifestSnapshot = structuredClone(snapshot);
delete legacyManifestSnapshot.executions[0].params!.annotationManifest;
assert.equal(
  annotationDraftRestoreContext(legacyManifestSnapshot, legacyManifestSnapshot.executions[0]).state,
  'available',
);
const restoreSnapshot = structuredClone(snapshot);
const restoredSourceBlock = restoreSnapshot.blocks.find((block) => block.blockId === sourceBlock.blockId)!;
restoredSourceBlock.data.assetId = 'asset_replaced_after_execution';
assert.equal(
  annotationDraftRestoreContext(restoreSnapshot, restoreSnapshot.executions[0]).state,
  'source_replaced',
);

function rectanglesOverlap(left: BlockRecord, right: BlockRecord, gap: number): boolean {
  return !(
    left.position.x + left.size.width + gap <= right.position.x ||
    right.position.x + right.size.width + gap <= left.position.x ||
    left.position.y + left.size.height + gap <= right.position.y ||
    right.position.y + right.size.height + gap <= left.position.y
  );
}

console.log({
  markCount: manifest.marks.length,
  persistedExecutionId: operation.execution.executionId,
  promptLines: prompt.split('\n').length,
});
