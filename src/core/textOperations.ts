import { aiSdkTextAdapterDefinition, codexAppServerTextAdapterDefinition } from './capabilityRegistry';
import { connectedInputBlocks, promptTextFromInputs } from './capabilities';
import { createBlockRecord, maxZIndex, touchBoard } from './blockFactory';
import { recordExecutionConfiguration } from './executionConfiguration';
import type { ExecutionConnectionSummary } from './executionProviders';
import { createId, nowIso } from './id';
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
): { operationBlock: BlockRecord; promptBlock: BlockRecord; resultBlock: BlockRecord } {
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
  const resultBlock = createBlockRecord(snapshot, 'text');
  resultBlock.data = {
    ...resultBlock.data,
    title: input.resultTitle,
    body: '',
    placeholder: input.waitingBody,
    managedTextResult: true,
  };

  promptBlock.position = { x: 80, y: 80 };
  operationBlock.position = { x: promptBlock.position.x + promptBlock.size.width + 90, y: promptBlock.position.y };
  resultBlock.position = { x: operationBlock.position.x + operationBlock.size.width + 90, y: operationBlock.position.y };
  promptBlock.zIndex = maxZIndex(snapshot.blocks) + 1;
  operationBlock.zIndex = promptBlock.zIndex + 1;
  resultBlock.zIndex = operationBlock.zIndex + 1;
  snapshot.blocks.push(promptBlock, operationBlock, resultBlock);
  snapshot.edges.push(
    {
      edgeId: createId('edge'),
      sourceBlockId: promptBlock.blockId,
      targetBlockId: operationBlock.blockId,
      kind: 'execution_input',
    },
    {
      edgeId: createId('edge'),
      sourceBlockId: operationBlock.blockId,
      targetBlockId: resultBlock.blockId,
      kind: 'execution_output',
    },
  );
  touchBoard(snapshot);
  return { operationBlock, promptBlock, resultBlock };
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
  if (!operationBlock || operationBlock.data.capabilityId !== 'text.generate') {
    throw new Error(`Text generation operation not found: ${input.operationBlockId}`);
  }
  if (
    input.connection.status !== 'ready' ||
    !input.connection.supportedCapabilityIds.includes('text.generate') ||
    !isTextConnector(input.connection.connectorId)
  ) {
    throw new Error(`Connection cannot execute text.generate: ${input.connection.connectionId}`);
  }
  const promptBlock = connectedInputBlocks(snapshot, operationBlock.blockId).find((block) => block.type === 'text');
  const prompt = promptTextFromInputs(promptBlock ? [promptBlock] : []);
  if (!promptBlock || !prompt) throw new Error('Connect a non-empty Text Block before generating text.');

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
    body: '',
    placeholder: input.labels.waitingBody,
    managedTextResult: true,
    status: 'queued',
    operationBlockId: operationBlock.blockId,
    sourceExecutionId: executionId,
  };
  delete resultBlock.data.assetId;
  delete resultBlock.data.previewUrl;
  resultBlock.updatedAt = createdAt;

  operationBlock.data = {
    ...operationBlock.data,
    body: prompt,
    status: 'queued',
    adapter,
    agentHost: usesCodexAppServer ? 'codex' : undefined,
    triggerMode: usesCodexAppServer ? 'agent_bridge' : 'server_worker',
    capabilityId: 'text.generate',
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
    capabilityId: 'text.generate',
    adapter,
    status: 'queued',
    inputBlockIds: [promptBlock.blockId],
    outputBlockIds: [resultBlock.blockId],
    outputAssetIds: [],
    agentHost: usesCodexAppServer ? 'codex' : undefined,
    triggerMode: usesCodexAppServer ? 'agent_bridge' : 'server_worker',
    provider: input.connection.providerLabel,
    model: input.connection.modelId,
    connectionId: input.connection.connectionId,
    skillId: 'text.general_generation',
    prompt,
    params: {
      operationBlockId: operationBlock.blockId,
      maxOutputTokens: input.maxOutputTokens ?? 4_096,
    },
    ...(previousExecution ? { previousExecutionId: previousExecution.executionId } : {}),
    startedAt: createdAt,
  };
  recordExecutionConfiguration(snapshot, execution, operationBlock);
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
    block.type === 'text' &&
    block.data.managedTextResult === true &&
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
  const resultBlock = createBlockRecord(snapshot, 'text');
  resultBlock.position = {
    x: operationBlock.position.x + operationBlock.size.width + 90,
    y: operationBlock.position.y + previousResults * (resultBlock.size.height + 36),
  };
  resultBlock.zIndex = maxZIndex(snapshot.blocks) + 1;
  resultBlock.data = {
    ...resultBlock.data,
    title: labels.resultTitle,
    body: '',
    placeholder: labels.waitingBody,
    managedTextResult: true,
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

function isTextConnector(connectorId: string): boolean {
  return connectorId === 'anthropic-native' || connectorId === 'codex-app-server' || connectorId === 'google-native' || connectorId === 'openai-compatible';
}
