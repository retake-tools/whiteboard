import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { runCodexAppServerTurn } from './codex-app-server-client';
import { publishExecutionEvent } from './execution-events';
import {
  createProviderImagePrompt,
  imageExecutionInputAssignments,
  type ImageExecutionInputAssignment,
} from './image-execution-prompt';
import { resolveAssetStoragePath } from './local-store/asset-files';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { listExecutionProviderSettings } from './local-store/execution-provider-store';
import {
  failExecution,
  markExecutionAdapterRetryRunning,
  markExecutionRunning,
  recordExecutionRequestPrompts,
  updateImageResultBlock,
} from './local-store/execution-store';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';
import { createSerialTaskQueue } from './serial-task-queue';

interface CodexAppServerImageDependencies {
  runTurn?: typeof runCodexAppServerTurn;
}

export async function startCodexAppServerImageGeneration(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  connectionId: string;
  resultBlockId?: string;
}, dependencies: CodexAppServerImageDependencies = {}): Promise<{
  snapshot: BoardSnapshot;
  execution: ExecutionRecord;
  completion: Promise<void>;
}> {
  const settings = await listExecutionProviderSettings(input.projectId);
  const connection = settings.connections.find((candidate) => candidate.connectionId === input.connectionId);
  if (
    !connection ||
    connection.connectorId !== 'codex-app-server' ||
    connection.status !== 'ready' ||
    !connection.modelId
  ) {
    throw new Error('Codex App Server is unavailable. Test the built-in connection in Retake Settings.');
  }
  const current = await loadSnapshot(input.projectId, input.boardId);
  const execution = current.executions.find((candidate) => candidate.executionId === input.executionId);
  const expectedStatus = input.resultBlockId ? 'failed' : 'queued';
  if (!execution || execution.status !== expectedStatus || execution.adapter !== 'codex_app_server') {
    throw new Error(`${expectedStatus === 'failed' ? 'Failed' : 'Queued'} Codex App Server image execution not found: ${input.executionId}`);
  }
  if (execution.connectionId !== input.connectionId) {
    throw new Error(`Image execution connection mismatch: ${input.connectionId}`);
  }

  const started = input.resultBlockId
    ? await markExecutionAdapterRetryRunning({ ...input, resultBlockId: input.resultBlockId, adapter: 'codex_app_server' })
    : await markExecutionRunning(input);
  publishExecutionEvent(input.executionId, { type: 'execution.started' });
  const resultBlockIds = input.resultBlockId ? [input.resultBlockId] : started.execution.outputBlockIds;
  const completion = executeCodexImageRun(started.execution, connection.modelId, dependencies, resultBlockIds)
    .then(async () => settleIncompleteRetry(input))
    .catch(async (error) => {
      const errorMessage = error instanceof Error ? error.message : 'Codex App Server image generation failed.';
      const failed = await failExecution({ ...input, errorMessage }).catch(() => undefined);
      publishExecutionEvent(input.executionId, {
        type: 'execution.failed',
        errorMessage,
        ...(failed ? { snapshot: failed.snapshot } : {}),
      });
      throw error;
    });
  void completion.catch(() => undefined);
  return { ...started, completion };
}

async function executeCodexImageRun(
  execution: ExecutionRecord,
  model: string,
  dependencies: CodexAppServerImageDependencies,
  resultBlockIds: string[],
): Promise<void> {
  const initial = await loadSnapshot(execution.projectId, execution.boardId);
  const inputAssignments = imageExecutionInputAssignments(execution);
  const localImagePaths = await executionInputImagePaths(initial, inputAssignments);
  const requests = resultBlockIds.map((outputBlockId) => ({
    index: execution.outputBlockIds.indexOf(outputBlockId),
    outputBlockId,
    prompt: createProviderImagePrompt(execution, inputAssignments, {
      dialect: 'codex_imagegen',
      variantIndex: execution.outputBlockIds.indexOf(outputBlockId),
      variantCount: execution.outputBlockIds.length,
    }),
  }));
  await recordExecutionRequestPrompts({
    projectId: execution.projectId,
    boardId: execution.boardId,
    executionId: execution.executionId,
    requestPrompts: requests,
  });
  const enqueueWrite = createSerialTaskQueue();
  const results = await Promise.allSettled(requests.map(async (request) => {
    const { index, outputBlockId: resultBlockId } = request;
    await assertExecutionRunning(execution);
    const result = await (dependencies.runTurn ?? runCodexAppServerTurn)({
      cwd: process.env.TMPDIR || '/tmp',
      model,
      prompt: request.prompt,
      localImagePaths,
      sandbox: 'workspace-write',
      onImageGenerationStarted: () => publishExecutionEvent(execution.executionId, {
        type: 'execution.progress',
        message: `Generating image ${index + 1} of ${execution.outputBlockIds.length}`,
      }),
    });
    if (!result.image) throw new Error('Codex App Server completed without an image result.');
    const image = result.image;
    await enqueueWrite(async () => {
      await assertExecutionRunning(execution);
      const asset = image.savedPath
        ? await importCodexImagePath(execution, image.savedPath)
        : image.dataUrl
          ? await createAssetFromDataUrl({
            projectId: execution.projectId,
            sourceExecutionId: execution.executionId,
            dataUrl: image.dataUrl,
            fileName: `codex-image-${index + 1}.png`,
            kind: 'image',
          })
          : undefined;
      if (!asset) throw new Error('Codex App Server image result did not contain a saved path or image data.');
      await recordProviderResult(execution, {
        index,
        itemId: image.itemId,
        threadId: result.threadId,
        turnId: result.turnId,
        revisedPrompt: image.revisedPrompt,
      });
      const updated = await updateImageResultBlock({
        projectId: execution.projectId,
        boardId: execution.boardId,
        executionId: execution.executionId,
        assetId: asset.assetId,
        resultBlockId,
        title: execution.outputBlockIds.length > 1 ? `Codex image ${index + 1}` : 'Codex image',
        body: 'Generated through Codex App Server and imported into Retake.',
      });
      publishExecutionEvent(execution.executionId, { type: 'execution.snapshot', snapshot: updated.snapshot });
    });
  }));
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (failed) {
    throw failed.reason instanceof Error
      ? failed.reason
      : new Error('Codex App Server image generation failed for one or more candidates.');
  }
}

async function settleIncompleteRetry(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  resultBlockId?: string;
}): Promise<void> {
  if (!input.resultBlockId) return;
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = snapshot.executions.find((candidate) => candidate.executionId === input.executionId);
  if (execution?.status !== 'running') return;
  await failExecution({
    projectId: input.projectId,
    boardId: input.boardId,
    executionId: input.executionId,
    errorMessage: 'One or more image candidates are still incomplete. Retry the remaining failed results.',
  });
}

async function executionInputImagePaths(
  snapshot: BoardSnapshot,
  assignments: readonly ImageExecutionInputAssignment[],
): Promise<string[]> {
  for (const { assetId } of assignments) {
    if (!snapshot.assets.some((asset) => asset.assetId === assetId && asset.kind === 'image')) {
      throw new Error(`Codex image input is missing from the board snapshot: ${assetId}`);
    }
  }
  return Promise.all(assignments.map(({ assetId }) => resolveAssetStoragePath(snapshot.project.projectId, assetId)));
}

async function importCodexImagePath(execution: ExecutionRecord, sourcePath: string) {
  const resolvedPath = await realpath(sourcePath);
  const generatedImagesRoot = path.resolve(process.env.CODEX_HOME || path.join(homedir(), '.codex'), 'generated_images');
  if (!resolvedPath.startsWith(`${generatedImagesRoot}${path.sep}`)) {
    throw new Error('Codex App Server returned an image outside the managed generated-images directory.');
  }
  const file = await stat(resolvedPath);
  if (!file.isFile() || file.size <= 0 || file.size > 100 * 1024 * 1024) {
    throw new Error('Codex App Server returned an invalid or oversized image file.');
  }
  const bytes = await readFile(resolvedPath);
  const mimeType = rasterMimeType(bytes);
  if (!mimeType) throw new Error('Codex App Server returned a file that is not a supported raster image.');
  return createAssetFromDataUrl({
    projectId: execution.projectId,
    sourceExecutionId: execution.executionId,
    dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
    fileName: `codex-image${mimeType === 'image/jpeg' ? '.jpg' : mimeType === 'image/webp' ? '.webp' : '.png'}`,
    kind: 'image',
  });
}

function rasterMimeType(bytes: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | undefined {
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return undefined;
}

async function recordProviderResult(
  execution: ExecutionRecord,
  result: {
    index: number;
    itemId: string;
    threadId: string;
    turnId: string;
    revisedPrompt?: string;
  },
): Promise<void> {
  const snapshot = await loadSnapshot(execution.projectId, execution.boardId);
  const persisted = snapshot.executions.find((candidate) => candidate.executionId === execution.executionId);
  if (!persisted || persisted.status !== 'running') throw new Error('Image execution is no longer running.');
  const current = isRecord(persisted.params?.codexAppServer) ? persisted.params.codexAppServer : {};
  const results = Array.isArray(current.results) ? current.results.filter(isRecord) : [];
  persisted.params = {
    ...persisted.params,
    codexAppServer: {
      ...current,
      results: [...results, result],
    },
  };
  await saveSnapshot(snapshot);
}

async function assertExecutionRunning(execution: ExecutionRecord): Promise<void> {
  const snapshot = await loadSnapshot(execution.projectId, execution.boardId);
  const persisted = snapshot.executions.find((candidate) => candidate.executionId === execution.executionId);
  if (persisted?.status !== 'running') throw new Error('Image execution is no longer running.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
