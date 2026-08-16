import { Check, LayoutGrid, Plus, Settings2 } from 'lucide-react';
import { useState, type ReactElement, type RefObject } from 'react';
import type { WorkspaceBoardSummary, WorkspaceProjectSummary } from '../core/types';
import { useI18n } from '../i18n';

export function WorkspaceBoardSwitcher({
  currentBoardId,
  onCreateBoard,
  onOpenManager,
  onSelectBoard,
  project,
  rootRef,
}: {
  currentBoardId: string;
  onCreateBoard: (projectId: string) => void;
  onOpenManager: () => void;
  onSelectBoard: (projectId: string, boardId: string) => void;
  project: WorkspaceProjectSummary;
  rootRef: RefObject<HTMLElement | null>;
}): ReactElement {
  const { locale, t } = useI18n();

  return (
    <section
      ref={rootRef}
      id="workspace-board-switcher"
      className="workspace-board-switcher"
      aria-label={`${project.name} · ${t('projectBoard.boardsTitle')}`}
    >
      <header className="workspace-board-switcher-header">
        <span className="workspace-project-mark is-current" aria-hidden="true">
          {projectIdentity(project.name)}
        </span>
        <span className="workspace-board-switcher-title">
          <strong>{project.name}</strong>
          <small>{project.boards.length} {t('projectBoard.boardsTitle')}</small>
        </span>
      </header>

      <div className="workspace-board-switcher-label">{t('projectBoard.boardsTitle')}</div>
      <div className="workspace-board-switcher-list">
        {project.boards.map((board) => {
          const current = board.boardId === currentBoardId;
          return (
            <button
              key={board.boardId}
              type="button"
              className={current ? 'is-current' : undefined}
              aria-current={current ? 'page' : undefined}
              onClick={() => onSelectBoard(project.projectId, board.boardId)}
            >
              <BoardThumbnail board={board} />
              <span className="workspace-board-switcher-board-copy">
                <strong>{board.name}</strong>
                <time dateTime={board.updatedAt}>{formatUpdatedAt(board.updatedAt, locale)}</time>
              </span>
              {current ? <Check className="workspace-board-switcher-check" size={16} /> : null}
            </button>
          );
        })}
      </div>

      <footer>
        <button type="button" onClick={() => onCreateBoard(project.projectId)}>
          <Plus size={16} />
          {t('projectBoard.addBoard')}
        </button>
        <button type="button" onClick={onOpenManager}>
          <Settings2 size={16} />
          {t('projectBoard.openManager')}
        </button>
      </footer>
    </section>
  );
}

function BoardThumbnail({ board }: { board: WorkspaceBoardSummary }): ReactElement {
  const [failed, setFailed] = useState(false);

  return (
    <span className="workspace-board-preview" aria-hidden="true">
      {failed ? (
        <LayoutGrid size={15} strokeWidth={1.6} />
      ) : (
        <img
          alt=""
          decoding="async"
          loading="lazy"
          src={boardThumbnailUrl(board)}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

export function boardThumbnailUrl(board: WorkspaceBoardSummary): string {
  const projectId = encodeURIComponent(board.projectId);
  const boardId = encodeURIComponent(board.boardId);
  const revision = encodeURIComponent(board.updatedAt);
  return `/api/local/boards/${projectId}/${boardId}/thumbnail.webp?revision=${revision}`;
}

export function projectIdentity(name: string): string {
  const normalized = name.trim();
  if (!normalized) return 'R';
  const hanCharacter = Array.from(normalized).find((character) => /\p{Script=Han}/u.test(character));
  if (hanCharacter) return hanCharacter;
  const words = normalized.split(/\s+/u).filter(Boolean);
  if (words.length >= 2) {
    return words.slice(0, 2).map((word) => Array.from(word)[0]).join('').toUpperCase();
  }
  return Array.from(words[0]).slice(0, 2).join('').toUpperCase();
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
