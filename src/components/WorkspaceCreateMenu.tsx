import {
  FileText,
  ImageIcon,
  Layers3,
  Play,
  Plus,
  Upload,
  Video,
} from 'lucide-react';
import { useRef, useState, type ReactElement } from 'react';
import type { BlockType } from '../core/types';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';

interface WorkspaceCreateMenuProps {
  onAddBlock: (type: Extract<BlockType, 'group' | 'image' | 'operation' | 'text' | 'video'>) => void;
  onUploadAsset: () => void;
}

export function WorkspaceCreateMenu({
  onAddBlock,
  onUploadAsset,
}: WorkspaceCreateMenuProps): ReactElement {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useDismissiblePopover({
    active: isOpen,
    focusOnEscapeRef: triggerRef,
    onDismiss: () => setIsOpen(false),
    rootRef,
  });

  function run(action: () => void): void {
    setIsOpen(false);
    action();
  }

  return (
    <div ref={rootRef} className="workspace-create-menu">
      <button
        type="button"
        ref={triggerRef}
        className="workspace-create-trigger"
        aria-controls="workspace-create-menu-popover"
        aria-expanded={isOpen}
        aria-label={t('createMenu.open')}
        onClick={() => setIsOpen((current) => !current)}
      >
        <Plus size={17} strokeWidth={1.75} />
      </button>
      {isOpen ? (
        <div
          id="workspace-create-menu-popover"
          className="workspace-create-popover"
          role="dialog"
          aria-labelledby="workspace-create-menu-title"
        >
          <h2 id="workspace-create-menu-title">{t('createMenu.title')}</h2>
          <div className="workspace-create-grid">
            <CreateAction
              icon={<FileText size={21} strokeWidth={1.75} />}
              label={t('block.text.title')}
              onClick={() => run(() => onAddBlock('text'))}
            />
            <CreateAction
              icon={<ImageIcon size={21} strokeWidth={1.75} />}
              label={t('block.image.title')}
              onClick={() => run(() => onAddBlock('image'))}
            />
            <CreateAction
              icon={<Video size={21} strokeWidth={1.75} />}
              label={t('block.video.title')}
              onClick={() => run(() => onAddBlock('video'))}
            />
            <CreateAction
              icon={<Play size={21} strokeWidth={1.75} />}
              label={t('createMenu.operationBlock')}
              onClick={() => run(() => onAddBlock('operation'))}
            />
            <CreateAction
              icon={<Upload size={21} strokeWidth={1.75} />}
              label={t('workspaceMaterials.upload')}
              onClick={() => run(onUploadAsset)}
            />
            <CreateAction
              icon={<Layers3 size={21} strokeWidth={1.75} />}
              label={t('group.defaultTitle')}
              onClick={() => run(() => onAddBlock('group'))}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CreateAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactElement;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button type="button" className="workspace-create-action" onClick={onClick}>
      <span className="workspace-create-action-icon" aria-hidden="true">{icon}</span>
      <span>{label}</span>
    </button>
  );
}
