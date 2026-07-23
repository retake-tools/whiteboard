import {
  assetIdsForBindingValue,
  capabilityBindingValueForBlock,
} from './artifactLibrary';
import {
  capabilityDefinitionFor,
  codexAppServerImageAdapterDefinition,
} from './capabilityRegistry';
import type { CapabilityInputBinding } from './capabilityContracts';
import { createBlockRecord, maxZIndex, touchBoard } from './blockFactory';
import { recordExecutionConfiguration } from './executionConfiguration';
import type { ExecutionConnectionSummary } from './executionProviders';
import { createExecutionResultGroup, expandGroupToContents } from './grouping';
import { createId, nowIso } from './id';
import type { PackageInvocationContext } from './packageContracts';
import {
  skillDefinitionFor,
  snapshotSkill,
} from './skillRegistry';
import {
  normalizeStoryboardSheetGenerationParameters,
  normalizeStoryboardUnitId,
  StoryboardSheetContractError,
  storyboardSheetCapabilityId,
  storyboardSheetSkillId,
  type StoryboardSheetGenerationParameters,
} from './storyboardSheetContracts';
import type { SkillDraftInputBinding, TextGenerationLabels } from './textOperations';
import type {
  BlockRecord,
  BoardHistoryEvent,
  BoardSnapshot,
  ExecutionRecord,
} from './types';
import { attachWorkflowExecution } from './workflowRuntime';

export interface StoryboardSheetDraftInput {
  connectionId?: string;
  explicitInputBindings?: SkillDraftInputBinding[];
  labels: TextGenerationLabels;
  packageContext?: PackageInvocationContext;
  parameters?: Record<string, unknown>;
  selectedBlockIds?: string[];
  unitId?: string;
}

export function createDraftStoryboardSheetOperation(
  snapshot: BoardSnapshot,
  input: StoryboardSheetDraftInput,
): { inputBlocks: BlockRecord[]; operationBlock: BlockRecord } {
  const selected = new Set(input.selectedBlockIds ?? []);
  const assignedSlots = new Map<string, string>();
  const createdBlocks: BlockRecord[] = [];
  const inputBlocks: BlockRecord[] = [];

  for (const binding of input.explicitInputBindings ?? []) {
    const block = binding.kind === 'block'
      ? snapshot.blocks.find((candidate) => candidate.blockId === binding.blockId)
      : projectAssetInput(snapshot, binding.assetId, binding.inputSlotId, input.labels, createdBlocks.length);
    if (!block || (block.type !== 'document' && block.type !== 'image')) {
      throw new Error(`Storyboard Sheet input is incompatible: ${binding.kind === 'block' ? binding.blockId : binding.assetId}`);
    }
    if (binding.kind === 'asset') createdBlocks.push(block);
    inputBlocks.push(block);
    assignedSlots.set(block.blockId, binding.inputSlotId);
  }

  for (const block of snapshot.blocks) {
    if (!selected.has(block.blockId) || (block.type !== 'document' && block.type !== 'image')) continue;
    if (!inputBlocks.includes(block)) inputBlocks.push(block);
    assignedSlots.set(block.blockId, block.type === 'document' ? 'storyboard_plan' : 'references');
  }

  if (!inputBlocks.some((block) => assignedSlots.get(block.blockId) === 'storyboard_plan')) {
    const placeholder = createBlockRecord(snapshot, 'document');
    placeholder.data = {
      ...placeholder.data,
      title: input.labels.inputSlots?.find((slot) => slot.slotId === 'storyboard_plan')?.promptTitle
        ?? input.labels.promptTitle,
      documentKind: 'storyboard_plan',
      placeholder: input.labels.inputSlots?.find((slot) => slot.slotId === 'storyboard_plan')?.promptPlaceholder
        ?? input.labels.promptPlaceholder,
    };
    placeholder.position = { x: 80, y: 80 };
    placeholder.zIndex = maxZIndex(snapshot.blocks) + createdBlocks.length + 1;
    createdBlocks.push(placeholder);
    inputBlocks.unshift(placeholder);
    assignedSlots.set(placeholder.blockId, 'storyboard_plan');
  }

  const parameters = normalizeStoryboardSheetGenerationParameters(input.parameters);
  const operationBlock = createBlockRecord(snapshot, 'operation');
  const usesCodexAppServer = input.connectionId === 'codex-app-server';
  operationBlock.data = {
    ...operationBlock.data,
    title: input.unitId
      ? `${input.labels.operationTitle} · ${input.unitId.trim()}`
      : input.labels.operationTitle,
    body: input.labels.promptPlaceholder,
    capabilityId: storyboardSheetCapabilityId,
    skillId: storyboardSheetSkillId,
    operationMode: 'text_to_image',
    adapter: usesCodexAppServer ? 'codex_app_server' : 'mcp_agent',
    agentHost: 'codex',
    triggerMode: usesCodexAppServer ? 'agent_bridge' : 'manual_agent_session',
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
    ...(input.packageContext ? packageInvocationMetadata(input.packageContext) : {}),
    storyboardUnitId: input.unitId?.trim() ?? '',
    storyboardReferenceCount: inputBlocks.filter(
      (block) => assignedSlots.get(block.blockId) === 'references',
    ).length,
    storyboardSheetParameters: parameters,
    generationParams: generationParams(parameters),
    workflowParameters: parameters,
  };
  const anchor = inputBlocks[0];
  operationBlock.position = {
    x: Math.max(...inputBlocks.map((block) => block.position.x + block.size.width)) + 90,
    y: anchor?.position.y ?? 80,
  };
  operationBlock.zIndex = Math.max(maxZIndex(snapshot.blocks), ...inputBlocks.map((block) => block.zIndex)) + 1;
  snapshot.blocks.push(...createdBlocks, operationBlock);
  for (const block of inputBlocks) {
    snapshot.edges.push({
      edgeId: createId('edge'),
      sourceBlockId: block.blockId,
      targetBlockId: operationBlock.blockId,
      kind: 'execution_input',
      inputSlotId: assignedSlots.get(block.blockId),
    });
  }
  touchBoard(snapshot);
  return { inputBlocks, operationBlock };
}

export function executeExistingStoryboardSheetOperation(
  snapshot: BoardSnapshot,
  input: {
    connection: ExecutionConnectionSummary;
    operationBlockId: string;
  },
): {
  execution: ExecutionRecord;
  operationBlock: BlockRecord;
  resultBlocks: BlockRecord[];
} {
  const operationBlock = snapshot.blocks.find(
    (block) => block.blockId === input.operationBlockId && block.type === 'operation',
  );
  if (!operationBlock || operationBlock.data.capabilityId !== storyboardSheetCapabilityId) {
    throw new Error(`Storyboard Sheet operation not found: ${input.operationBlockId}`);
  }
  if (
    input.connection.connectorId !== 'codex-app-server'
    || input.connection.status !== 'ready'
    || !input.connection.supportedCapabilityIds.includes(storyboardSheetCapabilityId)
  ) {
    throw new StoryboardSheetContractError(
      'storyboard_adapter_unavailable',
      `Connection cannot execute ${storyboardSheetCapabilityId}: ${input.connection.connectionId}`,
    );
  }

  const unitId = normalizeStoryboardUnitId(operationBlock.data.storyboardUnitId);
  const parameters = normalizeStoryboardSheetGenerationParameters(
    objectValue(operationBlock.data.storyboardSheetParameters),
  );
  const inputEdges = snapshot.edges.filter(
    (edge) => edge.kind === 'execution_input' && edge.targetBlockId === operationBlock.blockId,
  );
  const inputBlockById = new Map(snapshot.blocks.map((block) => [block.blockId, block]));
  const planBlocks = inputEdges
    .filter((edge) => edge.inputSlotId === 'storyboard_plan')
    .flatMap((edge) => {
      const block = inputBlockById.get(edge.sourceBlockId);
      return block?.type === 'document' ? [block] : [];
    });
  if (planBlocks.length !== 1 || typeof planBlocks[0]?.data.assetId !== 'string') {
    throw new StoryboardSheetContractError(
      'storyboard_plan_missing',
      'Connect exactly one asset-backed Storyboard Plan before generating a sheet.',
    );
  }
  const referenceBlocks = inputEdges
    .filter((edge) => edge.inputSlotId === 'references')
    .flatMap((edge) => {
      const block = inputBlockById.get(edge.sourceBlockId);
      return block?.type === 'image' && typeof block.data.assetId === 'string' ? [block] : [];
    });
  const bindings: CapabilityInputBinding[] = [
    {
      slotId: 'storyboard_plan',
      values: [capabilityBindingValueForBlock(planBlocks[0])],
    },
    {
      slotId: 'unit_id',
      values: [{ kind: 'inline', value: unitId }],
    },
    ...(referenceBlocks.length > 0 ? [{
      slotId: 'references',
      values: referenceBlocks.map(capabilityBindingValueForBlock),
    }] : []),
  ];

  const createdAt = nowIso();
  const executionId = createId('exec');
  const resultBlocks = reusableOrCreateResultBlocks(
    snapshot,
    operationBlock,
    parameters.outputCount,
    executionId,
    createdAt,
    unitId,
  );
  const prompt = storyboardSheetPrompt(unitId, parameters);
  operationBlock.data = {
    ...operationBlock.data,
    title: `Generate storyboard sheet · ${unitId}`,
    body: prompt,
    status: 'queued',
    adapter: 'codex_app_server',
    agentHost: 'codex',
    triggerMode: 'agent_bridge',
    connectionId: input.connection.connectionId,
    sourceExecutionId: executionId,
    storyboardUnitId: unitId,
    storyboardReferenceCount: referenceBlocks.length,
    storyboardSheetParameters: parameters,
    generationParams: generationParams(parameters),
  };
  operationBlock.updatedAt = createdAt;

  const definition = capabilityDefinitionFor(storyboardSheetCapabilityId);
  const skill = skillDefinitionFor(storyboardSheetSkillId);
  const execution: ExecutionRecord = {
    executionId,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId: storyboardSheetCapabilityId,
    adapter: 'codex_app_server',
    status: 'queued',
    inputBlockIds: [...planBlocks, ...referenceBlocks].map((block) => block.blockId),
    inputAssetIds: [...new Set(bindings.flatMap((binding) =>
      binding.values.flatMap((value) => assetIdsForBindingValue(snapshot, value)),
    ))],
    outputBlockIds: resultBlocks.map((block) => block.blockId),
    outputAssetIds: [],
    agentHost: 'codex',
    triggerMode: 'agent_bridge',
    provider: input.connection.providerLabel,
    model: input.connection.modelId,
    connectionId: input.connection.connectionId,
    skillId: storyboardSheetSkillId,
    prompt,
    params: {
      generation: generationParams(parameters),
      operationBlockId: operationBlock.blockId,
      referenceAssetIds: referenceBlocks.map((block) => String(block.data.assetId)),
      storyboardReferences: referenceBlocks.map((block, index) => ({
        artifactType: typeof block.data.artifactType === 'string'
          ? block.data.artifactType
          : 'bound_image_reference',
        assetId: String(block.data.assetId),
        order: index + 1,
        title: block.data.title,
      })),
      storyboardSheet: parameters,
      unitId,
    },
    capabilityLock: {
      capabilityId: definition.capabilityId,
      definitionHash: definition.definitionHash,
      version: definition.version,
    },
    skillSnapshot: snapshotSkill(skill, bindings),
    inputBindingsSnapshot: structuredClone(bindings),
    outputSlotResults: [{ slotId: 'storyboard_sheet', assetIds: [] }],
    adapterSnapshot: {
      adapterId: codexAppServerImageAdapterDefinition.adapterId,
      version: codexAppServerImageAdapterDefinition.version,
      definitionHash: codexAppServerImageAdapterDefinition.definitionHash,
      adapterClass: codexAppServerImageAdapterDefinition.adapterClass,
      routeKind: codexAppServerImageAdapterDefinition.routeKind,
      provider: input.connection.providerLabel,
      model: input.connection.modelId,
    },
    startedAt: createdAt,
  };
  recordExecutionConfiguration(snapshot, execution, operationBlock);
  execution.inputBindingsSnapshot = structuredClone(bindings);
  execution.skillSnapshot = snapshotSkill(skill, bindings);
  attachWorkflowExecution(snapshot, operationBlock, execution);
  snapshot.executions.unshift(execution);
  snapshot.historyEvents = [
    storyboardSheetHistory(execution, operationBlock, resultBlocks, unitId),
    ...(snapshot.historyEvents ?? []),
  ].slice(0, 200);
  createExecutionResultGroup(snapshot, { executionId, operationBlock, resultBlocks });
  if (operationBlock.parentGroupId) expandGroupToContents(snapshot, operationBlock.parentGroupId);
  touchBoard(snapshot);
  return { execution, operationBlock, resultBlocks };
}

function reusableOrCreateResultBlocks(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  count: number,
  executionId: string,
  createdAt: string,
  unitId: string,
): BlockRecord[] {
  const existing = snapshot.edges
    .filter((edge) => edge.kind === 'execution_output' && edge.sourceBlockId === operationBlock.blockId)
    .flatMap((edge) => {
      const block = snapshot.blocks.find((candidate) => candidate.blockId === edge.targetBlockId);
      return block?.type === 'image' && typeof block.data.assetId !== 'string' ? [block] : [];
    });
  const resultBlocks = existing.slice(0, count);
  while (resultBlocks.length < count) {
    const block = createBlockRecord(snapshot, 'image');
    snapshot.blocks.push(block);
    snapshot.edges.push({
      edgeId: createId('edge'),
      sourceBlockId: operationBlock.blockId,
      targetBlockId: block.blockId,
      kind: 'execution_output',
    });
    resultBlocks.push(block);
  }
  resultBlocks.forEach((block, index) => {
    block.parentGroupId = operationBlock.parentGroupId;
    block.position = {
      x: operationBlock.position.x + operationBlock.size.width + 90,
      y: operationBlock.position.y + index * (block.size.height + 28),
    };
    block.zIndex = maxZIndex(snapshot.blocks) + index + 1;
    block.data = {
      ...block.data,
      title: count > 1
        ? `Storyboard sheet · ${unitId} · same-unit candidate ${index + 1}/${count}`
        : `Storyboard sheet · ${unitId}`,
      body: 'Waiting for storyboard-sheet generation.',
      status: 'queued',
      operationBlockId: operationBlock.blockId,
      sourceExecutionId: executionId,
      storyboardUnitId: unitId,
      workflowOutputSlotId: 'storyboard_sheet',
    };
    delete block.data.assetId;
    delete block.data.previewUrl;
    block.updatedAt = createdAt;
  });
  return resultBlocks;
}

function storyboardSheetPrompt(
  unitId: string,
  parameters: StoryboardSheetGenerationParameters,
): string {
  const skill = skillDefinitionFor(storyboardSheetSkillId);
  return `${skill.instructionTemplate}

Locked unit ID: ${unitId}
Locked layout: ${parameters.panelCount} panels in ${parameters.gridLayout}; each panel ${parameters.panelAspectRatio}.
Render mode: ${parameters.renderMode}.
Generate ${parameters.outputCount} same-unit candidate${parameters.outputCount === 1 ? '' : 's'} for this request.`;
}

function generationParams(parameters: StoryboardSheetGenerationParameters): Record<string, unknown> {
  return {
    aspectRatioPreset: '16:9',
    variationCount: parameters.outputCount,
    storyboardSheet: parameters,
  };
}

function projectAssetInput(
  snapshot: BoardSnapshot,
  assetId: string,
  slotId: string,
  labels: TextGenerationLabels,
  index: number,
): BlockRecord {
  const asset = snapshot.assets.find((candidate) => candidate.assetId === assetId);
  if (!asset || (asset.kind !== 'document' && asset.kind !== 'image')) {
    throw new Error(`Storyboard Sheet Asset not found: ${assetId}`);
  }
  const block = createBlockRecord(snapshot, asset.kind);
  const slotLabels = labels.inputSlots?.find((candidate) => candidate.slotId === slotId);
  block.data = {
    ...block.data,
    title: slotLabels?.promptTitle ?? labels.promptTitle,
    assetId,
    composerSourceAssetId: assetId,
    ...(asset.kind === 'document'
      ? { documentKind: slotId === 'storyboard_plan' ? 'storyboard_plan' : 'markdown_document' }
      : { previewUrl: asset.previewUrl }),
  };
  block.position = { x: 80, y: 80 + index * (block.size.height + 36) };
  block.zIndex = maxZIndex(snapshot.blocks) + index + 1;
  return block;
}

function packageInvocationMetadata(context: PackageInvocationContext): Partial<BlockRecord['data']> {
  return {
    packageId: context.packageLock.packageId,
    packageVersion: context.packageLock.version,
    packageDigest: context.packageLock.digest,
    packageEntryPointId: context.entrypointId,
  };
}

function storyboardSheetHistory(
  execution: ExecutionRecord,
  operationBlock: BlockRecord,
  resultBlocks: BlockRecord[],
  unitId: string,
): BoardHistoryEvent {
  return {
    eventId: createId('history'),
    type: 'operation_created',
    createdAt: execution.startedAt,
    actor: 'user',
    executionId: execution.executionId,
    blockIds: [...execution.inputBlockIds, operationBlock.blockId, ...resultBlocks.map((block) => block.blockId)],
    assetIds: execution.inputAssetIds,
    summary: `Generate storyboard sheet · ${unitId}`,
    detail: {
      capabilityId: storyboardSheetCapabilityId,
      unitId,
    },
  };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
