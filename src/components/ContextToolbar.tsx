import {
  Crop,
  Download,
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
import type { BlockRecord } from '../core/types';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import { ImageAnnotationEditor, type AnnotationComposite } from './ImageAnnotationEditor';
import { TooltipIconButton } from './Tooltip';

type ImageTool = 'quick-edit' | 'annotation-edit' | 'create-similar' | 'crop' | 'adjust' | 'more';
export type ExecutionRoute = 'codex_mcp';

interface ContextToolbarProps {
  canvasZoom: number;
  selectedBlock?: BlockRecord;
  selectedImageUrl?: string;
  onCreateLocalEdit: (input: {
    body: string;
    capabilityId: 'image.local_adjust' | 'image.local_crop' | 'image.local_expand';
    params?: Record<string, unknown>;
    title: string;
  }) => void;
  onRunAnnotationEdit: (input: {
    instruction: string;
    composite: AnnotationComposite;
    route: ExecutionRoute;
  }) => void;
  onCreateSimilar: (input: { route: ExecutionRoute }) => void;
  onDownloadImage: () => void;
  onReplaceImage: () => void;
  onRunQuickEdit: (input: { instruction: string; route: ExecutionRoute }) => void;
}

export function ContextToolbar({
  canvasZoom,
  selectedBlock,
  selectedImageUrl,
  onRunAnnotationEdit,
  onCreateSimilar,
  onCreateLocalEdit,
  onDownloadImage,
  onReplaceImage,
  onRunQuickEdit,
}: ContextToolbarProps): ReactElement | null {
  const [activeTool, setActiveTool] = useState<ImageTool | null>(null);
  const [annotationInstruction, setAnnotationInstruction] = useState('');
  const [annotationOffset, setAnnotationOffset] = useState({ x: 0, y: 0 });
  const [adjustForm, setAdjustForm] = useState({ brightness: 0, contrast: 0, saturation: 0 });
  const [isAnnotationDragging, setIsAnnotationDragging] = useState(false);
  const [quickEditInstruction, setQuickEditInstruction] = useState('');
  const annotationDragRef = useRef({ startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const dockRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const { t } = useI18n();
  const executionRoute: ExecutionRoute = 'codex_mcp';

  useEffect(() => {
    if (!selectedBlock || selectedBlock.type !== 'image') return;
    setActiveTool(null);
    setAdjustForm({ brightness: 0, contrast: 0, saturation: 0 });
    setAnnotationOffset({ x: 0, y: 0 });
  }, [selectedBlock?.blockId, selectedBlock?.type, selectedImageUrl]);

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
  const visibleActiveTool = selectedBlock?.type === 'image' && hasImageAsset ? activeTool : null;

  useDismissiblePopover({
    active: Boolean(visibleActiveTool),
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
      className="context-dock"
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
        <IconButton label={t('context.crop')} onClick={() => toggleTool('crop')}>
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
          executionRoute={executionRoute}
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
          onAnnotationPanelPointerDown={beginAnnotationDrag}
          onClose={() => setActiveTool(null)}
          onAdjustFormChange={setAdjustForm}
          onCreateLocalEdit={onCreateLocalEdit}
          onCreateSimilar={() => onCreateSimilar({ route: executionRoute })}
          onRunAnnotationEdit={(input) => onRunAnnotationEdit({ ...input, route: executionRoute })}
          onQuickEditInstructionChange={setQuickEditInstruction}
          onRunQuickEdit={() => onRunQuickEdit({ instruction: quickEditInstruction, route: executionRoute })}
        />
      ) : null}
    </div>
  );
}

function ImageToolPopover({
  annotationInstruction,
  executionRoute,
  adjustForm,
  imageUrl,
  popoverScale,
  popoverRef,
  quickEditInstruction,
  selectedBlock,
  tool,
  annotationPopoverStyle,
  onAnnotationInstructionChange,
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
  executionRoute: ExecutionRoute;
  adjustForm: { brightness: number; contrast: number; saturation: number };
  imageUrl?: string;
  popoverScale: number;
  popoverRef: RefObject<HTMLDivElement | null>;
  quickEditInstruction: string;
  selectedBlock: BlockRecord;
  tool: ImageTool;
  annotationPopoverStyle?: CSSProperties;
  onAnnotationInstructionChange: (instruction: string) => void;
  onAnnotationPanelPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClose: () => void;
  onAdjustFormChange: (form: { brightness: number; contrast: number; saturation: number }) => void;
  onCreateLocalEdit: (input: {
    body: string;
    capabilityId: 'image.local_adjust' | 'image.local_crop' | 'image.local_expand';
    params?: Record<string, unknown>;
    title: string;
  }) => void;
  onCreateSimilar: () => void;
  onRunAnnotationEdit: (input: { instruction: string; composite: AnnotationComposite }) => void;
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
      <div ref={popoverRef} className="context-popover annotation-popover" style={annotationPopoverStyle} aria-label={t('context.annotateEdit')}>
        <div className="context-popover-header annotation-popover-header" onPointerDown={onAnnotationPanelPointerDown}>
          <h2>{t('context.annotateEdit')}</h2>
          <IconButton label={t('context.close')} onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <ImageAnnotationEditor
          imageUrl={imageUrl}
          instruction={annotationInstruction}
          placeholder={t('context.annotationNotePlaceholder')}
          runLabel={t('context.run')}
          title={t('context.annotateEdit')}
          unavailableLabel={t('context.annotationSourceMissing')}
          onInstructionChange={onAnnotationInstructionChange}
          onRun={onRunAnnotationEdit}
        />
      </div>
    );
    return createPortal(annotationEditor, document.body);
  }

  if (tool === 'crop') {
    return (
      <div ref={popoverRef} className="context-popover" aria-label={t('context.crop')}>
        <h2>{t('context.crop')}</h2>
        <div className="tool-grid">
          {['free', '1:1', '16:9', '9:16'].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() =>
                onCreateLocalEdit({
                  capabilityId: 'image.local_crop',
                  title: t('context.crop'),
                  body: preset === 'free' ? t('context.free') : `${t('context.crop')} ${preset}`,
                  params: { cropAspectRatio: preset },
                })
              }
            >
              {preset === 'free' ? t('context.free') : preset}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (tool === 'adjust') {
    return (
      <div ref={popoverRef} className="context-popover" aria-label={t('context.adjust')}>
        <h2>{t('context.adjust')}</h2>
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
        <button
          type="button"
          onClick={() =>
            onCreateLocalEdit({
              capabilityId: 'image.local_expand',
              title: t('context.expand'),
              body: t('context.expand'),
            })
          }
        >
          <Maximize2 size={15} />
          {t('context.expand')}
        </button>
        <button type="button">{t('context.relight')}</button>
        <button type="button">{t('context.multiAngle')}</button>
        <button type="button">{t('context.removeBackground')}</button>
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
    <label className="range-control">
      <span>{label}</span>
      <input
        type="range"
        min="-100"
        max="100"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function IconButton({
  children,
  onClick,
  label,
}: {
  children: ReactElement;
  onClick: () => void;
  label: string;
}): ReactElement {
  return (
    <TooltipIconButton label={label} onClick={onClick}>
      {children}
    </TooltipIconButton>
  );
}
