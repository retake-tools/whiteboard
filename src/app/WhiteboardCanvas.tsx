import {
  Background,
  NodeToolbar,
  Position,
  ReactFlow,
  type EdgeTypes,
  type NodeTypes,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
  type SetStateAction,
} from 'react';
import { CanvasMiniMap } from '../components/CanvasMiniMap';
import { CanvasViewportControls } from '../components/CanvasViewportControls';
import { BoardBackgroundLayer } from '../components/BoardBackgroundLayer';
import { ContextToolbar } from '../components/ContextToolbar';
import { ExecutionOutputEdge } from '../components/ExecutionOutputEdge';
import { WorkflowEdge } from '../components/WorkflowEdge';
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
import type {
  AssetRecord,
  BlockRecord,
  BoardSnapshot,
} from '../core/types';
import type { RetakeEdge, RetakeNode } from '../canvas/reactFlowTypes';
import type { useI18n } from '../i18n';
import { BlockNode } from '../nodes/BlockNode';
import { downloadAsset, operationModeFromBlock } from './appHelpers';
import type { useBlockActions } from './useBlockActions';
import { useCanvasImageDoubleTap } from './useCanvasImageDoubleTap';
import type { useCanvasController } from './useCanvasController';
import type { useGroupController } from './useGroupController';
import type { useImageOperationController } from './useImageOperationController';
import type { useWorkflowRuntimeController } from './useWorkflowRuntimeController';
import { workflowRunViewForGroup } from '../core/workflowRuntime';

const nodeTypes = { text: BlockNode, document: BlockNode, image: BlockNode, video: BlockNode, operation: BlockNode, group: BlockNode } satisfies NodeTypes;
const edgeTypes = { executionOutput: ExecutionOutputEdge, workflow: WorkflowEdge } satisfies EdgeTypes;

interface WhiteboardCanvasProps {
  blockActions: ReturnType<typeof useBlockActions>;
  canvas: ReturnType<typeof useCanvasController>;
  directImageImportInputRef: RefObject<HTMLInputElement | null>;
  groups: ReturnType<typeof useGroupController>;
  imageOperations: ReturnType<typeof useImageOperationController>;
  isMiniMapVisible: boolean;
  onOpenWorkflowRun: (workflowRunId: string) => void;
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
    onOpenWorkflowRun,
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
  const pointerIdleFrameRef = useRef<number | undefined>(undefined);
  const pointerLastMovedAtRef = useRef(0);
  const imageToolbarDismissTimerRef = useRef<number | undefined>(undefined);
  const finePointerRef = useRef(
    typeof window !== 'undefined'
      && window.matchMedia('(hover: hover) and (pointer: fine)').matches,
  );
  const [hoveredImageBlockId, setHoveredImageBlockId] = useState<string>();
  const imageDoubleTap = useCanvasImageDoubleTap({
    gestureKeyForTarget: imageBlockIdFromGestureTarget,
    onDoubleTap: (blockId) => {
      window.dispatchEvent(new CustomEvent('retake:open-execution-inspector', {
        detail: { blockId },
      }));
    },
  });
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
  const imageToolbarOperation = imageToolbarContextOperation(
    snapshot,
    imageToolbarContext?.block,
  );
  const onNodesChange = useStableCallback(canvas.onNodesChange);
  const onEdgesChange = useStableCallback(canvas.onEdgesChange);
  const onNodeDragStart = useStableCallback(canvas.onNodeDragStart);
  const onNodeDrag = useStableCallback(canvas.onNodeDrag);
  const onNodeDragStop = useStableCallback(canvas.onNodeDragStop);
  const onNodeClick = useStableCallback(canvas.onNodeClick);
  const onNodeDoubleClick = useStableCallback(canvas.onNodeDoubleClick);
  const onConnect = useStableCallback(canvas.onConnect);
  const onConnectEnd = useStableCallback(canvas.onConnectEnd);
  const onSelectionChange = useStableCallback(canvas.onSelectionChange);
  const onInit = useStableCallback((
    instance: ReactFlowInstance<RetakeNode, RetakeEdge>,
  ) => {
    canvas.reactFlowRef.current = instance;
    void instance.setViewport(canvas.currentViewportRef.current, {
      duration: 0,
    });
  });
  const onMove = useStableCallback((
    _event: MouseEvent | TouchEvent | null,
    viewport: Viewport,
  ) => {
    canvas.scheduleViewportPersist(viewport);
  });
  const onMoveEnd = useStableCallback((
    _event: MouseEvent | TouchEvent | null,
    viewport: Viewport,
  ) => {
    canvas.persistViewport(viewport);
  });

  useEffect(() => () => {
    if (pointerIdleFrameRef.current !== undefined) {
      window.cancelAnimationFrame(pointerIdleFrameRef.current);
    }
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
    if (imageToolbarDismissTimerRef.current !== undefined) return;
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

  function imageBlockIdFromGestureTarget(
    target: EventTarget | null,
  ): string | undefined {
    if (!(target instanceof Element)) return undefined;
    if (target.closest([
      '.block-heading',
      '.image-context-toolbar-bridge',
      '.react-flow__handle',
      '.react-flow__resize-control',
      'button',
      'input',
      'select',
      'textarea',
    ].join(','))) return undefined;
    const blockId = blockIdFromNodeTarget(target);
    const block = blockId
      ? snapshot.blocks.find((candidate) => candidate.blockId === blockId)
      : undefined;
    return block?.type === 'image' && typeof block.data.assetId === 'string'
      ? block.blockId
      : undefined;
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
        && finePointerRef.current
      ) {
        if (blockId === hoveredImageBlockId) cancelImageToolbarDismiss();
        else showImageToolbarPreview(blockId);
      } else if (hoveredImageBlockId) {
        scheduleImageToolbarDismiss(hoveredImageBlockId);
      }
    }
    const canvasElement = event.currentTarget;
    if (canvasElement.dataset.pointerMoving !== 'true') canvasElement.dataset.pointerMoving = 'true';
    pointerLastMovedAtRef.current = window.performance.now();
    if (pointerIdleFrameRef.current === undefined) {
      pointerIdleFrameRef.current = window.requestAnimationFrame(
        () => settleCanvasPointer(canvasElement),
      );
    }
  }

  function settleCanvasPointer(canvasElement: HTMLElement): void {
    if (window.performance.now() - pointerLastMovedAtRef.current < 90) {
      pointerIdleFrameRef.current = window.requestAnimationFrame(
        () => settleCanvasPointer(canvasElement),
      );
      return;
    }
    canvasElement.dataset.pointerMoving = 'false';
    pointerIdleFrameRef.current = undefined;
  }

  function handleCanvasPointerLeave(event: ReactPointerEvent<HTMLElement>): void {
    if (pointerIdleFrameRef.current !== undefined) {
      window.cancelAnimationFrame(pointerIdleFrameRef.current);
    }
    pointerIdleFrameRef.current = undefined;
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
      onClickCapture={imageDoubleTap.onClickCapture}
      onFocusCapture={handleCanvasFocus}
      onPointerDownCapture={imageDoubleTap.onPointerDownCapture}
      onPointerMoveCapture={handleCanvasPointerMove}
      onPointerLeave={handleCanvasPointerLeave}
    >
      <BoardBackgroundLayer snapshot={snapshot} />
      <PluginBlockRendererProvider
        onFatalFailure={onPluginContributionFatalFailure}
        registry={pluginContributionRegistry}
      >
        <ReactFlow
        nodes={canvas.nodes}
        edges={canvas.edges}
        edgeTypes={edgeTypes}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onInit={onInit}
        onMove={onMove}
        onMoveEnd={onMoveEnd}
        onSelectionChange={onSelectionChange}
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
                onRegenerate={imageToolbarOperation ? () => {
                  void imageOperations.startExistingOperationBlock({
                    block: imageToolbarOperation,
                    operation: operationModeFromBlock(imageToolbarOperation, snapshot),
                    revealOnStart: true,
                  });
                } : undefined}
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
                const currentRun = workflowRunViewForGroup(
                  snapshot,
                  selectedBlock.blockId,
                );
                if (currentRun) {
                  onOpenWorkflowRun(currentRun.record.workflowRunId);
                } else {
                  void workflowRuntime.createWorkflowRun(selectedBlock.blockId);
                }
              }}
            />
          </NodeToolbar>
        ) : null}
        {showGrid ? <Background /> : null}
        {isMiniMapVisible ? <CanvasMiniMap onSelectBlock={canvas.selectBlock} /> : null}
        <CanvasViewportControls
          isMiniMapVisible={isMiniMapVisible}
          onToggleMiniMap={() => setMiniMapVisible((current) => !current)}
        />
        </ReactFlow>
      </PluginBlockRendererProvider>
      {canvas.activeCanvasTool === 'group' ? (
        <GroupDrawOverlay getCandidateCount={groups.groupDrawCandidateCount} onCancel={() => canvas.setActiveCanvasTool('pan')} onComplete={groups.completeGroupDraw} />
      ) : null}
    </section>
  );
}

function useStableCallback<TArguments extends unknown[], TResult>(
  callback: (...arguments_: TArguments) => TResult,
): (...arguments_: TArguments) => TResult {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  return useCallback((...arguments_: TArguments) => (
    callbackRef.current(...arguments_)
  ), []);
}

function imageToolbarContextOperation(
  snapshot: BoardSnapshot,
  imageBlock: BlockRecord | undefined,
): BlockRecord | undefined {
  const operationBlockId = imageBlock?.data.operationBlockId;
  if (typeof operationBlockId !== 'string') return undefined;
  return snapshot.blocks.find((block) => (
    block.blockId === operationBlockId
    && block.type === 'operation'
    && block.data.adapter !== 'local_canvas'
    && block.data.status !== 'queued'
    && block.data.status !== 'running'
  ));
}
