import {
  FileText,
  Hand,
  ImageIcon,
  MousePointer2,
  Video,
} from 'lucide-react';
import type { ReactElement } from 'react';
import type { BlockType } from '../core/types';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

export type CanvasTool = 'select' | 'pan';

interface FloatingToolbarProps {
  activeTool: CanvasTool;
  onAddBlock: (type: Extract<BlockType, 'image' | 'text' | 'video'>) => void;
  onSetActiveTool: (tool: CanvasTool) => void;
}

export function FloatingToolbar({
  activeTool,
  onAddBlock,
  onSetActiveTool,
}: FloatingToolbarProps): ReactElement {
  const { t } = useI18n();

  return (
    <nav className="floating-toolbar" aria-label={t('canvas.tools')}>
      <ToolButton
        isPressed={activeTool === 'select'}
        label={t('toolbar.selectTool')}
        onClick={() => onSetActiveTool('select')}
      >
        <MousePointer2 size={18} />
      </ToolButton>
      <ToolButton
        isPressed={activeTool === 'pan'}
        label={t('toolbar.panTool')}
        onClick={() => onSetActiveTool('pan')}
      >
        <Hand size={18} />
      </ToolButton>
      <div className="toolbar-divider" />
      <ToolButton label={t('toolbar.addText')} onClick={() => onAddBlock('text')}>
        <FileText size={18} />
      </ToolButton>
      <ToolButton label={t('toolbar.addImage')} onClick={() => onAddBlock('image')}>
        <ImageIcon size={18} />
      </ToolButton>
      <ToolButton label={t('toolbar.addVideo')} onClick={() => onAddBlock('video')}>
        <Video size={18} />
      </ToolButton>
    </nav>
  );
}

function ToolButton({
  children,
  disabled,
  isPressed,
  label,
  onClick,
}: {
  children: ReactElement;
  disabled?: boolean;
  isPressed?: boolean;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <TooltipIconButton disabled={disabled} isPressed={isPressed} label={label} onClick={onClick}>
      {children}
    </TooltipIconButton>
  );
}
