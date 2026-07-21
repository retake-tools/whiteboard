import { Background, NodeToolbar, Position, ReactFlow, type EdgeTypes, type NodeTypes } from '@xyflow/react';
import { useEffect, useRef, type Dispatch, type PointerEvent as ReactPointerEvent, type ReactElement, type RefObject, type SetStateAction } from 'react';
import { CanvasMiniMap } from '../components/CanvasMiniMap';
import { CanvasViewportControls } from '../components/CanvasViewportControls';
import { ContextToolbar } from '../components/ContextToolbar';
import { ExecutionOutputEdge } from '../components/ExecutionOutputEdge';
import { GroupDrawOverlay } from '../components/GroupDrawOverlay';
import { GroupToolbar } from '../components/GroupToolbar';
import { createImageAssetFromDataUrl } from '../core/assetStore';
import { maxBoardZoom, minBoardZoom } from '../core/boardViewStateStore';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../core/types';
import type { useI18n } from '../i18n';
import { BlockNode } from '../nodes/BlockNode';
import { downloadAsset } from './appHelpers';
import type { useAnnotationController } from './useAnnotationController';
import type { useBlockActions } from './useBlockActions';
import type { useCanvasController } from './useCanvasController';
import type { useGroupController } from './useGroupController';
import type { useImageOperationController } from './useImageOperationController';

const nodeTypes = { text: BlockNode, image: BlockNode, video: BlockNode, operation: BlockNode, group: BlockNode } satisfies NodeTypes;
const edgeTypes = { executionOutput: ExecutionOutputEdge } satisfies EdgeTypes;

interface WhiteboardCanvasProps {
  annotations: ReturnType<typeof useAnnotationController>;
  blockActions: ReturnType<typeof useBlockActions>;
  canvas: ReturnType<typeof useCanvasController>;
  directImageImportInputRef: RefObject<HTMLInputElement | null>;
  flushAnnotationDraftPersist: () => void;
  groups: ReturnType<typeof useGroupController>;
  imageOperations: ReturnType<typeof useImageOperationController>;
  isMiniMapVisible: boolean;
  pendingDirectImageImportBlockIdRef: RefObject<string | undefined>;
  selectedBlock?: BlockRecord;
  selectedBlockContentLocked: boolean;
  selectedGroupInheritedLocked: boolean;
  selectedGroupMediaCount: number;
  selectedImageAsset?: AssetRecord;
  selectedImageUrl?: string;
  setHistoryOpen: (open: boolean) => void;
  setInspectorBlockId: (blockId: string | undefined) => void;
  setMiniMapVisible: Dispatch<SetStateAction<boolean>>;
  showGrid: boolean;
  snapshot: BoardSnapshot;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
}

export function WhiteboardCanvas(props: WhiteboardCanvasProps): ReactElement {
  const {
    annotations,
    blockActions,
    canvas,
    directImageImportInputRef,
    flushAnnotationDraftPersist,
    groups,
    imageOperations,
    isMiniMapVisible,
    pendingDirectImageImportBlockIdRef,
    selectedBlock,
    selectedBlockContentLocked,
    selectedGroupInheritedLocked,
    selectedGroupMediaCount,
    selectedImageAsset,
    selectedImageUrl,
    setHistoryOpen,
    setInspectorBlockId,
    setMiniMapVisible,
    showGrid,
    snapshot,
    snapshotRef,
    t,
  } = props;
  const pointerIdleTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    if (pointerIdleTimerRef.current !== undefined) window.clearTimeout(pointerIdleTimerRef.current);
  }, []);

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLElement>): void {
    if (event.pointerType === 'touch') return;
    const canvasElement = event.currentTarget;
    if (canvasElement.dataset.pointerMoving !== 'true') canvasElement.dataset.pointerMoving = 'true';
    if (pointerIdleTimerRef.current !== undefined) window.clearTimeout(pointerIdleTimerRef.current);
    pointerIdleTimerRef.current = window.setTimeout(() => {
      canvasElement.dataset.pointerMoving = 'false';
      pointerIdleTimerRef.current = undefined;
    }, 90);
  }

  function handleCanvasPointerLeave(event: ReactPointerEvent<HTMLElement>): void {
    if (pointerIdleTimerRef.current !== undefined) window.clearTimeout(pointerIdleTimerRef.current);
    pointerIdleTimerRef.current = undefined;
    event.currentTarget.dataset.pointerMoving = 'false';
  }

  return (
    <section
      ref={canvas.canvasAreaRef}
      className="canvas-area"
      data-pointer-moving="false"
      aria-label="Retake board canvas"
      onPointerMoveCapture={handleCanvasPointerMove}
      onPointerLeave={handleCanvasPointerLeave}
    >
      <ReactFlow
        nodes={canvas.nodes}
        edges={canvas.edges}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        onNodesChange={canvas.onNodesChange}
        onEdgesChange={canvas.onEdgesChange}
        onNodeDragStart={canvas.onNodeDragStart}
        onNodeDrag={canvas.onNodeDrag}
        onNodeDragStop={canvas.onNodeDragStop}
        onNodeClick={canvas.onNodeClick}
        onNodeDoubleClick={canvas.onNodeDoubleClick}
        onConnect={canvas.onConnect}
        onInit={(instance) => {
          canvas.reactFlowRef.current = instance;
          void instance.setViewport(canvas.currentViewportRef.current, { duration: 0 });
        }}
        onMove={(_event, viewport) => {
          canvas.scheduleViewportPersist(viewport);
        }}
        onMoveEnd={(_event, viewport) => canvas.persistViewport(viewport)}
        onSelectionChange={canvas.onSelectionChange}
        defaultViewport={canvas.currentViewportRef.current}
        minZoom={minBoardZoom}
        maxZoom={maxBoardZoom}
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        nodesDraggable={canvas.activeCanvasTool === 'select'}
        panOnDrag={canvas.activeCanvasTool === 'pan'}
        selectionOnDrag={canvas.activeCanvasTool === 'select'}
        fitView={false}
      >
        {selectedBlock?.type === 'image' && selectedImageUrl && !selectedBlockContentLocked ? (
          <NodeToolbar nodeId={selectedBlock.blockId} position={Position.Top} offset={12} isVisible>
            <ContextToolbar
              annotationConnections={imageOperations.annotationConnections}
              preferredAnnotationConnectionId={imageOperations.preferredAnnotationConnectionId}
              canvasZoom={canvas.canvasZoom}
              annotationEditorOpenRequest={annotations.annotationEditorOpenRequest?.blockId === selectedBlock.blockId ? annotations.annotationEditorOpenRequest : undefined}
              selectedBlock={selectedBlock}
              selectedImageUrl={selectedImageUrl}
              onAnnotationDraftChange={(draft) => annotations.updateAnnotationDraft(selectedBlock.blockId, draft)}
              onAnnotationDraftFlush={flushAnnotationDraftPersist}
              onAnnotationEditorOpenRequestHandled={() => annotations.setAnnotationEditorOpenRequest(undefined)}
              onCreateSimilar={() => imageOperations.createImageToImageDraftOperation(selectedBlock, 'create_similar')}
              onCreateLocalEdit={(input) => { void imageOperations.createLocalImageEditOperation(selectedBlock, input); }}
              onDownloadImage={() => { if (selectedImageAsset) downloadAsset(selectedImageAsset, selectedBlock.data.title); }}
              onReplaceImage={() => {
                if (selectedBlock.data.sourceExecutionId || selectedBlock.data.operationBlockId) return;
                pendingDirectImageImportBlockIdRef.current = selectedBlock.blockId;
                directImageImportInputRef.current?.click();
              }}
              onRunAnnotationEdit={({ instruction, manifest, composite, connectionId, historical, variationCount }) => {
                void createImageAssetFromDataUrl({
                  projectId: snapshotRef.current.project.projectId,
                  dataUrl: composite.dataUrl,
                  fileName: `annotation-${selectedBlock.blockId}.png`,
                  width: composite.width,
                  height: composite.height,
                }).then(async (annotatedCompositeAsset) => {
                  const created = await imageOperations.startImageCodexOperation('annotation_edit', selectedBlock, instruction, {
                    annotatedCompositeAsset,
                    annotationManifest: { ...manifest, compositeAssetId: annotatedCompositeAsset.assetId },
                    connectionId,
                    generationParams: { variationCount },
                  });
                  if (!created) return;
                  if (!historical) {
                    annotations.updateAnnotationDraft(selectedBlock.blockId, { schemaVersion: 1, globalInstruction: '', marks: [] });
                    flushAnnotationDraftPersist();
                  }
                });
              }}
              onRunQuickEdit={({ instruction }) => imageOperations.createImageToImageDraftOperation(selectedBlock, 'quick_edit', instruction)}
            />
          </NodeToolbar>
        ) : null}
        {selectedBlock?.type === 'group' ? (
          <NodeToolbar nodeId={selectedBlock.blockId} position={Position.Top} offset={34} isVisible>
            <GroupToolbar
              collapsed={canvas.collapsedGroupIds.includes(selectedBlock.blockId)}
              group={selectedBlock}
              inheritedLocked={selectedGroupInheritedLocked}
              mediaCount={selectedGroupMediaCount}
              onBrowse={() => { setHistoryOpen(false); setInspectorBlockId(selectedBlock.blockId); }}
              onDelete={() => { if (window.confirm(t('group.deleteConfirm'))) blockActions.deleteBlockIds([selectedBlock.blockId]); }}
              onDownload={() => groups.downloadGroupAssets(selectedBlock.blockId)}
              onFit={() => groups.fitSelectedGroup(selectedBlock.blockId)}
              onLayout={(layoutMode) => groups.layoutSelectedGroup(selectedBlock.blockId, layoutMode)}
              onToggleCollapsed={() => groups.toggleGroupCollapsed(selectedBlock.blockId)}
              onUngroup={() => groups.ungroupSelectedGroup(selectedBlock.blockId)}
              onUpdate={(updates) => groups.updateGroup(selectedBlock.blockId, updates)}
            />
          </NodeToolbar>
        ) : null}
        {showGrid ? <Background /> : null}
        {isMiniMapVisible ? <CanvasMiniMap onSelectBlock={canvas.selectBlock} /> : null}
        <CanvasViewportControls isMiniMapVisible={isMiniMapVisible} onToggleMiniMap={() => setMiniMapVisible((current) => !current)} />
      </ReactFlow>
      {canvas.activeCanvasTool === 'group' ? (
        <GroupDrawOverlay getCandidateCount={groups.groupDrawCandidateCount} onCancel={() => canvas.setActiveCanvasTool('pan')} onComplete={groups.completeGroupDraw} />
      ) : null}
    </section>
  );
}
