import { aiSdkTextAdapterDefinition, codexAppServerTextAdapterDefinition } from './capabilityRegistry';
import type { CapabilityInputBinding } from './capabilityContracts';
import { connectedInputBlocks, promptTextFromInputs } from './capabilities';
import { createBlockRecord, maxZIndex, touchBoard } from './blockFactory';
import { recordExecutionConfiguration } from './executionConfiguration';
import type { ExecutionConnectionSummary } from './executionProviders';
import { createId, nowIso } from './id';
import { capabilityForSkill, skillDefinitionFor, snapshotSkill } from './skillRegistry';
import type { BlockRecord, BoardHistoryEvent, BoardSnapshot, ExecutionRecord } from './types';

export interface TextGenerationLabels {
  operationTitle: string;
  promptPlaceholder: string;
  promptTitle: string;
  resultTitle: string;
  waitingBody: string;
}

export function createDraftTextGenerationOperation(
  snapshot: BoardSnapshot,
  input: TextGenerationLabels & { connectionId?: string },
): { operationBlock: BlockRecord; promptBlock: BlockRecord } {
  const usesCodexAppServer = input.connectionId === 'codex-app-server';
  const promptBlock = createBlockRecord(snapshot, 'text');
  promptBlock.data = {
    ...promptBlock.data,
    title: input.promptTitle,
    body: '',
    placeholder: input.promptPlaceholder,
    promptRole: 'operation_prompt',
  };
  const operationBlock = createBlockRecord(snapshot, 'operation');
  operationBlock.data = {
    title: input.operationTitle,
    body: input.promptPlaceholder,
    capabilityId: 'text.generate',
    adapter: usesCodexAppServer ? 'codex_app_server' : 'direct_api',
    ...(usesCodexAppServer ? { agentHost: 'codex' as const } : {}),
    triggerMode: usesCodexAppServer ? 'agent_bridge' : 'server_worker',
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
  };
  promptBlock.position = { x: 80, y: 80 };
  operationBlock.position = { x: promptBlock.position.x + promptBlock.size.width + 90, y: promptBlock.position.y };
  promptBlock.zIndex = maxZIndex(snapshot.blocks) + 1;
  operationBlock.zIndex = promptBlock.zIndex + 1;
  snapshot.blocks.push(promptBlock, operationBlock);
  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId: promptBlock.blockId,
    targetBlockId: operationBlock.blockId,
    kind: 'execution_input',
  });
  touchBoard(snapshot);
  return { operationBlock, promptBlock };
}

export function createDraftSkillOperation(
  snapshot: BoardSnapshot,
  input: TextGenerationLabels & {
    connectionId?: string;
    selectedBlockIds?: string[];
    skillId: string;
  },
): { operationBlock: BlockRecord; inputBlocks: BlockRecord[] } {
  const skill = skillDefinitionFor(input.skillId);
  const capabilityId = capabilityForSkill(skill);
  const selectedIds = new Set(input.selectedBlockIds ?? []);
  const selectedInputs = snapshot.blocks.filter((block) =>
    selectedIds.has(block.blockId) && (block.type === 'text' || block.type === 'document'),
  );
  const inputBlocks = selectedInputs.length > 0 ? selectedInputs : [createSkillInputBlock(snapshot, input)];
  const operationBlock = createBlockRecord(snapshot, 'operation');
  const usesCodexAppServer = input.connectionId === 'codex-app-server';
  operationBlock.data = {
    title: input.operationTitle,
    body: input.promptPlaceholder,
    capabilityId,
    skillId: skill.skillId,
    adapter: usesCodexAppServer ? 'codex_app_server' : 'direct_api',
    ...(usesCodexAppServer ? { agentHost: 'codex' as const } : {}),
    triggerMode: usesCodexAppServer ? 'agent_bridge' : 'server_worker',
    ...(input.connectionId ? { connectionId: input.connectionId } : {}),
  };
  const anchor = inputBlocks[0];
  operationBlock.position = {
    x: anchor.position.x + anchor.size.width + 90,
    y: anchor.position.y,
  };
  operationBlock.zIndex = Math.max(maxZIndex(snapshot.blocks), ...inputBlocks.map((block) => block.zIndex)) + 1;
  if (selectedInputs.length === 0) snapshot.blocks.push(...inputBlocks);
  snapshot.blocks.push(operationBlock);
  inputBlocks.forEach((block) => snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId: block.blockId,
    targetBlockId: operationBlock.blockId,
    kind: 'execution_input',
  }));
  touchBoard(snapshot);
  return { operationBlock, inputBlocks };
}

export function executeExistingTextGenerationOperation(
  snapshot: BoardSnapshot,
  input: {
    connection: ExecutionConnectionSummary;
    labels: Pick<TextGenerationLabels, 'resultTitle' | 'waitingBody'>;
    maxOutputTokens?: number;
    operationBlockId: string;
  },
): { execution: ExecutionRecord; operationBlock: BlockRecord; resultBlock: BlockRecord } {
  const operationBlock = snapshot.blocks.find(
    (block) => block.blockId === input.operationBlockId && block.type === 'operation',
  );
  const capabilityId = typeof operationBlock?.data.capabilityId === 'string' ? operationBlock.data.capabilityId : '';
  if (!operationBlock || !isTextDocumentCapability(capabilityId)) {
    throw new Error(`Text generation operation not found: ${input.operationBlockId}`);
  }
  if (
    input.connection.status !== 'ready' ||
    !input.connection.supportedCapabilityIds.includes(capabilityId) ||
    !isTextConnector(input.connection.connectorId)
  ) {
    throw new Error(`Connection cannot execute ${capabilityId}: ${input.connection.connectionId}`);
  }
  const inputBlocks = connectedInputBlocks(snapshot, operationBlock.blockId).filter(
    (block) => block.type === 'text' || block.type === 'document',
  );
  const promptBlock = inputBlocks[0];
  const prompt = promptTextFromInputs(inputBlocks.filter((block) => block.type === 'text'))
    || (promptBlock?.type === 'document' ? promptBlock.data.title : '');
  if (!promptBlock || !prompt || (promptBlock.type === 'document' && typeof promptBlock.data.assetId !== 'string')) {
    throw new Error('Connect a non-empty Text or Document Block before generating a screenplay.');
  }

  const executionId = createId('exec');
  const createdAt = nowIso();
  const usesCodexAppServer = input.connection.connectorId === 'codex-app-server';
  const adapter = usesCodexAppServer ? 'codex_app_server' : 'direct_api';
  const resultBlock = reusableDraftResult(snapshot, operationBlock) ?? createResultBlock(
    snapshot,
    operationBlock,
    input.labels,
    executionId,
    createdAt,
  );
  resultBlock.data = {
    ...resultBlock.data,
    title: input.labels.resultTitle,
    placeholder: input.labels.waitingBody,
    managedDocumentResult: true,
    status: 'queued',
    operationBlockId: operationBlock.blockId,
    sourceExecutionId: executionId,
  };
  delete resultBlock.data.assetId;
  delete resultBlock.data.previewUrl;
  delete resultBlock.data.documentExcerpt;
  delete resultBlock.data.documentOutline;
  resultBlock.data.documentCharacterCount = 0;
  resultBlock.updatedAt = createdAt;

  operationBlock.data = {
    ...operationBlock.data,
    body: prompt,
    status: 'queued',
    adapter,
    agentHost: usesCodexAppServer ? 'codex' : undefined,
    triggerMode: usesCodexAppServer ? 'agent_bridge' : 'server_worker',
    capabilityId,
    connectionId: input.connection.connectionId,
    sourceExecutionId: executionId,
  };
  operationBlock.updatedAt = createdAt;

  const previousExecution = snapshot.executions.find((candidate) =>
    candidate.params?.operationBlockId === operationBlock.blockId,
  );
  const execution: ExecutionRecord = {
    executionId,
    projectId: snapshot.project.projectId,
    boardId: snapshot.board.boardId,
    capabilityId,
    adapter,
    status: 'queued',
    inputBlockIds: inputBlocks.map((block) => block.blockId),
    outputBlockIds: [resultBlock.blockId],
    outputAssetIds: [],
    agentHost: usesCodexAppServer ? 'codex' : undefined,
    triggerMode: usesCodexAppServer ? 'agent_bridge' : 'server_worker',
    provider: input.connection.providerLabel,
    model: input.connection.modelId,
    connectionId: input.connection.connectionId,
    skillId: typeof operationBlock.data.skillId === 'string' ? operationBlock.data.skillId : undefined,
    prompt,
    params: {
      operationBlockId: operationBlock.blockId,
      maxOutputTokens: input.maxOutputTokens ?? 4_096,
    },
    ...(previousExecution ? { previousExecutionId: previousExecution.executionId } : {}),
    startedAt: createdAt,
  };
  recordExecutionConfiguration(snapshot, execution, operationBlock);
  if (execution.skillId) {
    const skill = skillDefinitionFor(execution.skillId);
    const bindings = screenplayInputBindings(capabilityId, inputBlocks);
    execution.inputBindingsSnapshot = bindings;
    execution.skillSnapshot = snapshotSkill(skill, bindings);
  }
  const adapterDefinition = usesCodexAppServer ? codexAppServerTextAdapterDefinition : aiSdkTextAdapterDefinition;
  execution.adapterSnapshot = {
    adapterId: adapterDefinition.adapterId,
    version: adapterDefinition.version,
    definitionHash: adapterDefinition.definitionHash,
    adapterClass: adapterDefinition.adapterClass,
    routeKind: adapterDefinition.routeKind,
    provider: input.connection.providerLabel,
    model: input.connection.modelId,
  };
  snapshot.executions.unshift(execution);
  snapshot.historyEvents = [operationHistory(execution, operationBlock, promptBlock, resultBlock), ...(snapshot.historyEvents ?? [])].slice(0, 200);
  touchBoard(snapshot);
  return { execution, operationBlock, resultBlock };
}

function reusableDraftResult(snapshot: BoardSnapshot, operationBlock: BlockRecord): BlockRecord | undefined {
  const outputBlockIds = snapshot.edges
    .filter((edge) => edge.sourceBlockId === operationBlock.blockId && edge.kind === 'execution_output')
    .map((edge) => edge.targetBlockId);
  return snapshot.blocks.find((block) =>
    outputBlockIds.includes(block.blockId) &&
    block.type === 'document' &&
    block.data.managedDocumentResult === true &&
    typeof block.data.sourceExecutionId !== 'string' &&
    typeof block.data.assetId !== 'string');
}

function createResultBlock(
  snapshot: BoardSnapshot,
  operationBlock: BlockRecord,
  labels: Pick<TextGenerationLabels, 'resultTitle' | 'waitingBody'>,
  executionId: string,
  createdAt: string,
): BlockRecord {
  const previousResults = snapshot.edges.filter(
    (edge) => edge.sourceBlockId === operationBlock.blockId && edge.kind === 'execution_output',
  ).length;
  const resultBlock = createBlockRecord(snapshot, 'document');
  resultBlock.position = {
    x: operationBlock.position.x + operationBlock.size.width + 90,
    y: operationBlock.position.y + previousResults * (resultBlock.size.height + 36),
  };
  resultBlock.zIndex = maxZIndex(snapshot.blocks) + 1;
  resultBlock.data = {
    ...resultBlock.data,
    title: labels.resultTitle,
    placeholder: labels.waitingBody,
    managedDocumentResult: true,
    status: 'queued',
    operationBlockId: operationBlock.blockId,
    sourceExecutionId: executionId,
  };
  resultBlock.createdAt = createdAt;
  resultBlock.updatedAt = createdAt;
  snapshot.blocks.push(resultBlock);
  snapshot.edges.push({
    edgeId: createId('edge'),
    sourceBlockId: operationBlock.blockId,
    targetBlockId: resultBlock.blockId,
    kind: 'execution_output',
  });
  return resultBlock;
}

function operationHistory(
  execution: ExecutionRecord,
  operationBlock: BlockRecord,
  promptBlock: BlockRecord,
  resultBlock: BlockRecord,
): BoardHistoryEvent {
  return {
    eventId: createId('history'),
    type: 'operation_created',
    createdAt: execution.startedAt,
    actor: 'user',
    executionId: execution.executionId,
    blockIds: [promptBlock.blockId, operationBlock.blockId, resultBlock.blockId],
    summary: operationBlock.data.title,
    detail: {
      capabilityId: execution.capabilityId,
      connectionId: execution.connectionId,
      prompt: execution.prompt,
      resultBlockIds: [resultBlock.blockId],
    },
  };
}

function createSkillInputBlock(snapshot: BoardSnapshot, input: TextGenerationLabels): BlockRecord {
  const promptBlock = createBlockRecord(snapshot, 'text');
  promptBlock.data = {
    ...promptBlock.data,
    title: input.promptTitle,
    body: '',
    placeholder: input.promptPlaceholder,
  };
  promptBlock.position = { x: 80, y: 80 };
  promptBlock.zIndex = maxZIndex(snapshot.blocks) + 1;
  return promptBlock;
}

function screenplayInputBindings(capabilityId: string, blocks: BlockRecord[]): CapabilityInputBinding[] {
  const values = blocks.map((block) => typeof block.data.assetId === 'string'
    ? { kind: 'asset' as const, assetId: block.data.assetId, blockId: block.blockId }
    : { kind: 'block' as const, blockId: block.blockId });
  if (capabilityId === 'story.screenplay.generate') {
    return [
      { slotId: 'brief', values: values.slice(0, 1) },
      ...(values.length > 1 ? [{ slotId: 'references', values: values.slice(1) }] : []),
    ];
  }
  if (capabilityId === 'story.screenplay.normalize') {
    return [
      { slotId: 'source_screenplay', values: values.slice(0, 1) },
      ...(values.length > 1 ? [{ slotId: 'normalization_instruction', values: values.slice(1, 2) }] : []),
    ];
  }
  return [{ slotId: 'prompt', values }];
}

export function isTextDocumentCapability(capabilityId: string): boolean {
  return capabilityId === 'text.generate'
    || capabilityId === 'story.screenplay.generate'
    || capabilityId === 'story.screenplay.normalize';
}

function isTextConnector(connectorId: string): boolean {
  return connectorId === 'anthropic-native' || connectorId === 'codex-app-server' || connectorId === 'google-native' || connectorId === 'openai-compatible';
}
