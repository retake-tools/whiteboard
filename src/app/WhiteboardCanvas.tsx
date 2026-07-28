import { Background, NodeToolbar, Position, ReactFlow, type EdgeTypes, type NodeTypes } from '@xyflow/react';
import { useEffect, useRef, useState, type Dispatch, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent, type ReactElement, type RefObject, type SetStateAction } from 'react';
import { CanvasMiniMap } from '../components/CanvasMiniMap';
import { CanvasViewportControls } from '../components/CanvasViewportControls';
import { ContextToolbar } from '../components/ContextToolbar';
import { ExecutionOutputEdge } from '../components/ExecutionOutputEdge';
import { GroupDrawOverlay } from '../components/GroupDrawOverlay';
import { GroupToolbar } from '../components/GroupToolbar';
import {
  PluginBlockRendererProvider,
} from '../components/PluginBlockRendererHost';
import {
  PluginImageToolbarActions,
} from '../components/PluginImageToolbarActions';
import {
  PluginSelectionToolbarActions,
} from '../components/PluginSelectionToolbarActions';
import { maxBoardZoom, minBoardZoom } from '../core/boardViewStateStore';
import type {
  PluginContributionRegistryV1,
} from '../core/pluginContributionRegistry';
import { blockLockedByGroup } from '../core/grouping';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../core/types';
import type { useI18n } from '../i18n';
import { BlockNode } from '../nodes/BlockNode';
import { downloadAsset } from './appHelpers';
import type { useBlockActions } from './useBlockActions';
import type { useCanvasController } from './useCanvasController';
import type { useGroupController } from './useGroupController';
import type { useImageOperationController } from './useImageOperationController';
import type { useWorkflowRuntimeController } from './useWorkflowRuntimeController';
import { workflowRunViewForGroup } from '../core/workflowRuntime';

const nodeTypes = { text: BlockNode, document: BlockNode, image: BlockNode, video: BlockNode, operation: BlockNode, group: BlockNode } satisfies NodeTypes;
const edgeTypes = { executionOutput: ExecutionOutputEdge } satisfies EdgeTypes;

interface WhiteboardCanvasProps {
  blockActions: ReturnType<typeof useBlockActions>;
  canvas: ReturnType<typeof useCanvasController>;
  directImageImportInputRef: RefObject<HTMLInputElement | null>;
  groups: ReturnType<typeof useGroupController>;
  imageOperations: ReturnType<typeof useImageOperationController>;
  isMiniMapVisible: boolean;
  onPluginContributionFatalFailure?: (
    pluginModuleId: string,
    message: string,
  ) => Promise<void> | void;
  pendingDirectImageImportBlockIdRef: RefObject<string | undefined>;
  pluginContributionRegistry?: PluginContributionRegistryV1;
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
  t: ReturnType<typeof useI18n>['t'];
  workflowRuntime: ReturnType<typeof useWorkflowRuntimeController>;
}

export function WhiteboardCanvas(props: WhiteboardCanvasProps): ReactElement {
  const {
    blockActions,
    canvas,
    directImageImportInputRef,
    groups,
    imageOperations,
    isMiniMapVisible,
    onPluginContributionFatalFailure,
    pendingDirectImageImportBlockIdRef,
    pluginContributionRegistry,
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
    t,
    workflowRuntime,
  } = props;
  const pointerIdleTimerRef = useRef<number | undefined>(undefined);
  const imageToolbarDismissTimerRef = useRef<number | undefined>(undefined);
  const [hoveredImageBlockId, setHoveredImageBlockId] = useState<string>();
  const selectedImageActionBlocks = canvas.selectedBlockIds.flatMap(
    (blockId) => {
      const block = snapshot.blocks.find(
        (candidate) => candidate.blockId === blockId,
      );
      const asset = snapshot.assets.find(
        (candidate) => candidate.assetId === block?.data.assetId,
      );
      if (!block || block.type !== 'image' || !asset) return [];
      return [{
        assetId: asset.assetId,
        blockId: block.blockId,
        previewUrl: asset.previewUrl,
        title: block.data.title,
        type: 'image' as const,
      }];
    },
  );
  const selectedImageToolbarContext =
    selectedBlock?.type === 'image'
    && selectedImageAsset
    && selectedImageUrl
    && !selectedBlockContentLocked
      ? {
          asset: selectedImageAsset,
          block: selectedBlock,
          previewUrl: selectedImageUrl,
        }
      : undefined;
  const hoveredImageBlock = hoveredImageBlockId
    ? snapshot.blocks.find((candidate) => (
        candidate.blockId === hoveredImageBlockId
        && candidate.type === 'image'
      ))
    : undefined;
  const hoveredImageAsset = hoveredImageBlock
    && typeof hoveredImageBlock.data.assetId === 'string'
      ? snapshot.assets.find((candidate) => (
          candidate.assetId === hoveredImageBlock.data.assetId
        ))
      : undefined;
  const hoveredImageToolbarContext =
    hoveredImageBlock
    && hoveredImageAsset
    && !blockLockedByGroup(snapshot, hoveredImageBlock.blockId)
      ? {
          asset: hoveredImageAsset,
          block: hoveredImageBlock,
          previewUrl: hoveredImageAsset.previewUrl,
        }
      : undefined;
  const imageToolbarContext = selectedImageToolbarContext
    ?? (
      canvas.selectedBlockIds.length < 2
        ? hoveredImageToolbarContext
        : undefined
    );

  useEffect(() => () => {
    if (pointerIdleTimerRef.current !== undefined) window.clearTimeout(pointerIdleTimerRef.current);
    if (imageToolbarDismissTimerRef.current !== undefined) {
      window.clearTimeout(imageToolbarDismissTimerRef.current);
    }
  }, []);

  useEffect(() => {
    if (!hoveredImageBlockId || hoveredImageToolbarContext) return;
    setHoveredImageBlockId(undefined);
  }, [hoveredImageBlockId, hoveredImageToolbarContext]);

  useEffect(() => {
    if (!hoveredImageBlockId) return;
    function handleDocumentPointerMove(event: PointerEvent): void {
      if (event.pointerType === 'touch' || !(event.target instanceof Element)) {
        return;
      }
      if (event.target.closest('.image-context-toolbar-bridge')) {
        cancelImageToolbarDismiss();
        return;
      }
      if (blockIdFromNodeTarget(event.target)) return;
      scheduleImageToolbarDismiss(hoveredImageBlockId!);
    }
    document.addEventListener('pointermove', handleDocumentPointerMove, {
      capture: true,
    });
    return () => {
      document.removeEventListener('pointermove', handleDocumentPointerMove, {
        capture: true,
      });
    };
  }, [hoveredImageBlockId]);

  function cancelImageToolbarDismiss(): void {
    if (imageToolbarDismissTimerRef.current === undefined) return;
    window.clearTimeout(imageToolbarDismissTimerRef.current);
    imageToolbarDismissTimerRef.current = undefined;
  }

  function showImageToolbarPreview(blockId: string): void {
    cancelImageToolbarDismiss();
    const block = snapshot.blocks.find((candidate) => (
      candidate.blockId === blockId
      && candidate.type === 'image'
      && typeof candidate.data.assetId === 'string'
    ));
    if (!block || blockLockedByGroup(snapshot, block.blockId)) return;
    setHoveredImageBlockId(block.blockId);
  }

  function scheduleImageToolbarDismiss(blockId: string): void {
    cancelImageToolbarDismiss();
    imageToolbarDismissTimerRef.current = window.setTimeout(() => {
      setHoveredImageBlockId((current) => (
        current === blockId ? undefined : current
      ));
      imageToolbarDismissTimerRef.current = undefined;
    }, 140);
  }

  function blockIdFromNodeTarget(
    target: EventTarget | null,
  ): string | undefined {
    if (!(target instanceof Element)) return undefined;
    return target
      .closest<HTMLElement>('.react-flow__node[data-id]')
      ?.dataset.id;
  }

  function handleCanvasFocus(event: ReactFocusEvent<HTMLElement>): void {
    const blockId = blockIdFromNodeTarget(event.target);
    if (blockId) showImageToolbarPreview(blockId);
  }

  function handleCanvasBlur(event: ReactFocusEvent<HTMLElement>): void {
    const blockId = blockIdFromNodeTarget(event.target);
    if (!blockId) return;
    const nextBlockId = blockIdFromNodeTarget(event.relatedTarget);
    if (nextBlockId === blockId) return;
    scheduleImageToolbarDismiss(blockId);
  }

  function handleCanvasPointerMove(event: ReactPointerEvent<HTMLElement>): void {
    if (event.pointerType === 'touch') return;
    if (
      event.target instanceof Element
      && event.target.closest('.image-context-toolbar-bridge')
    ) {
      cancelImageToolbarDismiss();
    } else {
      const blockId = blockIdFromNodeTarget(event.target);
      if (
        blockId
        && window.matchMedia(
          '(hover: hover) and (pointer: fine)',
        ).matches
      ) {
        showImageToolbarPreview(blockId);
      } else if (hoveredImageBlockId) {
        scheduleImageToolbarDismiss(hoveredImageBlockId);
      }
    }
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
    if (hoveredImageBlockId) {
      scheduleImageToolbarDismiss(hoveredImageBlockId);
    }
  }

  return (
    <section
      ref={canvas.canvasAreaRef}
      className="canvas-area"
      data-pointer-moving="false"
      aria-label="Retake board canvas"
      onBlurCapture={handleCanvasBlur}
      onFocusCapture={handleCanvasFocus}
      onPointerMoveCapture={handleCanvasPointerMove}
      onPointerLeave={handleCanvasPointerLeave}
    >
      <PluginBlockRendererProvider
        onFatalFailure={onPluginContributionFatalFailure}
        registry={pluginContributionRegistry}
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
        {canvas.selectedBlockIds.length >= 2
          && selectedImageActionBlocks.length
            === canvas.selectedBlockIds.length ? (
          <NodeToolbar
            nodeId={[...canvas.selectedBlockIds]}
            position={Position.Top}
            offset={12}
            isVisible
          >
            <PluginSelectionToolbarActions
              blocks={selectedImageActionBlocks}
              onFatalFailure={onPluginContributionFatalFailure}
              registry={pluginContributionRegistry}
            />
          </NodeToolbar>
        ) : null}
        {imageToolbarContext ? (
          <NodeToolbar
            isVisible
            nodeId={imageToolbarContext.block.blockId}
            offset={12}
            position={Position.Top}
            style={{ pointerEvents: 'all' }}
          >
            <div
              className="image-context-toolbar-bridge"
              onBlurCapture={(event) => {
                if (
                  event.relatedTarget instanceof Node
                  && event.currentTarget.contains(event.relatedTarget)
                ) return;
                scheduleImageToolbarDismiss(
                  imageToolbarContext.block.blockId,
                );
              }}
              onClick={(event) => event.stopPropagation()}
              onFocusCapture={cancelImageToolbarDismiss}
              onPointerEnter={cancelImageToolbarDismiss}
              onPointerLeave={() => {
                scheduleImageToolbarDismiss(
                  imageToolbarContext.block.blockId,
                );
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <ContextToolbar
                canvasZoom={canvas.canvasZoom}
                pluginActions={(
                  <PluginImageToolbarActions
                    assetId={imageToolbarContext.asset.assetId}
                    blockId={imageToolbarContext.block.blockId}
                    onFatalFailure={onPluginContributionFatalFailure}
                    onInvoke={() => {
                      if (
                        canvas.selectedBlockIds.length !== 1
                        || canvas.selectedBlockIds[0]
                          !== imageToolbarContext.block.blockId
                      ) {
                        canvas.selectBlock(imageToolbarContext.block.blockId);
                      }
                    }}
                    previewUrl={imageToolbarContext.previewUrl}
                    registry={pluginContributionRegistry}
                    title={imageToolbarContext.block.data.title}
                  />
                )}
                selectedBlock={imageToolbarContext.block}
                selectedImageUrl={imageToolbarContext.previewUrl}
                onCreateSimilar={() => imageOperations.createImageToImageDraftOperation(imageToolbarContext.block, 'create_similar')}
                onDownloadImage={() => downloadAsset(imageToolbarContext.asset, imageToolbarContext.block.data.title)}
                onInteract={() => {
                  if (
                    canvas.selectedBlockIds.length !== 1
                    || canvas.selectedBlockIds[0]
                      !== imageToolbarContext.block.blockId
                  ) {
                    canvas.selectBlock(imageToolbarContext.block.blockId);
                  }
                }}
                onReplaceImage={() => {
                  if (imageToolbarContext.block.data.sourceExecutionId || imageToolbarContext.block.data.operationBlockId) return;
                  pendingDirectImageImportBlockIdRef.current = imageToolbarContext.block.blockId;
                  directImageImportInputRef.current?.click();
                }}
                onRunQuickEdit={({ instruction }) => imageOperations.createImageToImageDraftOperation(imageToolbarContext.block, 'quick_edit', instruction)}
              />
            </div>
          </NodeToolbar>
        ) : null}
        {selectedBlock?.type === 'group' ? (
          <NodeToolbar nodeId={selectedBlock.blockId} position={Position.Top} offset={34} isVisible>
            <GroupToolbar
              collapsed={canvas.collapsedGroupIds.includes(selectedBlock.blockId)}
              group={selectedBlock}
              inheritedLocked={selectedGroupInheritedLocked}
              mediaCount={selectedGroupMediaCount}
              workflowRun={workflowRunViewForGroup(snapshot, selectedBlock.blockId)}
              onBrowse={() => { setHistoryOpen(false); setInspectorBlockId(selectedBlock.blockId); }}
              onDelete={() => { if (window.confirm(t('group.deleteConfirm'))) blockActions.deleteBlockIds([selectedBlock.blockId]); }}
              onDownload={() => groups.downloadGroupAssets(selectedBlock.blockId)}
              onFit={() => groups.fitSelectedGroup(selectedBlock.blockId)}
              onLayout={(layoutMode) => groups.layoutSelectedGroup(selectedBlock.blockId, layoutMode)}
              onToggleCollapsed={() => groups.toggleGroupCollapsed(selectedBlock.blockId)}
              onUngroup={() => groups.ungroupSelectedGroup(selectedBlock.blockId)}
              onUpdate={(updates) => groups.updateGroup(selectedBlock.blockId, updates)}
              onWorkflowRun={() => {
                if (workflowRunViewForGroup(snapshot, selectedBlock.blockId)) {
                  setHistoryOpen(false);
                  setInspectorBlockId(selectedBlock.blockId);
                } else {
                  workflowRuntime.createWorkflowRun(selectedBlock.blockId);
                }
              }}
            />
          </NodeToolbar>
        ) : null}
        {showGrid ? <Background /> : null}
        {isMiniMapVisible ? <CanvasMiniMap onSelectBlock={canvas.selectBlock} /> : null}
        <CanvasViewportControls isMiniMapVisible={isMiniMapVisible} onToggleMiniMap={() => setMiniMapVisible((current) => !current)} />
        </ReactFlow>
      </PluginBlockRendererProvider>
      {canvas.activeCanvasTool === 'group' ? (
        <GroupDrawOverlay getCandidateCount={groups.groupDrawCandidateCount} onCancel={() => canvas.setActiveCanvasTool('pan')} onComplete={groups.completeGroupDraw} />
      ) : null}
    </section>
  );
}
