import { Hand, MousePointer2 } from 'lucide-react';
import type { ReactElement } from 'react';
import type { PackageComposerInvocation } from '../core/packageComposer';
import { shouldShowSkillDock } from '../core/releaseFeatures';
import type { BlockType, BoardSnapshot } from '../core/types';
import { useI18n } from '../i18n';
import { SkillQuickInputComposer } from './SkillQuickInputComposer';
import { WorkspaceCreateMenu } from './WorkspaceCreateMenu';
import type {
  UnifiedComposerAgentInput,
  UnifiedComposerImageDraftInput,
  UnifiedComposerVideoDraftInput,
} from './UnifiedComposerProvider';
import { TooltipIconButton } from './Tooltip';

const skillDockVisible = shouldShowSkillDock({ DEV: import.meta.env?.DEV === true });

export type CanvasTool = 'group' | 'select' | 'pan';

interface FloatingToolbarProps {
  activeTool: CanvasTool;
  agentDisabled?: boolean;
  composerVisible?: boolean;
  onAttachFiles?: Parameters<typeof SkillQuickInputComposer>[0]['onAttachFiles'];
  onAddBlock: (type: Extract<BlockType, 'group' | 'image' | 'operation' | 'text' | 'video'>) => void;
  onCreateImage: (input: UnifiedComposerImageDraftInput) => Promise<void>;
  onCreateVideoDraft?: (input: UnifiedComposerVideoDraftInput) => Promise<void>;
  onInvokeEntryPoint: (invocation: PackageComposerInvocation) => Promise<void>;
  onSubmitAgentMessage: (input: UnifiedComposerAgentInput) => void;
  onSetActiveTool: (tool: CanvasTool) => void;
  onUploadAsset: () => void;
  snapshot: BoardSnapshot;
}

export function FloatingToolbar({
  activeTool,
  agentDisabled,
  composerVisible = true,
  onAttachFiles,
  onAddBlock,
  onCreateImage,
  onCreateVideoDraft,
  onInvokeEntryPoint,
  onSubmitAgentMessage,
  onSetActiveTool,
  onUploadAsset,
  snapshot,
}: FloatingToolbarProps): ReactElement {
  const { t } = useI18n();

  return (
    <>
      {skillDockVisible && composerVisible ? (
        <SkillQuickInputComposer
          agentDisabled={agentDisabled}
          onAttachFiles={onAttachFiles}
          snapshot={snapshot}
          onCreateImage={onCreateImage}
          onCreateVideoDraft={onCreateVideoDraft}
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
        <MousePointer2 size={16} strokeWidth={1.75} />
      </ToolButton>
      <ToolButton
        isPressed={activeTool === 'pan'}
        label={t('toolbar.panTool')}
        onClick={() => onSetActiveTool('pan')}
      >
        <Hand size={16} strokeWidth={1.75} />
      </ToolButton>
      <div className="toolbar-divider" />
      <WorkspaceCreateMenu
        onAddBlock={onAddBlock}
        onUploadAsset={onUploadAsset}
      />
      </nav>
    </>
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
