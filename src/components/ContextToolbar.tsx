import {
  Crop,
  ImagePlus,
  Maximize2,
  MessageSquareText,
  MoreHorizontal,
  SlidersHorizontal,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from 'react';
import type { BlockRecord } from '../core/types';
import { useI18n } from '../i18n';
import { ImageAnnotationEditor, type AnnotationComposite } from './ImageAnnotationEditor';
import {
  createDefaultGenerationForm,
  generationFormToParams,
  ImageGenerationPanel,
  type ImageGenerationForm,
} from './ImageGenerationPanel';
import { TooltipIconButton } from './Tooltip';
import type { ImageGenerationParams } from '../core/imageOperations';

type ImageTool = 'quick-edit' | 'annotation-edit' | 'generate' | 'create-similar' | 'crop' | 'adjust' | 'more';
export type ExecutionRoute = 'codex_mcp';

interface ContextToolbarProps {
  canvasZoom: number;
  selectedBlock?: BlockRecord;
  selectedImageUrl?: string;
  onRunAnnotationEdit: (input: {
    instruction: string;
    composite: AnnotationComposite;
    route: ExecutionRoute;
  }) => void;
  onCreateSimilar: (input: { route: ExecutionRoute }) => void;
  onGenerateImage: (input: {
    generationParams: ImageGenerationParams;
    instruction: string;
    referenceFiles: File[];
    route: ExecutionRoute;
  }) => void;
  onImportImage: (file: File) => void;
  onRunQuickEdit: (input: { instruction: string; route: ExecutionRoute }) => void;
}

export function ContextToolbar({
  canvasZoom,
  selectedBlock,
  selectedImageUrl,
  onRunAnnotationEdit,
  onCreateSimilar,
  onGenerateImage,
  onImportImage,
  onRunQuickEdit,
}: ContextToolbarProps): ReactElement | null {
  const [activeTool, setActiveTool] = useState<ImageTool | null>(null);
  const [annotationInstruction, setAnnotationInstruction] = useState('');
  const [annotationOffset, setAnnotationOffset] = useState({ x: 0, y: 0 });
  const [generationForm, setGenerationForm] = useState<ImageGenerationForm>(() => createDefaultGenerationForm());
  const [isAnnotationDragging, setIsAnnotationDragging] = useState(false);
  const [quickEditInstruction, setQuickEditInstruction] = useState('');
  const annotationDragRef = useRef({ startX: 0, startY: 0, baseX: 0, baseY: 0 });
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { t } = useI18n();
  const executionRoute: ExecutionRoute = 'codex_mcp';

  useEffect(() => {
    if (!selectedBlock || selectedBlock.type !== 'image') return;
    setActiveTool(null);
    setAnnotationOffset({ x: 0, y: 0 });
    setGenerationForm(createDefaultGenerationForm(selectedBlock));
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

  useEffect(() => {
    if (activeTool !== 'annotation-edit') return;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setActiveTool(null);
    }

    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true });
  }, [activeTool]);

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

  function updateGenerationForm(updater: (current: ImageGenerationForm) => ImageGenerationForm): void {
    setGenerationForm((current) => updater(current));
  }

  const hasImageAsset = Boolean(selectedImageUrl);
  const visibleActiveTool = hasImageAsset || activeTool === 'generate' ? activeTool : null;
  const popoverScale = clamp(canvasZoom, 0.45, 2.2);

  return (
    <div
      className="context-dock"
      style={{ '--context-popover-scale': popoverScale } as CSSProperties}
      aria-label={t('context.selectedTools')}
    >
      <div className="context-toolbar">
        {!hasImageAsset ? (
          <>
            <IconButton label={t('context.importImage')} onClick={() => fileInputRef.current?.click()}>
              <Upload size={16} />
            </IconButton>
            <IconButton label={t('context.generateImage')} onClick={() => toggleTool('generate')}>
              <WandSparkles size={16} />
            </IconButton>
          </>
        ) : (
          <>
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
            <IconButton label={t('context.moreTools')} onClick={() => toggleTool('more')}>
              <MoreHorizontal size={16} />
            </IconButton>
          </>
        )}
      </div>
      <input
        ref={fileInputRef}
        className="hidden-file-input"
        type="file"
        accept="image/*"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = '';
          if (file) onImportImage(file);
        }}
      />
      {visibleActiveTool ? (
        <ImageToolPopover
          annotationInstruction={annotationInstruction}
          executionRoute={executionRoute}
          generationForm={generationForm}
          imageUrl={selectedImageUrl}
          popoverScale={popoverScale}
          quickEditInstruction={quickEditInstruction}
          selectedBlock={selectedBlock}
          tool={visibleActiveTool}
          annotationPopoverStyle={{
            transform: `translate(calc(-50% + ${annotationOffset.x}px), ${annotationOffset.y}px)`,
          }}
          onAnnotationInstructionChange={setAnnotationInstruction}
          onAnnotationPanelPointerDown={beginAnnotationDrag}
          onClose={() => setActiveTool(null)}
          onGenerateFormChange={updateGenerationForm}
          onCreateSimilar={() => onCreateSimilar({ route: executionRoute })}
          onRunAnnotationEdit={(input) => onRunAnnotationEdit({ ...input, route: executionRoute })}
          onRunGenerateImage={() =>
            onGenerateImage({
              generationParams: generationFormToParams(generationForm, selectedBlock),
              instruction: generationForm.instruction,
              referenceFiles: generationForm.referenceFiles,
              route: executionRoute,
            })
          }
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
  generationForm,
  imageUrl,
  popoverScale,
  quickEditInstruction,
  selectedBlock,
  tool,
  annotationPopoverStyle,
  onAnnotationInstructionChange,
  onAnnotationPanelPointerDown,
  onClose,
  onGenerateFormChange,
  onCreateSimilar,
  onRunAnnotationEdit,
  onRunGenerateImage,
  onQuickEditInstructionChange,
  onRunQuickEdit,
}: {
  annotationInstruction: string;
  executionRoute: ExecutionRoute;
  generationForm: ImageGenerationForm;
  imageUrl?: string;
  popoverScale: number;
  quickEditInstruction: string;
  selectedBlock: BlockRecord;
  tool: ImageTool;
  annotationPopoverStyle?: CSSProperties;
  onAnnotationInstructionChange: (instruction: string) => void;
  onAnnotationPanelPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onClose: () => void;
  onGenerateFormChange: (updater: (current: ImageGenerationForm) => ImageGenerationForm) => void;
  onCreateSimilar: () => void;
  onRunAnnotationEdit: (input: { instruction: string; composite: AnnotationComposite }) => void;
  onRunGenerateImage: () => void;
  onQuickEditInstructionChange: (instruction: string) => void;
  onRunQuickEdit: () => void;
}): ReactElement {
  const { t } = useI18n();

  if (tool === 'generate') {
    return (
      <ImageGenerationPanel
        form={generationForm}
        popoverScale={popoverScale}
        selectedBlock={selectedBlock}
        onChange={onGenerateFormChange}
        onRun={onRunGenerateImage}
      />
    );
  }

  if (tool === 'create-similar') {
    return (
      <div className="context-popover" aria-label={t('context.createSimilar')}>
        <h2>{t('context.createSimilar')}</h2>
        <button type="button" className="primary-popover-button" onClick={onCreateSimilar}>
          {t('context.run')}
        </button>
      </div>
    );
  }

  if (tool === 'quick-edit') {
    return (
      <div className="context-popover" aria-label={t('context.quickEdit')}>
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
      <div className="context-popover annotation-popover" style={annotationPopoverStyle} aria-label={t('context.annotateEdit')}>
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
      <div className="context-popover" aria-label={t('context.crop')}>
        <h2>{t('context.crop')}</h2>
        <div className="tool-grid">
          <button type="button">{t('context.free')}</button>
          <button type="button">1:1</button>
          <button type="button">16:9</button>
          <button type="button">9:16</button>
        </div>
      </div>
    );
  }

  if (tool === 'adjust') {
    return (
      <div className="context-popover" aria-label={t('context.adjust')}>
        <h2>{t('context.adjust')}</h2>
        <RangeControl label={t('context.brightness')} />
        <RangeControl label={t('context.contrast')} />
        <RangeControl label={t('context.saturation')} />
      </div>
    );
  }

  return (
    <div className="context-popover" aria-label={t('context.moreTools')}>
      <h2>{t('context.more')}</h2>
      <div className="tool-list">
        <button type="button">
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

function RangeControl({ label }: { label: string }): ReactElement {
  return (
    <label className="range-control">
      <span>{label}</span>
      <input type="range" min="-100" max="100" defaultValue="0" />
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
