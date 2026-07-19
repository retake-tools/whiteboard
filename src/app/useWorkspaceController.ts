import { useEffect, useState, type RefObject } from 'react';
import {
  createWorkspaceBoard,
  createWorkspaceProject,
  deleteWorkspaceBoard,
  deleteWorkspaceProject,
  duplicateWorkspaceBoard,
  loadBoardSnapshot,
  loadWorkspaceSummary,
  renameWorkspaceBoard,
  renameWorkspaceProject,
  reorderWorkspaceBoards,
  reorderWorkspaceProjects,
} from '../core/boardStore';
import { touchBoard } from '../core/blockFactory';
import { numberedDefaultName } from '../core/listUtils';
import type { BoardSnapshot, WorkspaceSummary } from '../core/types';
import type { ProjectBoardDialogState } from '../components/projectBoardTypes';
import type { useI18n } from '../i18n';

interface WorkspaceControllerOptions {
  applyLoadedSnapshot: (snapshot: BoardSnapshot) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  t: ReturnType<typeof useI18n>['t'];
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: { syncFlow?: boolean; persist?: boolean; history?: boolean },
  ) => BoardSnapshot;
}

export function useWorkspaceController({
  applyLoadedSnapshot,
  snapshotRef,
  t,
  updateSnapshot,
}: WorkspaceControllerOptions) {
  const [workspace, setWorkspace] = useState<WorkspaceSummary | undefined>();
  const [projectBoardDialog, setProjectBoardDialog] = useState<ProjectBoardDialogState | undefined>();

  useEffect(() => {
    let cancelled = false;
    void loadWorkspaceSummary()
      .then((loadedWorkspace) => {
        if (!cancelled) setWorkspace(loadedWorkspace);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshWorkspace(): Promise<void> {
    setWorkspace(await loadWorkspaceSummary());
  }

  async function refreshCurrentBoard(): Promise<void> {
    const nextSnapshot = await loadBoardSnapshot({
      projectId: snapshotRef.current.project.projectId,
      boardId: snapshotRef.current.board.boardId,
    });
    applyLoadedSnapshot(nextSnapshot);
    await refreshWorkspace();
  }

  async function selectBoard(projectId: string, boardId: string): Promise<void> {
    const nextSnapshot = await loadBoardSnapshot({ projectId, boardId });
    applyLoadedSnapshot(nextSnapshot);
    await refreshWorkspace();
  }

  function createProjectFromMenu(): void {
    setProjectBoardDialog({
      action: 'createProject',
      defaultName: numberedDefaultName(t('projectBoard.newProjectName'), (workspace?.projects.length ?? 0) + 1),
    });
  }

  function createBoardFromMenu(projectId: string): void {
    const boardCount = workspace?.projects.find((project) => project.projectId === projectId)?.boards.length ?? 0;
    setProjectBoardDialog({
      action: 'createBoard',
      projectId,
      defaultName: numberedDefaultName(t('projectBoard.newBoardName'), boardCount + 1),
    });
  }

  function renameProjectFromMenu(projectId: string, currentName: string): void {
    setProjectBoardDialog({ action: 'renameProject', projectId, currentName });
  }

  function renameBoardFromMenu(projectId: string, boardId: string, currentName: string): void {
    setProjectBoardDialog({ action: 'renameBoard', projectId, boardId, currentName });
  }

  function duplicateBoardFromMenu(projectId: string, boardId: string): void {
    const sourceBoard = workspace?.projects
      .find((project) => project.projectId === projectId)
      ?.boards.find((candidate) => candidate.boardId === boardId);
    setProjectBoardDialog({
      action: 'duplicateBoard',
      projectId,
      boardId,
      currentName: `${sourceBoard?.name ?? t('projectBoard.newBoardName')} Copy`,
    });
  }

  function deleteBoardFromMenu(projectId: string, boardId: string): void {
    setProjectBoardDialog({ action: 'deleteBoard', projectId, boardId });
  }

  function deleteProjectFromMenu(projectId: string): void {
    setProjectBoardDialog({ action: 'deleteProject', projectId });
  }

  async function submitProjectBoardDialog(value: string): Promise<void> {
    const dialog = projectBoardDialog;
    if (!dialog) return;
    setProjectBoardDialog(undefined);

    if (dialog.action === 'createProject') {
      const result = await createWorkspaceProject(value || dialog.defaultName);
      setWorkspace(result.workspace);
      applyLoadedSnapshot(result.snapshot);
      return;
    }
    if (dialog.action === 'createBoard') {
      const result = await createWorkspaceBoard(dialog.projectId, value || dialog.defaultName);
      setWorkspace(result.workspace);
      applyLoadedSnapshot(result.snapshot);
      return;
    }
    if (dialog.action === 'renameProject') {
      await renameProjectByValue(dialog.projectId, value || dialog.currentName);
      return;
    }
    if (dialog.action === 'renameBoard') {
      const result = await renameWorkspaceBoard(dialog.projectId, dialog.boardId, value || dialog.currentName);
      setWorkspace(result.workspace);
      if (dialog.projectId === snapshotRef.current.project.projectId && dialog.boardId === snapshotRef.current.board.boardId) {
        applyLoadedSnapshot(result.snapshot);
      }
      return;
    }
    if (dialog.action === 'duplicateBoard') {
      const result = await duplicateWorkspaceBoard(dialog.projectId, dialog.boardId, value || dialog.currentName);
      setWorkspace(result.workspace);
      applyLoadedSnapshot(result.snapshot);
      return;
    }
    if (dialog.action === 'deleteBoard') {
      const result = await deleteWorkspaceBoard(dialog.projectId, dialog.boardId);
      setWorkspace(result.workspace);
      if (dialog.projectId === snapshotRef.current.project.projectId && dialog.boardId === snapshotRef.current.board.boardId) {
        applyLoadedSnapshot(result.snapshot);
      }
      return;
    }
    const result = await deleteWorkspaceProject(dialog.projectId);
    setWorkspace(result.workspace);
    if (dialog.projectId === snapshotRef.current.project.projectId) applyLoadedSnapshot(result.snapshot);
  }

  async function renameProjectByValue(projectId: string, name: string): Promise<void> {
    const result = await renameWorkspaceProject(projectId, name);
    setWorkspace(result.workspace);
    if (result.snapshot && result.snapshot.project.projectId === snapshotRef.current.project.projectId) {
      applyLoadedSnapshot(result.snapshot);
    } else if (projectId === snapshotRef.current.project.projectId) {
      updateSnapshot((current) => {
        current.project.name = name.trim() || current.project.name;
        return touchBoard(current);
      }, { persist: true });
    }
  }

  async function reorderProjectsFromMenu(projectIds: string[]): Promise<void> {
    const result = await reorderWorkspaceProjects(projectIds);
    setWorkspace(result.workspace);
  }

  async function reorderBoardsFromMenu(projectId: string, boardIds: string[]): Promise<void> {
    const result = await reorderWorkspaceBoards(projectId, boardIds);
    setWorkspace(result.workspace);
  }

  return {
    createBoardFromMenu,
    createProjectFromMenu,
    deleteBoardFromMenu,
    deleteProjectFromMenu,
    duplicateBoardFromMenu,
    projectBoardDialog,
    refreshCurrentBoard,
    renameBoardFromMenu,
    renameProjectFromMenu,
    reorderBoardsFromMenu,
    reorderProjectsFromMenu,
    selectBoard,
    setProjectBoardDialog,
    submitProjectBoardDialog,
    workspace,
  };
}
