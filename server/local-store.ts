import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultSnapshot } from '../src/core/sampleBoard';
import { createMockSvg } from './mock-svg';
import type {
  AssetKind,
  AssetRecord,
  BlockRecord,
  BoardRecord,
  BoardSnapshot,
  CodexProjectBinding,
  ExecutionRecord,
  ProjectRecord,
  WorkspaceSummary,
} from '../src/core/types';

const workspaceRoot = process.cwd();
const retakeWorkspaceDir = process.env.RETAKE_WORKSPACE_DIR ?? '.retake';
const retakeRoot = path.isAbsolute(retakeWorkspaceDir)
  ? retakeWorkspaceDir
  : path.join(workspaceRoot, retakeWorkspaceDir);
const projectsRoot = path.join(retakeRoot, 'projects');

export async function ensureDefaultSnapshot(): Promise<BoardSnapshot> {
  await ensureWorkspace();

  const defaultProjectDir = path.join(projectsRoot, defaultSnapshot.project.projectId);
  const defaultBoardDir = path.join(defaultProjectDir, 'boards', defaultSnapshot.board.boardId);
  const snapshotPath = path.join(defaultBoardDir, 'snapshot.json');

  try {
    return JSON.parse(await readFile(snapshotPath, 'utf8')) as BoardSnapshot;
  } catch {
    const snapshot = createDefaultWorkspaceSnapshot();
    await saveSnapshot(snapshot);
    return snapshot;
  }
}

export async function getBoardSnapshot(input?: { projectId?: string; boardId?: string }): Promise<BoardSnapshot> {
  if (!input?.projectId || !input.boardId) {
    return ensureDefaultSnapshot();
  }

  return loadSnapshot(input.projectId, input.boardId);
}

export async function listWorkspace(): Promise<WorkspaceSummary> {
  await ensureDefaultSnapshot();

  const projectDirs = await readdir(projectsRoot, { withFileTypes: true });
  const projects = await Promise.all(
    projectDirs
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const projectId = entry.name;
        const project = await readProject(projectId);
        const boardsRoot = path.join(projectsRoot, projectId, 'boards');
        const boardDirs = await readdir(boardsRoot, { withFileTypes: true }).catch(() => []);
        const boards = await Promise.all(
          boardDirs
            .filter((boardEntry) => boardEntry.isDirectory())
            .map(async (boardEntry) => readBoard(projectId, boardEntry.name)),
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
  return {
    defaultProjectId: defaultSnapshot.project.projectId,
    projects,
  };
}

export async function createProject(input?: { name?: string }): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const now = new Date().toISOString();
  const projectId = `proj_${randomUUID().slice(0, 8)}`;
  const boardId = `board_${randomUUID().slice(0, 8)}`;
  const projectOrder = await nextProjectOrder();
  const snapshot = createBlankSnapshot({
    projectId,
    boardId,
    projectName: normalizeName(input?.name, 'Untitled project'),
    boardName: 'Untitled board',
    now,
    projectOrder,
    boardOrder: 0,
  });

  await saveSnapshot(snapshot);
  return { snapshot, workspace: await listWorkspace() };
}

export async function createBoard(input: {
  projectId: string;
  name?: string;
}): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const base = await getProjectDefaultSnapshot(input.projectId);
  const now = new Date().toISOString();
  const boardId = `board_${randomUUID().slice(0, 8)}`;
  const boardOrder = (await listProjectBoards(input.projectId)).length;
  const snapshot = createBlankSnapshot({
    projectId: base.project.projectId,
    boardId,
    projectName: base.project.name,
    boardName: normalizeName(input.name, 'Untitled board'),
    now,
    project: base.project,
    boardOrder,
  });

  snapshot.project.defaultBoardId = boardId;
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  await syncProjectToSnapshots(snapshot.project);
  return { snapshot, workspace: await listWorkspace() };
}

export async function reorderProjects(input: {
  projectIds: string[];
}): Promise<{ workspace: WorkspaceSummary }> {
  const workspace = await listWorkspace();
  const knownIds = new Set(workspace.projects.map((project) => project.projectId));
  const orderedIds = input.projectIds.filter((projectId) => knownIds.has(projectId));
  for (const project of workspace.projects) {
    if (!orderedIds.includes(project.projectId)) orderedIds.push(project.projectId);
  }

  await Promise.all(
    orderedIds.map(async (projectId, order) => {
      const project = await readProject(projectId);
      project.order = order;
      project.updatedAt = new Date().toISOString();
      await syncProjectToSnapshots(project);
    }),
  );

  return { workspace: await listWorkspace() };
}

export async function reorderBoards(input: {
  projectId: string;
  boardIds: string[];
}): Promise<{ workspace: WorkspaceSummary }> {
  const boards = await listProjectBoards(input.projectId);
  const knownIds = new Set(boards.map((board) => board.boardId));
  const orderedIds = input.boardIds.filter((boardId) => knownIds.has(boardId));
  for (const board of boards) {
    if (!orderedIds.includes(board.boardId)) orderedIds.push(board.boardId);
  }

  await Promise.all(
    orderedIds.map(async (boardId, order) => {
      const snapshot = await loadSnapshot(input.projectId, boardId);
      snapshot.board.order = order;
      snapshot.board.updatedAt = new Date().toISOString();
      await saveSnapshot(snapshot);
    }),
  );

  return { workspace: await listWorkspace() };
}

export async function renameProject(input: {
  projectId: string;
  name: string;
}): Promise<{ workspace: WorkspaceSummary; snapshot?: BoardSnapshot }> {
  const project = await readProject(input.projectId);
  project.name = normalizeName(input.name, project.name);
  project.updatedAt = new Date().toISOString();
  await syncProjectToSnapshots(project);
  const snapshot = await getProjectDefaultSnapshot(input.projectId).catch(() => undefined);
  return { workspace: await listWorkspace(), snapshot };
}

export async function renameBoard(input: {
  projectId: string;
  boardId: string;
  name: string;
}): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  snapshot.board.name = normalizeName(input.name, snapshot.board.name);
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return { snapshot, workspace: await listWorkspace() };
}

export async function duplicateBoard(input: {
  projectId: string;
  boardId: string;
  name?: string;
}): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const source = await loadSnapshot(input.projectId, input.boardId);
  const now = new Date().toISOString();
  const boardId = `board_${randomUUID().slice(0, 8)}`;
  const snapshot = structuredClone(source);
  snapshot.board = {
    ...snapshot.board,
    boardId,
    name: normalizeName(input.name, `${source.board.name} Copy`),
    createdAt: now,
    updatedAt: now,
  };
  snapshot.layers = snapshot.layers.map((layer) => ({ ...layer, boardId }));
  snapshot.blocks = snapshot.blocks.map((block) => ({ ...block, boardId, updatedAt: now }));
  snapshot.project.defaultBoardId = boardId;
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  await syncProjectToSnapshots(snapshot.project);
  return { snapshot, workspace: await listWorkspace() };
}

export async function deleteBoard(input: {
  projectId: string;
  boardId: string;
}): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const project = await readProject(input.projectId);
  const boards = await listProjectBoards(input.projectId);
  if (boards.length <= 1) {
    throw new Error('A project must keep at least one board.');
  }

  await rm(path.join(projectsRoot, input.projectId, 'boards', input.boardId), { recursive: true, force: true });
  const remainingBoards = boards.filter((board) => board.boardId !== input.boardId);
  const nextBoard = remainingBoards[0];
  if (project.defaultBoardId === input.boardId) {
    project.defaultBoardId = nextBoard.boardId;
    project.updatedAt = new Date().toISOString();
    await syncProjectToSnapshots(project);
  }

  return {
    snapshot: await loadSnapshot(input.projectId, nextBoard.boardId),
    workspace: await listWorkspace(),
  };
}

export async function deleteProject(input: {
  projectId: string;
}): Promise<{ snapshot: BoardSnapshot; workspace: WorkspaceSummary }> {
  const workspace = await listWorkspace();
  if (workspace.projects.length <= 1) {
    throw new Error('Workspace must keep at least one project.');
  }

  await rm(path.join(projectsRoot, input.projectId), { recursive: true, force: true });
  const nextProject = workspace.projects.find((project) => project.projectId !== input.projectId);
  if (!nextProject || nextProject.boards.length === 0) {
    throw new Error('No remaining project with boards.');
  }

  return {
    snapshot: await loadSnapshot(nextProject.projectId, nextProject.defaultBoardId),
    workspace: await listWorkspace(),
  };
}

export async function setCodexProjectBinding(input: {
  projectId: string;
  boardId: string;
  codexProjectPath: string;
  note?: string;
}): Promise<{ binding: CodexProjectBinding; snapshot: BoardSnapshot }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const now = new Date().toISOString();
  const binding: CodexProjectBinding = {
    projectPath: path.resolve(input.codexProjectPath),
    projectId: input.projectId,
    boardId: input.boardId,
    boundAt: now,
    note: input.note,
  };

  snapshot.project.codexProjectPath = binding.projectPath;
  snapshot.project.externalBindings = {
    ...(snapshot.project.externalBindings ?? {}),
    codex: binding,
  };
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);

  return { binding, snapshot };
}

export async function validateCodexProjectBinding(input: {
  projectId?: string;
  boardId?: string;
  codexProjectPath?: string;
}): Promise<{
  ok: boolean;
  reason?: string;
  expected?: CodexProjectBinding;
  actual: {
    projectId: string;
    boardId: string;
    codexProjectPath?: string;
  };
}> {
  const snapshot = await getBoardSnapshot({ projectId: input.projectId, boardId: input.boardId });
  const binding = snapshot.project.externalBindings?.codex;
  const actualPath = input.codexProjectPath ? path.resolve(input.codexProjectPath) : undefined;
  const actual = {
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    codexProjectPath: actualPath,
  };

  if (!binding) {
    return {
      ok: false,
      reason: 'No Codex binding has been set for this Retake Project.',
      actual,
    };
  }

  if (binding.projectId !== snapshot.project.projectId || binding.boardId !== snapshot.board.boardId) {
    return {
      ok: false,
      reason: 'Stored Codex binding points to a different Retake Project or Board.',
      expected: binding,
      actual,
    };
  }

  if (actualPath && binding.projectPath !== actualPath) {
    return {
      ok: false,
      reason: 'Current Codex project path does not match the stored Retake binding.',
      expected: binding,
      actual,
    };
  }

  return {
    ok: true,
    expected: binding,
    actual,
  };
}

export async function createCodexBindingPrompt(input?: {
  projectId?: string;
  boardId?: string;
  codexProjectPath?: string;
}): Promise<{ prompt: string; projectId: string; boardId: string; codexProjectPath?: string }> {
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
  ]
    .filter(Boolean)
    .join('\n');

  return { prompt, projectId, boardId, codexProjectPath };
}

export async function saveSnapshot(snapshot: BoardSnapshot): Promise<void> {
  await ensureWorkspace();

  const projectDir = path.join(projectsRoot, snapshot.project.projectId);
  const boardDir = path.join(projectDir, 'boards', snapshot.board.boardId);

  await mkdir(boardDir, { recursive: true });
  await mkdir(path.join(projectDir, 'assets'), { recursive: true });
  await mkdir(path.join(projectDir, 'executions'), { recursive: true });
  await mkdir(path.join(projectDir, 'skills'), { recursive: true });

  await writeJson(path.join(projectDir, 'project.json'), snapshot.project);
  await writeJson(path.join(boardDir, 'board.json'), snapshot.board);
  await writeJson(path.join(boardDir, 'snapshot.json'), snapshot);
}

export async function resetWorkspace(): Promise<BoardSnapshot> {
  await rm(retakeRoot, { recursive: true, force: true });
  const snapshot = createDefaultWorkspaceSnapshot();
  await saveSnapshot(snapshot);
  return snapshot;
}

export async function createMockGeneratedAsset(input: {
  projectId: string;
  sourceExecutionId: string;
}): Promise<AssetRecord> {
  await ensureWorkspace();

  const assetId = `asset_${randomUUID().slice(0, 8)}`;
  const projectDir = path.join(projectsRoot, input.projectId);
  const assetDir = path.join(projectDir, 'assets', assetId);
  const fileName = 'original.svg';
  const storageKey = path.join(assetDir, fileName);
  const createdAt = new Date().toISOString();

  await mkdir(assetDir, { recursive: true });
  await writeFile(storageKey, createMockSvg(), 'utf8');

  const asset: AssetRecord = {
    assetId,
    projectId: input.projectId,
    kind: 'image',
    mimeType: 'image/svg+xml',
    storageProvider: 'local',
    storageKey: path.relative(projectDir, storageKey),
    previewUrl: `/api/local/assets/${input.projectId}/${assetId}/${fileName}`,
    width: 1280,
    height: 832,
    sourceExecutionId: input.sourceExecutionId,
    createdAt,
  };

  await writeJson(path.join(assetDir, 'metadata.json'), asset);
  return asset;
}

export async function importAssetFromPath(input: {
  projectId: string;
  sourceExecutionId?: string;
  sourcePath: string;
  kind?: AssetKind;
  mimeType?: string;
}): Promise<AssetRecord> {
  await ensureWorkspace();

  const assetId = `asset_${randomUUID().slice(0, 8)}`;
  const projectDir = path.join(projectsRoot, input.projectId);
  const assetDir = path.join(projectDir, 'assets', assetId);
  const extension = path.extname(input.sourcePath) || extensionForMime(input.mimeType);
  const fileName = `original${extension}`;
  const storageKey = path.join(assetDir, fileName);
  const createdAt = new Date().toISOString();

  await mkdir(assetDir, { recursive: true });
  await copyFile(input.sourcePath, storageKey);

  const asset: AssetRecord = {
    assetId,
    projectId: input.projectId,
    kind: input.kind ?? kindForMime(input.mimeType),
    mimeType: input.mimeType ?? mimeForExtension(extension),
    storageProvider: 'local',
    storageKey: path.relative(projectDir, storageKey),
    previewUrl: `/api/local/assets/${input.projectId}/${assetId}/${fileName}`,
    sourceExecutionId: input.sourceExecutionId,
    createdAt,
  };

  await writeJson(path.join(assetDir, 'metadata.json'), asset);
  return asset;
}

export async function createAssetFromDataUrl(input: {
  projectId: string;
  dataUrl: string;
  fileName?: string;
  kind?: AssetKind;
  width?: number;
  height?: number;
  sourceExecutionId?: string;
}): Promise<AssetRecord> {
  await ensureWorkspace();

  const parsed = parseDataUrl(input.dataUrl);
  const assetId = `asset_${randomUUID().slice(0, 8)}`;
  const projectDir = path.join(projectsRoot, input.projectId);
  const assetDir = path.join(projectDir, 'assets', assetId);
  const extension = path.extname(input.fileName ?? '') || extensionForMime(parsed.mimeType);
  const fileName = sanitizeAssetFileName(input.fileName ?? `original${extension}`, extension);
  const storageKey = path.join(assetDir, fileName);
  const createdAt = new Date().toISOString();

  await mkdir(assetDir, { recursive: true });
  await writeFile(storageKey, parsed.bytes);

  const asset: AssetRecord = {
    assetId,
    projectId: input.projectId,
    kind: input.kind ?? kindForMime(parsed.mimeType),
    mimeType: parsed.mimeType,
    storageProvider: 'local',
    storageKey: path.relative(projectDir, storageKey),
    previewUrl: `/api/local/assets/${input.projectId}/${assetId}/${fileName}`,
    width: input.width,
    height: input.height,
    sourceExecutionId: input.sourceExecutionId,
    createdAt,
  };

  await writeJson(path.join(assetDir, 'metadata.json'), asset);
  return asset;
}

export async function createExecution(input: {
  projectId: string;
  boardId: string;
  capabilityId: string;
  adapter: ExecutionRecord['adapter'];
  inputBlockIds: string[];
  agentHost?: ExecutionRecord['agentHost'];
  triggerMode?: ExecutionRecord['triggerMode'];
  provider?: string;
  model?: string;
  skillId?: string;
  prompt?: string;
}): Promise<ExecutionRecord> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution: ExecutionRecord = {
    executionId: `exec_${randomUUID().slice(0, 8)}`,
    projectId: input.projectId,
    boardId: input.boardId,
    capabilityId: input.capabilityId,
    adapter: input.adapter,
    status: 'running',
    inputBlockIds: input.inputBlockIds,
    outputBlockIds: [],
    outputAssetIds: [],
    agentHost: input.agentHost,
    triggerMode: input.triggerMode,
    provider: input.provider,
    model: input.model,
    skillId: input.skillId,
    prompt: input.prompt,
    startedAt: new Date().toISOString(),
  };

  snapshot.executions.unshift(execution);
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return execution;
}

export async function getExecution(input: {
  projectId: string;
  boardId: string;
  executionId: string;
}): Promise<ExecutionRecord> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  return findExecutionOrThrow(snapshot, input.executionId);
}

export async function completeExecution(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  outputBlockIds?: string[];
  outputAssetIds?: string[];
}): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = findExecutionOrThrow(snapshot, input.executionId);
  const now = new Date().toISOString();

  execution.status = 'succeeded';
  execution.outputBlockIds = mergeUnique(execution.outputBlockIds, input.outputBlockIds ?? []);
  execution.outputAssetIds = mergeUnique(execution.outputAssetIds, input.outputAssetIds ?? []);
  execution.completedAt = now;
  delete execution.errorMessage;
  markExecutionBlocks(snapshot, input.executionId, 'succeeded');

  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return { snapshot, execution };
}

export async function failExecution(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  errorMessage: string;
}): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = findExecutionOrThrow(snapshot, input.executionId);
  const now = new Date().toISOString();

  execution.status = 'failed';
  execution.completedAt = now;
  execution.errorMessage = input.errorMessage;
  markExecutionBlocks(snapshot, input.executionId, 'failed');

  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return { snapshot, execution };
}

export async function createImageResultBlock(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  assetId: string;
  sourceBlockIds?: string[];
  displayWidth?: number;
  displayHeight?: number;
  title?: string;
  body?: string;
}): Promise<{ snapshot: BoardSnapshot; block: BlockRecord; execution?: ExecutionRecord }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const asset = await readAssetMetadata(input.projectId, input.assetId);
  if (!snapshot.assets.some((candidate) => candidate.assetId === asset.assetId)) {
    snapshot.assets.unshift(asset);
  }

  const sourceBlockIds = input.sourceBlockIds?.length
    ? input.sourceBlockIds
    : (snapshot.executions.find((execution) => execution.executionId === input.executionId)?.inputBlockIds ?? []);
  const source = snapshot.blocks.find((block) => block.blockId === sourceBlockIds[0]);
  const rightEdge = snapshot.blocks.reduce((max, block) => Math.max(max, block.position.x + block.size.width), 0);
  const displayWidth = positiveNumber(input.displayWidth) ?? 300;
  const displayHeight = positiveNumber(input.displayHeight) ?? 230;
  const now = new Date().toISOString();
  const block: BlockRecord = {
    blockId: `block_${randomUUID().slice(0, 8)}`,
    boardId: input.boardId,
    type: 'image',
    layerId: 'layer_default',
    position: {
      x: source ? source.position.x + source.size.width + 90 : rightEdge + 120,
      y: source ? source.position.y : 160,
    },
    size: { width: displayWidth, height: displayHeight },
    zIndex: snapshot.blocks.reduce((max, candidate) => Math.max(max, candidate.zIndex), 0) + 1,
    data: {
      title: input.title ?? 'Generated image result',
      body: input.body ?? 'Imported into AssetStore before creating this result block.',
      assetId: input.assetId,
      sourceExecutionId: input.executionId,
    },
    createdAt: now,
    updatedAt: now,
  };

  snapshot.blocks.push(block);
  for (const sourceBlockId of sourceBlockIds) {
    snapshot.edges.push({
      edgeId: `edge_${randomUUID().slice(0, 8)}`,
      sourceBlockId,
      targetBlockId: block.blockId,
      kind: 'derived_from',
    });
  }

  const execution = snapshot.executions.find((candidate) => candidate.executionId === input.executionId);
  if (execution) {
    execution.status = 'succeeded';
    execution.outputAssetIds = mergeUnique(execution.outputAssetIds, [input.assetId]);
    execution.outputBlockIds = mergeUnique(execution.outputBlockIds, [block.blockId]);
    execution.completedAt = now;
    delete execution.errorMessage;
    markExecutionBlocks(snapshot, input.executionId, 'succeeded');
  }

  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return { snapshot, block, execution };
}

export async function updateImageResultBlock(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  assetId: string;
  resultBlockId?: string;
  title?: string;
  body?: string;
}): Promise<{ snapshot: BoardSnapshot; block: BlockRecord; execution: ExecutionRecord }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = findExecutionOrThrow(snapshot, input.executionId);
  const asset = await readAssetMetadata(input.projectId, input.assetId);
  if (!snapshot.assets.some((candidate) => candidate.assetId === asset.assetId)) {
    snapshot.assets.unshift(asset);
  }

  const resultBlockId = input.resultBlockId ?? execution.outputBlockIds[0];
  const block = snapshot.blocks.find((candidate) => candidate.blockId === resultBlockId);
  if (!block || block.type !== 'image') {
    throw new Error(`Image result block not found: ${resultBlockId ?? 'missing'}`);
  }

  const now = new Date().toISOString();
  block.data = {
    ...block.data,
    title: input.title ?? block.data.title,
    body: input.body ?? block.data.body,
    assetId: asset.assetId,
    previewUrl: asset.previewUrl,
    status: 'succeeded',
    sourceExecutionId: input.executionId,
  };
  block.updatedAt = now;

  execution.status = 'succeeded';
  execution.outputAssetIds = mergeUnique(execution.outputAssetIds, [input.assetId]);
  execution.outputBlockIds = mergeUnique(execution.outputBlockIds, [block.blockId]);
  execution.completedAt = now;
  delete execution.errorMessage;
  markExecutionBlocks(snapshot, input.executionId, 'succeeded');

  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return { snapshot, block, execution };
}

export async function readAssetFile(input: {
  projectId: string;
  assetId: string;
  fileName: string;
}): Promise<{ bytes: Buffer; mimeType: string }> {
  const assetDir = path.join(projectsRoot, input.projectId, 'assets', input.assetId);
  const metadata = JSON.parse(await readFile(path.join(assetDir, 'metadata.json'), 'utf8')) as AssetRecord;
  const bytes = await readFile(path.join(assetDir, input.fileName));

  return {
    bytes,
    mimeType: metadata.mimeType,
  };
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

async function readAssetMetadata(projectId: string, assetId: string): Promise<AssetRecord> {
  const assetDir = path.join(projectsRoot, projectId, 'assets', assetId);
  return JSON.parse(await readFile(path.join(assetDir, 'metadata.json'), 'utf8')) as AssetRecord;
}

async function loadSnapshot(projectId: string, boardId: string): Promise<BoardSnapshot> {
  if (projectId === defaultSnapshot.project.projectId && boardId === defaultSnapshot.board.boardId) {
    return ensureDefaultSnapshot();
  }

  const snapshotPath = path.join(projectsRoot, projectId, 'boards', boardId, 'snapshot.json');
  return JSON.parse(await readFile(snapshotPath, 'utf8')) as BoardSnapshot;
}

async function readProject(projectId: string): Promise<ProjectRecord> {
  return JSON.parse(await readFile(path.join(projectsRoot, projectId, 'project.json'), 'utf8')) as ProjectRecord;
}

async function readBoard(projectId: string, boardId: string): Promise<BoardRecord> {
  return JSON.parse(
    await readFile(path.join(projectsRoot, projectId, 'boards', boardId, 'board.json'), 'utf8'),
  ) as BoardRecord;
}

async function listProjectBoards(projectId: string): Promise<BoardRecord[]> {
  const boardsRoot = path.join(projectsRoot, projectId, 'boards');
  const boardDirs = await readdir(boardsRoot, { withFileTypes: true });
  const boards = await Promise.all(
    boardDirs.filter((entry) => entry.isDirectory()).map((entry) => readBoard(projectId, entry.name)),
  );
  return boards.sort(compareOrderedRecords);
}

async function getProjectDefaultSnapshot(projectId: string): Promise<BoardSnapshot> {
  const project = await readProject(projectId);
  return loadSnapshot(projectId, project.defaultBoardId);
}

function findExecutionOrThrow(snapshot: BoardSnapshot, executionId: string): ExecutionRecord {
  const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
  if (!execution) {
    throw new Error(`Execution not found: ${executionId}`);
  }

  return execution;
}

function mergeUnique(existing: string[], incoming: string[]): string[] {
  return Array.from(new Set([...existing, ...incoming]));
}

function markExecutionBlocks(
  snapshot: BoardSnapshot,
  executionId: string,
  status: ExecutionRecord['status'],
): void {
  const now = new Date().toISOString();
  for (const block of snapshot.blocks) {
    if (block.data.sourceExecutionId === executionId) {
      block.data.status = status;
      block.updatedAt = now;
    }
  }
}

function touchSnapshot(snapshot: BoardSnapshot): void {
  const now = new Date().toISOString();
  snapshot.project.updatedAt = now;
  snapshot.board.updatedAt = now;
}

async function ensureWorkspace(): Promise<void> {
  await mkdir(projectsRoot, { recursive: true });
  await writeJson(path.join(retakeRoot, 'workspace.json'), {
    schemaVersion: 1,
    defaultProjectId: defaultSnapshot.project.projectId,
    createdFor: 'retake-whiteboard-local',
  });
}

function createDefaultWorkspaceSnapshot(): BoardSnapshot {
  const snapshot = structuredClone(defaultSnapshot);
  snapshot.project.localRoot = path.relative(
    workspaceRoot,
    path.join(projectsRoot, snapshot.project.projectId),
  );
  return snapshot;
}

function createBlankSnapshot(input: {
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
    ? {
        ...structuredClone(input.project),
        defaultBoardId: input.boardId,
        updatedAt: input.now,
      }
    : {
        projectId: input.projectId,
        name: input.projectName,
        createdAt: input.now,
        updatedAt: input.now,
        defaultBoardId: input.boardId,
        order: input.projectOrder ?? 0,
        localRoot: path.relative(workspaceRoot, path.join(projectsRoot, input.projectId)),
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
    layers: [
      {
        id: 'layer_default',
        boardId: input.boardId,
        name: 'Default layer',
        visible: true,
        locked: false,
        order: 0,
      },
    ],
    blocks: [],
    edges: [],
    assets: [],
    executions: [],
    historyEvents: [],
    viewport: structuredClone(defaultSnapshot.viewport),
  };
}

async function syncProjectToSnapshots(project: ProjectRecord): Promise<void> {
  const boards = await listProjectBoards(project.projectId);
  await writeJson(path.join(projectsRoot, project.projectId, 'project.json'), project);
  for (const board of boards) {
    const snapshot = await loadSnapshot(project.projectId, board.boardId);
    snapshot.project = structuredClone(project);
    await saveSnapshot(snapshot);
  }
}

function normalizeName(name: string | undefined, fallback: string): string {
  const trimmed = name?.trim();
  return trimmed || fallback;
}

async function nextProjectOrder(): Promise<number> {
  await ensureWorkspace();
  const projectDirs = await readdir(projectsRoot, { withFileTypes: true }).catch(() => []);
  return projectDirs.filter((entry) => entry.isDirectory()).length;
}

function compareOrderedRecords<T extends { order?: number; updatedAt: string; name: string }>(
  left: T,
  right: T,
): number {
  const leftOrder = typeof left.order === 'number' ? left.order : Number.MAX_SAFE_INTEGER;
  const rightOrder = typeof right.order === 'number' ? right.order : Number.MAX_SAFE_INTEGER;
  if (leftOrder !== rightOrder) return leftOrder - rightOrder;

  const updated = right.updatedAt.localeCompare(left.updatedAt);
  if (updated !== 0) return updated;
  return left.name.localeCompare(right.name);
}

function extensionForMime(mimeType?: string): string {
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  if (mimeType === 'image/svg+xml') return '.svg';
  if (mimeType === 'video/mp4') return '.mp4';
  return '.bin';
}

function parseDataUrl(dataUrl: string): { bytes: Buffer; mimeType: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) {
    throw new Error('Expected dataUrl to be a valid data URL.');
  }

  const mimeType = match[1] || 'application/octet-stream';
  const bytes = match[2] ? Buffer.from(match[3], 'base64') : Buffer.from(decodeURIComponent(match[3]));
  return { bytes, mimeType };
}

function sanitizeAssetFileName(fileName: string, extension: string): string {
  const ext = path.extname(fileName) || extension;
  const base = path
    .basename(fileName, path.extname(fileName))
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${base || 'original'}${ext}`;
}

function mimeForExtension(extension: string): string {
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  if (extension === '.svg') return 'image/svg+xml';
  if (extension === '.mp4') return 'video/mp4';
  return 'application/octet-stream';
}

function kindForMime(mimeType?: string): AssetKind {
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  if (mimeType?.startsWith('image/')) return 'image';
  return 'other';
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
