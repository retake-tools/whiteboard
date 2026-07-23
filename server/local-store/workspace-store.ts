import { randomUUID } from 'node:crypto';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { defaultSnapshot } from '../../src/core/sampleBoard';
import type { BoardSnapshot, CodexProjectBinding, WorkspaceSummary } from '../../src/core/types';
import { compareOrderedRecords, ensureWorkspace, projectsRoot, touchSnapshot } from './context';
import {
  createBlankSnapshot,
  getBoardSnapshot,
  getProjectDefaultSnapshot,
  listProjectBoards,
  loadSnapshot,
  readBoard,
  readProject,
  saveSnapshot,
  syncProjectToSnapshots,
} from './snapshot-store';

export async function listWorkspace(): Promise<WorkspaceSummary> {
  await getBoardSnapshot();
  const projectDirs = await readdir(projectsRoot, { withFileTypes: true });
  const projects = await Promise.all(
    projectDirs.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const project = await readProject(entry.name);
      const boardsRoot = path.join(projectsRoot, entry.name, 'boards');
      const boardDirs = await readdir(boardsRoot, { withFileTypes: true }).catch(() => []);
      const boards = await Promise.all(
        boardDirs.filter((boardEntry) => boardEntry.isDirectory()).map((boardEntry) => readBoard(entry.name, boardEntry.name)),
      );
      boards.sort(compareOrderedRecords);
      return {
        projectId: project.projectId,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        defaultBoardId: project.defaultBoardId,
        order: project.order,
        boards,
      };
    }),
  );
  projects.sort(compareOrderedRecords);
  return { defaultProjectId: defaultSnapshot.project.projectId, projects };
}

export async function createProject(input?: { name?: string }): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const now = new Date().toISOString();
  const projectId = `proj_${randomUUID().slice(0, 8)}`;
  const boardId = `board_${randomUUID().slice(0, 8)}`;
  const snapshot = createBlankSnapshot({
    projectId,
    boardId,
    projectName: normalizeName(input?.name, 'Untitled project'),
    boardName: 'Untitled board',
    now,
    projectOrder: await nextProjectOrder(),
    boardOrder: 0,
  });
  await saveSnapshot(snapshot);
  return { snapshot, workspace: await listWorkspace() };
}

export async function createBoard(input: { projectId: string; name?: string }): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const base = await getProjectDefaultSnapshot(input.projectId);
  const now = new Date().toISOString();
  const boardId = `board_${randomUUID().slice(0, 8)}`;
  const snapshot = createBlankSnapshot({
    projectId: base.project.projectId,
    boardId,
    projectName: base.project.name,
    boardName: normalizeName(input.name, 'Untitled board'),
    now,
    project: base.project,
    boardOrder: (await listProjectBoards(input.projectId)).length,
  });
  snapshot.project.defaultBoardId = boardId;
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  await syncProjectToSnapshots(snapshot.project);
  return { snapshot, workspace: await listWorkspace() };
}

export async function reorderProjects(input: { projectIds: string[] }): Promise<{ workspace: WorkspaceSummary }> {
  const workspace = await listWorkspace();
  const knownIds = new Set(workspace.projects.map((project) => project.projectId));
  const orderedIds = input.projectIds.filter((projectId) => knownIds.has(projectId));
  for (const project of workspace.projects) if (!orderedIds.includes(project.projectId)) orderedIds.push(project.projectId);
  await Promise.all(orderedIds.map(async (projectId, order) => {
    const project = await readProject(projectId);
    project.order = order;
    project.updatedAt = new Date().toISOString();
    await syncProjectToSnapshots(project);
  }));
  return { workspace: await listWorkspace() };
}

export async function reorderBoards(input: { projectId: string; boardIds: string[] }): Promise<{ workspace: WorkspaceSummary }> {
  const boards = await listProjectBoards(input.projectId);
  const knownIds = new Set(boards.map((board) => board.boardId));
  const orderedIds = input.boardIds.filter((boardId) => knownIds.has(boardId));
  for (const board of boards) if (!orderedIds.includes(board.boardId)) orderedIds.push(board.boardId);
  await Promise.all(orderedIds.map(async (boardId, order) => {
    const snapshot = await loadSnapshot(input.projectId, boardId);
    snapshot.board.order = order;
    snapshot.board.updatedAt = new Date().toISOString();
    await saveSnapshot(snapshot);
  }));
  return { workspace: await listWorkspace() };
}

export async function renameProject(input: { projectId: string; name: string }): Promise<{ workspace: WorkspaceSummary; snapshot?: BoardSnapshot }> {
  const project = await readProject(input.projectId);
  project.name = normalizeName(input.name, project.name);
  project.updatedAt = new Date().toISOString();
  await syncProjectToSnapshots(project);
  const snapshot = await getProjectDefaultSnapshot(input.projectId).catch(() => undefined);
  return { workspace: await listWorkspace(), snapshot };
}

export async function renameBoard(input: { projectId: string; boardId: string; name: string }): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  snapshot.board.name = normalizeName(input.name, snapshot.board.name);
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return { snapshot, workspace: await listWorkspace() };
}

export async function duplicateBoard(input: { projectId: string; boardId: string; name?: string }): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const source = await loadSnapshot(input.projectId, input.boardId);
  const now = new Date().toISOString();
  const boardId = `board_${randomUUID().slice(0, 8)}`;
  const snapshot = structuredClone(source);
  snapshot.board = { ...snapshot.board, boardId, name: normalizeName(input.name, `${source.board.name} Copy`), createdAt: now, updatedAt: now };
  snapshot.layers = snapshot.layers.map((layer) => ({ ...layer, boardId }));
  snapshot.blocks = snapshot.blocks.map((block) => {
    const data = { ...block.data };
    delete data.workflowRunId;
    return { ...block, boardId, data, updatedAt: now };
  });
  snapshot.executions = snapshot.executions.map((execution) => {
    const next = { ...execution };
    delete next.workflowRunId;
    delete next.stepRunId;
    return next;
  });
  snapshot.agentRuns = [];
  snapshot.agentSessions = [];
  snapshot.agentMessages = [];
  snapshot.agentRuntimeBindings = [];
  snapshot.agentRuntimeEvents = [];
  snapshot.changeProposals = [];
  snapshot.changeDecisions = [];
  snapshot.workflowRuns = [];
  snapshot.workflowStepRuns = [];
  snapshot.workflowGateEvaluations = [];
  snapshot.workflowApprovalRequests = [];
  snapshot.workflowApprovalDecisions = [];
  snapshot.project.defaultBoardId = boardId;
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  await syncProjectToSnapshots(snapshot.project);
  return { snapshot, workspace: await listWorkspace() };
}

export async function deleteBoard(input: { projectId: string; boardId: string }): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const project = await readProject(input.projectId);
  const boards = await listProjectBoards(input.projectId);
  if (boards.length <= 1) throw new Error('A project must keep at least one board.');
  await rm(path.join(projectsRoot, input.projectId, 'boards', input.boardId), { recursive: true, force: true });
  const nextBoard = boards.filter((board) => board.boardId !== input.boardId)[0];
  if (project.defaultBoardId === input.boardId) {
    project.defaultBoardId = nextBoard.boardId;
    project.updatedAt = new Date().toISOString();
    await syncProjectToSnapshots(project);
  }
  return { snapshot: await loadSnapshot(input.projectId, nextBoard.boardId), workspace: await listWorkspace() };
}

export async function deleteProject(input: { projectId: string }): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const workspace = await listWorkspace();
  if (workspace.projects.length <= 1) throw new Error('Workspace must keep at least one project.');
  await rm(path.join(projectsRoot, input.projectId), { recursive: true, force: true });
  const nextProject = workspace.projects.find((project) => project.projectId !== input.projectId);
  if (!nextProject || nextProject.boards.length === 0) throw new Error('No remaining project with boards.');
  return { snapshot: await loadSnapshot(nextProject.projectId, nextProject.defaultBoardId), workspace: await listWorkspace() };
}

export async function setCodexProjectBinding(input: { projectId: string; boardId: string; codexProjectPath: string; note?: string }): Promise<{ binding: CodexProjectBinding; snapshot: BoardSnapshot }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const binding: CodexProjectBinding = {
    projectPath: path.resolve(input.codexProjectPath),
    projectId: input.projectId,
    boardId: input.boardId,
    boundAt: new Date().toISOString(),
    note: input.note,
  };
  snapshot.project.codexProjectPath = binding.projectPath;
  snapshot.project.externalBindings = { ...(snapshot.project.externalBindings ?? {}), codex: binding };
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return { binding, snapshot };
}

export async function validateCodexProjectBinding(input: { projectId?: string; boardId?: string; codexProjectPath?: string }): Promise<{
  ok: boolean;
  reason?: string;
  expected?: CodexProjectBinding;
  actual: { projectId: string; boardId: string; codexProjectPath?: string };
}> {
  const snapshot = await getBoardSnapshot({ projectId: input.projectId, boardId: input.boardId });
  const binding = snapshot.project.externalBindings?.codex;
  const actualPath = input.codexProjectPath ? path.resolve(input.codexProjectPath) : undefined;
  const actual = { projectId: snapshot.project.projectId, boardId: snapshot.board.boardId, codexProjectPath: actualPath };
  if (!binding) return { ok: false, reason: 'No Codex binding has been set for this Retake Project.', actual };
  if (binding.projectId !== snapshot.project.projectId || binding.boardId !== snapshot.board.boardId) {
    return { ok: false, reason: 'Stored Codex binding points to a different Retake Project or Board.', expected: binding, actual };
  }
  if (actualPath && binding.projectPath !== actualPath) {
    return { ok: false, reason: 'Current Codex project path does not match the stored Retake binding.', expected: binding, actual };
  }
  return { ok: true, expected: binding, actual };
}

export async function createCodexBindingPrompt(input?: { projectId?: string; boardId?: string; codexProjectPath?: string }): Promise<{ prompt: string; projectId: string; boardId: string; codexProjectPath?: string }> {
  const snapshot = await getBoardSnapshot({ projectId: input?.projectId, boardId: input?.boardId });
  const projectId = snapshot.project.projectId;
  const boardId = snapshot.board.boardId;
  const codexProjectPath = input?.codexProjectPath ?? snapshot.project.codexProjectPath;
  const prompt = [
    'Bind this Codex workspace to the Retake Whiteboard project and board.',
    '',
    `Retake projectId: ${projectId}`,
    `Retake boardId: ${boardId}`,
    codexProjectPath ? `Expected Codex project path: ${codexProjectPath}` : undefined,
    '',
    'Use the Retake MCP tools in this order:',
    '1. retake_validate_project_binding',
    '2. retake_set_project_binding if validation is missing or stale',
    '3. retake_get_board_snapshot to confirm the active board',
    '',
    'After binding, wait for a specific Retake operation prompt before creating or writing results.',
  ].filter(Boolean).join('\n');
  return { prompt, projectId, boardId, codexProjectPath };
}

function normalizeName(name: string | undefined, fallback: string): string {
  return name?.trim() || fallback;
}

async function nextProjectOrder(): Promise<number> {
  await ensureWorkspace();
  const projectDirs = await readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  return projectDirs.filter((entry) => entry.isDirectory()).length;
}
