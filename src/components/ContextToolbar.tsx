import {
  Download,
  ImagePlus,
  ImageUp,
  MoreHorizontal,
  WandSparkles,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  ReactElement,
  ReactNode,
  RefObject,
} from 'react';
import type { BlockRecord } from '../core/types';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import { TooltipIconButton, TooltipWrapper } from './Tooltip';

type ImageTool = 'quick-edit' | 'create-similar' | 'more';

interface ContextToolbarProps {
  canvasZoom: number;
  pluginActions?: ReactNode;
  selectedBlock?: BlockRecord;
  selectedImageUrl?: string;
  onCreateSimilar: () => void;
  onDownloadImage: () => void;
  onInteract?: () => void;
  onReplaceImage: () => void;
  onRunQuickEdit: (input: { instruction: string }) => void;
}

export function ContextToolbar({
  canvasZoom,
  pluginActions,
  selectedBlock,
  selectedImageUrl,
  onCreateSimilar,
  onDownloadImage,
  onInteract,
  onReplaceImage,
  onRunQuickEdit,
}: ContextToolbarProps): ReactElement | null {
  const [activeTool, setActiveTool] = useState<ImageTool | null>(null);
  const [quickEditInstruction, setQuickEditInstruction] = useState('');
  const dockRef = useRef<HTMLDivElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const { t } = useI18n();

  useEffect(() => {
    if (!selectedBlock || selectedBlock.type !== 'image') return;
    setActiveTool(null);
  }, [selectedBlock?.blockId, selectedBlock?.type, selectedImageUrl]);

  const hasImageAsset = Boolean(selectedImageUrl);
  const visibleActiveTool = selectedBlock?.type === 'image' && hasImageAsset ? activeTool : null;

  useDismissiblePopover({
    active: Boolean(visibleActiveTool),
    additionalRefs: [popoverRef],
    onDismiss: () => setActiveTool(null),
    rootRef: dockRef,
  });

  if (!selectedBlock || selectedBlock.type !== 'image') {
    return null;
  }

  function toggleTool(tool: ImageTool): void {
    setActiveTool((current) => (current === tool ? null : tool));
    onInteract?.();
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
        <IconButton label={t('context.createSimilar')} onClick={() => toggleTool('create-similar')}>
          <ImagePlus size={16} />
        </IconButton>
        <IconButton
          label={t('context.downloadImage')}
          onClick={() => {
            onDownloadImage();
            onInteract?.();
          }}
        >
          <Download size={16} />
        </IconButton>
        {pluginActions}
        {canReplaceImage ? (
          <IconButton
            label={t('context.replaceImage')}
            onClick={() => {
              onReplaceImage();
              onInteract?.();
            }}
          >
            <ImageUp size={16} />
          </IconButton>
        ) : null}
        <IconButton label={t('context.moreTools')} onClick={() => toggleTool('more')}>
          <MoreHorizontal size={16} />
        </IconButton>
      </div>
      {visibleActiveTool ? (
        <ImageToolPopover
          popoverRef={popoverRef}
          quickEditInstruction={quickEditInstruction}
          tool={visibleActiveTool}
          onCreateSimilar={onCreateSimilar}
          onQuickEditInstructionChange={setQuickEditInstruction}
          onRunQuickEdit={() => onRunQuickEdit({ instruction: quickEditInstruction })}
        />
      ) : null}
    </div>
  );
}

function ImageToolPopover({
  popoverRef,
  quickEditInstruction,
  tool,
  onCreateSimilar,
  onQuickEditInstructionChange,
  onRunQuickEdit,
}: {
  popoverRef: RefObject<HTMLDivElement | null>;
  quickEditInstruction: string;
  tool: ImageTool;
  onCreateSimilar: () => void;
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

  return (
    <div ref={popoverRef} className="context-popover" aria-label={t('context.moreTools')}>
      <h2>{t('context.more')}</h2>
      <div className="tool-list">
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
