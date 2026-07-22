import {
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  CloudAlert,
  Copy,
  Grid3X3,
  History,
  Keyboard,
  Menu,
  MoreVertical,
  Languages,
  Loader2,
  Palette,
  Pin,
  PinOff,
  Plus,
  Redo2,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties, type MutableRefObject, type ReactElement } from 'react';
import type { BoardSnapshot, WorkspaceSummary } from '../core/types';
import { loadUiPreferences, saveUiPreferences } from '../core/uiPreferences';
import { useI18n, type Locale } from '../i18n';
import { ProjectBoardMenu } from './ProjectBoardMenu';
import { TooltipIconButton, TooltipWrapper } from './Tooltip';

const ExecutionProvidersSettings = lazy(async () => {
  const module = await import('./ExecutionProvidersSettings');
  return { default: module.ExecutionProvidersSettings };
});

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface TopBarProps {
  snapshot: BoardSnapshot;
  autosaveStatus: AutosaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  isHistoryOpen: boolean;
  isProjectBoardDialogOpen?: boolean;
  showGrid: boolean;
  workspace?: WorkspaceSummary;
  onCreateBoard: (projectId: string) => void;
  onCreateProject: () => void;
  onDeleteBoard: (projectId: string, boardId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDuplicateBoard: (projectId: string, boardId: string) => void;
  onRenameBoard: (projectId: string, boardId: string, currentName: string) => void;
  onRenameProject: (projectId: string, currentName: string) => void;
  onReorderBoards: (projectId: string, boardIds: string[]) => void;
  onReorderProjects: (projectIds: string[]) => void;
  onRefreshBoard: () => void;
  onRetrySave: () => void;
  onSelectBoard: (projectId: string, boardId: string) => void;
  onToggleGrid: () => void;
  onToggleHistory: () => void;
  onDeleteSelection: () => void;
  onDuplicateSelection: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

export function TopBar({
  snapshot,
  autosaveStatus,
  canUndo,
  canRedo,
  hasSelection,
  isProjectBoardDialogOpen,
  showGrid,
  workspace,
  onCreateBoard,
  onCreateProject,
  onDeleteBoard,
  onDeleteProject,
  onDuplicateBoard,
  onRenameBoard,
  onRenameProject,
  onReorderBoards,
  onReorderProjects,
  onRefreshBoard,
  onRetrySave,
  onSelectBoard,
  onToggleGrid,
  onDeleteSelection,
  onDuplicateSelection,
  onToggleHistory,
  onUndo,
  onRedo,
  isHistoryOpen,
}: TopBarProps): ReactElement {
  const { locale, setLocale, t } = useI18n();
  const initialUiPreferences = useRef(loadUiPreferences());
  const [isBoardMenuOpen, setIsBoardMenuOpen] = useState(() => initialUiPreferences.current.isBoardMenuOpen);
  const [isBoardMenuPinned, setIsBoardMenuPinned] = useState(() => initialUiPreferences.current.isBoardMenuPinned);
  const [isBoardProjectActionsOpen, setIsBoardProjectActionsOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(() => initialUiPreferences.current.isProjectMenuOpen);
  const [isProjectMenuPinned, setIsProjectMenuPinned] = useState(() => initialUiPreferences.current.isProjectMenuPinned);
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
  const [keyboardShortcutsPosition, setKeyboardShortcutsPosition] = useState<{ left: number; top: number } | undefined>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExecutionSettingsOpen, setIsExecutionSettingsOpen] = useState(false);
  const boardControlRef = useRef<HTMLDivElement | null>(null);
  const keyboardShortcutsRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const currentProjectSummary = workspace?.projects.find((project) => project.projectId === snapshot.project.projectId);
  const boardCount = currentProjectSummary?.boards.length ?? 0;
  const nextLocale = locale === 'zh' ? 'en' : 'zh';
  const languageTitle =
    locale === 'zh' ? `${t('language.label')}: ${t('language.english')}` : `${t('language.label')}: ${t('language.chinese')}`;

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (boardControlRef.current?.contains(event.target as Node)) return;
      setIsBoardProjectActionsOpen(false);
    }

    if (!isBoardProjectActionsOpen) return undefined;
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isBoardProjectActionsOpen]);

  useEffect(() => {
    saveUiPreferences({ isBoardMenuOpen });
  }, [isBoardMenuOpen]);

  useEffect(() => {
    saveUiPreferences({ isBoardMenuPinned });
  }, [isBoardMenuPinned]);

  useEffect(() => {
    saveUiPreferences({ isProjectMenuOpen });
  }, [isProjectMenuOpen]);

  useEffect(() => {
    saveUiPreferences({ isProjectMenuPinned });
  }, [isProjectMenuPinned]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (settingsRef.current?.contains(event.target as Node)) return;
      setIsSettingsOpen(false);
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setIsSettingsOpen(false);
    }

    if (!isSettingsOpen) return undefined;
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isSettingsOpen]);

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      if (keyboardShortcutsRef.current?.contains(event.target as Node)) return;
      setIsKeyboardShortcutsOpen(false);
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') setIsKeyboardShortcutsOpen(false);
    }

    if (!isKeyboardShortcutsOpen) return undefined;
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isKeyboardShortcutsOpen]);

  function openKeyboardShortcuts(): void {
    const menuElement = settingsRef.current?.querySelector<HTMLElement>('.top-bar-settings-menu');
    const anchorElement = menuElement ?? settingsRef.current;
    const rect = anchorElement?.getBoundingClientRect();
    const panelWidth = Math.min(380, window.innerWidth - 36);
    const left = rect ? Math.min(Math.max(18, rect.left), window.innerWidth - panelWidth - 18) : 18;
    const top = rect ? rect.bottom + 8 : 72;
    setKeyboardShortcutsPosition({ left, top });
    setIsSettingsOpen(false);
    setIsKeyboardShortcutsOpen(true);
  }

  const openExecutionProviderSettings = useCallback((): void => {
    setIsSettingsOpen(false);
    setIsExecutionSettingsOpen(true);
  }, []);

  const closeExecutionProviderSettings = useCallback((): void => {
    setIsExecutionSettingsOpen(false);
  }, []);

  return (
    <>
      <header className="top-bar" aria-label="Project and board controls">
        <div className="top-bar-left">
          <div className="top-bar-project-menu-anchor">
            <IconButton
              label={t('toolbar.menu')}
              onClick={() => {
                setIsProjectMenuOpen((current) => !current);
                setIsBoardMenuOpen(false);
              }}
              tone={isProjectMenuOpen ? 'active' : undefined}
            >
              <Menu className={isProjectMenuOpen ? 'top-bar-menu-open-icon' : undefined} size={17} />
            </IconButton>
            {isProjectMenuOpen ? (
              <ProjectBoardMenu
                currentBoardId={snapshot.board.boardId}
                currentProjectId={snapshot.project.projectId}
                isPinned={isProjectMenuPinned}
                mode="projects"
                onClose={() => {
                  if (isProjectBoardDialogOpen) return;
                  if (!isProjectMenuPinned) setIsProjectMenuOpen(false);
                }}
                onCreateBoard={onCreateBoard}
                onCreateProject={onCreateProject}
                onDeleteBoard={onDeleteBoard}
                onDeleteProject={onDeleteProject}
                onDuplicateBoard={onDuplicateBoard}
                onRenameBoard={onRenameBoard}
                onRenameProject={onRenameProject}
                onReorderBoards={onReorderBoards}
                onReorderProjects={onReorderProjects}
                onSelectBoard={(projectId, boardId) => {
                  if (!isProjectMenuPinned) setIsProjectMenuOpen(false);
                  onSelectBoard(projectId, boardId);
                }}
                onTogglePinned={() => setIsProjectMenuPinned((current) => !current)}
                workspace={workspace}
              />
            ) : null}
          </div>
          <div className="top-bar-board-menu-anchor">
            {isBoardMenuOpen ? (
              <div ref={boardControlRef} className="top-bar-title is-active is-board-controls" aria-label={t('toolbar.boardMenu')}>
                <button
                  type="button"
                  className="top-bar-title-project"
                  aria-expanded={isBoardMenuOpen}
                  onClick={() => {
                    if (!isBoardMenuPinned) setIsBoardMenuOpen(false);
                  }}
                >
                  <strong>{snapshot.project.name}</strong>
                  <span>{boardCount}</span>
                  <ChevronDown size={15} />
                </button>
                <TooltipIconButton
                  className="top-bar-title-icon"
                  label={t('projectBoard.addBoard')}
                  onClick={() => onCreateBoard(snapshot.project.projectId)}
                >
                  <Plus size={14} />
                </TooltipIconButton>
                <div className="top-bar-title-menu">
                  <TooltipIconButton
                    className={isBoardProjectActionsOpen ? 'top-bar-title-icon is-active' : 'top-bar-title-icon'}
                    label={t('projectBoard.projectActions')}
                    onClick={() => setIsBoardProjectActionsOpen((current) => !current)}
                  >
                    <MoreVertical size={14} />
                  </TooltipIconButton>
                  {isBoardProjectActionsOpen ? (
                    <div className="top-bar-project-action-menu">
                      <button
                        type="button"
                        onClick={() => {
                          setIsBoardProjectActionsOpen(false);
                          onRenameProject(snapshot.project.projectId, snapshot.project.name);
                        }}
                      >
                        {t('projectBoard.rename')}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsBoardProjectActionsOpen(false);
                          onCreateBoard(snapshot.project.projectId);
                        }}
                      >
                        {t('projectBoard.addBoard')}
                      </button>
                      <button
                        type="button"
                        className="is-danger"
                        onClick={() => {
                          setIsBoardProjectActionsOpen(false);
                          onDeleteProject(snapshot.project.projectId);
                        }}
                      >
                        {t('projectBoard.delete')}
                      </button>
                    </div>
                  ) : null}
                </div>
                <TooltipIconButton
                  className={isBoardMenuPinned ? 'top-bar-title-icon is-active' : 'top-bar-title-icon'}
                  label={isBoardMenuPinned ? t('projectBoard.unpin') : t('projectBoard.pin')}
                  onClick={() => setIsBoardMenuPinned((current) => !current)}
                >
                  {isBoardMenuPinned ? <PinOff size={14} /> : <Pin size={14} />}
                </TooltipIconButton>
              </div>
            ) : (
              <button
                type="button"
                className="top-bar-title"
                aria-expanded={isBoardMenuOpen}
                aria-label={t('toolbar.boardMenu')}
                onClick={() => {
                  setIsBoardMenuOpen(true);
                  if (!isProjectMenuPinned) setIsProjectMenuOpen(false);
                }}
              >
                <strong>{snapshot.project.name}</strong>
                <span>{snapshot.board.name}</span>
                <ChevronDown size={15} />
              </button>
            )}
            {isBoardMenuOpen ? (
              <ProjectBoardMenu
                currentBoardId={snapshot.board.boardId}
                currentProjectId={snapshot.project.projectId}
                isPinned={isBoardMenuPinned}
                mode="boards"
                onClose={() => {
                  if (isProjectBoardDialogOpen) return;
                  if (!isBoardMenuPinned) setIsBoardMenuOpen(false);
                }}
                onCreateBoard={onCreateBoard}
                onCreateProject={onCreateProject}
                onDeleteBoard={onDeleteBoard}
                onDeleteProject={onDeleteProject}
                onDuplicateBoard={onDuplicateBoard}
                onRenameBoard={onRenameBoard}
                onRenameProject={onRenameProject}
                onReorderBoards={onReorderBoards}
                onReorderProjects={onReorderProjects}
                onSelectBoard={(projectId, boardId) => {
                  if (!isBoardMenuPinned) setIsBoardMenuOpen(false);
                  onSelectBoard(projectId, boardId);
                }}
                onTogglePinned={() => setIsBoardMenuPinned((current) => !current)}
                workspace={workspace}
              />
            ) : null}
          </div>
          <IconButton label={t('toolbar.undo')} onClick={onUndo} disabled={!canUndo}>
            <Undo2 size={16} />
          </IconButton>
          <IconButton label={t('toolbar.redo')} onClick={onRedo} disabled={!canRedo}>
            <Redo2 size={16} />
          </IconButton>
          <IconButton label={t('toolbar.deleteSelection')} onClick={onDeleteSelection} disabled={!hasSelection}>
            <Trash2 size={16} />
          </IconButton>
          <IconButton label={t('toolbar.duplicateSelection')} onClick={onDuplicateSelection} disabled={!hasSelection}>
            <Copy size={16} />
          </IconButton>
        </div>

        <div className="top-bar-actions">
          <TooltipIconButton
            className="icon-button"
            isPressed={isHistoryOpen}
            label={t('history.open')}
            onClick={onToggleHistory}
          >
            <History size={16} />
          </TooltipIconButton>
          <IconButton label={t('toolbar.refreshBoard')} onClick={onRefreshBoard}>
            <RefreshCw size={16} />
          </IconButton>
          <TooltipIconButton className="language-button" label={languageTitle} onClick={() => setLocale(nextLocale)}>
            <Languages size={16} />
            <span>{locale === 'zh' ? '中' : 'EN'}</span>
          </TooltipIconButton>
          <AutosaveIndicator status={autosaveStatus} onRetry={onRetrySave} />
          <div ref={settingsRef} className="top-bar-settings-anchor">
            <IconButton
              label={t('toolbar.moreSettings')}
              onClick={() => setIsSettingsOpen((current) => !current)}
              tone={isSettingsOpen ? 'active' : undefined}
            >
              <Settings size={17} />
            </IconButton>
            {isSettingsOpen ? (
              <SettingsMenu
                currentLocale={locale}
                showGrid={showGrid}
                onOpenExecutionProviders={openExecutionProviderSettings}
                onOpenKeyboardShortcuts={openKeyboardShortcuts}
                onSelectLanguage={setLocale}
                onToggleGrid={onToggleGrid}
              />
            ) : null}
          </div>
        </div>
      </header>
      {isKeyboardShortcutsOpen ? (
        <KeyboardShortcutsWindow
          position={keyboardShortcutsPosition}
          refElement={keyboardShortcutsRef}
          onClose={() => setIsKeyboardShortcutsOpen(false)}
        />
      ) : null}
      {isExecutionSettingsOpen ? (
        <Suspense fallback={<div className="execution-settings-backdrop" aria-busy="true" />}>
          <ExecutionProvidersSettings
            projectId={snapshot.project.projectId}
            onClose={closeExecutionProviderSettings}
          />
        </Suspense>
      ) : null}
    </>
  );
}

function SettingsMenu({
  currentLocale,
  onOpenExecutionProviders,
  onOpenKeyboardShortcuts,
  showGrid,
  onSelectLanguage,
  onToggleGrid,
}: {
  currentLocale: Locale;
  onOpenExecutionProviders: () => void;
  onOpenKeyboardShortcuts: () => void;
  showGrid: boolean;
  onSelectLanguage: (locale: Locale) => void;
  onToggleGrid: () => void;
}): ReactElement {
  const { t } = useI18n();

  return (
    <section className="top-bar-settings-menu" aria-label={t('settings.title')}>
      <div className="settings-menu-group">
        <button type="button" className="settings-menu-item" onClick={onOpenExecutionProviders}>
          <Sparkles size={15} />
          <span>{t('settings.executionProviders')}</span>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="settings-menu-group">
        <button type="button" className="settings-menu-item">
          <Grid3X3 size={15} />
          <span>{t('settings.preferences')}</span>
          <ChevronRight size={14} />
        </button>
        <div className="settings-submenu" role="menu" aria-label={t('settings.preferences')}>
          <button type="button" className="settings-submenu-row" onClick={onToggleGrid}>
            <Grid3X3 size={15} />
            <span>
              <strong>{t('settings.showGrid')}</strong>
              <small>{t('settings.showGridDescription')}</small>
            </span>
            <span className={showGrid ? 'settings-check is-active' : 'settings-check'}>{showGrid ? <Check size={14} /> : null}</span>
          </button>
          <button type="button" className="settings-submenu-row" disabled>
            <Palette size={15} />
            <span>
              <strong>{t('settings.theme')}</strong>
              <small>{t('settings.themePlanned')}</small>
            </span>
          </button>
        </div>
      </div>
      <div className="settings-menu-group">
        <button type="button" className="settings-menu-item">
          <Languages size={15} />
          <span>{t('settings.language')}</span>
          <ChevronRight size={14} />
        </button>
        <div className="settings-submenu" role="menu" aria-label={t('settings.language')}>
          <button type="button" className="settings-submenu-row" onClick={() => onSelectLanguage('zh')}>
            <Languages size={15} />
            <span>
              <strong>{t('language.chinese')}</strong>
            </span>
            <span className={currentLocale === 'zh' ? 'settings-check is-active' : 'settings-check'}>
              {currentLocale === 'zh' ? <Check size={14} /> : null}
            </span>
          </button>
          <button type="button" className="settings-submenu-row" onClick={() => onSelectLanguage('en')}>
            <Languages size={15} />
            <span>
              <strong>{t('language.english')}</strong>
            </span>
            <span className={currentLocale === 'en' ? 'settings-check is-active' : 'settings-check'}>
              {currentLocale === 'en' ? <Check size={14} /> : null}
            </span>
          </button>
        </div>
      </div>
      <div className="settings-menu-group">
        <button
          type="button"
          className="settings-menu-item"
          onClick={onOpenKeyboardShortcuts}
        >
          <Keyboard size={15} />
          <span>{t('settings.keyboardShortcuts')}</span>
        </button>
      </div>
    </section>
  );
}

function KeyboardShortcutsWindow({
  onClose,
  position,
  refElement,
}: {
  onClose: () => void;
  position?: { left: number; top: number };
  refElement: MutableRefObject<HTMLDivElement | null>;
}): ReactElement {
  const { t } = useI18n();
  const style: CSSProperties | undefined = position ? { left: position.left, top: position.top } : undefined;

  return (
    <section ref={refElement} className="keyboard-shortcuts-window" role="dialog" aria-label={t('settings.keyboardShortcuts')} style={style}>
      <header>
        <h2>{t('settings.keyboardShortcuts')}</h2>
        <TooltipIconButton className="keyboard-shortcuts-close" label={t('context.close')} onClick={onClose}>
          <X size={16} />
        </TooltipIconButton>
      </header>
      <div className="keyboard-shortcuts-list">
        <ShortcutRow keys="Cmd/Ctrl+Z" label={t('settings.shortcutUndo')} />
        <ShortcutRow keys="Cmd/Ctrl+Shift+Z" label={t('settings.shortcutRedo')} />
        <ShortcutRow keys="Esc" label={t('settings.shortcutClose')} />
      </div>
    </section>
  );
}

function ShortcutRow({ keys, label }: { keys: string; label: string }): ReactElement {
  return (
    <div className="settings-shortcut-row">
      <Keyboard size={15} />
      <span>{label}</span>
      <kbd>{keys}</kbd>
    </div>
  );
}

function AutosaveIndicator({ status, onRetry }: { status: AutosaveStatus; onRetry: () => void }): ReactElement {
  const { t } = useI18n();

  if (status === 'saving') {
    return (
      <TooltipWrapper className="autosave-indicator" label={t('autosave.saving')}>
        <Loader2 size={16} />
      </TooltipWrapper>
    );
  }

  if (status === 'error') {
    return (
      <TooltipIconButton className="autosave-indicator is-error" label={t('autosave.retry')} onClick={onRetry}>
        <CloudAlert size={16} />
      </TooltipIconButton>
    );
  }

  if (status === 'saved') {
    return (
      <TooltipWrapper className="autosave-indicator" label={t('autosave.saved')}>
        <Check size={16} />
      </TooltipWrapper>
    );
  }

  return (
    <TooltipWrapper className="autosave-indicator is-idle" label={t('autosave.idle')}>
      <Cloud size={16} />
    </TooltipWrapper>
  );
}

function IconButton({
  children,
  disabled,
  label,
  onClick,
  tone,
}: {
  children: ReactElement;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  tone?: 'success' | 'warning' | 'active';
}): ReactElement {
  return (
    <TooltipIconButton
      className={tone ? `icon-button is-${tone}` : 'icon-button'}
      disabled={disabled}
      label={label}
      onClick={onClick}
    >
      {children}
    </TooltipIconButton>
  );
}
