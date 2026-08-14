import { MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type {
  CSSProperties,
  ReactElement,
  ReactNode,
} from 'react';
import type { BlockRecord } from '../core/types';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import { ImageContextCommandMenu } from './ImageContextCommandMenu';

type ImageTool = 'more';

interface ContextToolbarProps {
  canvasZoom: number;
  pluginActions?: ReactNode;
  pluginMenuActions?: ReactNode;
  selectedBlock?: BlockRecord;
  selectedImageUrl?: string;
  onDownloadImage: () => void;
  onInteract?: () => void;
  onRegenerate?: () => void;
  onReplaceImage: () => void;
}

export function ContextToolbar({
  canvasZoom,
  pluginActions,
  pluginMenuActions,
  selectedBlock,
  selectedImageUrl,
  onDownloadImage,
  onInteract,
  onRegenerate,
  onReplaceImage,
}: ContextToolbarProps): ReactElement | null {
  const [activeTool, setActiveTool] = useState<ImageTool | null>(null);
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
        {pluginActions}
        <button
          type="button"
          className="image-context-primary-action image-context-more-trigger"
          aria-controls="image-context-command-menu"
          aria-expanded={visibleActiveTool === 'more'}
          onClick={() => toggleTool('more')}
        >
          <MoreHorizontal size={16} />
          <span>{t('context.more')}</span>
        </button>
      </div>
      {visibleActiveTool ? (
        <ImageContextCommandMenu
          canReplaceImage={canReplaceImage}
          onClose={() => setActiveTool(null)}
          onDownloadImage={onDownloadImage}
          onInteract={onInteract}
          onRegenerate={onRegenerate}
          onReplaceImage={onReplaceImage}
          popoverRef={popoverRef}
          pluginActions={pluginMenuActions}
        />
      ) : null}
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
