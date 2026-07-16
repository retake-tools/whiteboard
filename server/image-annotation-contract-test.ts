import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  annotationColorOptions,
  annotationMarksMissingIntent,
  compileAnnotationInstruction,
  hasExecutableAnnotationIntent,
  nextAnnotationMarkId,
  type AnnotationManifest,
} from '../src/core/imageAnnotations';
import { addImageCodexOperation } from '../src/core/imageOperations';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type { AssetRecord, BlockRecord } from '../src/core/types';

assert.deepEqual(
  annotationColorOptions.map((option) => option.name),
  ['red', 'yellow', 'green', 'blue', 'purple'],
);
assert.equal(new Set(annotationColorOptions.map((option) => option.value)).size, 5);

const editorSource = await readFile('src/components/ImageAnnotationEditor.tsx', 'utf8');
assert.doesNotMatch(
  editorSource,
  /annotation-current-color/,
  'annotation colors should only be edited from the selected-mark controls',
);
assert.match(editorSource, /fixedShapeYScale={renderMetrics\.displayWidth \/ renderMetrics\.displayHeight}/);
assert.match(editorSource, /disabled={!selectedMark}/);

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
assert.match(prompt, /Replace the cup with a small green plant/);
assert.match(prompt, /Keep the surrounding room unchanged/);
assert.match(prompt, /without annotation IDs/);
assert.equal(hasExecutableAnnotationIntent(manifest), true);
assert.deepEqual(annotationMarksMissingIntent(manifest), []);
assert.equal(nextAnnotationMarkId(manifest.marks, 'rect'), 'R2');
assert.equal(nextAnnotationMarkId(manifest.marks, 'brush'), 'B1');

const incomplete: AnnotationManifest = {
  schemaVersion: 1,
  globalInstruction: '',
  marks: [{ ...manifest.marks[0], intent: '' }],
};
assert.equal(hasExecutableAnnotationIntent(incomplete), false);
assert.deepEqual(annotationMarksMissingIntent(incomplete), ['R1']);

const renderText: AnnotationManifest = {
  schemaVersion: 1,
  globalInstruction: '',
  marks: [{
    id: 'T1',
    kind: 'text',
    color: '#a855f7',
    strokeSize: 'm',
    intent: '',
    point: { x: 0.5, y: 0.5 },
    text: 'Retake Studio',
    textMode: 'render_text',
  }],
};
assert.equal(hasExecutableAnnotationIntent(renderText), true);
assert.match(compileAnnotationInstruction(renderText), /Render this exact text/);

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
  data: { title: 'Source image', assetId: sourceAsset.assetId },
  createdAt: sourceAsset.createdAt,
  updatedAt: sourceAsset.createdAt,
};
snapshot.assets.unshift(sourceAsset);
snapshot.blocks.push(sourceBlock);
const persistedManifest = { ...manifest, compositeAssetId: compositeAsset.assetId };
const operation = addImageCodexOperation(snapshot, {
  operation: 'annotation_edit',
  sourceBlockId: sourceBlock.blockId,
  instruction: prompt,
  annotatedCompositeAsset: compositeAsset,
  annotationManifest: persistedManifest,
});
assert.deepEqual(operation.operationBlock.data.annotationManifest, persistedManifest);
assert.deepEqual(operation.execution.params?.annotationManifest, persistedManifest);
assert.match(operation.execution.prompt ?? '', /R1: red rectangle/);
assert.match(operation.prompt, /annotated composite/);

console.log({
  markCount: manifest.marks.length,
  persistedExecutionId: operation.execution.executionId,
  promptLines: prompt.split('\n').length,
});
