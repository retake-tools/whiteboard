import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import {
  annotationEditControlsFromManifest,
  readAnnotationEditControlManifest,
} from '../src/core/annotationEditControls';
import type { AnnotationManifest } from '../src/core/imageAnnotations';
import {
  annotationDraftRestoreContext,
  annotationManifestFromUnknown,
} from '../src/core/restoreAnnotationDraft';
import { createFlowNodes } from '../src/core/flowProjection';
import { pluginHostBoundScope } from '../src/core/pluginHostScope';
import { defaultSnapshot } from '../src/core/sampleBoard';
import type {
  AssetRecord,
  BlockRecord,
  ExecutionRecord,
} from '../src/core/types';

const removedAuthoringFiles = [
  'src/app/useAnnotationController.ts',
  'src/components/ImageAnnotationControls.tsx',
  'src/components/ImageAnnotationEditor.tsx',
  'src/components/ImageAnnotationOverlay.tsx',
  'src/components/imageAnnotationComposite.ts',
  'src/components/imageAnnotationGeometry.ts',
  'src/nodes/AnnotationOperationPreviewButton.tsx',
  'src/styles/annotation-controls.css',
  'src/styles/annotation-editor.css',
];
for (const path of removedAuthoringFiles) {
  await assert.rejects(
    access(path),
    undefined,
    `${path} must remain outside Whiteboard Core after P10.5D`,
  );
}

const toolbarSource = await readFile(
  'src/components/ContextToolbar.tsx',
  'utf8',
);
const canvasSource = await readFile(
  'src/app/WhiteboardCanvas.tsx',
  'utf8',
);
const blockNodeSource = await readFile(
  'src/nodes/BlockNode.tsx',
  'utf8',
);
const executionDetailSource = await readFile(
  'src/components/ExecutionDetailContent.tsx',
  'utf8',
);
const appEventBindingsSource = await readFile(
  'src/app/useAppEventBindings.ts',
  'utf8',
);
const capabilitySource = await readFile(
  'src/core/capabilities.ts',
  'utf8',
);
const annotationModelSource = await readFile(
  'src/core/imageAnnotations.ts',
  'utf8',
);
const pluginDraftSource = await readFile(
  'src/app/usePluginDraftController.ts',
  'utf8',
);
const annotationOperationControlsSource = await readFile(
  'src/nodes/AnnotationOperationInlineControls.tsx',
  'utf8',
);
const operationInlineControlsStyles = await readFile(
  'src/nodes/operation-inline-controls.css',
  'utf8',
);

assert.doesNotMatch(toolbarSource, /annotation-edit|ImageAnnotationEditor/);
assert.doesNotMatch(canvasSource, /onRunAnnotationEdit|annotationController/);
assert.doesNotMatch(blockNodeSource, /AnnotationOperationPreviewButton/);
assert.doesNotMatch(appEventBindingsSource, /retake:open-annotation-editor/);
assert.doesNotMatch(
  capabilitySource,
  /'image\.annotation_edit':\s*\{/,
  'Whiteboard must not own an active Annotation Capability schema',
);
assert.doesNotMatch(
  annotationModelSource,
  /compileAnnotationInstruction|nextAnnotationMarkId/,
  'Whiteboard keeps legacy data types, not Annotation authoring behavior',
);
assert.match(executionDetailSource, /function AnnotationManifestDetail/);
assert.match(executionDetailSource, /PluginOperationInspectorActions/);
assert.doesNotMatch(executionDetailSource, /onOpenAnnotationEditor/);
assert.match(pluginDraftSource, /block\.data\.annotationDraft/);
assert.match(pluginDraftSource, /legacy: true/);
assert.match(
  annotationOperationControlsSource,
  /operation-param-popover/,
  'Annotation result count must use the same parameter popover pattern as other Operations',
);
assert.doesNotMatch(
  annotationOperationControlsSource,
  /<select/,
  'Annotation result count must not render as a direct select control',
);
assert.match(
  annotationOperationControlsSource,
  /operation-param-popover is-count-only/,
  'Annotation count popover must opt into the compact parameter layout',
);
assert.match(
  operationInlineControlsStyles,
  /\.operation-param-popover\.is-count-only\s*\{[\s\S]*width:\s*188px/,
  'The count-only parameter popover must remain compact',
);
assert.match(
  blockNodeSource,
  /operationInputTargetCapabilityId === 'image\.annotation_edit'/,
  'Annotation source inputs must hide the redundant source-role badge',
);

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
assert.deepEqual(annotationManifestFromUnknown(manifest), manifest);
assert.equal(annotationManifestFromUnknown({
  ...manifest,
  marks: [{ ...manifest.marks[0], color: '#000000' }],
}), undefined);

const editControls = annotationEditControlsFromManifest(manifest);
assert.deepEqual(editControls.controls.map(
  (control) => control.controlType,
), ['region', 'vector']);
assert.deepEqual(
  readAnnotationEditControlManifest(
    JSON.parse(JSON.stringify(editControls)),
  ),
  editControls,
);

const snapshot = structuredClone(defaultSnapshot);
const createdAt = '2026-07-27T00:00:00.000Z';
const sourceAsset = imageAsset(
  snapshot.project.projectId,
  'asset.annotation-source',
  createdAt,
);
const compositeAsset = imageAsset(
  snapshot.project.projectId,
  'asset.annotation-composite',
  createdAt,
);
const sourceBlock = imageBlock(
  snapshot.board.boardId,
  sourceAsset,
  'block.annotation-source',
  createdAt,
);
const operationBlock: BlockRecord = {
  blockId: 'block.annotation-operation',
  boardId: snapshot.board.boardId,
  createdAt,
  data: {
    annotatedCompositeAssetId: compositeAsset.assetId,
    annotationManifest: manifest,
    annotationText: 'Compiled by Image Studio.',
    capabilityId: 'image.annotation_edit',
    sourceAssetId: sourceAsset.assetId,
    sourceBlockId: sourceBlock.blockId,
    sourceExecutionId: 'exec.annotation',
    status: 'succeeded',
    title: 'Annotation Edit',
  },
  layerId: 'layer_default',
  position: { x: 420, y: 0 },
  size: { width: 320, height: 190 },
  type: 'operation',
  updatedAt: createdAt,
  zIndex: 21,
};
const execution: ExecutionRecord = {
  adapter: 'mcp_agent',
  boardId: snapshot.board.boardId,
  capabilityId: 'image.annotation_edit',
  executionId: 'exec.annotation',
  inputAssetIds: [sourceAsset.assetId, compositeAsset.assetId],
  inputBindingsSnapshot: [
    {
      slotId: 'source_image',
      values: [{ blockId: sourceBlock.blockId, kind: 'block' }],
    },
    {
      slotId: 'annotated_composite',
      values: [{ assetId: compositeAsset.assetId, kind: 'asset' }],
    },
    {
      slotId: 'prompt',
      values: [{ kind: 'inline', value: 'Compiled by Image Studio.' }],
    },
  ],
  inputBlockIds: [sourceBlock.blockId],
  outputAssetIds: [],
  outputBlockIds: [],
  params: {
    inputBindings: [
      {
        assetId: sourceAsset.assetId,
        blockId: sourceBlock.blockId,
        inputRole: 'source',
      },
      {
        assetId: compositeAsset.assetId,
        inputRole: 'annotated_composite',
      },
    ],
    operationBlockId: operationBlock.blockId,
    pluginParameters: { manifest },
  },
  projectId: snapshot.project.projectId,
  startedAt: createdAt,
  status: 'succeeded',
};
snapshot.assets.unshift(sourceAsset, compositeAsset);
snapshot.blocks.push(sourceBlock, operationBlock);
snapshot.edges.push({
  edgeId: 'edge.annotation-source',
  sourceBlockId: sourceBlock.blockId,
  targetBlockId: operationBlock.blockId,
  kind: 'execution_input',
  inputRole: 'source',
});
snapshot.executions.unshift(execution);
snapshot.historyEvents = [{
  actor: 'user',
  assetIds: [sourceAsset.assetId, compositeAsset.assetId],
  blockIds: [sourceBlock.blockId, operationBlock.blockId],
  createdAt,
  detail: {
    capabilityId: execution.capabilityId,
    operationBlockId: operationBlock.blockId,
    sourceBlockId: sourceBlock.blockId,
  },
  eventId: 'history.annotation',
  executionId: execution.executionId,
  summary: 'Annotation Edit',
  type: 'operation_created',
}];

const restore = annotationDraftRestoreContext(snapshot, execution);
assert.equal(restore.state, 'available');
assert.deepEqual(restore.manifest, manifest);

const projectedOperation = createFlowNodes(snapshot).find(
  (node) => node.id === operationBlock.blockId,
);
assert.equal(
  projectedOperation?.data.annotatedCompositePreviewUrl,
  compositeAsset.previewUrl,
);
assert.equal(projectedOperation?.data.annotationMarkCount, 2);
const projectedSource = createFlowNodes(snapshot, {
  selectedOperationBlockId: operationBlock.blockId,
}).find(
  (node) => node.id === sourceBlock.blockId,
);
assert.equal(
  projectedSource?.data.operationInputTargetCapabilityId,
  'image.annotation_edit',
);

assert.deepEqual(
  pluginHostBoundScope(
    snapshot,
    [operationBlock.blockId],
  ),
  {
    boundAssetIds: [compositeAsset.assetId, sourceAsset.assetId].sort(),
    boundBlockIds: [operationBlock.blockId, sourceBlock.blockId].sort(),
    boundGroupIds: [],
  },
);

sourceBlock.data.assetId = 'asset.replaced';
assert.equal(
  annotationDraftRestoreContext(snapshot, execution).state,
  'source_replaced',
);

process.stdout.write(`${JSON.stringify({
  coreAnnotationAuthoringRemoved: true,
  legacyAnnotationProjectionPreserved: true,
  pluginHistoricalScopeIncludesFrozenInputs: true,
  sourceReplacementBlocksHistoricalAuthoring: true,
})}\n`);

function imageAsset(
  projectId: string,
  assetId: string,
  createdAt: string,
): AssetRecord {
  return {
    assetId,
    createdAt,
    height: 400,
    kind: 'image',
    mimeType: 'image/png',
    previewUrl: `data:image/png;base64,${assetId}`,
    projectId,
    storageKey: `local-mock://${assetId}`,
    storageProvider: 'local_mock',
    width: 640,
  };
}

function imageBlock(
  boardId: string,
  asset: AssetRecord,
  blockId: string,
  createdAt: string,
): BlockRecord {
  return {
    blockId,
    boardId,
    createdAt,
    data: {
      assetId: asset.assetId,
      title: 'Annotation source',
    },
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { width: 320, height: 200 },
    type: 'image',
    updatedAt: createdAt,
    zIndex: 20,
  };
}
