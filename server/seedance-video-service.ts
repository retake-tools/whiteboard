import { seedanceModelArkAdapterDefinition } from '../src/core/capabilityRegistry';
import { cancelExecution } from '../src/core/executionLifecycle';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import {
  createVideoGenerationExecution,
  seedanceModelArkExecutionProfile,
  type VideoGenerationInput,
} from '../src/core/videoGeneration';
import { importAssetFromUrl } from './local-store/asset-store';
import { readAssetAsDataUrl } from './local-store/asset-files';
import { resolveExecutionConnection } from './local-store/execution-provider-store';
import { failExecution, updateVideoResultBlock } from './local-store/execution-store';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';
import {
  readSeedanceModelArkConfig,
  SeedanceModelArkClient,
  type FetchLike,
  type SeedanceContentItem,
  type SeedanceModelArkConfig,
  type SeedanceTask,
} from './seedance-modelark-client';

interface SeedanceServiceDependencies {
  config?: SeedanceModelArkConfig;
  fetchImpl?: FetchLike;
}

interface ActiveSeedanceRun {
  abortController: AbortController;
  client: SeedanceModelArkClient;
  taskIds: string[];
}

const activeRuns = new Map<string, ActiveSeedanceRun>();

export async function startSeedanceVideoGeneration(
  input: VideoGenerationInput & { projectId: string; boardId: string },
  dependencies: SeedanceServiceDependencies = {},
): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord; completion: Promise<void> }> {
  const config = dependencies.config ?? await resolveSeedanceConfig(input.connectionId);
  if (!config) throw new Error('Seedance ModelArk is unavailable. Configure its API key in Retake Settings or on the server.');
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const profile = {
    ...seedanceModelArkExecutionProfile,
    adapterDefinition: { ...seedanceModelArkAdapterDefinition, model: config.model },
  };
  const run = createVideoGenerationExecution(snapshot, {
    ...input,
    connectionId: input.connectionId || 'byteplus-modelark',
  }, profile);
  const content = await buildSeedanceContent(snapshot, run.execution);
  run.execution.params = {
    ...run.execution.params,
    modelArk: { providerTaskIds: [], ratio: seedanceRatio(input.aspectRatio), generateAudio: true, watermark: false },
  };
  await saveSnapshot(snapshot);

  const abortController = new AbortController();
  const client = new SeedanceModelArkClient(config, dependencies.fetchImpl);
  const activeRun: ActiveSeedanceRun = { abortController, client, taskIds: [] };
  activeRuns.set(run.execution.executionId, activeRun);
  const completion = executeSeedanceRun({
    content,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    execution: run.execution,
    resultBlockIds: run.execution.outputBlockIds,
    activeRun,
    fetchImpl: dependencies.fetchImpl,
  }).finally(() => activeRuns.delete(run.execution.executionId));
  void completion.catch(() => undefined);
  return { snapshot, execution: run.execution, completion };
}

export async function cancelSeedanceVideoGeneration(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  providerTaskIds?: string[];
  remoteOnly?: boolean;
  connectionId?: string;
}, dependencies: SeedanceServiceDependencies = {}): Promise<{ snapshot?: BoardSnapshot; remoteQueuedTasksCanceled: number }> {
  const activeRun = activeRuns.get(input.executionId);
  if (input.remoteOnly) {
    activeRun?.abortController.abort(new DOMException('Canceled by user', 'AbortError'));
    const persistedExecution = activeRun ? undefined : (await loadSnapshot(input.projectId, input.boardId)).executions
      .find((candidate) => candidate.executionId === input.executionId);
    const config = dependencies.config ?? await resolveSeedanceConfig(
      input.connectionId || persistedExecution?.connectionId,
    );
    const client = activeRun?.client ?? (config ? new SeedanceModelArkClient(config, dependencies.fetchImpl) : undefined);
    const taskIds = activeRun?.taskIds ?? sanitizeProviderTaskIds(input.providerTaskIds);
    return { remoteQueuedTasksCanceled: await cancelQueuedTasks(client, taskIds) };
  }

  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = snapshot.executions.find((candidate) => candidate.executionId === input.executionId);
  if (!execution || execution.adapterSnapshot?.adapterId !== seedanceModelArkAdapterDefinition.adapterId) {
    throw new Error(`Seedance execution not found: ${input.executionId}`);
  }
  cancelExecution(snapshot, input.executionId);
  await saveSnapshot(snapshot);

  activeRun?.abortController.abort(new DOMException('Canceled by user', 'AbortError'));
  const config = dependencies.config ?? await resolveSeedanceConfig(execution.connectionId);
  const client = activeRun?.client ?? (config ? new SeedanceModelArkClient(config, dependencies.fetchImpl) : undefined);
  const taskIds = activeRun?.taskIds ?? providerTaskIds(execution);
  return { snapshot, remoteQueuedTasksCanceled: await cancelQueuedTasks(client, taskIds) };
}

async function executeSeedanceRun(input: {
  content: SeedanceContentItem[];
  durationSeconds: number;
  aspectRatio?: string;
  execution: ExecutionRecord;
  resultBlockIds: string[];
  activeRun: ActiveSeedanceRun;
  fetchImpl?: FetchLike;
}): Promise<void> {
  const { execution, activeRun } = input;
  try {
    for (let index = 0; index < input.resultBlockIds.length; index += 1) {
      await assertExecutionStillRunning(execution);
      const created = await activeRun.client.createTask({
        content: input.content,
        duration: input.durationSeconds,
        ratio: seedanceRatio(input.aspectRatio),
        generateAudio: true,
        watermark: false,
      }, activeRun.abortController.signal);
      activeRun.taskIds.push(created.id);
      await recordProviderTaskId(execution, created.id);
      const task = await activeRun.client.waitForTask(created.id, activeRun.abortController.signal);
      await recordProviderTaskResult(execution, task);
      await assertExecutionStillRunning(execution);
      const asset = await importAssetFromUrl({
        projectId: execution.projectId,
        sourceExecutionId: execution.executionId,
        sourceUrl: task.content!.video_url!,
        duration: task.duration ?? input.durationSeconds,
        fetchImpl: input.fetchImpl,
      });
      await updateVideoResultBlock({
        projectId: execution.projectId,
        boardId: execution.boardId,
        executionId: execution.executionId,
        assetId: asset.assetId,
        resultBlockId: input.resultBlockIds[index],
        title: input.resultBlockIds.length > 1 ? `Seedance result ${index + 1}` : 'Seedance result',
        body: 'Generated by Dreamina Seedance 2.0 through BytePlus ModelArk.',
      });
    }
  } catch (error) {
    const current = await loadSnapshot(execution.projectId, execution.boardId);
    const persisted = current.executions.find((candidate) => candidate.executionId === execution.executionId);
    if (persisted?.status === 'canceled' || isAbortError(error)) return;
    await failExecution({
      projectId: execution.projectId,
      boardId: execution.boardId,
      executionId: execution.executionId,
      errorMessage: error instanceof Error ? error.message : 'Seedance video generation failed.',
    });
    throw error;
  }
}

async function buildSeedanceContent(snapshot: BoardSnapshot, execution: ExecutionRecord): Promise<SeedanceContentItem[]> {
  const bindings = execution.inputBindingsSnapshot ?? [];
  const firstFrame = assetIdsForSlot(bindings, 'first_frame');
  const lastFrame = assetIdsForSlot(bindings, 'last_frame');
  const references = [
    ...assetIdsForSlot(bindings, 'character_references'),
    ...assetIdsForSlot(bindings, 'scene_references'),
    ...assetIdsForSlot(bindings, 'general_references'),
  ];
  if (lastFrame.length > 0 && firstFrame.length === 0) throw new Error('Seedance last-frame input requires a first-frame input.');
  if ((firstFrame.length > 0 || lastFrame.length > 0) && references.length > 0) {
    throw new Error('Seedance fixed first/last frames cannot be mixed with reference images in one task.');
  }
  const mediaCount = firstFrame.length + lastFrame.length + references.length;
  if (mediaCount > 9) throw new Error('Seedance supports at most 9 image inputs.');
  const content: SeedanceContentItem[] = [{ type: 'text', text: execution.prompt ?? '' }];
  for (const assetId of firstFrame) content.push(await imageContent(snapshot, assetId, 'first_frame'));
  for (const assetId of lastFrame) content.push(await imageContent(snapshot, assetId, 'last_frame'));
  for (const assetId of references) content.push(await imageContent(snapshot, assetId, 'reference_image'));
  return content;
}

async function imageContent(
  snapshot: BoardSnapshot,
  assetId: string,
  role: NonNullable<SeedanceContentItem['role']>,
): Promise<SeedanceContentItem> {
  if (!snapshot.assets.some((asset) => asset.assetId === assetId && asset.kind === 'image')) {
    throw new Error(`Seedance image asset is missing from the board snapshot: ${assetId}`);
  }
  return { type: 'image_url', image_url: { url: await readAssetAsDataUrl(snapshot.project.projectId, assetId) }, role };
}

function assetIdsForSlot(
  bindings: NonNullable<ExecutionRecord['inputBindingsSnapshot']>,
  slotId: string,
): string[] {
  return bindings
    .find((binding) => binding.slotId === slotId)
    ?.values.flatMap((value) => value.kind === 'asset' ? [value.assetId] : []) ?? [];
}

async function recordProviderTaskId(execution: ExecutionRecord, taskId: string): Promise<void> {
  const snapshot = await loadSnapshot(execution.projectId, execution.boardId);
  const persisted = snapshot.executions.find((candidate) => candidate.executionId === execution.executionId);
  if (!persisted || persisted.status !== 'running') throw new DOMException('Execution is no longer running', 'AbortError');
  const modelArk = isRecord(persisted.params?.modelArk) ? persisted.params!.modelArk as Record<string, unknown> : {};
  const taskIds = Array.isArray(modelArk.providerTaskIds)
    ? modelArk.providerTaskIds.filter((value): value is string => typeof value === 'string')
    : [];
  persisted.params = { ...persisted.params, modelArk: { ...modelArk, providerTaskIds: [...taskIds, taskId] } };
  await saveSnapshot(snapshot);
}

async function recordProviderTaskResult(execution: ExecutionRecord, task: SeedanceTask): Promise<void> {
  const snapshot = await loadSnapshot(execution.projectId, execution.boardId);
  const persisted = snapshot.executions.find((candidate) => candidate.executionId === execution.executionId);
  if (!persisted || persisted.status !== 'running') throw new DOMException('Execution is no longer running', 'AbortError');
  const modelArk = isRecord(persisted.params?.modelArk) ? persisted.params!.modelArk as Record<string, unknown> : {};
  const taskResults = Array.isArray(modelArk.taskResults)
    ? modelArk.taskResults.filter(isRecord)
    : [];
  persisted.params = {
    ...persisted.params,
    modelArk: {
      ...modelArk,
      taskResults: [...taskResults, {
        taskId: task.id,
        status: task.status,
        ...(task.duration === undefined ? {} : { duration: task.duration }),
        ...(task.usage === undefined ? {} : { usage: task.usage }),
      }],
    },
  };
  await saveSnapshot(snapshot);
}

async function assertExecutionStillRunning(execution: ExecutionRecord): Promise<void> {
  const snapshot = await loadSnapshot(execution.projectId, execution.boardId);
  const persisted = snapshot.executions.find((candidate) => candidate.executionId === execution.executionId);
  if (persisted?.status !== 'running') throw new DOMException('Execution is no longer running', 'AbortError');
}

function providerTaskIds(execution: ExecutionRecord): string[] {
  const modelArk = isRecord(execution.params?.modelArk) ? execution.params!.modelArk : undefined;
  return Array.isArray(modelArk?.providerTaskIds)
    ? modelArk.providerTaskIds.filter((value): value is string => typeof value === 'string')
    : [];
}

function sanitizeProviderTaskIds(taskIds: string[] | undefined): string[] {
  return [...new Set((taskIds ?? []).filter((taskId) => typeof taskId === 'string' && taskId.length > 0))];
}

async function cancelQueuedTasks(client: SeedanceModelArkClient | undefined, taskIds: string[]): Promise<number> {
  if (!client) return 0;
  let canceled = 0;
  for (const taskId of taskIds) {
    if (await client.cancelQueuedTask(taskId).catch(() => false)) canceled += 1;
  }
  return canceled;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function seedanceRatio(value: string | undefined): 'adaptive' | '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9' {
  if (value === '16:9' || value === '9:16' || value === '1:1' || value === '4:3' || value === '3:4' || value === '21:9') return value;
  return 'adaptive';
}

async function resolveSeedanceConfig(connectionId = 'byteplus-modelark'): Promise<SeedanceModelArkConfig | undefined> {
  const stored = await resolveExecutionConnection(connectionId);
  if (!stored) return connectionId === 'byteplus-modelark' ? readSeedanceModelArkConfig() : undefined;
  const environment = readSeedanceModelArkConfig();
  return {
    ...stored,
    pollIntervalMs: environment?.pollIntervalMs ?? 5_000,
    taskTimeoutMs: environment?.taskTimeoutMs ?? 30 * 60_000,
  };
}
