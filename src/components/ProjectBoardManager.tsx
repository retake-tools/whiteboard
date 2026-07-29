import {
  ArrowRight,
  Copy,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from 'react';
import { projectPluginRuntimeForProfileV1 } from '@retake-tools/plugin-runtime';
import type {
  PluginRuntimeControllerV1,
} from '../core/pluginRuntimeManagementClient';
import type {
  WorkspaceBoardSummary,
  WorkspaceProjectSummary,
  WorkspaceSummary,
} from '../core/types';
import { useI18n } from '../i18n';
import {
  ProjectBoardPluginSettings,
  type PluginSettingsTarget,
} from './ProjectBoardPluginSettings';

export function ProjectBoardManager({
  currentBoardId,
  currentProjectId,
  onClose,
  onCreateBoard,
  onCreateProject,
  onDeleteBoard,
  onDeleteProject,
  onDuplicateBoard,
  onOpenBoard,
  onRenameBoard,
  onRenameProject,
  pluginController,
  workspace,
}: {
  currentBoardId: string;
  currentProjectId: string;
  onClose: () => void;
  onCreateBoard: (projectId: string) => void;
  onCreateProject: () => void;
  onDeleteBoard: (projectId: string, boardId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDuplicateBoard: (projectId: string, boardId: string) => void;
  onOpenBoard: (projectId: string, boardId: string) => void;
  onRenameBoard: (
    projectId: string,
    boardId: string,
    currentName: string,
  ) => void;
  onRenameProject: (projectId: string, currentName: string) => void;
  pluginController: PluginRuntimeControllerV1;
  workspace: WorkspaceSummary;
}): ReactElement {
  const { locale, t } = useI18n();
  const pluginSnapshot = useSyncExternalStore(
    pluginController.subscribe,
    pluginController.getSnapshot,
    pluginController.getSnapshot,
  );
  const profileState = pluginController.getProfileState();
  const [selectedProjectId, setSelectedProjectId] = useState(currentProjectId);
  const [pluginTarget, setPluginTarget] = useState<PluginSettingsTarget>();
  const selectedProject = workspace.projects.find(
    (project) => project.projectId === selectedProjectId,
  ) ?? workspace.projects[0];

  useEffect(() => {
    if (
      selectedProject
      && selectedProject.projectId !== selectedProjectId
    ) {
      setSelectedProjectId(selectedProject.projectId);
    }
  }, [selectedProject, selectedProjectId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        if (pluginTarget) setPluginTarget(undefined);
        else onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, pluginTarget]);

  return (
    <div className="project-board-manager-backdrop" role="presentation">
      <section
        className="project-board-manager"
        role="dialog"
        aria-modal="true"
        aria-label={t('projectBoard.managerTitle')}
      >
        <header className="project-board-manager-header">
          <div>
            <span>
              <FolderKanban size={14} />
              {t('projectBoard.managerKicker')}
            </span>
            <h2>{t('projectBoard.managerTitle')}</h2>
            <p>{t('projectBoard.managerDescription')}</p>
          </div>
          <button
            type="button"
            aria-label={t('context.close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>

        <div className="project-board-manager-layout">
          <aside className="project-board-manager-projects">
            <header>
              <strong>{t('projectBoard.projectsTitle')}</strong>
              <button type="button" onClick={onCreateProject}>
                <Plus size={14} />
                {t('projectBoard.addProject')}
              </button>
            </header>
            <nav aria-label={t('projectBoard.projectsTitle')}>
              {workspace.projects.map((project) => (
                <button
                  key={project.projectId}
                  type="button"
                  className={
                    project.projectId === selectedProject?.projectId
                      ? 'is-active'
                      : undefined
                  }
                  onClick={() => {
                    setSelectedProjectId(project.projectId);
                    setPluginTarget(undefined);
                  }}
                >
                  <span>
                    <strong>{project.name}</strong>
                    <small>
                      {project.boards.length} {t('projectBoard.boardsTitle')}
                    </small>
                  </span>
                  <ArrowRight size={14} />
                </button>
              ))}
            </nav>
          </aside>

          <main className="project-board-manager-content">
            {selectedProject ? (
              <>
                <ProjectHeader
                  current={selectedProject.projectId === currentProjectId}
                  onCreateBoard={() => onCreateBoard(selectedProject.projectId)}
                  onDelete={() => onDeleteProject(selectedProject.projectId)}
                  onOpenPlugins={() => setPluginTarget({
                    boardId: null,
                    label: selectedProject.name,
                    projectId: selectedProject.projectId,
                    scope: 'project',
                  })}
                  onRename={() => onRenameProject(
                    selectedProject.projectId,
                    selectedProject.name,
                  )}
                  project={selectedProject}
                  t={t}
                />
                <section className="project-board-manager-board-section">
                  <header>
                    <div>
                      <strong>{t('projectBoard.boardsTitle')}</strong>
                      <small>{t('projectBoard.boardListDescription')}</small>
                    </div>
                    <button
                      type="button"
                      className="is-primary"
                      onClick={() => onCreateBoard(selectedProject.projectId)}
                    >
                      <Plus size={14} />
                      {t('projectBoard.addBoard')}
                    </button>
                  </header>
                  <div className="project-board-manager-board-grid">
                    {selectedProject.boards.map((board) => (
                      <BoardCard
                        key={board.boardId}
                        board={board}
                        current={
                          board.boardId === currentBoardId
                          && selectedProject.projectId === currentProjectId
                        }
                        locale={locale}
                        onDelete={() => onDeleteBoard(
                          selectedProject.projectId,
                          board.boardId,
                        )}
                        onDuplicate={() => onDuplicateBoard(
                          selectedProject.projectId,
                          board.boardId,
                        )}
                        onOpen={() => onOpenBoard(
                          selectedProject.projectId,
                          board.boardId,
                        )}
                        onOpenPlugins={() => setPluginTarget({
                          boardId: board.boardId,
                          label: `${selectedProject.name} / ${board.name}`,
                          projectId: selectedProject.projectId,
                          scope: 'board',
                        })}
                        onRename={() => onRenameBoard(
                          selectedProject.projectId,
                          board.boardId,
                          board.name,
                        )}
                        pluginSummary={pluginActivationSummary(
                          pluginSnapshot,
                          profileState,
                          selectedProject.projectId,
                          board.boardId,
                        )}
                        t={t}
                      />
                    ))}
                  </div>
                </section>
              </>
            ) : null}
          </main>
        </div>

        {pluginTarget ? (
          <ProjectBoardPluginSettings
            locale={locale}
            onClose={() => setPluginTarget(undefined)}
            pluginController={pluginController}
            runtime={pluginSnapshot}
            target={pluginTarget}
          />
        ) : null}
      </section>
    </div>
  );
}

function ProjectHeader({
  current,
  onCreateBoard,
  onDelete,
  onOpenPlugins,
  onRename,
  project,
  t,
}: {
  current: boolean;
  onCreateBoard: () => void;
  onDelete: () => void;
  onOpenPlugins: () => void;
  onRename: () => void;
  project: WorkspaceProjectSummary;
  t: ReturnType<typeof useI18n>['t'];
}): ReactElement {
  return (
    <header className="project-board-manager-project-header">
      <div>
        <span>
          {current ? t('projectBoard.currentProject') : null}
        </span>
        <h3>{project.name}</h3>
        <p>{project.projectId}</p>
      </div>
      <div>
        <button type="button" onClick={onOpenPlugins}>
          <Settings2 size={14} />
          {t('projectBoard.pluginSettings')}
        </button>
        <button type="button" onClick={onRename}>
          <Pencil size={14} />
          {t('projectBoard.rename')}
        </button>
        <button type="button" onClick={onCreateBoard}>
          <Plus size={14} />
          {t('projectBoard.addBoard')}
        </button>
        <button type="button" className="is-danger" onClick={onDelete}>
          <Trash2 size={14} />
          {t('projectBoard.delete')}
        </button>
      </div>
    </header>
  );
}

function BoardCard({
  board,
  current,
  locale,
  onDelete,
  onDuplicate,
  onOpen,
  onOpenPlugins,
  onRename,
  pluginSummary,
  t,
}: {
  board: WorkspaceBoardSummary;
  current: boolean;
  locale: string;
  onDelete: () => void;
  onDuplicate: () => void;
  onOpen: () => void;
  onOpenPlugins: () => void;
  onRename: () => void;
  pluginSummary: { enabled: number; total: number };
  t: ReturnType<typeof useI18n>['t'];
}): ReactElement {
  return (
    <article className={current ? 'is-current' : undefined}>
      <header>
        <span>{current ? t('projectBoard.currentBoard') : null}</span>
      </header>
      <button
        type="button"
        className="project-board-manager-board-open"
        onClick={onOpen}
      >
        <strong>{board.name}</strong>
        <small>{board.boardId}</small>
      </button>
      <div className="project-board-manager-board-meta">
        <span>
          {pluginSummary.enabled}/{pluginSummary.total}{' '}
          {t('projectBoard.pluginsEnabled')}
        </span>
        <time dateTime={board.updatedAt}>
          {new Date(board.updatedAt).toLocaleDateString(
            locale === 'zh' ? 'zh-CN' : 'en-US',
          )}
        </time>
      </div>
      <footer>
        <button type="button" onClick={onOpenPlugins}>
          <Settings2 size={14} />
          {t('projectBoard.pluginSettings')}
        </button>
        <details className="project-board-manager-board-more">
          <summary aria-label={t('context.more')}>
            <MoreHorizontal size={16} />
            {t('context.more')}
          </summary>
          <div>
            <button type="button" onClick={onRename}>
              <Pencil size={14} />
              {t('projectBoard.rename')}
            </button>
            <button type="button" onClick={onDuplicate}>
              <Copy size={14} />
              {t('projectBoard.copyBoard')}
            </button>
            <button type="button" className="is-danger" onClick={onDelete}>
              <Trash2 size={14} />
              {t('projectBoard.delete')}
            </button>
          </div>
        </details>
      </footer>
    </article>
  );
}

function pluginActivationSummary(
  runtime: ReturnType<PluginRuntimeControllerV1['getSnapshot']>,
  profile: ReturnType<PluginRuntimeControllerV1['getProfileState']>,
  projectId: string,
  boardId: string,
): { enabled: number; total: number } {
  const projection = projectPluginRuntimeForProfileV1({
    boardId,
    profile,
    projectId,
    runtime,
  });
  return {
    enabled: projection.modules.filter(
      (entry) => entry.activationState === 'enabled',
    ).length,
    total: projection.modules.length,
  };
}
