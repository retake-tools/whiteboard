import {
  assertValidCapabilityExecutionRequest,
  type CapabilityAdapterPort,
  type CapabilityExecutionRequest,
  type CapabilityInputBinding,
} from './capabilityContracts';
import {
  dreaminaCliAdapterDefinition,
  mockVideoAdapterDefinition,
  seedanceModelArkAdapterDefinition,
  videoGenerateCapabilityDefinition,
} from './capabilityRegistry';
import { maxZIndex, touchBoard } from './blockFactory';
import { createId, nowIso } from './id';
import { MockVideoAdapter } from './mockVideoAdapter';
import type { AssetRecord, BlockRecord, BoardHistoryEvent, BoardSnapshot, ExecutionInputRole, ExecutionRecord } from './types';

export interface VideoGenerationInput {
  targetBlockId: string;
  prompt: string;
  durationSeconds: number;
  outputCount: number;
  aspectRatio?: string;
}

export interface VideoGenerationRun {
  request: CapabilityExecutionRequest;
  execution: ExecutionRecord;
  resultBlocks: BlockRecord[];
}

export interface VideoExecutionProfile {
  adapter: ExecutionRecord['adapter'];
  adapterDefinition: typeof mockVideoAdapterDefinition;
  executionProfileId: string;
  qualityTier: 'draft' | 'preview' | 'final';
  resultBody: string;
  startSummary: string;
  triggerMode: NonNullable<ExecutionRecord['triggerMode']>;
}

export const mockVideoExecutionProfile: VideoExecutionProfile = {
  adapter: 'mock',
  adapterDefinition: mockVideoAdapterDefinition,
  executionProfileId: 'video-mock',
  qualityTier: 'preview',
  resultBody: 'Generating with the Retake mock video adapter.',
  startSummary: 'Mock video generation started',
  triggerMode: 'local_mock',
};

export const seedanceModelArkExecutionProfile: VideoExecutionProfile = {
  adapter: 'direct_api',
  adapterDefinition: seedanceModelArkAdapterDefinition,
  executionProfileId: 'video-seedance-modelark',
  qualityTier: 'final',
  resultBody: 'Generating with Seedance 2.0 through ModelArk.',
  startSummary: 'Seedance ModelArk video generation started',
  triggerMode: 'server_worker',
};

export const dreaminaCliExecutionProfile: VideoExecutionProfile = {
  adapter: 'provider_cli',
  adapterDefinition: dreaminaCliAdapterDefinition,
  executionProfileId: 'video-dreamina-cli',
  qualityTier: 'final',
  resultBody: 'Generating with the official Dreamina CLI and the signed-in membership account.',
  startSummary: 'Dreamina CLI video generation started',
  triggerMode: 'server_worker',
};

export async function runMockVideoGeneration(
  snapshot: BoardSnapshot,
  input: VideoGenerationInput,
  adapter: CapabilityAdapterPort = new MockVideoAdapter(),
): Promise<VideoGenerationRun> {
  const run = createVideoGenerationExecution(snapshot, input);
  try {
    await adapter.validate(run.request, mockVideoAdapterDefinition);
    const result = await adapter.execute({
      request: run.request,
      execution: run.execution,
      definition: mockVideoAdapterDefinition,
      signal: new AbortController().signal,
      emitProgress: () => undefined,
    });
    completeMockVideoGeneration(snapshot, run.execution, run.resultBlocks, result.producedFiles);
  } catch (error) {
    failMockVideoGeneration(snapshot, run.execution, run.resultBlocks, error);
    throw error;
  }
  return run;
}

export function createVideoGenerationExecution(
  snapshot: BoardSnapshot,
  input: VideoGenerationInput,
  profile: VideoExecutionProfile = mockVideoExecutionProfile,
): VideoGenerationRun {
  const targetBlock = snapshot.blocks.find((block) => block.blockId === input.targetBlockId && block.type === 'video');
  if (!targetBlock) throw new Error(`Video target block not found: ${input.targetBlockId}`);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Enter a video prompt before generating.');
  if (!Number.isInteger(input.outputCount) || input.outputCount < 1 || input.outputCount > 4) {
    throw new Error('Video output count must be an integer from 1 to 4.');
  }
  if (input.durationSeconds < 4 || input.durationSeconds > 15) {
    throw new Error('Video duration must be from 4 to 15 seconds for the selected profile.');
  }

  const requestId = createId('request');
  const executionId = createId('exec');
  const createdAt = nowIso();
  const inputBindings = videoInputBindings(snapshot, targetBlock, prompt);
  const request: CapabilityExecutionRequest = {
    schemaVersion: 1,
    requestId,
    scope: {
      workspaceId: 'workspace_local',
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
    },
    trigger: { kind: 'video_block_shortcut', sourceBlockId: targetBlock.blockId },
    capabilityLock: {
      capabilityId: videoGenerateCapabilityDefinition.capabilityId,
      version: videoGenerateCapabilityDefinition.version,
      definitionHash: videoGenerateCapabilityDefinition.definitionHash,
    },
    skillLock: null,
    executionProfileId: profile.executionProfileId,
    requestedAdapterId: profile.adapterDefinition.adapterId,
    inputBindings,
    parameters: {
      durationSeconds: input.durationSeconds,
      outputCount: input.outputCount,
      aspectRatio: input.aspectRatio ?? '9:16',
      qualityTier: profile.qualityTier,
    },
    resultProjection: {
      mode: input.outputCount > 1 ? 'target_and_siblings' : 'target',
      targetBlockId: targetBlock.blockId,
    },
    actor: { actorType: 'user', actorId: 'user_local' },
    idempotencyKey: `${snapshot.board.boardId}:${targetBlock.blockId}:${executionId}`,
    createdAt,
  };
  assertValidCapabilityExecutionRequest(request, videoGenerateCapabilityDefinition);
  const resultBlocks = prepareVideoResultBlocks(
    snapshot,
    targetBlock,
    executionId,
    input.outputCount,
    createdAt,
    profile.resultBody,
  );

  const inputBlockIds = inputBindings.flatMap((binding) =>
    binding.values.flatMap((value) => 'blockId' in value && value.blockId ? [value.blockId] : []),
  );
  const inputAssetIds = inputBindings.flatMap((binding) =>
    binding.values.flatMap((value) => value.kind === 'asset' ? [value.assetId] : []),
  );
  const execution: ExecutionRecord = {
    executionId,
    requestId,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId: videoGenerateCapabilityDefinition.capabilityId,
    adapter: profile.adapter,
    status: 'running',
    inputBlockIds: [...new Set(inputBlockIds)],
    inputAssetIds: [...new Set(inputAssetIds)],
    outputBlockIds: resultBlocks.map((block) => block.blockId),
    outputAssetIds: [],
    triggerMode: profile.triggerMode,
    provider: profile.adapterDefinition.provider,
    model: profile.adapterDefinition.model,
    prompt,
    params: { generation: structuredClone(request.parameters), shortcutBlockId: targetBlock.blockId },
    startedAt: createdAt,
    capabilityLock: structuredClone(request.capabilityLock),
    adapterSnapshot: adapterSnapshot(profile.adapterDefinition),
    inputBindingsSnapshot: structuredClone(inputBindings),
    outputSlotResults: [{ slotId: 'videos', assetIds: [] }],
    resultSummary: { requested: input.outputCount, succeeded: 0, failed: 0 },
  };
  snapshot.executions.unshift(execution);
  appendHistory(snapshot, {
    eventId: createId('history'),
    type: 'operation_created',
    createdAt,
    actor: 'user',
    executionId,
    blockIds: [...execution.inputBlockIds, ...execution.outputBlockIds],
    assetIds: execution.inputAssetIds,
    summary: profile.startSummary,
    detail: { requestId, outputCount: input.outputCount, durationSeconds: input.durationSeconds },
  });
  touchBoard(snapshot);
  return { request, execution, resultBlocks };
}

function completeMockVideoGeneration(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  resultBlocks: BlockRecord[],
  producedFiles: Array<{ duration?: number; mimeType: string; sourcePath: string }>,
): void {
  const completedAt = nowIso();
  const assets = producedFiles.map((file, index): AssetRecord => {
    const assetId = createId('asset');
    return {
      assetId,
      projectId: snapshot.project.projectId,
      kind: 'video',
      mimeType: file.mimeType,
      storageProvider: 'local_mock',
      storageKey: file.sourcePath,
      previewUrl: file.sourcePath,
      duration: file.duration,
      sourceExecutionId: execution.executionId,
      createdAt: completedAt,
    };
  });
  snapshot.assets.unshift(...assets);
  resultBlocks.forEach((block, index) => {
    const asset = assets[index];
    if (!asset) return;
    block.data = {
      ...block.data,
      assetId: asset.assetId,
      previewUrl: asset.previewUrl,
      status: 'succeeded',
      body: 'Mock video result. Replace the Adapter profile to run a real provider.',
    };
    block.updatedAt = completedAt;
  });
  execution.status = 'succeeded';
  execution.outputAssetIds = assets.map((asset) => asset.assetId);
  execution.outputSlotResults = [{ slotId: 'videos', assetIds: [...execution.outputAssetIds] }];
  execution.resultSummary = { requested: resultBlocks.length, succeeded: assets.length, failed: 0 };
  execution.completedAt = completedAt;
  appendHistory(snapshot, {
    eventId: createId('history'),
    type: 'execution_succeeded',
    createdAt: completedAt,
    actor: 'system',
    executionId: execution.executionId,
    blockIds: execution.outputBlockIds,
    assetIds: execution.outputAssetIds,
    summary: 'Mock video generation completed',
  });
  touchBoard(snapshot);
}

function failMockVideoGeneration(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  resultBlocks: BlockRecord[],
  error: unknown,
): void {
  const completedAt = nowIso();
  execution.status = 'failed';
  execution.completedAt = completedAt;
  execution.errorMessage = error instanceof Error ? error.message : 'Mock video generation failed.';
  execution.resultSummary = { requested: resultBlocks.length, succeeded: 0, failed: resultBlocks.length };
  for (const block of resultBlocks) {
    block.data.status = 'failed';
    block.updatedAt = completedAt;
  }
  touchBoard(snapshot);
}

function videoInputBindings(
  snapshot: BoardSnapshot,
  targetBlock: BlockRecord,
  prompt: string,
): CapabilityInputBinding[] {
  const slotValues = new Map<string, CapabilityInputBinding['values']>([
    ['prompt', [{ kind: 'inline', value: prompt }]],
  ]);
  const inputEdges = snapshot.edges.filter(
    (edge) => edge.targetBlockId === targetBlock.blockId && edge.kind === 'execution_input',
  );
  for (const edge of inputEdges) {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === edge.sourceBlockId);
    if (block?.type !== 'image' || typeof block.data.assetId !== 'string') continue;
    const slotId = videoSlotForRole(edge.inputRole);
    const values = slotValues.get(slotId) ?? [];
    values.push({ kind: 'asset', assetId: block.data.assetId, blockId: block.blockId });
    slotValues.set(slotId, values);
  }
  return [...slotValues].map(([slotId, values]) => ({ slotId, values }));
}

function videoSlotForRole(role: ExecutionInputRole | undefined): string {
  if (role === 'first_frame') return 'first_frame';
  if (role === 'last_frame') return 'last_frame';
  if (role === 'character_reference') return 'character_references';
  if (role === 'environment_reference') return 'scene_references';
  return 'general_references';
}

function prepareVideoResultBlocks(
  snapshot: BoardSnapshot,
  targetBlock: BlockRecord,
  executionId: string,
  outputCount: number,
  createdAt: string,
  body: string,
): BlockRecord[] {
  const canUseTarget =
    !targetBlock.data.assetId &&
    (
      !targetBlock.data.sourceExecutionId ||
      targetBlock.data.status === 'failed' ||
      targetBlock.data.status === 'canceled'
    );
  const resultBlocks: BlockRecord[] = [];
  const firstX = canUseTarget ? targetBlock.position.x : targetBlock.position.x + targetBlock.size.width + 80;
  for (let index = 0; index < outputCount; index += 1) {
    const block = index === 0 && canUseTarget
      ? targetBlock
      : createVideoResultBlock(snapshot, targetBlock, firstX + index * (targetBlock.size.width + 32), createdAt);
    block.data = {
      ...block.data,
      title: outputCount > 1 ? `Video result ${index + 1}` : 'Video result',
      body,
      status: 'running',
      sourceExecutionId: executionId,
      resultIndex: index,
      resultCount: outputCount,
    };
    block.updatedAt = createdAt;
    resultBlocks.push(block);
  }
  return resultBlocks;
}

function createVideoResultBlock(
  snapshot: BoardSnapshot,
  targetBlock: BlockRecord,
  x: number,
  createdAt: string,
): BlockRecord {
  const block: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'video',
    layerId: targetBlock.layerId,
    parentGroupId: targetBlock.parentGroupId,
    position: { x, y: targetBlock.position.y },
    size: { ...targetBlock.size },
    zIndex: maxZIndex(snapshot.blocks) + 1,
    data: {
      title: 'Video result',
      executionDraft: structuredClone(targetBlock.data.executionDraft),
    },
    createdAt,
    updatedAt: createdAt,
  };
  snapshot.blocks.push(block);
  return block;
}

function adapterSnapshot(
  definition: VideoExecutionProfile['adapterDefinition'],
): NonNullable<ExecutionRecord['adapterSnapshot']> {
  return {
    adapterId: definition.adapterId,
    version: definition.version,
    definitionHash: definition.definitionHash,
    adapterClass: definition.adapterClass,
    routeKind: definition.routeKind,
    provider: definition.provider,
    model: definition.model,
  };
}

function appendHistory(snapshot: BoardSnapshot, event: BoardHistoryEvent): void {
  snapshot.historyEvents = [event, ...(snapshot.historyEvents ?? [])].slice(0, 200);
}
