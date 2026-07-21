import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { dreaminaCliAdapterDefinition } from '../src/core/capabilityRegistry';
import { cancelExecution } from '../src/core/executionLifecycle';
import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import {
  createVideoGenerationExecution,
  dreaminaCliExecutionProfile,
  type VideoGenerationInput,
} from '../src/core/videoGeneration';
import {
  DreaminaCliClient,
  type DreaminaCliConfig,
  type DreaminaCommandRunner,
  readDreaminaCliConfig,
} from './dreamina-cli-client';
import { importAssetFromPath } from './local-store/asset-store';
import { readAssetMetadata, resolveAssetStoragePath } from './local-store/asset-files';
import { failExecution, updateVideoResultBlock } from './local-store/execution-store';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';

interface DreaminaCliServiceDependencies {
  config?: DreaminaCliConfig;
  runner?: DreaminaCommandRunner;
}

interface ActiveDreaminaRun {
  abortController: AbortController;
  submitIds: string[];
}

const activeRuns = new Map<string, ActiveDreaminaRun>();
const supportedRatios = new Set(['1:1', '3:4', '16:9', '4:3', '9:16', '21:9']);

export async function startDreaminaCliVideoGeneration(
  input: VideoGenerationInput & { projectId: string; boardId: string },
  dependencies: DreaminaCliServiceDependencies = {},
): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord; completion: Promise<void> }> {
  const config = dependencies.config ?? readDreaminaCliConfig();
  if (!config) throw new Error('Dreamina CLI is unavailable. Install dreamina or configure DREAMINA_CLI_PATH on the Retake server.');
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const profile = {
    ...dreaminaCliExecutionProfile,
    adapterDefinition: { ...dreaminaCliAdapterDefinition, model: config.modelVersion },
  };
  const run = createVideoGenerationExecution(snapshot, input, profile);
  const commandInput = await buildDreaminaCommandInput(run.execution, config, input.aspectRatio ?? '9:16');
  run.execution.params = {
    ...run.execution.params,
    dreaminaCli: {
      submitIds: [],
      taskResults: [],
      cliMode: commandInput.subcommand,
      modelVersion: config.modelVersion,
      videoResolution: config.videoResolution,
      sessionId: config.sessionId,
      billingSource: 'dreamina_membership_credit',
    },
  };
  await saveSnapshot(snapshot);

  const activeRun: ActiveDreaminaRun = { abortController: new AbortController(), submitIds: [] };
  activeRuns.set(run.execution.executionId, activeRun);
  const client = new DreaminaCliClient(config, dependencies.runner);
  const completion = executeDreaminaRun({
    client,
    commandInput,
    execution: run.execution,
    resultBlockIds: run.execution.outputBlockIds,
    activeRun,
  }).finally(() => activeRuns.delete(run.execution.executionId));
  void completion.catch(() => undefined);
  return { snapshot, execution: run.execution, completion };
}

export async function cancelDreaminaCliVideoGeneration(input: {
  executionId: string;
  projectId: string;
  boardId: string;
  remoteOnly?: boolean;
}): Promise<{ snapshot?: BoardSnapshot; providerTaskCancelable: false }> {
  const activeRun = activeRuns.get(input.executionId);
  activeRun?.abortController.abort(new DOMException('Canceled by user', 'AbortError'));
  if (input.remoteOnly) return { providerTaskCancelable: false };
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = snapshot.executions.find((candidate) => candidate.executionId === input.executionId);
  if (!execution || execution.adapterSnapshot?.adapterId !== dreaminaCliAdapterDefinition.adapterId) {
    throw new Error(`Dreamina CLI execution not found: ${input.executionId}`);
  }
  cancelExecution(snapshot, input.executionId);
  await saveSnapshot(snapshot);
  return { snapshot, providerTaskCancelable: false };
}

async function executeDreaminaRun(input: {
  client: DreaminaCliClient;
  commandInput: { subcommand: string; args: string[] };
  execution: ExecutionRecord;
  resultBlockIds: string[];
  activeRun: ActiveDreaminaRun;
}): Promise<void> {
  const { execution, activeRun } = input;
  try {
    for (let index = 0; index < input.resultBlockIds.length; index += 1) {
      await assertExecutionStillRunning(execution);
      const submitted = await input.client.submit(
        [input.commandInput.subcommand, ...input.commandInput.args],
        activeRun.abortController.signal,
      );
      activeRun.submitIds.push(submitted.submitId);
      await recordDreaminaTask(execution, { submitId: submitted.submitId, status: 'submitted' });
      await input.client.waitForTask(submitted.submitId, activeRun.abortController.signal);
      await recordDreaminaTask(execution, { submitId: submitted.submitId, status: 'provider_completed' });
      await assertExecutionStillRunning(execution);

      const stagingDir = await mkdtemp(path.join(tmpdir(), `retake-dreamina-${execution.executionId}-`));
      let imported = false;
      try {
        const downloadedFiles = await input.client.downloadTask(
          submitted.submitId,
          stagingDir,
          activeRun.abortController.signal,
        );
        await assertExecutionStillRunning(execution);
        const asset = await importAssetFromPath({
          projectId: execution.projectId,
          sourceExecutionId: execution.executionId,
          sourcePath: downloadedFiles[0],
          kind: 'video',
          mimeType: mimeForVideoFile(downloadedFiles[0]),
        });
        imported = true;
        await recordDreaminaTask(execution, {
          submitId: submitted.submitId,
          status: 'downloaded',
          outputAssetId: asset.assetId,
        });
        await updateVideoResultBlock({
          projectId: execution.projectId,
          boardId: execution.boardId,
          executionId: execution.executionId,
          assetId: asset.assetId,
          resultBlockId: input.resultBlockIds[index],
          title: input.resultBlockIds.length > 1 ? `Dreamina result ${index + 1}` : 'Dreamina result',
          body: 'Generated by Seedance 2.0 through the official Dreamina CLI membership account.',
        });
      } finally {
        // The paid result is removed from staging only after AssetStore has a durable copy.
        if (imported) await rm(stagingDir, { recursive: true, force: true });
      }
    }
  } catch (error) {
    const current = await loadSnapshot(execution.projectId, execution.boardId);
    const persisted = current.executions.find((candidate) => candidate.executionId === execution.executionId);
    if (persisted?.status === 'canceled' || isAbortError(error)) return;
    await failExecution({
      projectId: execution.projectId,
      boardId: execution.boardId,
      executionId: execution.executionId,
      errorMessage: error instanceof Error ? error.message : 'Dreamina CLI video generation failed.',
    });
    throw error;
  }
}

async function buildDreaminaCommandInput(
  execution: ExecutionRecord,
  config: DreaminaCliConfig,
  aspectRatio: string,
): Promise<{ subcommand: string; args: string[] }> {
  if (!supportedRatios.has(aspectRatio)) throw new Error(`Dreamina aspect ratio is not supported: ${aspectRatio}`);
  const bindings = execution.inputBindingsSnapshot ?? [];
  const firstFrames = assetIdsForSlot(bindings, 'first_frame');
  const lastFrames = assetIdsForSlot(bindings, 'last_frame');
  const references = [
    ...assetIdsForSlot(bindings, 'character_references'),
    ...assetIdsForSlot(bindings, 'scene_references'),
    ...assetIdsForSlot(bindings, 'general_references'),
  ];
  if (firstFrames.length > 1 || lastFrames.length > 1) throw new Error('Dreamina accepts at most one first frame and one last frame.');
  if (lastFrames.length > 0 && firstFrames.length === 0) throw new Error('Dreamina last-frame input requires a first-frame input.');
  if ((firstFrames.length > 0 || lastFrames.length > 0) && references.length > 0) {
    throw new Error('Dreamina fixed first/last frames cannot be mixed with reference images in one Retake task.');
  }
  if (references.length > 9) throw new Error('Dreamina multimodal video supports at most 9 image references.');
  const common = [
    '--prompt', execution.prompt ?? '',
    '--duration', String(execution.params?.generation && isRecord(execution.params.generation)
      ? execution.params.generation.durationSeconds ?? 8
      : 8),
    '--session', String(config.sessionId),
    '--poll', '0',
    '--model_version', config.modelVersion,
    '--video_resolution', config.videoResolution,
  ];
  if (firstFrames.length === 1 && lastFrames.length === 1) {
    return {
      subcommand: 'frames2video',
      args: [
        '--first', await rasterImagePath(execution.projectId, firstFrames[0]),
        '--last', await rasterImagePath(execution.projectId, lastFrames[0]),
        ...common,
      ],
    };
  }
  if (firstFrames.length === 1) {
    return {
      subcommand: 'image2video',
      args: ['--image', await rasterImagePath(execution.projectId, firstFrames[0]), ...common],
    };
  }
  if (references.length > 0) {
    const referenceArgs: string[] = [];
    for (const assetId of references) referenceArgs.push('--image', await rasterImagePath(execution.projectId, assetId));
    return { subcommand: 'multimodal2video', args: [...referenceArgs, ...common, '--ratio', aspectRatio] };
  }
  return { subcommand: 'text2video', args: [...common, '--ratio', aspectRatio] };
}

async function rasterImagePath(projectId: string, assetId: string): Promise<string> {
  const metadata = await readAssetMetadata(projectId, assetId);
  if (!metadata.mimeType.startsWith('image/') || metadata.mimeType === 'image/svg+xml') {
    throw new Error(`Dreamina CLI requires a supported raster image input: ${assetId}`);
  }
  return resolveAssetStoragePath(projectId, assetId);
}

async function recordDreaminaTask(
  execution: ExecutionRecord,
  task: { submitId: string; status: string; outputAssetId?: string },
): Promise<void> {
  const snapshot = await loadSnapshot(execution.projectId, execution.boardId);
  const persisted = snapshot.executions.find((candidate) => candidate.executionId === execution.executionId);
  if (!persisted || persisted.status !== 'running') throw new DOMException('Execution is no longer running', 'AbortError');
  const dreaminaCli = isRecord(persisted.params?.dreaminaCli) ? persisted.params!.dreaminaCli : {};
  const submitIds = Array.isArray(dreaminaCli.submitIds)
    ? dreaminaCli.submitIds.filter((value): value is string => typeof value === 'string')
    : [];
  const taskResults = Array.isArray(dreaminaCli.taskResults)
    ? dreaminaCli.taskResults.filter(isRecord).filter((value) => value.submitId !== task.submitId)
    : [];
  persisted.params = {
    ...persisted.params,
    dreaminaCli: {
      ...dreaminaCli,
      submitIds: submitIds.includes(task.submitId) ? submitIds : [...submitIds, task.submitId],
      taskResults: [...taskResults, task],
    },
  };
  await saveSnapshot(snapshot);
}

async function assertExecutionStillRunning(execution: ExecutionRecord): Promise<void> {
  const snapshot = await loadSnapshot(execution.projectId, execution.boardId);
  const persisted = snapshot.executions.find((candidate) => candidate.executionId === execution.executionId);
  if (persisted?.status !== 'running') throw new DOMException('Execution is no longer running', 'AbortError');
}

function assetIdsForSlot(
  bindings: NonNullable<ExecutionRecord['inputBindingsSnapshot']>,
  slotId: string,
): string[] {
  return bindings
    .find((binding) => binding.slotId === slotId)
    ?.values.flatMap((value) => value.kind === 'asset' ? [value.assetId] : []) ?? [];
}

function mimeForVideoFile(filePath: string): string {
  if (filePath.toLowerCase().endsWith('.webm')) return 'video/webm';
  if (filePath.toLowerCase().endsWith('.mov')) return 'video/quicktime';
  return 'video/mp4';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}
