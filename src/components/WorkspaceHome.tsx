import { ImagePlus, LayoutGrid, Plus } from 'lucide-react';
import { memo, useMemo, useState, type ReactElement } from 'react';
import type {
  WorkspaceBoardSummary,
  WorkspaceProjectSummary,
  WorkspaceSummary,
} from '../core/types';
import { useI18n } from '../i18n';
import { boardThumbnailUrl } from './WorkspaceBoardSwitcher';

interface RecentBoard {
  board: WorkspaceBoardSummary;
  project: WorkspaceProjectSummary;
}

export const WorkspaceHome = memo(function WorkspaceHome({
  currentBoardId,
  currentProjectId,
  onCreateProject,
  onOpenImage,
  onSelectBoard,
  workspace,
}: {
  currentBoardId: string;
  currentProjectId: string;
  onCreateProject: () => void;
  onOpenImage: () => void;
  onSelectBoard: (projectId: string, boardId: string) => void;
  workspace?: WorkspaceSummary;
}): ReactElement {
  const { locale, t } = useI18n();
  const recentBoards = useMemo(() => collectRecentBoards(workspace), [workspace]);

  return (
    <section className="workspace-home" aria-labelledby="workspace-home-title">
      <header className="workspace-home-header">
        <div>
          <h1 id="workspace-home-title">{t('workspaceHome.title')}</h1>
          <p>{t('workspaceHome.subtitle')}</p>
        </div>
        <div className="workspace-home-actions">
          <button type="button" className="is-primary" onClick={onOpenImage}>
            <ImagePlus size={17} />
            {t('workspaceHome.openImage')}
          </button>
          <button type="button" onClick={onCreateProject}>
            <Plus size={17} />
            {t('projectBoard.addProject')}
          </button>
        </div>
      </header>

      {recentBoards.length ? (
        <div className="workspace-home-grid">
          <button type="button" className="workspace-home-new-card" onClick={onCreateProject}>
            <span><Plus size={22} /></span>
            <strong>{t('projectBoard.addProject')}</strong>
            <small>{t('workspaceHome.newProjectDescription')}</small>
          </button>
          {recentBoards.map(({ board, project }) => (
            <RecentBoardCard
              board={board}
              current={board.boardId === currentBoardId && project.projectId === currentProjectId}
              key={`${project.projectId}:${board.boardId}`}
              locale={locale}
              onOpen={() => onSelectBoard(project.projectId, board.boardId)}
              project={project}
            />
          ))}
        </div>
      ) : (
        <div className="workspace-home-empty">
          <LayoutGrid size={28} />
          <strong>{t('workspaceHome.emptyTitle')}</strong>
          <p>{t('workspaceHome.emptyDescription')}</p>
          <button type="button" className="is-primary" onClick={onOpenImage}>
            <ImagePlus size={17} />
            {t('workspaceHome.openImage')}
          </button>
        </div>
      )}
    </section>
  );
});

function RecentBoardCard({
  board,
  current,
  locale,
  onOpen,
  project,
}: {
  board: WorkspaceBoardSummary;
  current: boolean;
  locale: 'en' | 'zh';
  onOpen: () => void;
  project: WorkspaceProjectSummary;
}): ReactElement {
  const [thumbnailFailed, setThumbnailFailed] = useState(false);
  const { t } = useI18n();

  return (
    <button
      type="button"
      className={`workspace-home-board-card${current ? ' is-current' : ''}`}
      aria-current={current ? 'page' : undefined}
      onClick={onOpen}
    >
      <span className="workspace-home-board-preview" aria-hidden="true">
        {thumbnailFailed ? (
          <LayoutGrid size={24} />
        ) : (
          <img
            alt=""
            decoding="async"
            loading="lazy"
            src={boardThumbnailUrl(board)}
            onError={() => setThumbnailFailed(true)}
          />
        )}
      </span>
      <span className="workspace-home-board-copy">
        <small>{project.name}</small>
        <strong>{board.name}</strong>
        <time dateTime={board.updatedAt}>
          {t('workspaceHome.updated')} {formatUpdatedAt(board.updatedAt, locale)}
        </time>
      </span>
    </button>
  );
}

export function collectRecentBoards(workspace?: WorkspaceSummary): RecentBoard[] {
  const boards: RecentBoard[] = [];
  for (const project of workspace?.projects ?? []) {
    for (const board of project.boards) boards.push({ board, project });
  }
  return [...boards].sort((left, right) => right.board.updatedAt.localeCompare(left.board.updatedAt));
}

function formatUpdatedAt(value: string, locale: 'en' | 'zh'): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const elapsed = timestamp - Date.now();
  const absolute = Math.abs(elapsed);
  const formatter = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    numeric: 'auto',
  });
  if (absolute < 60_000) return formatter.format(0, 'second');
  if (absolute < 3_600_000) return formatter.format(Math.round(elapsed / 60_000), 'minute');
  if (absolute < 86_400_000) return formatter.format(Math.round(elapsed / 3_600_000), 'hour');
  if (absolute < 604_800_000) return formatter.format(Math.round(elapsed / 86_400_000), 'day');
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en', {
    month: 'short',
    day: 'numeric',
  }).format(timestamp);
}
