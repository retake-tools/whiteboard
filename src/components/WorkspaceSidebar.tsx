import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Folder,
  Grid2X2,
  History,
  Library,
  MoreHorizontal,
  Plus,
  Settings,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { WorkspaceSummary } from '../core/types';
import { useDismissiblePopover } from '../hooks/useDismissiblePopover';
import { useI18n } from '../i18n';
import { ProjectBoardMenu } from './ProjectBoardMenu';
import { WorkspaceBoardSwitcher, projectIdentity } from './WorkspaceBoardSwitcher';

export function WorkspaceSidebar({
  collapsed,
  currentBoardId,
  currentProjectId,
  historyOpen,
  artifactLibraryOpen,
  workspace,
  onCreateBoard,
  onCreateProject,
  onDeleteBoard,
  onDeleteProject,
  onDuplicateBoard,
  onOpenArtifactLibrary,
  onOpenHistory,
  onOpenSettings,
  onRenameBoard,
  onRenameProject,
  onReorderBoards,
  onReorderProjects,
  onSelectBoard,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  currentBoardId: string;
  currentProjectId: string;
  historyOpen: boolean;
  artifactLibraryOpen: boolean;
  workspace?: WorkspaceSummary;
  onCreateBoard: (projectId: string) => void;
  onCreateProject: () => void;
  onDeleteBoard: (projectId: string, boardId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDuplicateBoard: (projectId: string, boardId: string) => void;
  onOpenArtifactLibrary: () => void;
  onOpenHistory: () => void;
  onOpenSettings: () => void;
  onRenameBoard: (projectId: string, boardId: string, currentName: string) => void;
  onRenameProject: (projectId: string, currentName: string) => void;
  onReorderBoards: (projectId: string, boardIds: string[]) => void;
  onReorderProjects: (projectIds: string[]) => void;
  onSelectBoard: (projectId: string, boardId: string) => void;
  onToggleCollapsed: () => void;
}): ReactElement {
  const { t } = useI18n();
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set([currentProjectId]),
  );
  const [openProjectId, setOpenProjectId] = useState<string | undefined>();
  const [managementMenuOpen, setManagementMenuOpen] = useState(false);
  const activeProjectTriggerRef = useRef<HTMLButtonElement | null>(null);
  const boardSwitcherRef = useRef<HTMLElement | null>(null);
  const openProject = workspace?.projects.find((project) => project.projectId === openProjectId);

  useEffect(() => {
    setExpandedProjectIds((current) => {
      if (current.has(currentProjectId)) return current;
      return new Set([...current, currentProjectId]);
    });
  }, [currentProjectId]);

  useEffect(() => {
    if (!collapsed) setOpenProjectId(undefined);
    else setManagementMenuOpen(false);
  }, [collapsed]);

  const openProjectBoardManager = (): void => {
    setManagementMenuOpen(false);
    setOpenProjectId(undefined);
    window.dispatchEvent(new CustomEvent('retake:open-project-board-manager'));
  };

  useDismissiblePopover({
    active: Boolean(collapsed && openProject),
    additionalRefs: [activeProjectTriggerRef],
    focusOnEscapeRef: activeProjectTriggerRef,
    onDismiss: () => setOpenProjectId(undefined),
    rootRef: boardSwitcherRef,
  });

  const label = (value: string): ReactElement => (
    <span className="workspace-sidebar-label">{value}</span>
  );

  if (collapsed) {
    return (
      <aside
        className="workspace-sidebar workspace-sidebar-rail"
        aria-label={t('projectBoard.menuTitle')}
        data-collapsed="true"
      >
        <header className="workspace-sidebar-rail-brand">
          <img src="/brand/retake-mark.png" alt="" />
          <button
            type="button"
            className="workspace-sidebar-collapse"
            aria-label={t('history.expand')}
            onClick={onToggleCollapsed}
          >
            <ChevronRight size={16} />
          </button>
        </header>

        <nav className="workspace-project-rail" aria-label={t('projectBoard.projectsTitle')}>
          {(workspace?.projects ?? []).map((project) => {
            const current = project.projectId === currentProjectId;
            const open = project.projectId === openProjectId;
            return (
              <button
                key={project.projectId}
                ref={open ? activeProjectTriggerRef : undefined}
                type="button"
                className={`workspace-project-rail-button${current ? ' is-current' : ''}`}
                aria-controls={open ? 'workspace-board-switcher' : undefined}
                aria-expanded={open}
                aria-label={project.name}
                title={project.name}
                onClick={(event) => {
                  activeProjectTriggerRef.current = event.currentTarget;
                  setOpenProjectId((value) => value === project.projectId ? undefined : project.projectId);
                }}
              >
                <span className="workspace-project-mark" aria-hidden="true">
                  {projectIdentity(project.name)}
                </span>
              </button>
            );
          })}
          <button
            type="button"
            className={artifactLibraryOpen ? 'workspace-project-rail-utility is-active' : 'workspace-project-rail-utility'}
            aria-label={t('artifactLibrary.open')}
            aria-pressed={artifactLibraryOpen}
            title={t('artifactLibrary.open')}
            onClick={() => {
              setOpenProjectId(undefined);
              onOpenArtifactLibrary();
            }}
          >
            <Library size={17} />
          </button>
          <button
            type="button"
            className="workspace-project-rail-utility is-create"
            aria-label={t('projectBoard.addProject')}
            title={t('projectBoard.addProject')}
            onClick={onCreateProject}
          >
            <Plus size={17} />
          </button>
        </nav>

        <footer className="workspace-sidebar-rail-footer">
          <button
            type="button"
            className={historyOpen ? 'is-active' : undefined}
            aria-label={t('history.open')}
            aria-pressed={historyOpen}
            title={t('history.open')}
            onClick={onOpenHistory}
          >
            <History size={18} />
          </button>
          <button type="button" aria-label={t('settings.title')} title={t('settings.title')} onClick={onOpenSettings}>
            <Settings size={18} />
          </button>
          <div className="workspace-sidebar-rail-local" title="Local workspace" aria-label="Local workspace">
            L
          </div>
        </footer>

        {openProject ? (
          <WorkspaceBoardSwitcher
            currentBoardId={currentBoardId}
            onCreateBoard={(projectId) => {
              setOpenProjectId(undefined);
              onCreateBoard(projectId);
            }}
            onSelectBoard={(projectId, boardId) => {
              setOpenProjectId(undefined);
              onSelectBoard(projectId, boardId);
            }}
            onOpenManager={openProjectBoardManager}
            project={openProject}
            rootRef={boardSwitcherRef}
          />
        ) : null}
      </aside>
    );
  }

  return (
    <aside
      className="workspace-sidebar"
      aria-label={t('projectBoard.menuTitle')}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <header className="workspace-sidebar-brand">
        <img src="/brand/retake-mark.png" alt="" />
        {label('Retake Whiteboard')}
        <button
          type="button"
          className="workspace-sidebar-collapse"
          aria-label={collapsed ? t('history.expand') : t('history.collapse')}
          onClick={onToggleCollapsed}
        >
          <ChevronLeft size={16} />
        </button>
      </header>

      <nav className="workspace-sidebar-primary" aria-label={t('projectBoard.menuTitle')}>
        <button
          type="button"
          aria-controls="workspace-project-list"
          title={t('projectBoard.projectsTitle')}
          onClick={() => {
            const projectList = document.getElementById('workspace-project-list');
            projectList?.scrollIntoView({ block: 'nearest' });
            projectList
              ?.querySelector<HTMLButtonElement>('[aria-current="page"]')
              ?.focus();
          }}
        >
          <Clock3 size={18} />
          {label(t('projectBoard.projectsTitle'))}
        </button>
        <button
          type="button"
          className={artifactLibraryOpen ? 'is-active' : undefined}
          aria-pressed={artifactLibraryOpen}
          title={t('artifactLibrary.open')}
          onClick={onOpenArtifactLibrary}
        >
          <Library size={18} />
          {label(t('artifactLibrary.open'))}
        </button>
      </nav>

      <section
        id="workspace-project-list"
        className="workspace-sidebar-projects"
        aria-label={t('projectBoard.projectsTitle')}
      >
        <header>
          {label(t('projectBoard.currentProject'))}
          <span className="workspace-sidebar-project-header-actions">
            <button
              type="button"
              aria-expanded={managementMenuOpen}
              aria-label={t('projectBoard.openManager')}
              onClick={() => setManagementMenuOpen((current) => !current)}
            >
              <MoreHorizontal size={15} />
            </button>
            <button type="button" aria-label={t('projectBoard.addProject')} onClick={onCreateProject}>
              <Plus size={15} />
            </button>
          </span>
        </header>
        <div className="workspace-sidebar-project-list">
          {(workspace?.projects ?? []).map((project) => {
            const expanded = expandedProjectIds.has(project.projectId);
            const currentProject = project.projectId === currentProjectId;
            return (
              <div className="workspace-sidebar-project" key={project.projectId}>
                <div className={`workspace-sidebar-project-row${currentProject ? ' is-current' : ''}`}>
                  <button
                    type="button"
                    className="workspace-sidebar-project-toggle"
                    aria-expanded={expanded}
                    title={project.name}
                    onClick={() => setExpandedProjectIds((current) => {
                      const next = new Set(current);
                      if (next.has(project.projectId)) next.delete(project.projectId);
                      else next.add(project.projectId);
                      return next;
                    })}
                  >
                    <Folder size={17} />
                    {label(project.name)}
                    {expanded ? <ChevronDown className="workspace-sidebar-chevron" size={14} /> : <ChevronRight className="workspace-sidebar-chevron" size={14} />}
                  </button>
                  <button
                    type="button"
                    className="workspace-sidebar-project-add"
                    aria-label={t('projectBoard.addBoard')}
                    onClick={() => onCreateBoard(project.projectId)}
                  >
                    <Plus size={14} />
                  </button>
                </div>
                {expanded ? (
                  <div className="workspace-sidebar-board-list">
                    {project.boards.map((board) => {
                      const current = currentProject && board.boardId === currentBoardId;
                      return (
                        <div className="workspace-sidebar-board-row" key={board.boardId}>
                          <button
                            type="button"
                            className={current ? 'is-active' : undefined}
                            aria-current={current ? 'page' : undefined}
                            title={board.name}
                            onClick={() => onSelectBoard(project.projectId, board.boardId)}
                          >
                            <Grid2X2 size={16} />
                            {label(board.name)}
                          </button>
                          <button
                            type="button"
                            className="workspace-sidebar-board-more"
                            aria-label={t('projectBoard.renameBoard')}
                            onClick={() => onRenameBoard(project.projectId, board.boardId, board.name)}
                          >
                            <MoreHorizontal size={15} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>

      <footer className="workspace-sidebar-footer">
        <button
          type="button"
          className={historyOpen ? 'is-active' : undefined}
          aria-pressed={historyOpen}
          title={t('history.open')}
          onClick={onOpenHistory}
        >
          <History size={18} />
          {label(t('history.open'))}
        </button>
        <button type="button" title={t('settings.title')} onClick={onOpenSettings}>
          <Settings size={18} />
          {label(t('settings.title'))}
        </button>
        <div className="workspace-sidebar-local" title="Local workspace">
          <span aria-hidden="true">L</span>
          {label('Local workspace')}
        </div>
      </footer>
      {managementMenuOpen ? (
        <ProjectBoardMenu
          currentBoardId={currentBoardId}
          currentProjectId={currentProjectId}
          mode="projects"
          workspace={workspace}
          onClose={() => setManagementMenuOpen(false)}
          onCreateBoard={onCreateBoard}
          onCreateProject={onCreateProject}
          onDeleteBoard={onDeleteBoard}
          onDeleteProject={onDeleteProject}
          onDuplicateBoard={onDuplicateBoard}
          onOpenManager={openProjectBoardManager}
          onRenameBoard={onRenameBoard}
          onRenameProject={onRenameProject}
          onReorderBoards={onReorderBoards}
          onReorderProjects={onReorderProjects}
          onSelectBoard={onSelectBoard}
        />
      ) : null}
    </aside>
  );
}
