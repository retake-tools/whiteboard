import {
  assertValidCapabilityExecutionRequest,
  type CapabilityAdapterPort,
  type CapabilityExecutionRequest,
  type CapabilityInputBinding,
} from './capabilityContracts';
import {
  assetIdsForBindingValue,
  capabilityBindingValueForBlock,
} from './artifactLibrary';
import {
  domainVideoGenerationCapabilityDefinition,
  dreaminaCliAdapterDefinition,
  mockVideoAdapterDefinition,
  seedanceModelArkAdapterDefinition,
  videoGenerateCapabilityDefinition,
} from './capabilityRegistry';
import { maxZIndex, touchBoard } from './blockFactory';
import {
  domainVideoGenerationSkillId,
  type DomainVideoRequestSnapshotV1,
  type ProviderExecutionAuthorizationV1,
} from './domainVideoGenerationContracts';
import {
  configurationFingerprint,
  currentOperationConfiguration,
} from './executionConfiguration';
import { createId, nowIso } from './id';
import { MockVideoAdapter } from './mockVideoAdapter';
import { skillDefinitionFor } from './skillRegistry';
import type { AssetRecord, BlockRecord, BoardHistoryEvent, BoardSnapshot, ExecutionInputRole, ExecutionRecord } from './types';
import { attachWorkflowExecution, reconcileWorkflowRuntime } from './workflowRuntime';

export interface DomainVideoExecutionContext {
  authorization: ProviderExecutionAuthorizationV1;
  generationPackageBlockId: string;
  operationBlockId: string;
  providerPrompt: string;
  request: DomainVideoRequestSnapshotV1;
}

export interface VideoGenerationInput {
  targetBlockId: string;
  prompt: string;
  durationSeconds: number;
  outputCount: number;
  aspectRatio?: string;
  connectionId?: string;
  domain?: DomainVideoExecutionContext;
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
  options: {
    beforeExecute?: (run: VideoGenerationRun) => Promise<void>;
  } = {},
): Promise<VideoGenerationRun> {
  const run = createVideoGenerationExecution(snapshot, input);
  try {
    await options.beforeExecute?.(run);
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
  const domain = input.domain;
  const targetBlock = snapshot.blocks.find(
    (block) => block.blockId === input.targetBlockId && block.type === 'video',
  ) ?? (domain ? createDomainVideoTargetBlock(snapshot, domain.operationBlockId) : undefined);
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
  if (domain) assertDomainExecutionContext(domain, profile);
  const capability = domain
    ? domainVideoGenerationCapabilityDefinition
    : videoGenerateCapabilityDefinition;
  const skill = domain ? skillDefinitionFor(domainVideoGenerationSkillId) : undefined;
  const inputBindings = domain
    ? domainVideoInputBindings(domain)
    : videoInputBindings(snapshot, targetBlock, prompt);
  const workflowStep = domain
    ? (snapshot.workflowStepRuns ?? []).find((step) => step.operationBlockId === domain.operationBlockId)
    : undefined;
  const request: CapabilityExecutionRequest = {
    schemaVersion: 1,
    requestId,
    scope: {
      workspaceId: 'workspace_local',
      projectId: snapshot.project.projectId,
      boardId: snapshot.board.boardId,
    },
    trigger: workflowStep
      ? {
          kind: 'workflow_step',
          sourceBlockId: domain?.operationBlockId,
          workflowRunId: workflowStep.workflowRunId,
          stepRunId: workflowStep.stepRunId,
        }
      : domain
        ? { kind: 'operation_block', sourceBlockId: domain.operationBlockId }
        : { kind: 'video_block_shortcut', sourceBlockId: targetBlock.blockId },
    capabilityLock: {
      capabilityId: capability.capabilityId,
      version: capability.version,
      definitionHash: capability.definitionHash,
    },
    skillLock: skill ? {
      skillId: skill.skillId,
      version: skill.version,
      definitionHash: skill.definitionHash,
    } : null,
    executionProfileId: profile.executionProfileId,
    requestedAdapterId: profile.adapterDefinition.adapterId,
    ...(input.connectionId ? { requestedConnectionId: input.connectionId } : {}),
    inputBindings,
    parameters: {
      durationSeconds: input.durationSeconds,
      outputCount: input.outputCount,
      aspectRatio: input.aspectRatio ?? '9:16',
      qualityTier: domain?.request.launchParameters.qualityTier ?? profile.qualityTier,
    },
    resultProjection: {
      mode: input.outputCount > 1 ? 'target_and_siblings' : 'target',
      targetBlockId: targetBlock.blockId,
    },
    actor: { actorType: 'user', actorId: 'user_local' },
    idempotencyKey: `${snapshot.board.boardId}:${targetBlock.blockId}:${executionId}`,
    createdAt,
  };
  assertValidCapabilityExecutionRequest(request, capability);
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
    binding.values.flatMap((value) => assetIdsForBindingValue(snapshot, value)),
  );
  const execution: ExecutionRecord = {
    executionId,
    requestId,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId: capability.capabilityId,
    adapter: profile.adapter,
    status: 'running',
    inputBlockIds: [...new Set(inputBlockIds)],
    inputAssetIds: [...new Set(inputAssetIds)],
    outputBlockIds: resultBlocks.map((block) => block.blockId),
    outputAssetIds: [],
    triggerMode: profile.triggerMode,
    provider: domain?.request.provider ?? profile.adapterDefinition.provider,
    model: domain?.request.model ?? profile.adapterDefinition.model,
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    ...(skill ? { skillId: skill.skillId } : {}),
    prompt,
    requestPrompts: domain
      ? resultBlocks.map((block, index) => ({
          index,
          outputBlockId: block.blockId,
          prompt: domain.providerPrompt,
        }))
      : undefined,
    params: {
      generation: structuredClone(request.parameters),
      ...(domain
        ? {
            operationBlockId: domain.operationBlockId,
            generationPackageBlockId: domain.generationPackageBlockId,
          }
        : { shortcutBlockId: targetBlock.blockId }),
    },
    startedAt: createdAt,
    capabilityLock: structuredClone(request.capabilityLock),
    ...(request.skillLock ? { skillSnapshot: structuredClone(request.skillLock) } : {}),
    adapterSnapshot: adapterSnapshot(profile.adapterDefinition),
    inputBindingsSnapshot: structuredClone(inputBindings),
    outputSlotResults: [{ slotId: 'videos', assetIds: [] }],
    resultSummary: { requested: input.outputCount, succeeded: 0, failed: 0 },
    ...(domain ? {
      domainVideoRequestSnapshot: structuredClone(domain.request),
      providerExecutionAuthorization: structuredClone(domain.authorization),
      providerCalls: resultBlocks.map((_, index) => ({
        providerCallId: createId('provider_call'),
        executionId,
        callIndex: index,
        status: 'queued' as const,
        provider: domain.request.provider,
        model: domain.request.model,
        requestPromptIndex: index,
        outputAssetIds: [],
        billingSource: domain.authorization.costDisclosure.billingSource,
        startedAt: createdAt,
      })),
    } : {}),
  };
  if (domain) {
    const operation = snapshot.blocks.find((block) =>
      block.blockId === domain.operationBlockId && block.type === 'operation',
    );
    if (!operation) throw new Error(`Domain Video Operation not found: ${domain.operationBlockId}`);
    execution.configuration = currentOperationConfiguration(snapshot, operation);
    execution.configurationFingerprint = configurationFingerprint(execution.configuration);
    attachWorkflowExecution(snapshot, operation, execution);
  }
  snapshot.executions.unshift(execution);
  if (domain) reconcileWorkflowRuntime(snapshot);
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
  if (execution.providerCalls) {
    execution.providerCalls = execution.providerCalls.map((call, index) => ({
      ...call,
      status: 'succeeded',
      outputAssetIds: assets[index] ? [assets[index].assetId] : [],
      completedAt,
    }));
  }
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

function assertDomainExecutionContext(
  domain: DomainVideoExecutionContext,
  profile: VideoExecutionProfile,
): void {
  const request = domain.request;
  const authorization = domain.authorization;
  if (
    authorization.requestFingerprint !== request.requestFingerprint
    || authorization.generationPackageArtifactRevisionId
      !== request.generationPackageArtifactRevisionId
    || authorization.adapterId !== request.adapterId
    || authorization.connectionId !== request.connectionId
    || authorization.outputCount !== request.launchParameters.outputCount
  ) {
    throw new Error('Domain Video authorization does not match the final request.');
  }
  if (
    request.adapterId !== profile.adapterDefinition.adapterId
    || request.adapterVersion !== profile.adapterDefinition.version
    || request.adapterDefinitionHash !== profile.adapterDefinition.definitionHash
  ) {
    throw new Error('Domain Video Adapter lock does not match the selected execution profile.');
  }
  const local = profile.adapterDefinition.routeKind === 'local';
  if (
    local
      ? authorization.kind !== 'not_required_no_external_action'
        || authorization.action !== 'local_execute'
      : authorization.kind !== 'explicit_user_submit'
        || authorization.action !== 'provider_submit'
  ) {
    throw new Error('Domain Video authorization kind does not match the Adapter route.');
  }
}

function domainVideoInputBindings(
  domain: DomainVideoExecutionContext,
): CapabilityInputBinding[] {
  return [
    {
      slotId: 'generation_package',
      values: [{
        kind: 'artifact_revision',
        artifactRevisionId: domain.request.generationPackageArtifactRevisionId,
        blockId: domain.generationPackageBlockId,
      }],
    },
    {
      slotId: 'references',
      values: domain.request.referenceBindings.map((binding) => ({
        kind: 'asset' as const,
        assetId: binding.assetId,
      })),
    },
  ];
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
    if (
      !block
      || (block.type !== 'image' && block.type !== 'video')
      || typeof block.data.assetId !== 'string'
    ) continue;
    const slotId = videoSlotForRole(edge.inputRole);
    const values = slotValues.get(slotId) ?? [];
    values.push(capabilityBindingValueForBlock(block));
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

function createDomainVideoTargetBlock(
  snapshot: BoardSnapshot,
  operationBlockId: string,
): BlockRecord {
  const operation = snapshot.blocks.find(
    (block) => block.blockId === operationBlockId && block.type === 'operation',
  );
  if (!operation) throw new Error(`Domain Video Operation not found: ${operationBlockId}`);
  const existingOutput = snapshot.edges
    .filter((edge) => edge.kind === 'execution_output' && edge.sourceBlockId === operationBlockId)
    .flatMap((edge) => {
      const block = snapshot.blocks.find(
        (candidate) => candidate.blockId === edge.targetBlockId && candidate.type === 'video',
      );
      return block ? [block] : [];
    })[0];
  if (existingOutput) return existingOutput;
  const createdAt = nowIso();
  const block: BlockRecord = {
    blockId: createId('block'),
    boardId: snapshot.board.boardId,
    type: 'video',
    layerId: operation.layerId,
    parentGroupId: operation.parentGroupId,
    position: {
      x: operation.position.x + operation.size.width + 90,
      y: operation.position.y,
    },
    size: { width: 320, height: 240 },
    zIndex: maxZIndex(snapshot.blocks) + 1,
    data: {
      title: 'Video result',
      body: 'Waiting for authorized Domain Video execution.',
    },
    createdAt,
    updatedAt: createdAt,
  };
  snapshot.blocks.push(block);
  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId: operationBlockId,
    targetBlockId: block.blockId,
    kind: 'execution_output',
  });
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
