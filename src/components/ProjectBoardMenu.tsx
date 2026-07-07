import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, GripVertical, MoreVertical, Pin, PinOff, Plus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { WorkspaceBoardSummary, WorkspaceProjectSummary, WorkspaceSummary } from '../core/types';
import { useI18n } from '../i18n';
import { TooltipIconButton, TooltipWrapper } from './Tooltip';

type MenuMode = 'projects' | 'boards';

interface ProjectBoardMenuProps {
  currentProjectId: string;
  currentBoardId: string;
  isPinned?: boolean;
  mode: MenuMode;
  workspace?: WorkspaceSummary;
  onClose: () => void;
  onCreateProject: () => void;
  onCreateBoard: (projectId: string) => void;
  onDeleteBoard: (projectId: string, boardId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDuplicateBoard: (projectId: string, boardId: string) => void;
  onRenameBoard: (projectId: string, boardId: string, currentName: string) => void;
  onRenameProject: (projectId: string, currentName: string) => void;
  onReorderBoards: (projectId: string, boardIds: string[]) => void;
  onReorderProjects: (projectIds: string[]) => void;
  onSelectBoard: (projectId: string, boardId: string) => void;
  onTogglePinned?: () => void;
}

export function ProjectBoardMenu({
  currentProjectId,
  currentBoardId,
  isPinned,
  mode,
  workspace,
  onClose,
  onCreateProject,
  onCreateBoard,
  onDeleteBoard,
  onDeleteProject,
  onDuplicateBoard,
  onRenameBoard,
  onRenameProject,
  onReorderBoards,
  onReorderProjects,
  onSelectBoard,
  onTogglePinned,
}: ProjectBoardMenuProps): ReactElement {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [openActionKey, setOpenActionKey] = useState<string | undefined>();
  const [dragItem, setDragItem] = useState<DragItem | undefined>();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const currentProject = useMemo(
    () => workspace?.projects.find((project) => project.projectId === currentProjectId),
    [currentProjectId, workspace],
  );
  const projects = workspace?.projects ?? [];
  const title = mode === 'projects' ? t('projectBoard.projectsTitle') : t('projectBoard.boardsTitle');

  useEffect(() => {
    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Element;
      if (rootRef.current?.contains(target)) {
        if (
          openActionKey &&
          !target.closest('.project-board-action-menu') &&
          !target.closest('.project-board-action-trigger')
        ) {
          setOpenActionKey(undefined);
        }
        return;
      }
      if (mode === 'boards' && target.closest('.top-bar-board-menu-anchor')) return;
      setOpenActionKey(undefined);
      if (!isPinned) onClose();
    }

    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [isPinned, mode, onClose, openActionKey]);

  function handleProjectDragStart(event: DragStartEvent): void {
    const item = parseSortableId(event.active.id);
    if (item?.type !== 'project') return;
    setOpenActionKey(undefined);
    setDragItem(item);
  }

  function handleProjectDragEnd(event: DragEndEvent): void {
    const activeItem = parseSortableId(event.active.id);
    const overItem = event.over ? parseSortableId(event.over.id) : undefined;
    setDragItem(undefined);
    if (activeItem?.type !== 'project' || overItem?.type !== 'project') return;
    onReorderProjects(reorderIds(projects.map((project) => project.projectId), activeItem.id, overItem.id));
  }

  function handleBoardDragStart(event: DragStartEvent): void {
    const item = parseSortableId(event.active.id);
    if (item?.type !== 'board') return;
    setOpenActionKey(undefined);
    setDragItem(item);
  }

  function handleBoardDragEnd(project: WorkspaceProjectSummary, event: DragEndEvent): void {
    const activeItem = parseSortableId(event.active.id);
    const overItem = event.over ? parseSortableId(event.over.id) : undefined;
    setDragItem(undefined);
    if (
      activeItem?.type !== 'board' ||
      overItem?.type !== 'board' ||
      activeItem.projectId !== project.projectId ||
      overItem.projectId !== project.projectId
    ) {
      return;
    }

    onReorderBoards(
      project.projectId,
      reorderIds(project.boards.map((board) => board.boardId), activeItem.id, overItem.id),
    );
  }

  return (
    <section
      ref={rootRef}
      className={[
        'project-board-menu',
        `is-${mode}`,
        isPinned ? 'is-pinned' : '',
        dragItem?.type === 'project' ? 'is-project-dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-label={title}
    >
      {mode === 'projects' ? (
        <header className="project-board-menu-header">
          <strong>{title}</strong>
          <div className="project-board-row-actions">
            <TooltipIconButton className="project-board-icon-button" label={t('projectBoard.addProject')} onClick={onCreateProject}>
              <Plus size={15} />
            </TooltipIconButton>
            {onTogglePinned ? (
              <TooltipIconButton
                className={isPinned ? 'project-board-icon-button is-active' : 'project-board-icon-button'}
                label={isPinned ? t('projectBoard.unpin') : t('projectBoard.pin')}
                onClick={onTogglePinned}
              >
                {isPinned ? <PinOff size={14} /> : <Pin size={14} />}
              </TooltipIconButton>
            ) : null}
          </div>
        </header>
      ) : null}

      <div className={mode === 'projects' ? 'project-board-menu-body' : 'project-board-menu-body is-board-only'}>
        {mode === 'projects' ? (
          <DndContext
            collisionDetection={closestCenter}
            onDragCancel={() => setDragItem(undefined)}
            onDragEnd={handleProjectDragEnd}
            onDragStart={handleProjectDragStart}
            sensors={sensors}
          >
            <SortableContext items={projects.map((project) => sortableProjectId(project.projectId))} strategy={verticalListSortingStrategy}>
              {projects.map((project) => (
                <ProjectRow
                  key={project.projectId}
                  currentBoardId={currentBoardId}
                  currentProjectId={currentProjectId}
                  dragItem={dragItem}
                  isActionsOpen={openActionKey === project.projectId}
                  openActionKey={openActionKey}
                  mode={mode}
                  onCreateBoard={onCreateBoard}
                  onDeleteBoard={onDeleteBoard}
                  onDeleteProject={onDeleteProject}
                  onDuplicateBoard={onDuplicateBoard}
                  onRenameBoard={onRenameBoard}
                  onRenameProject={onRenameProject}
                  onSelectBoard={onSelectBoard}
                  onToggleActions={() => setOpenActionKey((current) => (current === project.projectId ? undefined : project.projectId))}
                  project={project}
                  setOpenActionKey={setOpenActionKey}
                  onBoardDragCancel={() => setDragItem(undefined)}
                  onBoardDragEnd={(event) => handleBoardDragEnd(project, event)}
                  onBoardDragStart={handleBoardDragStart}
                  sensors={sensors}
                />
              ))}
            </SortableContext>
          </DndContext>
        ) : null}
        {mode === 'boards' && currentProject ? (
          <BoardList
            boards={currentProject.boards}
            currentBoardId={currentBoardId}
            currentProjectId={currentProjectId}
            dragItem={dragItem}
            openActionKey={openActionKey}
            onBoardDragCancel={() => setDragItem(undefined)}
            onBoardDragEnd={(event) => handleBoardDragEnd(currentProject, event)}
            onBoardDragStart={handleBoardDragStart}
            onDeleteBoard={onDeleteBoard}
            onDuplicateBoard={onDuplicateBoard}
            onRenameBoard={onRenameBoard}
            onSelectBoard={onSelectBoard}
            projectId={currentProject.projectId}
            root
            sensors={sensors}
            setOpenActionKey={setOpenActionKey}
          />
        ) : null}
      </div>
    </section>
  );
}

function BoardList({
  boards,
  currentBoardId,
  currentProjectId,
  dragItem,
  openActionKey,
  onBoardDragCancel,
  onBoardDragEnd,
  onBoardDragStart,
  onDeleteBoard,
  onDuplicateBoard,
  onRenameBoard,
  onSelectBoard,
  projectId,
  root,
  sensors,
  setOpenActionKey,
}: {
  boards: WorkspaceBoardSummary[];
  currentBoardId: string;
  currentProjectId: string;
  dragItem?: DragItem;
  openActionKey?: string;
  onBoardDragCancel: () => void;
  onBoardDragEnd: (event: DragEndEvent) => void;
  onBoardDragStart: (event: DragStartEvent) => void;
  onDeleteBoard: (projectId: string, boardId: string) => void;
  onDuplicateBoard: (projectId: string, boardId: string) => void;
  onRenameBoard: (projectId: string, boardId: string, currentName: string) => void;
  onSelectBoard: (projectId: string, boardId: string) => void;
  projectId: string;
  root?: boolean;
  sensors: ReturnType<typeof useSensors>;
  setOpenActionKey: (key: string | undefined) => void;
}): ReactElement {
  return (
    <DndContext
      collisionDetection={closestCenter}
      onDragCancel={onBoardDragCancel}
      onDragEnd={onBoardDragEnd}
      onDragStart={onBoardDragStart}
      sensors={sensors}
    >
      <SortableContext items={boards.map((board) => sortableBoardId(projectId, board.boardId))} strategy={verticalListSortingStrategy}>
        <div className={root ? 'project-board-board-list is-root-list' : 'project-board-board-list'}>
          {boards.map((board) => (
            <BoardRow
              key={board.boardId}
              board={board}
              currentBoardId={currentBoardId}
              currentProjectId={currentProjectId}
              dragItem={dragItem}
              isActionsOpen={openActionKeyForBoard(projectId, board.boardId) === openActionKey}
              onDeleteBoard={onDeleteBoard}
              onDuplicateBoard={onDuplicateBoard}
              onRenameBoard={onRenameBoard}
              onSelectBoard={onSelectBoard}
              onCloseActions={() => setOpenActionKey(undefined)}
              onToggleActions={() => {
                const actionKey = openActionKeyForBoard(projectId, board.boardId);
                setOpenActionKey(openActionKey === actionKey ? undefined : actionKey);
              }}
              projectId={projectId}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function ProjectRow({
  currentBoardId,
  currentProjectId,
  dragItem,
  isActionsOpen,
  mode,
  openActionKey,
  onBoardDragCancel,
  onBoardDragEnd,
  onBoardDragStart,
  onCreateBoard,
  onDeleteBoard,
  onDeleteProject,
  onDuplicateBoard,
  onRenameBoard,
  onRenameProject,
  onSelectBoard,
  onToggleActions,
  project,
  sensors,
  setOpenActionKey,
}: {
  currentBoardId: string;
  currentProjectId: string;
  dragItem?: DragItem;
  isActionsOpen: boolean;
  mode: MenuMode;
  openActionKey?: string;
  onBoardDragCancel: () => void;
  onBoardDragEnd: (event: DragEndEvent) => void;
  onBoardDragStart: (event: DragStartEvent) => void;
  onCreateBoard: (projectId: string) => void;
  onDeleteBoard: (projectId: string, boardId: string) => void;
  onDeleteProject: (projectId: string) => void;
  onDuplicateBoard: (projectId: string, boardId: string) => void;
  onRenameBoard: (projectId: string, boardId: string, currentName: string) => void;
  onRenameProject: (projectId: string, currentName: string) => void;
  onSelectBoard: (projectId: string, boardId: string) => void;
  onToggleActions: () => void;
  project: WorkspaceProjectSummary;
  sensors: ReturnType<typeof useSensors>;
  setOpenActionKey: (key: string | undefined) => void;
}): ReactElement {
  const { t } = useI18n();
  const canDragProject = mode === 'projects';
  const sortable = useSortable({ id: sortableProjectId(project.projectId), disabled: !canDragProject });
  const style = sortableStyle(sortable.transform, sortable.transition);

  return (
    <div
      ref={sortable.setNodeRef}
      className={`project-board-project${sortable.isDragging ? ' is-dragging' : ''}`}
      style={style}
    >
      <div
        className={`project-board-project-row${dragItem?.id === project.projectId ? ' is-active-drag' : ''}`}
      >
        {canDragProject ? (
          <button
            type="button"
            className="project-board-drag-handle"
            aria-label="Drag project"
            {...sortable.attributes}
            {...sortable.listeners}
          >
            <GripVertical size={14} />
          </button>
        ) : null}
        <div className="project-board-project-name">
          <TooltipWrapper className="project-board-name-tooltip" label={project.name}>
            <strong>{project.name}</strong>
          </TooltipWrapper>
          <span>{project.boards.length}</span>
        </div>
        <div className="project-board-row-actions">
          <TooltipIconButton className="project-board-icon-button" label={t('projectBoard.addBoard')} onClick={() => onCreateBoard(project.projectId)}>
            <Plus size={14} />
          </TooltipIconButton>
          <ActionButton
            isOpen={isActionsOpen}
            label={t('projectBoard.projectActions')}
            onClick={onToggleActions}
          />
          {isActionsOpen ? (
            <ActionMenu
              items={[
                { label: t('projectBoard.rename'), onClick: () => onRenameProject(project.projectId, project.name) },
                { label: t('projectBoard.addBoard'), onClick: () => onCreateBoard(project.projectId) },
                { label: t('projectBoard.delete'), tone: 'danger', onClick: () => onDeleteProject(project.projectId) },
              ]}
              onClose={() => setOpenActionKey(undefined)}
            />
          ) : null}
        </div>
      </div>

      <BoardList
        boards={project.boards}
        currentBoardId={currentBoardId}
        currentProjectId={currentProjectId}
        dragItem={dragItem}
        openActionKey={openActionKey}
        onBoardDragCancel={onBoardDragCancel}
        onBoardDragEnd={onBoardDragEnd}
        onBoardDragStart={onBoardDragStart}
        onDeleteBoard={onDeleteBoard}
        onDuplicateBoard={onDuplicateBoard}
        onRenameBoard={onRenameBoard}
        onSelectBoard={onSelectBoard}
        projectId={project.projectId}
        sensors={sensors}
        setOpenActionKey={setOpenActionKey}
      />
    </div>
  );
}

function BoardRow({
  board,
  currentBoardId,
  currentProjectId,
  dragItem,
  isActionsOpen,
  onDeleteBoard,
  onDuplicateBoard,
  onRenameBoard,
  onSelectBoard,
  onCloseActions,
  onToggleActions,
  projectId,
}: {
  board: WorkspaceBoardSummary;
  currentBoardId: string;
  currentProjectId: string;
  dragItem?: DragItem;
  isActionsOpen: boolean;
  onDeleteBoard: (projectId: string, boardId: string) => void;
  onDuplicateBoard: (projectId: string, boardId: string) => void;
  onRenameBoard: (projectId: string, boardId: string, currentName: string) => void;
  onSelectBoard: (projectId: string, boardId: string) => void;
  onCloseActions: () => void;
  onToggleActions: () => void;
  projectId: string;
}): ReactElement {
  const { t } = useI18n();
  const isActive = currentProjectId === projectId && currentBoardId === board.boardId;
  const sortable = useSortable({ id: sortableBoardId(projectId, board.boardId) });
  const style = sortableStyle(sortable.transform, sortable.transition);

  return (
    <div
      ref={sortable.setNodeRef}
      className={[
        'project-board-board-row',
        isActive ? 'is-active' : '',
        dragItem?.type === 'board' && dragItem.id === board.boardId ? 'is-active-drag' : '',
        sortable.isDragging ? 'is-dragging' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={style}
    >
      <button
        type="button"
        className="project-board-drag-handle"
        aria-label="Drag board"
        {...sortable.attributes}
        {...sortable.listeners}
      >
        <GripVertical size={14} />
      </button>
      <button
        type="button"
        className="project-board-board-button"
        aria-label={t('projectBoard.switchBoard')}
        onClick={() => onSelectBoard(projectId, board.boardId)}
      >
        <TooltipWrapper className="project-board-name-tooltip" label={board.name}>
          <span>{board.name}</span>
        </TooltipWrapper>
        {isActive ? <Check size={14} /> : null}
      </button>
      <div className={isActionsOpen ? 'project-board-row-actions is-open' : 'project-board-row-actions'}>
        <ActionButton isOpen={isActionsOpen} label={t('projectBoard.boardActions')} onClick={onToggleActions} />
        {isActionsOpen ? (
          <ActionMenu
            items={[
              { label: t('projectBoard.rename'), onClick: () => onRenameBoard(projectId, board.boardId, board.name) },
              { label: t('projectBoard.copyBoard'), onClick: () => onDuplicateBoard(projectId, board.boardId) },
              { label: t('projectBoard.delete'), tone: 'danger', onClick: () => onDeleteBoard(projectId, board.boardId) },
            ]}
            onClose={onCloseActions}
          />
        ) : null}
      </div>
    </div>
  );
}

function ActionButton({ isOpen, label, onClick }: { isOpen: boolean; label: string; onClick: () => void }): ReactElement {
  return (
    <TooltipIconButton
      className={isOpen ? 'project-board-icon-button project-board-action-trigger is-active' : 'project-board-icon-button project-board-action-trigger'}
      label={label}
      onClick={onClick}
    >
      <MoreVertical size={14} />
    </TooltipIconButton>
  );
}

function ActionMenu({
  items,
  onClose,
}: {
  items: Array<{ label: string; tone?: 'danger'; onClick: () => void }>;
  onClose: () => void;
}): ReactElement {
  return (
    <div className="project-board-action-menu">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          className={item.tone === 'danger' ? 'is-danger' : undefined}
          onClick={() => {
            onClose();
            item.onClick();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

type DragItem = { type: 'project'; id: string } | { type: 'board'; id: string; projectId: string };

function sortableProjectId(projectId: string): string {
  return `project:${projectId}`;
}

function sortableBoardId(projectId: string, boardId: string): string {
  return `board:${projectId}:${boardId}`;
}

function parseSortableId(sortableId: string | number): DragItem | undefined {
  const id = String(sortableId);
  const [type, firstId, secondId] = id.split(':');
  if (type === 'project' && firstId) return { type: 'project', id: firstId };
  if (type === 'board' && firstId && secondId) return { type: 'board', projectId: firstId, id: secondId };
  return undefined;
}

function sortableStyle(transform: Parameters<typeof CSS.Transform.toString>[0], transition?: string): CSSProperties {
  return {
    transform: CSS.Transform.toString(transform),
    transition,
  };
}

function reorderIds(ids: string[], movingId: string, targetId: string): string[] {
  if (movingId === targetId) return ids;
  const movingIndex = ids.indexOf(movingId);
  const targetIndex = ids.indexOf(targetId);
  if (movingIndex < 0 || targetIndex < 0) return ids;

  const reordered = [...ids];
  const [moving] = reordered.splice(movingIndex, 1);
  reordered.splice(targetIndex, 0, moving);
  return reordered;
}

function openActionKeyForBoard(projectId: string, boardId: string): string {
  return `${projectId}:${boardId}`;
}
