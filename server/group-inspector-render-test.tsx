import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GroupInspector } from '../src/components/GroupInspector';
import { GroupToolbar } from '../src/components/GroupToolbar';
import { GroupDrawOverlay } from '../src/components/GroupDrawOverlay';
import { FloatingToolbar } from '../src/components/FloatingToolbar';
import { OperationInlineControls } from '../src/nodes/OperationInlineControls';
import { operationDisplayState } from '../src/core/operationDisplay';
import { ExecutionDetailContent } from '../src/components/ExecutionDetailContent';
import { BoardHistoryPanel } from '../src/components/BoardHistoryPanel';
import { ContextToolbar } from '../src/components/ContextToolbar';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { loadCollapsedGroupIds, saveCollapsedGroupIds } from '../src/core/groupViewState';
import type { BlockRecord } from '../src/core/types';
import { I18nProvider } from '../src/i18n';
import { VideoBlockBody } from '../src/nodes/VideoBlockBody';

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

const snapshot = structuredClone(defaultSnapshot);
const createdAt = '2026-07-10T00:00:00.000Z';
const group: BlockRecord = {
  blockId: 'group_render',
  boardId: snapshot.board.boardId,
  type: 'group',
  layerId: 'layer_default',
  position: { x: 0, y: 0 },
  size: { width: 500, height: 400 },
  zIndex: 1,
  data: { title: 'Render group', groupKind: 'execution_results', groupColor: 'blue' },
  createdAt,
  updatedAt: createdAt,
};
const imageBlock: BlockRecord = {
  blockId: 'image_render',
  boardId: snapshot.board.boardId,
  type: 'image',
  layerId: 'layer_default',
  parentGroupId: group.blockId,
  position: { x: 40, y: 60 },
  size: { width: 200, height: 240 },
  zIndex: 2,
  data: { title: 'Rendered image', assetId: 'asset_render' },
  createdAt,
  updatedAt: createdAt,
};
snapshot.blocks = [group, imageBlock];
snapshot.assets = [{
  assetId: 'asset_render',
  projectId: snapshot.project.projectId,
  kind: 'image',
  mimeType: 'image/png',
  storageProvider: 'local',
  storageKey: 'render.png',
  previewUrl: '/render.png',
  width: 800,
  height: 960,
  createdAt,
}];

const markup = renderToStaticMarkup(
  <I18nProvider>
    <GroupToolbar
      collapsed={false}
      group={group}
      inheritedLocked={false}
      mediaCount={1}
      onBrowse={() => undefined}
      onDelete={() => undefined}
      onDownload={() => undefined}
      onFit={() => undefined}
      onLayout={() => undefined}
      onToggleCollapsed={() => undefined}
      onUngroup={() => undefined}
      onUpdate={() => undefined}
    />
    <GroupInspector
      group={group}
      snapshot={snapshot}
      onClose={() => undefined}
      onCopyPrompt={() => undefined}
      onDownloadAll={() => undefined}
    />
  </I18nProvider>,
);

assert.match(markup, /Browse group media/);
assert.match(markup, /Download all original assets/);
assert.match(markup, /Group browser/);
assert.match(markup, /Rendered image/);
assert.match(markup, /800 x 960/);
assert.match(markup, /1 \/ 1/);
assert.match(markup, /Collapse group/);
assert.match(markup, /Group locks/);
assert.match(markup, /Arrange group/);

const drawOverlayMarkup = renderToStaticMarkup(
  <I18nProvider>
    <GroupDrawOverlay getCandidateCount={() => 2} onCancel={() => undefined} onComplete={() => undefined} />
  </I18nProvider>,
);
assert.match(drawOverlayMarkup, /Drag on the canvas to draw a group/);
saveCollapsedGroupIds('project_render', 'board_render', ['group_render', 'group_render']);
assert.deepEqual(loadCollapsedGroupIds('project_render', 'board_render'), ['group_render']);

const floatingToolbarMarkup = renderToStaticMarkup(
  <I18nProvider>
    <FloatingToolbar
      activeTool="select"
      onAddBlock={() => undefined}
      onCreateImageToImage={() => undefined}
      onCreateTextToImage={() => undefined}
      onSetActiveTool={() => undefined}
    />
  </I18nProvider>,
);
const basicElementsMenuStart = floatingToolbarMarkup.indexOf('role="menu" aria-label="Basic elements"');
const basicElementsMenuEnd = floatingToolbarMarkup.indexOf('</div>', basicElementsMenuStart);
assert.ok(basicElementsMenuStart >= 0 && basicElementsMenuEnd > basicElementsMenuStart);
assert.doesNotMatch(floatingToolbarMarkup.slice(basicElementsMenuStart, basicElementsMenuEnd), /Add group/);
assert.equal(floatingToolbarMarkup.match(/aria-label="Add group"/g)?.length, 1);
assert.ok(floatingToolbarMarkup.indexOf('aria-label="Add group"') > floatingToolbarMarkup.indexOf('aria-label="Video creation"'));

const videoDraftMarkup = renderToStaticMarkup(
  <I18nProvider>
    <VideoBlockBody
      blockId="video_draft"
      data={{
        title: 'Video block',
        executionDraft: {
          schemaVersion: 1,
          capabilityId: 'video.generate',
          executionProfileId: 'video-mock',
          prompt: 'Camera pushes toward the subject.',
          parameters: { durationSeconds: 8, outputCount: 3 },
        },
      }}
    />
  </I18nProvider>,
);
assert.match(videoDraftMarkup, /Camera pushes toward the subject/);
assert.match(videoDraftMarkup, /Generate mock video/);
assert.match(videoDraftMarkup, /Retake mock · no provider cost/);
assert.match(videoDraftMarkup, /<option value="8" selected="">8s<\/option>/);
assert.match(videoDraftMarkup, /<option value="3" selected="">3<\/option>/);

const videoResultMarkup = renderToStaticMarkup(
  <I18nProvider>
    <VideoBlockBody
      blockId="video_result"
      data={{
        title: 'Video result',
        assetId: 'asset_mock_video',
        previewUrl: 'local-mock://video/result.mp4',
        sourceExecutionId: 'exec_video',
        status: 'succeeded',
      }}
    />
  </I18nProvider>,
);
assert.match(videoResultMarkup, /Mock video result/);
assert.match(videoResultMarkup, /Show execution details/);

const queuedOperationMarkup = renderToStaticMarkup(
  <I18nProvider>
    <OperationInlineControls
      blockId="operation_queued"
      data={{
        title: 'Text to image',
        capabilityId: 'image.text_to_image',
        generationProfileId: 'codex-managed',
        sourceExecutionId: 'exec_queued',
        status: 'queued',
      }}
    />
  </I18nProvider>,
);
assert.match(queuedOperationMarkup, /Copy prompt/);
assert.doesNotMatch(queuedOperationMarkup, /Generate again/);

const canceledOperationMarkup = renderToStaticMarkup(
  <I18nProvider>
    <OperationInlineControls
      blockId="operation_canceled"
      data={{
        title: 'Text to image',
        capabilityId: 'image.text_to_image',
        generationProfileId: 'codex-managed',
        operationCanRun: true,
        sourceExecutionId: 'exec_canceled',
        status: 'canceled',
      }}
    />
  </I18nProvider>,
);
assert.match(canceledOperationMarkup, /Generate again/);

const completedAnnotationOperationMarkup = renderToStaticMarkup(
  <I18nProvider>
    <OperationInlineControls
      blockId="operation_annotation_succeeded"
      data={{
        title: 'Annotation edit',
        capabilityId: 'image.annotation_edit',
        generationProfileId: 'codex-managed',
        operationCanRun: true,
        sourceExecutionId: 'exec_annotation_succeeded',
        status: 'succeeded',
      }}
    />
  </I18nProvider>,
);
assert.match(completedAnnotationOperationMarkup, /Generate again/);

const invalidOperationMarkup = renderToStaticMarkup(
  <I18nProvider>
    <OperationInlineControls
      blockId="operation_invalid"
      data={{
        title: 'Text to image',
        capabilityId: 'image.text_to_image',
        generationProfileId: 'codex-managed',
        operationCanRun: false,
        operationReadinessIssues: ['prompt_empty'],
      }}
    />
  </I18nProvider>,
);
assert.match(invalidOperationMarkup, /Enter a prompt before running this operation/);
assert.match(invalidOperationMarkup, /disabled=""/);
assert.match(invalidOperationMarkup, /9:16 \/ 1x/);

const sourceAspectOperationMarkup = renderToStaticMarkup(
  <I18nProvider>
    <OperationInlineControls
      blockId="operation_source_aspect"
      data={{
        title: 'Image to image',
        capabilityId: 'image.image_to_image',
        generationProfileId: 'codex-managed',
        operationCanRun: true,
        operationSourceAspectRatio: 3 / 2,
      }}
    />
  </I18nProvider>,
);
assert.match(sourceAspectOperationMarkup, /Source ratio \/ 1x/);

const localAdjustOperationMarkup = renderToStaticMarkup(
  <I18nProvider>
    <OperationInlineControls
      blockId="operation_local_adjust"
      data={{
        title: 'Adjust',
        adapter: 'local_canvas',
        capabilityId: 'image.local_adjust',
        localEditParams: { brightness: 20, contrast: -10, saturation: 0 },
        sourceExecutionId: 'exec_local_adjust',
        status: 'succeeded',
      }}
    />
  </I18nProvider>,
);
assert.match(localAdjustOperationMarkup, /Local processing/);
assert.match(localAdjustOperationMarkup, /Brightness \+20 · Contrast -10 · Saturation 0/);
assert.doesNotMatch(localAdjustOperationMarkup, /Codex Managed/);
assert.doesNotMatch(localAdjustOperationMarkup, /Generate again/);

const runningDisplayState = operationDisplayState({
  title: 'Text to image',
  operationCanRun: false,
  operationReadinessIssues: ['prompt_empty'],
  status: 'running',
});
assert.equal(runningDisplayState.executionBadge?.labelKey, 'status.running');
assert.equal(runningDisplayState.executionBadge?.historical, false);
assert.equal(runningDisplayState.showReadinessIssue, false);
assert.equal(runningDisplayState.runDisabled, true);

const completedInvalidDisplayState = operationDisplayState({
  title: 'Text to image',
  operationCanRun: false,
  operationReadinessIssues: ['prompt_empty'],
  sourceExecutionId: 'exec_succeeded',
  status: 'succeeded',
});
assert.equal(completedInvalidDisplayState.executionBadge?.labelKey, 'operationStatus.succeeded');
assert.equal(completedInvalidDisplayState.executionBadge?.historical, true);
assert.equal(completedInvalidDisplayState.inputState, 'input_required');
assert.equal(completedInvalidDisplayState.showReadinessIssue, true);
assert.equal(completedInvalidDisplayState.runDisabled, true);

const changedCompletedDisplayState = operationDisplayState({
  title: 'Text to image',
  operationCanRun: true,
  operationChangeCount: 2,
  sourceExecutionId: 'exec_succeeded',
  status: 'succeeded',
});
assert.equal(changedCompletedDisplayState.executionBadge, undefined);

const configurationDetailsMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ExecutionDetailContent
      context={{
        activity: [{
          createdAt: '2026-07-11T00:00:05.000Z',
          detail: 'Synthetic image provider failure',
          kind: 'failed',
          resultTitles: ['Result 1'],
        }, {
          createdAt: '2026-07-11T00:00:10.000Z',
          kind: 'resumed',
          resultTitles: ['Result 1'],
        }],
        currentDraftChanges: [{
          current: 'A revised prompt',
          key: 'prompt',
          kind: 'prompt',
          previous: 'The generated prompt',
        }],
        execution: {
          adapter: 'mcp_agent',
          boardId: 'board_test',
          capabilityId: 'image.text_to_image',
          executionId: 'exec_v2',
          inputBlockIds: [],
          outputAssetIds: [],
          outputBlockIds: [],
          projectId: 'project_test',
          startedAt: '2026-07-11T00:00:00.000Z',
          status: 'succeeded',
        },
        executionChanges: [{ current: 2, key: 'variationCount', kind: 'parameter', previous: 1 }],
        executionVersion: 2,
        inputImages: [],
        outputAssets: [],
        sourceAssets: [],
        sourceBlock: {
          ...imageBlock,
          blockId: 'source_result_v2',
          data: { ...imageBlock.data, title: 'Source result' },
        },
        sourceExecutionVersion: 2,
      }}
      copyKey="configuration-test"
      copySource="execution_inspector"
      onCopyPrompt={() => undefined}
      onRestoreConfiguration={() => undefined}
    />
  </I18nProvider>,
);
assert.match(configurationDetailsMarkup, /Failure and retry/);
assert.match(configurationDetailsMarkup, /Synthetic image provider failure/);
assert.match(configurationDetailsMarkup, /Failed result retried/);
assert.match(configurationDetailsMarkup, /Changes in this version · V2/);
assert.match(configurationDetailsMarkup, /Params · variationCount/);
assert.match(configurationDetailsMarkup, /Current draft changes/);
assert.match(configurationDetailsMarkup, /The generated prompt/);
assert.match(configurationDetailsMarkup, /A revised prompt/);
assert.match(configurationDetailsMarkup, /Restore this version/);
assert.match(configurationDetailsMarkup, /Source result · V2/);

const historySnapshot = structuredClone(defaultSnapshot);
const historyOperation = historySnapshot.blocks.find((block) => block.blockId === 'block_operation');
if (!historyOperation) throw new Error('Expected default operation block for history rendering');
const baseExecution = {
  adapter: 'mcp_agent' as const,
  boardId: historySnapshot.board.boardId,
  capabilityId: 'image.text_to_image',
  inputBlockIds: ['block_brief'],
  outputAssetIds: [],
  outputBlockIds: [],
  projectId: historySnapshot.project.projectId,
  status: 'succeeded' as const,
};
historySnapshot.executions = [{
  ...baseExecution,
  executionId: 'exec_history_v2',
  operationVersion: 2,
  previousExecutionId: 'exec_history_v1',
  prompt: 'Second prompt',
  params: { operationBlockId: historyOperation.blockId },
  startedAt: '2026-07-11T00:01:00.000Z',
  configuration: {
    capabilityId: 'image.text_to_image',
    generationParams: { variationCount: 2 },
    imageInputs: [],
    prompt: 'Second prompt',
  },
}, {
  ...baseExecution,
  executionId: 'exec_history_v1',
  operationVersion: 1,
  prompt: 'First prompt',
  params: { operationBlockId: historyOperation.blockId },
  startedAt: '2026-07-11T00:00:00.000Z',
  configuration: {
    capabilityId: 'image.text_to_image',
    generationParams: { variationCount: 1 },
    imageInputs: [],
    prompt: 'First prompt',
  },
}];
historySnapshot.historyEvents = [{
  actor: 'user',
  createdAt: '2026-07-11T00:01:00.000Z',
  eventId: 'history_v2',
  executionId: 'exec_history_v2',
  summary: 'Text to image',
  type: 'operation_created',
}];
const historyMarkup = renderToStaticMarkup(
  <I18nProvider>
    <BoardHistoryPanel
      snapshot={historySnapshot}
      onClose={() => undefined}
      onCopyPrompt={() => undefined}
      onLocateBlock={() => undefined}
      onOpenAnnotationEditor={() => undefined}
    />
  </I18nProvider>,
);
assert.match(historyMarkup, /V2 · Prompt \+ Params/);

const annotationManifestMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ExecutionDetailContent
      context={{
        activity: [],
        annotationDraftRestoreState: 'available',
        annotationManifest: {
          schemaVersion: 1,
          globalInstruction: 'Preserve the background.',
          marks: [{
            id: 'M1',
            kind: 'marker',
            color: '#dc2626',
            strokeSize: 'm',
            intent: 'Replace the hat.',
            point: { x: 0.5, y: 0.5 },
          }],
        },
        currentDraftChanges: [],
        execution: historySnapshot.executions[0],
        executionChanges: [],
        inputImages: [],
        outputAssets: [],
        sourceAssets: [],
      }}
      copyKey="annotation-manifest-render"
      copySource="history_panel"
      onCopyPrompt={() => undefined}
      onOpenAnnotationEditor={() => undefined}
    />
  </I18nProvider>,
);
assert.match(annotationManifestMarkup, /Annotation Manifest/);
assert.match(annotationManifestMarkup, /M1 · Numbered marker/);
assert.match(annotationManifestMarkup, /Open in annotation editor/);

const replaceableImageBlock: BlockRecord = {
  ...group,
  blockId: 'image_replaceable',
  type: 'image',
  data: { assetId: 'asset_replaceable', title: 'Source image' },
};
const replaceableToolbarMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ContextToolbar
      canvasZoom={1}
      selectedBlock={replaceableImageBlock}
      selectedImageUrl="/source.png"
      onCreateLocalEdit={() => undefined}
      onCreateSimilar={() => undefined}
      onDownloadImage={() => undefined}
      onAnnotationDraftChange={() => undefined}
      onAnnotationDraftFlush={() => undefined}
      onReplaceImage={() => undefined}
      onRunAnnotationEdit={() => undefined}
      onRunQuickEdit={() => undefined}
    />
  </I18nProvider>,
);
assert.match(replaceableToolbarMarkup, /aria-label="Replace image"/);
assert.match(replaceableToolbarMarkup, /aria-label="Crop · Not available yet"/);
assert.match(replaceableToolbarMarkup, /disabled=""/);
const resultToolbarMarkup = renderToStaticMarkup(
  <I18nProvider>
    <ContextToolbar
      canvasZoom={1}
      selectedBlock={{
        ...replaceableImageBlock,
        blockId: 'image_result',
        data: { ...replaceableImageBlock.data, sourceExecutionId: 'exec_result' },
      }}
      selectedImageUrl="/result.png"
      onCreateLocalEdit={() => undefined}
      onCreateSimilar={() => undefined}
      onDownloadImage={() => undefined}
      onAnnotationDraftChange={() => undefined}
      onAnnotationDraftFlush={() => undefined}
      onReplaceImage={() => undefined}
      onRunAnnotationEdit={() => undefined}
      onRunQuickEdit={() => undefined}
    />
  </I18nProvider>,
);
assert.doesNotMatch(resultToolbarMarkup, /aria-label="Replace image"/);

console.log({
  hasGroupBrowser: true,
  hasGroupToolbarActions: true,
  hasGroupDrawMode: true,
  hasPerBoardCollapseState: true,
  hasStandaloneGroupButton: true,
  mediaCount: 1,
});
