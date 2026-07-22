import {
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Download,
  GalleryHorizontalEnd,
  Grid2X2,
  LockKeyhole,
  Move,
  PlayCircle,
  Rows3,
  Scan,
  Trash2,
  Ungroup,
} from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import type { BlockRecord, GroupColor, GroupLayoutMode } from '../core/types';
import type { WorkflowRunRuntimeView } from '../core/workflowRuntime';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import { TooltipIconButton } from './Tooltip';

const groupColors: GroupColor[] = ['transparent', 'neutral', 'blue', 'green', 'yellow', 'rose'];

interface GroupToolbarProps {
  collapsed: boolean;
  group: BlockRecord;
  inheritedLocked: boolean;
  mediaCount: number;
  workflowRun?: WorkflowRunRuntimeView;
  onBrowse: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onFit: () => void;
  onLayout: (layoutMode: GroupLayoutMode) => void;
  onToggleCollapsed: () => void;
  onUngroup: () => void;
  onUpdate: (updates: {
    color?: GroupColor;
    contentsLocked?: boolean;
    positionLocked?: boolean;
    title?: string;
  }) => void;
  onWorkflowRun: () => void;
}

export function GroupToolbar({
  collapsed,
  group,
  inheritedLocked,
  mediaCount,
  workflowRun,
  onBrowse,
  onDelete,
  onDownload,
  onFit,
  onLayout,
  onToggleCollapsed,
  onUngroup,
  onUpdate,
  onWorkflowRun,
}: GroupToolbarProps): ReactElement {
  const { t } = useI18n();
  const [title, setTitle] = useState(group.data.title);
  const [isLockMenuOpen, setIsLockMenuOpen] = useState(false);
  const [isLayoutMenuOpen, setIsLayoutMenuOpen] = useState(false);
  const lockControlRef = useRef<HTMLDivElement | null>(null);
  const layoutControlRef = useRef<HTMLDivElement | null>(null);
  const color = group.data.groupColor ?? 'neutral';
  const positionLocked = group.data.groupPositionLocked === true;
  const contentsLocked = group.data.groupContentsLocked === true;
  const structureLocked = inheritedLocked || positionLocked || contentsLocked;
  const layoutMode = group.data.groupLayoutMode ?? 'free';

  useEffect(() => {
    setTitle(group.data.title);
  }, [group.blockId, group.data.title]);

  useEffect(() => {
    if (inheritedLocked) setIsLockMenuOpen(false);
    if (structureLocked || collapsed) setIsLayoutMenuOpen(false);
  }, [collapsed, inheritedLocked, structureLocked]);

  useDismissiblePopover({
    active: isLockMenuOpen,
    onDismiss: () => setIsLockMenuOpen(false),
    rootRef: lockControlRef,
  });

  useDismissiblePopover({
    active: isLayoutMenuOpen,
    onDismiss: () => setIsLayoutMenuOpen(false),
    rootRef: layoutControlRef,
  });

  function commitTitle(): void {
    const nextTitle = title.trim() || t('group.defaultTitle');
    setTitle(nextTitle);
    if (nextTitle !== group.data.title) onUpdate({ title: nextTitle });
  }

  function onTitleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    event.stopPropagation();
    if (event.key === 'Enter') event.currentTarget.blur();
    if (event.key === 'Escape') {
      setTitle(group.data.title);
      event.currentTarget.blur();
    }
  }

  return (
    <div className="group-toolbar nodrag nopan" aria-label={t('group.tools')}>
      <input
        aria-label={t('group.title')}
        disabled={inheritedLocked}
        value={title}
        onBlur={commitTitle}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={onTitleKeyDown}
        onPointerDown={(event) => event.stopPropagation()}
      />
      <div className="group-color-swatches" aria-label={t('group.background')}>
        {groupColors.map((option) => (
          <button
            key={option}
            type="button"
            className={`group-color-swatch is-${option} ${color === option ? 'is-active' : ''}`}
            aria-label={t(`group.color.${option}`)}
            aria-pressed={color === option}
            disabled={inheritedLocked}
            onClick={() => onUpdate({ color: option })}
          />
        ))}
      </div>
      <span className="toolbar-divider" />
      {group.data.groupKind === 'workflow' ? (
        <button
          type="button"
          className={`workflow-run-control${workflowRun ? ` is-${workflowRun.status}` : ''}`}
          aria-label={t(workflowRun ? 'workflowRuntime.view' : 'workflowRuntime.create')}
          onClick={onWorkflowRun}
        >
          <PlayCircle size={15} />
          <span>{t(workflowRun ? workflowRunStatusKey(workflowRun.status) : 'workflowRuntime.create')}</span>
        </button>
      ) : null}
      <TooltipIconButton label={t('group.browse')} onClick={onBrowse}>
        <GalleryHorizontalEnd size={16} />
      </TooltipIconButton>
      <TooltipIconButton disabled={mediaCount === 0} label={t('group.downloadAssets')} onClick={onDownload}>
        <Download size={16} />
      </TooltipIconButton>
      <TooltipIconButton label={t(collapsed ? 'group.expand' : 'group.collapse')} onClick={onToggleCollapsed}>
        {collapsed ? <ChevronsUpDown size={16} /> : <ChevronsDownUp size={16} />}
      </TooltipIconButton>
      <div ref={lockControlRef} className="group-lock-control">
        <TooltipIconButton
          disabled={inheritedLocked}
          isPressed={positionLocked || contentsLocked}
          label={inheritedLocked ? t('group.inheritedLocked') : t('group.lock')}
          onClick={() => setIsLockMenuOpen((current) => !current)}
        >
          <LockKeyhole size={16} />
        </TooltipIconButton>
        {isLockMenuOpen && !inheritedLocked ? (
          <div className="group-lock-menu" role="menu" aria-label={t('group.lock')}>
            <button
              type="button"
              className={positionLocked ? 'is-selected' : undefined}
              role="menuitemcheckbox"
              aria-checked={positionLocked}
              onClick={() => onUpdate({ positionLocked: !positionLocked })}
            >
              <span><strong>{t('group.lockContainer')}</strong><small>{t('group.lockContainerDescription')}</small></span>
              {positionLocked ? <Check size={15} /> : null}
            </button>
            <button
              type="button"
              className={contentsLocked ? 'is-selected' : undefined}
              role="menuitemcheckbox"
              aria-checked={contentsLocked}
              onClick={() => onUpdate({ contentsLocked: !contentsLocked })}
            >
              <span><strong>{t('group.lockContents')}</strong><small>{t('group.lockContentsDescription')}</small></span>
              {contentsLocked ? <Check size={15} /> : null}
            </button>
          </div>
        ) : null}
      </div>
      <div ref={layoutControlRef} className="group-layout-control">
        <TooltipIconButton
          disabled={structureLocked || collapsed}
          label={t('group.layout')}
          onClick={() => setIsLayoutMenuOpen((current) => !current)}
        >
          <Grid2X2 size={16} />
        </TooltipIconButton>
        {isLayoutMenuOpen && !structureLocked && !collapsed ? (
          <div className="group-layout-menu" role="menu" aria-label={t('group.layout')}>
            {([
              { icon: <Move size={15} />, label: t('group.layoutFree'), value: 'free' },
              { icon: <Rows3 size={15} />, label: t('group.layoutRow'), value: 'row' },
              { icon: <Grid2X2 size={15} />, label: t('group.layoutGrid'), value: 'grid' },
            ] satisfies Array<{ icon: ReactElement; label: string; value: GroupLayoutMode }>).map((option) => (
              <button
                key={option.value}
                type="button"
                className={layoutMode === option.value ? 'is-selected' : undefined}
                role="menuitemradio"
                aria-checked={layoutMode === option.value}
                onClick={() => {
                  setIsLayoutMenuOpen(false);
                  onLayout(option.value);
                }}
              >
                {option.icon}<span>{option.label}</span>{layoutMode === option.value ? <Check size={15} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <TooltipIconButton disabled={inheritedLocked || positionLocked || collapsed} label={t('group.fit')} onClick={onFit}>
        <Scan size={16} />
      </TooltipIconButton>
      <TooltipIconButton disabled={structureLocked} label={t('group.ungroup')} onClick={onUngroup}>
        <Ungroup size={16} />
      </TooltipIconButton>
      <TooltipIconButton disabled={structureLocked} className="group-delete-button" label={t('group.deleteContents')} onClick={onDelete}>
        <Trash2 size={16} />
      </TooltipIconButton>
    </div>
  );
}

function workflowRunStatusKey(status: WorkflowRunRuntimeView['status']) {
  return `workflowRuntime.runStatus.${status}` as const;
}
