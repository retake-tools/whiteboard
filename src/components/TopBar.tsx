import {
  Check,
  Bot,
  Boxes,
  ChevronDown,
  ChevronRight,
  Copy,
  Grid3X3,
  History,
  Keyboard,
  Menu,
  MoreVertical,
  Languages,
  Library,
  Loader2,
  Palette,
  Pin,
  PinOff,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Trash2,
  TriangleAlert,
  Undo2,
  X,
} from 'lucide-react';
import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type MutableRefObject, type ReactElement } from 'react';
import type { BoardBackgroundV1, BoardSnapshot, WorkspaceSummary } from '../core/types';
import type { PluginRuntimeControllerV1 } from '../core/pluginRuntimeManagementClient';
import type { PackageLifecycleControllerV1 } from '../core/packageLifecycleClient';
import type { PackageBootstrapNoticeV1 } from '../core/installedRuntimeRegistryClient';
import { loadUiPreferences, saveUiPreferences } from '../core/uiPreferences';
import { useI18n, type Locale } from '../i18n';
import { ProjectBoardMenu } from './ProjectBoardMenu';
import { TooltipIconButton, TooltipWrapper } from './Tooltip';

const ExecutionProvidersSettings = lazy(async () => {
  const module = await import('./ExecutionProvidersSettings');
  return { default: module.ExecutionProvidersSettings };
});
const PluginManager = lazy(async () => {
  const module = await import('./PluginManager');
  return { default: module.PluginManager };
});
const BoardBackgroundSettings = lazy(async () => {
  const module = await import('./BoardBackgroundSettings');
  return { default: module.BoardBackgroundSettings };
});
const ProjectBoardManager = lazy(async () => {
  const module = await import('./ProjectBoardManager');
  return { default: module.ProjectBoardManager };
});

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

interface TopBarProps {
  agentWorkspaceButtonRef?: MutableRefObject<HTMLButtonElement | null>;
  snapshot: BoardSnapshot;
  autosaveStatus: AutosaveStatus;
  canUndo: boolean;
  canRedo: boolean;
  hasSelection: boolean;
  isArtifactLibraryOpen: boolean;
  isHistoryOpen: boolean;
  isAgentWorkspaceOpen: boolean;
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
  onSetBoardBackground: (background: BoardBackgroundV1) => void;
  onToggleGrid: () => void;
  onToggleArtifactLibrary: () => void;
  onToggleHistory: () => void;
  onToggleAgentWorkspace: () => void;
  onDeleteSelection: () => void;
  onDuplicateSelection: () => void;
  onUndo: () => void;
  onRedo: () => void;
  pluginRuntimeController?: PluginRuntimeControllerV1;
  packageLifecycleController?: PackageLifecycleControllerV1;
  onPluginManagerOpenChange?: (open: boolean) => void;
  packageBootstrapFailures?: PackageBootstrapNoticeV1[];
  showWorkspaceNavigation?: boolean;
  showSettingsAction?: boolean;
  showWorkspaceSurfaceActions?: boolean;
}

export function TopBar({
  agentWorkspaceButtonRef,
  snapshot,
  autosaveStatus,
  canUndo,
  canRedo,
  hasSelection,
  isArtifactLibraryOpen,
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
  onSetBoardBackground,
  onToggleGrid,
  onToggleArtifactLibrary,
  onDeleteSelection,
  onDuplicateSelection,
  onToggleHistory,
  onToggleAgentWorkspace,
  onUndo,
  onRedo,
  pluginRuntimeController,
  packageBootstrapFailures = [],
  packageLifecycleController,
  onPluginManagerOpenChange,
  isHistoryOpen,
  isAgentWorkspaceOpen,
  showWorkspaceNavigation = true,
  showSettingsAction = true,
  showWorkspaceSurfaceActions = true,
}: TopBarProps): ReactElement {
  const { locale, setLocale, t } = useI18n();
  const initialUiPreferences = useRef(loadUiPreferences());
  const [isBoardMenuOpen, setIsBoardMenuOpen] = useState(() => initialUiPreferences.current.isBoardMenuOpen);
  const [isBoardMenuPinned, setIsBoardMenuPinned] = useState(() => initialUiPreferences.current.isBoardMenuPinned);
  const [isBoardProjectActionsOpen, setIsBoardProjectActionsOpen] = useState(false);
  const [isBoardBackgroundOpen, setIsBoardBackgroundOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(() => initialUiPreferences.current.isProjectMenuOpen);
  const [isProjectMenuPinned, setIsProjectMenuPinned] = useState(() => initialUiPreferences.current.isProjectMenuPinned);
  const [isKeyboardShortcutsOpen, setIsKeyboardShortcutsOpen] = useState(false);
  const [keyboardShortcutsPosition, setKeyboardShortcutsPosition] = useState<{ left: number; top: number } | undefined>();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isExecutionSettingsOpen, setIsExecutionSettingsOpen] = useState(false);
  const [isPluginManagerOpen, setIsPluginManagerOpen] = useState(false);
  const [isProjectBoardManagerOpen, setIsProjectBoardManagerOpen] =
    useState(false);
  const boardControlRef = useRef<HTMLDivElement | null>(null);
  const keyboardShortcutsRef = useRef<HTMLDivElement | null>(null);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const currentProjectSummary = workspace?.projects.find((project) => project.projectId === snapshot.project.projectId);
  const boardCount = currentProjectSummary?.boards.length ?? 0;
  const nextLocale = locale === 'zh' ? 'en' : 'zh';
  const languageTitle =
    locale === 'zh' ? `${t('language.label')}: ${t('language.english')}` : `${t('language.label')}: ${t('language.chinese')}`;

  useEffect(() => {
    onPluginManagerOpenChange?.(isPluginManagerOpen);
  }, [isPluginManagerOpen, onPluginManagerOpenChange]);

  useEffect(() => {
    const openSettings = (): void => setIsSettingsOpen(true);
    window.addEventListener('retake:open-settings', openSettings);
    return () => window.removeEventListener('retake:open-settings', openSettings);
  }, []);

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

  const openPluginSettings = useCallback((): void => {
    setIsSettingsOpen(false);
    setIsPluginManagerOpen(true);
  }, []);

  const closePluginSettings = useCallback((): void => {
    setIsPluginManagerOpen(false);
  }, []);

  const openProjectBoardManager = useCallback((): void => {
    setIsBoardMenuOpen(false);
    setIsProjectMenuOpen(false);
    setIsProjectBoardManagerOpen(true);
  }, []);

  return (
    <>
      <header className="top-bar" aria-label="Project and board controls">
        <div className="top-bar-left">
          {showWorkspaceNavigation ? (
            <>
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
                onOpenManager={openProjectBoardManager}
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
                onOpenManager={openProjectBoardManager}
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
            </>
          ) : (
            <div className="top-bar-title is-static" aria-label={t('toolbar.boardMenu')}>
              <strong>{snapshot.project.name}</strong>
              <span>{snapshot.board.name}</span>
            </div>
          )}
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
          {showWorkspaceSurfaceActions ? (
            <>
              <TooltipIconButton
                className="icon-button"
                isPressed={isArtifactLibraryOpen}
                label={t('artifactLibrary.open')}
                onClick={onToggleArtifactLibrary}
              >
                <Library size={16} />
              </TooltipIconButton>
              <TooltipIconButton
                className="icon-button"
                isPressed={isHistoryOpen}
                label={t('history.open')}
                onClick={onToggleHistory}
              >
                <History size={16} />
              </TooltipIconButton>
            </>
          ) : null}
          <IconButton label={t('toolbar.refreshBoard')} onClick={onRefreshBoard}>
            <RefreshCw size={16} />
          </IconButton>
          <TooltipIconButton className="language-button" label={languageTitle} onClick={() => setLocale(nextLocale)}>
            <Languages size={16} />
            <span>{locale === 'zh' ? '中' : 'EN'}</span>
          </TooltipIconButton>
          <AutosaveIndicator status={autosaveStatus} onRetry={onRetrySave} />
          <div ref={settingsRef} className="top-bar-settings-anchor">
            {showSettingsAction ? (
              <IconButton
                label={t('toolbar.moreSettings')}
                onClick={() => setIsSettingsOpen((current) => !current)}
                tone={isSettingsOpen ? 'active' : undefined}
              >
                <Settings size={17} />
              </IconButton>
            ) : null}
            {isSettingsOpen ? (
              <SettingsMenu
                currentLocale={locale}
                showGrid={showGrid}
                onOpenBoardBackground={() => {
                  setIsSettingsOpen(false);
                  setIsBoardBackgroundOpen(true);
                }}
                onOpenExecutionProviders={openExecutionProviderSettings}
                onOpenKeyboardShortcuts={openKeyboardShortcuts}
                onOpenPlugins={pluginRuntimeController && packageLifecycleController
                  ? openPluginSettings
                  : undefined}
                onSelectLanguage={setLocale}
                onToggleGrid={onToggleGrid}
              />
            ) : null}
          </div>
        </div>
      </header>
      {!isAgentWorkspaceOpen ? (
        <TooltipIconButton
          buttonRef={agentWorkspaceButtonRef}
          className="agent-workspace-trigger"
          label={t('agentWorkspace.open')}
          onClick={onToggleAgentWorkspace}
        >
          <Bot size={16} strokeWidth={1.75} />
        </TooltipIconButton>
      ) : null}
      {packageBootstrapFailures.length > 0 ? (
        <PackageFailureBanner failures={packageBootstrapFailures} />
      ) : packageLifecycleController ? (
        <PackageUpdateBanner
          controller={packageLifecycleController}
          onOpen={() => setIsPluginManagerOpen(true)}
        />
      ) : null}
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
      {isPluginManagerOpen
      && pluginRuntimeController
      && packageLifecycleController ? (
        <Suspense fallback={<div className="execution-settings-backdrop" aria-busy="true" />}>
          <PluginManager
            packageController={packageLifecycleController}
            pluginController={pluginRuntimeController}
            onClose={closePluginSettings}
          />
        </Suspense>
      ) : null}
      {isProjectBoardManagerOpen
      && pluginRuntimeController
      && workspace ? (
        <Suspense fallback={<div className="execution-settings-backdrop" aria-busy="true" />}>
          <ProjectBoardManager
            currentBoardId={snapshot.board.boardId}
            currentProjectId={snapshot.project.projectId}
            onClose={() => setIsProjectBoardManagerOpen(false)}
            onCreateBoard={onCreateBoard}
            onCreateProject={onCreateProject}
            onDeleteBoard={onDeleteBoard}
            onDeleteProject={onDeleteProject}
            onDuplicateBoard={onDuplicateBoard}
            onOpenBoard={(projectId, boardId) => {
              setIsProjectBoardManagerOpen(false);
              onSelectBoard(projectId, boardId);
            }}
            onRenameBoard={onRenameBoard}
            onRenameProject={onRenameProject}
            pluginController={pluginRuntimeController}
            workspace={workspace}
          />
        </Suspense>
      ) : null}
      {isBoardBackgroundOpen ? (
        <Suspense fallback={<div className="execution-settings-backdrop" aria-busy="true" />}>
          <BoardBackgroundSettings
            onApply={onSetBoardBackground}
            onClose={() => setIsBoardBackgroundOpen(false)}
            snapshot={snapshot}
          />
        </Suspense>
      ) : null}
    </>
  );
}

const packageUpdateDismissalsKey =
  'retake.package-update-dismissals.v1';

export function PackageFailureBanner({
  failures,
}: {
  failures: PackageBootstrapNoticeV1[];
}): ReactElement | null {
  const { locale, t } = useI18n();
  const [dismissed, setDismissed] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  if (dismissed || failures.length === 0) return null;
  const candidateFailureCount = failures.filter(
    (failure) => failure.source === 'distribution',
  ).length;
  const activeFailureCount = failures.length - candidateFailureCount;
  const messages = [
    candidateFailureCount > 0
      ? countedPackageMessage(
          candidateFailureCount,
          t('packageLibrary.candidateFailuresBanner'),
          locale,
        )
      : null,
    activeFailureCount > 0
      ? countedPackageMessage(
          activeFailureCount,
          t('packageLibrary.failuresIsolatedBanner'),
          locale,
        )
      : null,
  ].filter((message): message is string => Boolean(message));
  const details = failures.map((failure) => (
    `${failure.packageId ?? 'bootstrap'}${failure.version ? `@${failure.version}` : ''}: ${failure.error}`
  )).join('\n');
  return (
    <aside
      className="package-update-banner is-failure"
      role="status"
      title={details}
    >
      <div className="package-update-banner-main">
        <span>
          <TriangleAlert size={15} />
          {messages.join(locale === 'zh' ? '；' : '; ')}
        </span>
        <div className="package-update-banner-actions">
          <button
            type="button"
            className="package-update-banner-details-toggle"
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((current) => !current)}
          >
            {detailsOpen
              ? t('packageLibrary.hideFailureDetails')
              : t('packageLibrary.viewFailureDetails')}
          </button>
          <button
            type="button"
            className="package-update-banner-dismiss"
            aria-label={t('packageLibrary.dismissFailures')}
            onClick={() => setDismissed(true)}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      {detailsOpen ? (
        <ul className="package-update-banner-failure-details">
          {failures.map((failure, index) => (
            <li key={`${failure.source}:${failure.packageId}:${failure.version}:${index}`}>
              {failure.packageId ?? 'bootstrap'}
              {failure.version ? `@${failure.version}` : ''}
              {' · '}{failure.error}
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}

function countedPackageMessage(
  count: number,
  message: string,
  locale: Locale,
): string {
  return locale === 'zh' ? `${count}${message}` : `${count} ${message}`;
}

export function PackageUpdateBanner({
  controller,
  onOpen,
}: {
  controller: PackageLifecycleControllerV1;
  onOpen: () => void;
}): ReactElement | null {
  const { t } = useI18n();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getUpdateSnapshot,
    controller.getUpdateSnapshot,
  );
  const requested = useRef(false);
  const [dismissRevision, setDismissRevision] = useState(0);

  useEffect(() => {
    if (snapshot || requested.current) return;
    requested.current = true;
    void controller.checkUpdates().catch(() => undefined);
  }, [controller, snapshot]);

  const dismissed = readPackageUpdateDismissals();
  const available = (snapshot?.checks ?? []).filter((check) => (
    check.status === 'available'
    && check.candidate
    && !dismissed.has(packageUpdateDismissalId(
      check.packageId,
      check.candidate.version,
      check.candidate.digest,
    ))
  ));
  if (available.length === 0) return null;

  return (
    <aside
      className="package-update-banner"
      data-dismiss-revision={dismissRevision}
      role="status"
    >
      <span>
        <RefreshCw size={15} />
        <strong>{available.length}</strong>
        {t('packageLibrary.updatesAvailableBanner')}
      </span>
      <div>
        <button type="button" onClick={onOpen}>
          {t('packageLibrary.reviewUpdates')}
        </button>
        <button
          type="button"
          className="package-update-banner-dismiss"
          aria-label={t('packageLibrary.dismissUpdates')}
          onClick={() => {
            const next = readPackageUpdateDismissals();
            for (const check of available) {
              next.add(packageUpdateDismissalId(
                check.packageId,
                check.candidate!.version,
                check.candidate!.digest,
              ));
            }
            writePackageUpdateDismissals(next);
            setDismissRevision((current) => current + 1);
          }}
        >
          <X size={15} />
        </button>
      </div>
    </aside>
  );
}

function packageUpdateDismissalId(
  packageId: string,
  version: string,
  digest: string,
): string {
  return `${packageId}:${version}:${digest}`;
}

function readPackageUpdateDismissals(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const value = JSON.parse(
      window.localStorage.getItem(packageUpdateDismissalsKey) ?? '[]',
    ) as unknown;
    return new Set(
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [],
    );
  } catch {
    return new Set();
  }
}

function writePackageUpdateDismissals(values: ReadonlySet<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      packageUpdateDismissalsKey,
      JSON.stringify([...values].sort()),
    );
  } catch {
    // The notification remains visible when browser storage is unavailable.
  }
}

function SettingsMenu({
  currentLocale,
  onOpenBoardBackground,
  onOpenExecutionProviders,
  onOpenKeyboardShortcuts,
  onOpenPlugins,
  showGrid,
  onSelectLanguage,
  onToggleGrid,
}: {
  currentLocale: Locale;
  onOpenBoardBackground: () => void;
  onOpenExecutionProviders: () => void;
  onOpenKeyboardShortcuts: () => void;
  onOpenPlugins?: () => void;
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
        {onOpenPlugins ? (
          <button type="button" className="settings-menu-item" onClick={onOpenPlugins}>
            <Boxes size={15} />
            <span>{t('settings.plugins')}</span>
            <ChevronRight size={14} />
          </button>
        ) : null}
      </div>
      <div className="settings-menu-group">
        <button type="button" className="settings-menu-item">
          <Grid3X3 size={15} />
          <span>{t('settings.preferences')}</span>
          <ChevronRight size={14} />
        </button>
        <div className="settings-submenu" role="menu" aria-label={t('settings.preferences')}>
          <button type="button" className="settings-submenu-row" onClick={onOpenBoardBackground}>
            <Palette size={15} />
            <span>
              <strong>{t('settings.boardBackground')}</strong>
              <small>{t('settings.boardBackgroundDescription')}</small>
            </span>
          </button>
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
        <TriangleAlert size={16} />
        <span className="autosave-error-label">{t('autosave.error')}</span>
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
      <Save size={16} />
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
