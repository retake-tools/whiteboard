import { readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { annotationEditControlDescription, readAnnotationEditControlManifest } from '../src/core/annotationEditControls';
import { runCodexAppServerTurn } from './codex-app-server-client';
import { publishExecutionEvent } from './execution-events';
import { resolveAssetStoragePath } from './local-store/asset-files';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { listExecutionProviderSettings } from './local-store/execution-provider-store';
import { failExecution, markExecutionRunning, updateImageResultBlock } from './local-store/execution-store';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';

interface CodexAppServerImageDependencies {
  runTurn?: typeof runCodexAppServerTurn;
}

export async function startCodexAppServerImageGeneration(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  connectionId: string;
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
  const queued = current.executions.find((candidate) => candidate.executionId === input.executionId);
  if (!queued || queued.status !== 'queued' || queued.adapter !== 'codex_app_server') {
    throw new Error(`Queued Codex App Server image execution not found: ${input.executionId}`);
  }
  if (queued.connectionId !== input.connectionId) {
    throw new Error(`Image execution connection mismatch: ${input.connectionId}`);
  }

  const started = await markExecutionRunning(input);
  publishExecutionEvent(input.executionId, { type: 'execution.started' });
  const completion = executeCodexImageRun(started.execution, connection.modelId, dependencies).catch(async (error) => {
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
): Promise<void> {
  const initial = await loadSnapshot(execution.projectId, execution.boardId);
  const localImagePaths = await executionInputImagePaths(initial, execution);
  for (let index = 0; index < execution.outputBlockIds.length; index += 1) {
    await assertExecutionRunning(execution);
    const result = await (dependencies.runTurn ?? runCodexAppServerTurn)({
      cwd: process.env.TMPDIR || '/tmp',
      model,
      prompt: imagegenPrompt(execution, localImagePaths.length > 0),
      localImagePaths,
      sandbox: 'workspace-write',
      onImageGenerationStarted: () => publishExecutionEvent(execution.executionId, {
        type: 'execution.progress',
        message: `Generating image ${index + 1} of ${execution.outputBlockIds.length}`,
      }),
    });
    if (!result.image) throw new Error('Codex App Server completed without an image result.');
    const asset = result.image.savedPath
      ? await importCodexImagePath(execution, result.image.savedPath)
      : result.image.dataUrl
        ? await createAssetFromDataUrl({
          projectId: execution.projectId,
          sourceExecutionId: execution.executionId,
          dataUrl: result.image.dataUrl,
          fileName: `codex-image-${index + 1}.png`,
          kind: 'image',
        })
        : undefined;
    if (!asset) throw new Error('Codex App Server image result did not contain a saved path or image data.');
    await recordProviderResult(execution, {
      index,
      itemId: result.image.itemId,
      threadId: result.threadId,
      turnId: result.turnId,
      revisedPrompt: result.image.revisedPrompt,
    });
    const updated = await updateImageResultBlock({
      projectId: execution.projectId,
      boardId: execution.boardId,
      executionId: execution.executionId,
      assetId: asset.assetId,
      resultBlockId: execution.outputBlockIds[index],
      title: execution.outputBlockIds.length > 1 ? `Codex image ${index + 1}` : 'Codex image',
      body: 'Generated through Codex App Server and imported into Retake.',
    });
    if (updated.execution.status === 'succeeded') {
      publishExecutionEvent(execution.executionId, { type: 'execution.snapshot', snapshot: updated.snapshot });
    }
  }
}

async function executionInputImagePaths(snapshot: BoardSnapshot, execution: ExecutionRecord): Promise<string[]> {
  const bindingAssetIds = execution.inputBindingsSnapshot?.flatMap((binding) =>
    binding.values.flatMap((value) => value.kind === 'asset' ? [value.assetId] : [])) ?? [];
  const annotatedCompositeAssetId = typeof execution.params?.annotatedCompositeAssetId === 'string'
    ? execution.params.annotatedCompositeAssetId
    : undefined;
  const assetIds = [...new Set([
    ...(bindingAssetIds.length ? bindingAssetIds : execution.inputAssetIds ?? []),
    ...(execution.capabilityId === 'image.annotation_edit'
      ? [
          ...(execution.inputAssetIds ?? []).filter((assetId) => assetId !== annotatedCompositeAssetId),
          annotatedCompositeAssetId,
        ]
      : []),
  ].filter((assetId): assetId is string => typeof assetId === 'string'))];
  for (const assetId of assetIds) {
    if (!snapshot.assets.some((asset) => asset.assetId === assetId && asset.kind === 'image')) {
      throw new Error(`Codex image input is missing from the board snapshot: ${assetId}`);
    }
  }
  return Promise.all(assetIds.map((assetId) => resolveAssetStoragePath(execution.projectId, assetId)));
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

function imagegenPrompt(execution: ExecutionRecord, hasInputs: boolean): string {
  const instruction = execution.prompt?.trim();
  if (!instruction) throw new Error('Image generation requires a non-empty prompt.');
  const generation = isRecord(execution.params?.generation) ? execution.params.generation : {};
  const width = finiteNumber(generation.targetWidth);
  const height = finiteNumber(generation.targetHeight);
  const dimensions = width && height ? ` Target composition: ${Math.round(width)}x${Math.round(height)}.` : '';
  if (execution.capabilityId === 'image.annotation_edit') {
    const annotationInstructions = annotationPromptInstructions(execution);
    return `$imagegen Edit the clean source image using the final attached annotated composite as a visual instruction layer. ${annotationInstructions} The colored marks, arrows, outlines, labels, and brush overlays are instructions only: do not retain them in the final image. Preserve all unmentioned content.${dimensions} Generate exactly one clean revised image. Do not call other tools or copy the result.`;
  }
  return hasInputs
    ? `$imagegen Edit the attached image according to this instruction: ${instruction}.${dimensions} Preserve all unmentioned content. Generate exactly one revised image. Do not call other tools or copy the result.`
    : `$imagegen Generate exactly one image from this instruction: ${instruction}.${dimensions} Do not call other tools or copy the result.`;
}

function annotationPromptInstructions(execution: ExecutionRecord): string {
  const manifest = isRecord(execution.params?.annotationManifest) ? execution.params.annotationManifest : {};
  const globalInstruction = typeof manifest.globalInstruction === 'string' ? manifest.globalInstruction.trim() : '';
  const controls = readAnnotationEditControlManifest(execution.params?.annotationEditControls)?.controls ?? [];
  const controlById = new Map(controls.map((control) => [control.markId, control]));
  const marks = Array.isArray(manifest.marks) ? manifest.marks.filter(isRecord) : [];
  const markInstructions = marks.flatMap((mark) => {
    if (typeof mark.id !== 'string' || typeof mark.intent !== 'string' || !mark.intent.trim()) return [];
    const control = controlById.get(mark.id);
    const location = control ? ` (${annotationEditControlDescription(control)})` : '';
    return [`${mark.id}${location}: ${mark.intent.trim()}`];
  });
  const parts = [
    globalInstruction ? `Global instruction: ${globalInstruction}` : '',
    markInstructions.length ? `Marked edits: ${markInstructions.join('; ')}` : '',
  ].filter(Boolean);
  return parts.join(' ') || `Instruction: ${execution.prompt?.trim() || 'Apply the marked edits.'}`;
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

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
