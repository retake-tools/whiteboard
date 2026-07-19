import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { defaultSnapshot } from '../../src/core/sampleBoard';
import { migrateBoardSnapshot } from '../../src/core/snapshotMigration';
import type { BoardRecord, BoardSnapshot, ProjectRecord } from '../../src/core/types';
import {
  compareOrderedRecords,
  ensureWorkspace,
  projectsRoot,
  retakeRoot,
  workspaceRoot,
  writeJson,
} from './context';

export async function ensureDefaultSnapshot(): Promise<BoardSnapshot> {
  await ensureWorkspace();

  const defaultProjectDir = path.join(projectsRoot, defaultSnapshot.project.projectId);
  const defaultBoardDir = path.join(defaultProjectDir, 'boards', defaultSnapshot.board.boardId);
  const snapshotPath = path.join(defaultBoardDir, 'snapshot.json');

  try {
    const snapshot = migrateBoardSnapshot(JSON.parse(await readFile(snapshotPath, 'utf8')) as BoardSnapshot);
    ensureSnapshotCodexProjectPath(snapshot);
    await saveSnapshot(snapshot);
    return snapshot;
  } catch {
    const snapshot = createDefaultWorkspaceSnapshot();
    await saveSnapshot(snapshot);
    return snapshot;
  }
}

export async function getBoardSnapshot(input?: { projectId?: string; boardId?: string }): Promise<BoardSnapshot> {
  if (!input?.projectId || !input.boardId) return ensureDefaultSnapshot();
  return loadSnapshot(input.projectId, input.boardId);
}

export async function saveSnapshot(snapshot: BoardSnapshot): Promise<void> {
  await ensureWorkspace();

  const normalizedSnapshot = migrateBoardSnapshot(snapshot);
  const projectDir = path.join(projectsRoot, normalizedSnapshot.project.projectId);
  const boardDir = path.join(projectDir, 'boards', normalizedSnapshot.board.boardId);

  await mkdir(boardDir, { recursive: true });
  await mkdir(path.join(projectDir, 'assets'), { recursive: true });
  await mkdir(path.join(projectDir, 'executions'), { recursive: true });
  await mkdir(path.join(projectDir, 'skills'), { recursive: true });

  await writeJson(path.join(projectDir, 'project.json'), normalizedSnapshot.project);
  await writeJson(path.join(boardDir, 'board.json'), normalizedSnapshot.board);
  await writeJson(path.join(boardDir, 'snapshot.json'), normalizedSnapshot);
}

export async function resetWorkspace(): Promise<BoardSnapshot> {
  await rm(retakeRoot, { recursive: true, force: true });
  const snapshot = createDefaultWorkspaceSnapshot();
  await saveSnapshot(snapshot);
  return snapshot;
}

export async function loadSnapshot(projectId: string, boardId: string): Promise<BoardSnapshot> {
  if (projectId === defaultSnapshot.project.projectId && boardId === defaultSnapshot.board.boardId) {
    return ensureDefaultSnapshot();
  }

  const snapshotPath = path.join(projectsRoot, projectId, 'boards', boardId, 'snapshot.json');
  const snapshot = migrateBoardSnapshot(JSON.parse(await readFile(snapshotPath, 'utf8')) as BoardSnapshot);
  ensureSnapshotCodexProjectPath(snapshot);
  await saveSnapshot(snapshot);
  return snapshot;
}

export async function readProject(projectId: string): Promise<ProjectRecord> {
  return JSON.parse(await readFile(path.join(projectsRoot, projectId, 'project.json'), 'utf8')) as ProjectRecord;
}

export async function readBoard(projectId: string, boardId: string): Promise<BoardRecord> {
  return JSON.parse(
    await readFile(path.join(projectsRoot, projectId, 'boards', boardId, 'board.json'), 'utf8'),
  ) as BoardRecord;
}

export async function listProjectBoards(projectId: string): Promise<BoardRecord[]> {
  const boardsRoot = path.join(projectsRoot, projectId, 'boards');
  const boardDirs = await readdir(boardsRoot, { withFileTypes: true });
  const boards = await Promise.all(
    boardDirs.filter((entry) => entry.isDirectory()).map((entry) => readBoard(projectId, entry.name)),
  );
  return boards.sort(compareOrderedRecords);
}

export async function getProjectDefaultSnapshot(projectId: string): Promise<BoardSnapshot> {
  const project = await readProject(projectId);
  return loadSnapshot(projectId, project.defaultBoardId);
}

export function createBlankSnapshot(input: {
  projectId: string;
  boardId: string;
  projectName: string;
  boardName: string;
  now: string;
  projectOrder?: number;
  boardOrder?: number;
  project?: ProjectRecord;
}): BoardSnapshot {
  const project: ProjectRecord = input.project
    ? { ...structuredClone(input.project), defaultBoardId: input.boardId, updatedAt: input.now }
    : {
        projectId: input.projectId,
        name: input.projectName,
        createdAt: input.now,
        updatedAt: input.now,
        defaultBoardId: input.boardId,
        order: input.projectOrder ?? 0,
        localRoot: path.relative(workspaceRoot, path.join(projectsRoot, input.projectId)),
        codexProjectPath: workspaceRoot,
      };

  return {
    schemaVersion: 1,
    project,
    board: {
      boardId: input.boardId,
      projectId: input.projectId,
      name: input.boardName,
      createdAt: input.now,
      updatedAt: input.now,
      order: input.boardOrder ?? 0,
    },
    layers: [{ id: 'layer_default', boardId: input.boardId, name: 'Default layer', visible: true, locked: false, order: 0 }],
    blocks: [],
    edges: [],
    assets: [],
    executions: [],
    historyEvents: [],
    viewport: structuredClone(defaultSnapshot.viewport),
  };
}

export async function syncProjectToSnapshots(project: ProjectRecord): Promise<void> {
  const boards = await listProjectBoards(project.projectId);
  await writeJson(path.join(projectsRoot, project.projectId, 'project.json'), project);
  for (const board of boards) {
    const snapshot = await loadSnapshot(project.projectId, board.boardId);
    snapshot.project = structuredClone(project);
    await saveSnapshot(snapshot);
  }
}

function createDefaultWorkspaceSnapshot(): BoardSnapshot {
  const snapshot = migrateBoardSnapshot(structuredClone(defaultSnapshot));
  snapshot.project.localRoot = path.relative(workspaceRoot, path.join(projectsRoot, snapshot.project.projectId));
  snapshot.project.codexProjectPath = workspaceRoot;
  return snapshot;
}

function ensureSnapshotCodexProjectPath(snapshot: BoardSnapshot): void {
  snapshot.project.codexProjectPath ??= workspaceRoot;
}
