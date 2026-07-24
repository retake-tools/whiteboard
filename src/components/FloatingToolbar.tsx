import {
  Clapperboard,
  FileText,
  Hand,
  ImageIcon,
  Layers3,
  MousePointer2,
  Play,
  Shapes,
  Sparkles,
  Video,
} from 'lucide-react';
import type { ReactElement } from 'react';
import type { PackageComposerInvocation } from '../core/packageComposer';
import { shouldShowSkillDock } from '../core/releaseFeatures';
import type { BlockType, BoardSnapshot } from '../core/types';
import { useI18n } from '../i18n';
import { SkillQuickInputComposer } from './SkillQuickInputComposer';
import type { UnifiedComposerAgentInput } from './UnifiedComposerProvider';
import { TooltipIconButton } from './Tooltip';

const skillDockVisible = shouldShowSkillDock({ DEV: import.meta.env?.DEV === true });

export type CanvasTool = 'group' | 'select' | 'pan';

interface FloatingToolbarProps {
  activeTool: CanvasTool;
  agentDisabled?: boolean;
  composerVisible?: boolean;
  onAddBlock: (type: Extract<BlockType, 'group' | 'image' | 'operation' | 'text' | 'video'>) => void;
  onCreateImageToImage: () => void;
  onCreateTextToImage: () => void;
  onInvokeEntryPoint: (invocation: PackageComposerInvocation) => void;
  onSubmitAgentMessage: (input: UnifiedComposerAgentInput) => void;
  onSetActiveTool: (tool: CanvasTool) => void;
  snapshot: BoardSnapshot;
}

export function FloatingToolbar({
  activeTool,
  agentDisabled,
  composerVisible = true,
  onAddBlock,
  onCreateImageToImage,
  onCreateTextToImage,
  onInvokeEntryPoint,
  onSubmitAgentMessage,
  onSetActiveTool,
  snapshot,
}: FloatingToolbarProps): ReactElement {
  const { t } = useI18n();

  return (
    <>
      {skillDockVisible && composerVisible ? (
        <SkillQuickInputComposer
          agentDisabled={agentDisabled}
          snapshot={snapshot}
          onInvokeEntryPoint={onInvokeEntryPoint}
          onSubmitAgentMessage={onSubmitAgentMessage}
        />
      ) : null}
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
      <ToolbarMenu icon={<Shapes size={18} />} label={t('toolbar.basicElements')}>
        <MenuItem icon={<FileText size={15} />} label={t('toolbar.addText')} onClick={() => onAddBlock('text')} />
        <MenuItem icon={<ImageIcon size={15} />} label={t('toolbar.addImage')} onClick={() => onAddBlock('image')} />
        <MenuItem icon={<Video size={15} />} label={t('toolbar.addVideo')} onClick={() => onAddBlock('video')} />
        <MenuItem icon={<Play size={15} />} label={t('toolbar.addOperation')} onClick={() => onAddBlock('operation')} />
      </ToolbarMenu>
      <ToolbarMenu icon={<Sparkles size={18} />} label={t('toolbar.generation')}>
        <MenuItem icon={<Sparkles size={15} />} label={t('toolbar.textToImage')} onClick={onCreateTextToImage} />
        <MenuItem icon={<ImageIcon size={15} />} label={t('toolbar.imageToImage')} onClick={onCreateImageToImage} />
        <MenuItem disabled icon={<ImageIcon size={15} />} label={t('toolbar.multiImageToImage')} />
        <MenuItem disabled icon={<Sparkles size={15} />} label={t('toolbar.styleTransfer')} />
        <MenuItem icon={<FileText size={15} />} label={t('toolbar.textToVideo')} onClick={() => onAddBlock('video')} />
        <MenuItem icon={<ImageIcon size={15} />} label={t('toolbar.imageToVideo')} onClick={() => onAddBlock('video')} />
        <MenuItem icon={<Clapperboard size={15} />} label={t('toolbar.firstLastFrameVideo')} onClick={() => onAddBlock('video')} />
      </ToolbarMenu>
      <div className="toolbar-divider" />
      <ToolButton isPressed={activeTool === 'group'} label={t('toolbar.addGroup')} onClick={() => onAddBlock('group')}>
        <Layers3 size={18} />
      </ToolButton>
      </nav>
    </>
  );
}

function ToolbarMenu({
  children,
  icon,
  label,
}: {
  children: ReactElement | ReactElement[];
  icon: ReactElement;
  label: string;
}): ReactElement {
  return (
    <div className="floating-toolbar-menu">
      <button type="button" className="floating-toolbar-menu-trigger" aria-label={label}>
        {icon}
      </button>
      <div className="floating-toolbar-submenu" role="menu" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

function MenuItem({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactElement;
  label: string;
  onClick?: () => void;
}): ReactElement {
  return (
    <button type="button" className="floating-toolbar-menu-item" disabled={disabled} role="menuitem" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
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
