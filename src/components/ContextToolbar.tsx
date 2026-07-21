import {
  Crop,
  Download,
  History,
  ImagePlus,
  ImageUp,
  Maximize2,
  MessageSquareText,
  MoreHorizontal,
  SlidersHorizontal,
  WandSparkles,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement, RefObject } from 'react';
import {
  hasImageAdjustments,
  imageAdjustmentFilter,
  type LocalImageAdjustments,
} from '../core/localImageTransforms';
import type { BlockRecord } from '../core/types';
import type { ExecutionConnectionSummary } from '../core/executionProviders';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import { ImageAnnotationEditor, type AnnotationComposite } from './ImageAnnotationEditor';
import {
  annotationDraftMatches,
  type AnnotationDraft,
  type AnnotationDraftContent,
  type AnnotationManifest,
} from '../core/imageAnnotations';
import { TooltipIconButton, TooltipWrapper } from './Tooltip';

type ImageTool = 'quick-edit' | 'annotation-edit' | 'create-similar' | 'adjust' | 'more';

interface ContextToolbarProps {
  annotationConnections?: ExecutionConnectionSummary[];
  preferredAnnotationConnectionId?: string;
  canvasZoom: number;
  annotationEditorOpenRequest?: {
    draft: AnnotationDraft;
    requestId: number;
  };
  selectedBlock?: BlockRecord;
  selectedImageUrl?: string;
  onCreateLocalEdit: (input: {
    body: string;
    capabilityId: 'image.local_adjust';
    params: LocalImageAdjustments;
    title: string;
  }) => void;
  onRunAnnotationEdit: (input: {
    instruction: string;
    manifest: AnnotationManifest;
    composite: AnnotationComposite;
    connectionId: string;
    historical: boolean;
    variationCount: number;
  }) => void;
  onAnnotationDraftChange: (draft: AnnotationDraftContent) => void;
  onAnnotationDraftFlush: () => void;
  onAnnotationEditorOpenRequestHandled: () => void;
  onCreateSimilar: () => void;
  onDownloadImage: () => void;
  onReplaceImage: () => void;
  onRunQuickEdit: (input: { instruction: string }) => void;
}

export function ContextToolbar({
  annotationConnections = [],
  preferredAnnotationConnectionId,
  canvasZoom,
  annotationEditorOpenRequest,
  selectedBlock,
  selectedImageUrl,
  onAnnotationDraftChange,
  onAnnotationDraftFlush,
  onAnnotationEditorOpenRequestHandled,
  onRunAnnotationEdit,
  onCreateSimilar,
  onCreateLocalEdit,
  onDownloadImage,
  onReplaceImage,
  onRunQuickEdit,
}: ContextToolbarProps): ReactElement | null {
  const [activeTool, setActiveTool] = useState<ImageTool | null>(null);
  const initialAnnotationDraft = annotationDraftForBlock(selectedBlock);
  const [historicalAnnotationDraft, setHistoricalAnnotationDraft] = useState<AnnotationDraft | undefined>();
  const [annotationInstruction, setAnnotationInstruction] = useState(
    () => initialAnnotationDraft?.globalInstruction ?? '',
  );
  const [annotationOffset, setAnnotationOffset] = useState({ x: 0, y: 0 });
  const [adjustForm, setAdjustForm] = useState({ brightness: 0, contrast: 0, saturation: 0 });
  const [isAnnotationDragging, setIsAnnotationDragging] = useState(false);
  const [quickEditInstruction, setQuickEditInstruction] = useState('');
  const annotationDragRef = useRef({ startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const pendingAnnotationDraftRef = useRef<AnnotationDraftContent | undefined>(undefined);
  const annotationDraftSaveTimerRef = useRef<number | undefined>(undefined);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!selectedBlock || selectedBlock.type !== 'image') return;
    setHistoricalAnnotationDraft(undefined);
    setAnnotationInstruction(annotationDraftForBlock(selectedBlock)?.globalInstruction ?? '');
    setActiveTool(null);
    setAdjustForm({ brightness: 0, contrast: 0, saturation: 0 });
    setAnnotationOffset({ x: 0, y: 0 });
  }, [selectedBlock?.blockId, selectedBlock?.type, selectedImageUrl]);

  useEffect(() => {
    if (!annotationEditorOpenRequest || selectedBlock?.type !== 'image' || !selectedImageUrl) return;
    setHistoricalAnnotationDraft(structuredClone(annotationEditorOpenRequest.draft));
    setAnnotationInstruction(annotationEditorOpenRequest.draft.globalInstruction);
    setActiveTool('annotation-edit');
    onAnnotationEditorOpenRequestHandled();
  }, [annotationEditorOpenRequest, onAnnotationEditorOpenRequestHandled, selectedBlock?.type, selectedImageUrl]);

  useEffect(() => () => {
    if (annotationDraftSaveTimerRef.current !== undefined) {
      window.clearTimeout(annotationDraftSaveTimerRef.current);
    }
  }, []);

  function queueAnnotationDraftChange(draft: AnnotationDraftContent): void {
    if (historicalAnnotationDraft) {
      setHistoricalAnnotationDraft((current) => current ? {
        ...current,
        globalInstruction: draft.globalInstruction,
        marks: structuredClone(draft.marks),
      } : current);
      return;
    }
    pendingAnnotationDraftRef.current = draft;
    if (annotationDraftSaveTimerRef.current !== undefined) {
      window.clearTimeout(annotationDraftSaveTimerRef.current);
    }
    annotationDraftSaveTimerRef.current = window.setTimeout(() => {
      annotationDraftSaveTimerRef.current = undefined;
      const pendingDraft = pendingAnnotationDraftRef.current;
      pendingAnnotationDraftRef.current = undefined;
      if (pendingDraft) onAnnotationDraftChange(pendingDraft);
    }, 120);
  }

  function flushAnnotationDraft(): void {
    if (annotationDraftSaveTimerRef.current !== undefined) {
      window.clearTimeout(annotationDraftSaveTimerRef.current);
      annotationDraftSaveTimerRef.current = undefined;
    }
    const pendingDraft = pendingAnnotationDraftRef.current;
    pendingAnnotationDraftRef.current = undefined;
    if (pendingDraft) onAnnotationDraftChange(pendingDraft);
    onAnnotationDraftFlush();
  }

  useEffect(() => {
    if (!isAnnotationDragging) return;

    function onPointerMove(event: PointerEvent): void {
      const drag = annotationDragRef.current;
      setAnnotationOffset({
        x: clamp(event.clientX - drag.startX + drag.baseX, -window.innerWidth / 2 + 160, window.innerWidth / 2 - 160),
        y: clamp(event.clientY - drag.startY + drag.baseY, -64, Math.max(0, window.innerHeight - 220)),
      });
    }

    function onPointerUp(): void {
      setIsAnnotationDragging(false);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  }, [isAnnotationDragging]);

  const hasImageAsset = Boolean(selectedImageUrl);
  const activeAnnotationDraft = historicalAnnotationDraft ?? annotationDraftForBlock(selectedBlock);
  const visibleActiveTool = selectedBlock?.type === 'image' && hasImageAsset ? activeTool : null;

  useDismissiblePopover({
    active: Boolean(visibleActiveTool && visibleActiveTool !== 'annotation-edit'),
    additionalRefs: [popoverRef],
    onDismiss: () => {
      setActiveTool(null);
      setIsAnnotationDragging(false);
    },
    rootRef: dockRef,
  });

  if (!selectedBlock || selectedBlock.type !== 'image') {
    return null;
  }

  function toggleTool(tool: ImageTool): void {
    setActiveTool((current) => (current === tool ? null : tool));
  }

  function beginAnnotationDrag(event: ReactPointerEvent<HTMLDivElement>): void {
    if ((event.target as HTMLElement).closest('button, input, textarea')) return;
    annotationDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      baseX: annotationOffset.x,
      baseY: annotationOffset.y,
    };
    setIsAnnotationDragging(true);
  }

  if (!hasImageAsset) return null;

  const popoverScale = clamp(canvasZoom, 0.45, 2.2);
  const canReplaceImage = !selectedBlock.data.sourceExecutionId && !selectedBlock.data.operationBlockId;

  return (
    <div
      ref={dockRef}
      className="context-dock nodrag nopan nowheel"
      style={{ '--context-popover-scale': popoverScale } as CSSProperties}
      aria-label={t('context.selectedTools')}
    >
      <div className="context-toolbar">
        <IconButton label={t('context.quickEdit')} onClick={() => toggleTool('quick-edit')}>
          <WandSparkles size={16} />
        </IconButton>
        <IconButton label={t('context.annotateEdit')} onClick={() => toggleTool('annotation-edit')}>
          <MessageSquareText size={16} />
        </IconButton>
        <IconButton label={t('context.createSimilar')} onClick={() => toggleTool('create-similar')}>
          <ImagePlus size={16} />
        </IconButton>
        <IconButton disabled label={`${t('context.crop')} · ${t('context.unavailable')}`} onClick={() => undefined}>
          <Crop size={16} />
        </IconButton>
        <IconButton label={t('context.adjust')} onClick={() => toggleTool('adjust')}>
          <SlidersHorizontal size={16} />
        </IconButton>
        <IconButton label={t('context.downloadImage')} onClick={onDownloadImage}>
          <Download size={16} />
        </IconButton>
        {canReplaceImage ? (
          <IconButton label={t('context.replaceImage')} onClick={onReplaceImage}>
            <ImageUp size={16} />
          </IconButton>
        ) : null}
        <IconButton label={t('context.moreTools')} onClick={() => toggleTool('more')}>
          <MoreHorizontal size={16} />
        </IconButton>
      </div>
      {visibleActiveTool ? (
        <ImageToolPopover
          annotationInstruction={annotationInstruction}
          annotationDraft={activeAnnotationDraft}
          annotationConnections={annotationConnections}
          preferredAnnotationConnectionId={preferredAnnotationConnectionId}
          isHistoricalAnnotationSession={Boolean(historicalAnnotationDraft)}
          adjustForm={adjustForm}
          imageUrl={selectedImageUrl}
          popoverScale={popoverScale}
          popoverRef={popoverRef}
          quickEditInstruction={quickEditInstruction}
          selectedBlock={selectedBlock}
          tool={visibleActiveTool}
          annotationPopoverStyle={{
            transform: `translate(calc(-50% + ${annotationOffset.x}px), ${annotationOffset.y}px)`,
          }}
          onAnnotationInstructionChange={setAnnotationInstruction}
          onAnnotationDraftChange={queueAnnotationDraftChange}
          onAnnotationPanelPointerDown={beginAnnotationDrag}
          onClose={() => {
            if (historicalAnnotationDraft) {
              setHistoricalAnnotationDraft(undefined);
            } else {
              flushAnnotationDraft();
            }
            setActiveTool(null);
          }}
          onAdjustFormChange={setAdjustForm}
          onCreateLocalEdit={onCreateLocalEdit}
          onCreateSimilar={onCreateSimilar}
          onRunAnnotationEdit={(input) => {
            const historical = Boolean(historicalAnnotationDraft);
            if (historicalAnnotationDraft) {
              setHistoricalAnnotationDraft(undefined);
            } else {
              flushAnnotationDraft();
            }
            onRunAnnotationEdit({ ...input, historical });
            setActiveTool(null);
          }}
          onQuickEditInstructionChange={setQuickEditInstruction}
          onRunQuickEdit={() => onRunQuickEdit({ instruction: quickEditInstruction })}
        />
      ) : null}
    </div>
  );
}

function ImageToolPopover({
  annotationInstruction,
  annotationDraft,
  annotationConnections,
  preferredAnnotationConnectionId,
  isHistoricalAnnotationSession,
  adjustForm,
  imageUrl,
  popoverScale,
  popoverRef,
  quickEditInstruction,
  selectedBlock,
  tool,
  annotationPopoverStyle,
  onAnnotationInstructionChange,
  onAnnotationDraftChange,
  onAnnotationPanelPointerDown,
  onClose,
  onAdjustFormChange,
  onCreateLocalEdit,
  onCreateSimilar,
  onRunAnnotationEdit,
  onQuickEditInstructionChange,
  onRunQuickEdit,
}: {
  annotationInstruction: string;
  annotationDraft?: AnnotationDraft;
  annotationConnections: ExecutionConnectionSummary[];
  preferredAnnotationConnectionId?: string;
  isHistoricalAnnotationSession: boolean;
  adjustForm: LocalImageAdjustments;
  imageUrl?: string;
  popoverScale: number;
  popoverRef: RefObject<HTMLDivElement | null>;
  quickEditInstruction: string;
  selectedBlock: BlockRecord;
  tool: ImageTool;
  annotationPopoverStyle?: CSSProperties;
  onAnnotationInstructionChange: (instruction: string) => void;
  onAnnotationDraftChange: (draft: AnnotationDraftContent) => void;
  onAnnotationPanelPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClose: () => void;
  onAdjustFormChange: (form: LocalImageAdjustments) => void;
  onCreateLocalEdit: (input: {
    body: string;
    capabilityId: 'image.local_adjust';
    params: LocalImageAdjustments;
    title: string;
  }) => void;
  onCreateSimilar: () => void;
  onRunAnnotationEdit: (input: {
    instruction: string;
    manifest: AnnotationManifest;
    composite: AnnotationComposite;
    connectionId: string;
    variationCount: number;
  }) => void;
  onQuickEditInstructionChange: (instruction: string) => void;
  onRunQuickEdit: () => void;
}): ReactElement {
  const { t } = useI18n();

  if (tool === 'create-similar') {
    return (
      <div ref={popoverRef} className="context-popover" aria-label={t('context.createSimilar')}>
        <h2>{t('context.createSimilar')}</h2>
        <button type="button" className="primary-popover-button" onClick={onCreateSimilar}>
          {t('context.run')}
        </button>
      </div>
    );
  }

  if (tool === 'quick-edit') {
    return (
      <div ref={popoverRef} className="context-popover" aria-label={t('context.quickEdit')}>
        <h2>{t('context.quickEdit')}</h2>
        <textarea
          placeholder={t('context.describeChange')}
          rows={3}
          value={quickEditInstruction}
          onChange={(event) => onQuickEditInstructionChange(event.target.value)}
        />
        <button type="button" className="primary-popover-button" onClick={onRunQuickEdit}>
          {t('context.run')}
        </button>
      </div>
    );
  }

  if (tool === 'annotation-edit') {
    const annotationEditor = (
      <div
        className="annotation-modal-layer nodrag nopan nowheel"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div ref={popoverRef} className="context-popover annotation-popover" style={annotationPopoverStyle} aria-label={t('context.annotateEdit')}>
          <div className="context-popover-header annotation-popover-header" onPointerDown={onAnnotationPanelPointerDown}>
            <h2>{t('context.annotateEdit')}</h2>
            <IconButton label={t('context.close')} onClick={onClose}>
              <X size={16} />
            </IconButton>
          </div>
          {isHistoricalAnnotationSession ? (
            <div className="annotation-history-session-notice" role="status">
              <History aria-hidden="true" size={16} />
              <div>
                <strong>{t('context.historicalAnnotationSession')}</strong>
                <span>{t('context.historicalAnnotationSessionBody')}</span>
              </div>
            </div>
          ) : null}
          <ImageAnnotationEditor
            connectionOptions={annotationConnections}
            defaultConnectionId={preferredAnnotationConnectionId}
            imageUrl={imageUrl}
            initialDraft={annotationDraft}
            instruction={annotationInstruction}
            runLabel={t('context.run')}
            title={t('context.annotateEdit')}
            unavailableLabel={t('context.annotationSourceMissing')}
            onInstructionChange={onAnnotationInstructionChange}
            onDraftChange={onAnnotationDraftChange}
            onRun={onRunAnnotationEdit}
          />
        </div>
      </div>
    );
    return createPortal(annotationEditor, document.body);
  }

  if (tool === 'adjust') {
    return (
      <div ref={popoverRef} className="context-popover nodrag nopan nowheel" aria-label={t('context.adjust')}>
        <h2>{t('context.adjust')}</h2>
        {imageUrl ? (
          <div className="local-adjust-preview">
            <img alt="" src={imageUrl} style={{ filter: imageAdjustmentFilter(adjustForm) }} />
          </div>
        ) : null}
        <RangeControl
          label={t('context.brightness')}
          value={adjustForm.brightness}
          onChange={(brightness) => onAdjustFormChange({ ...adjustForm, brightness })}
        />
        <RangeControl
          label={t('context.contrast')}
          value={adjustForm.contrast}
          onChange={(contrast) => onAdjustFormChange({ ...adjustForm, contrast })}
        />
        <RangeControl
          label={t('context.saturation')}
          value={adjustForm.saturation}
          onChange={(saturation) => onAdjustFormChange({ ...adjustForm, saturation })}
        />
        <button
          type="button"
          className="primary-popover-button"
          disabled={!hasImageAdjustments(adjustForm)}
          onClick={() =>
            onCreateLocalEdit({
              capabilityId: 'image.local_adjust',
              title: t('context.adjust'),
              body: t('context.adjust'),
              params: adjustForm,
            })
          }
        >
          {t('context.run')}
        </button>
      </div>
    );
  }

  return (
    <div ref={popoverRef} className="context-popover" aria-label={t('context.moreTools')}>
      <h2>{t('context.more')}</h2>
      <div className="tool-list">
        <button type="button" disabled title={t('context.unavailable')}>
          <Maximize2 size={15} />
          {t('context.expand')}
        </button>
        <button type="button" disabled title={t('context.unavailable')}>{t('context.relight')}</button>
        <button type="button" disabled title={t('context.unavailable')}>{t('context.multiAngle')}</button>
        <button type="button" disabled title={t('context.unavailable')}>{t('context.removeBackground')}</button>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function annotationDraftForBlock(block: BlockRecord | undefined): AnnotationDraft | undefined {
  if (!block || block.type !== 'image') return undefined;
  const sourceAssetId = typeof block.data.assetId === 'string' ? block.data.assetId : undefined;
  return annotationDraftMatches(block.data.annotationDraft, sourceAssetId)
    ? block.data.annotationDraft
    : undefined;
}

function RangeControl({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: number) => void;
  value: number;
}): ReactElement {
  return (
    <label className="range-control nodrag nopan">
      <span>{label}</span>
      <input
        className="nodrag nopan"
        type="range"
        min="-100"
        max="100"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output>{value > 0 ? `+${value}` : value}</output>
    </label>
  );
}

function IconButton({
  children,
  disabled,
  onClick,
  label,
}: {
  children: ReactElement;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}): ReactElement {
  const button = (
    <TooltipIconButton disabled={disabled} label={label} onClick={onClick}>
      {children}
    </TooltipIconButton>
  );
  return disabled ? <TooltipWrapper className="disabled-tool-wrapper" label={label}>{button}</TooltipWrapper> : button;
}
