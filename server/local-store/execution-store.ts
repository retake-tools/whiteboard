import { randomUUID } from 'node:crypto';
import { assignExecutionVersion } from '../../src/core/executionConfiguration';
import { syncExecutionOutputContractSnapshot } from '../../src/core/executionContractSnapshot';
import type {
  AssetRecord,
  BlockRecord,
  BoardSnapshot,
  ExecutionRecord,
  ExecutionRequestPrompt,
} from '../../src/core/types';
import { touchSnapshot } from './context';
import { readAssetMetadata } from './asset-files';
import { summarizeMarkdown } from '../../src/core/markdownDocument';
import { listProjectBoards, loadSnapshot, saveSnapshot } from './snapshot-store';
import { materializeWorkflowOutputArtifacts } from '../workflow-output-artifact-service';

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
  appendHistoryEvent(snapshot, { type: 'execution_started', actor: 'codex', execution, summary: `Execution started: ${execution.capabilityId}` });
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return execution;
}

export async function getExecution(input: { projectId: string; boardId: string; executionId: string }): Promise<ExecutionRecord> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  return findExecutionOrThrow(snapshot, input.executionId);
}

export async function markExecutionRunning(input: { projectId: string; boardId: string; executionId: string }): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = findExecutionOrThrow(snapshot, input.executionId);
  if (execution.status === 'canceled') throw new Error(`Cannot start a canceled execution: ${input.executionId}`);
  if (execution.status === 'succeeded') throw new Error(`Cannot start a completed execution: ${input.executionId}`);
  const resumedFromFailure = execution.status === 'failed';
  const incompleteResultBlockIds = incompleteExecutionResultBlockIds(snapshot, execution);
  if (resumedFromFailure && execution.adapter !== 'mcp_agent') {
    throw new Error(`Failed ${execution.adapter} execution must be retried by its execution adapter: ${input.executionId}`);
  }
  if (resumedFromFailure && incompleteResultBlockIds.length === 0) {
    throw new Error(`Cannot resume failed execution without incomplete result blocks: ${input.executionId}`);
  }
  if (execution.status === 'running') return { snapshot, execution };

  assignExecutionVersion(snapshot, execution);
  execution.status = 'running';
  delete execution.completedAt;
  delete execution.errorMessage;
  syncExecutionBlocks(snapshot, execution);
  appendHistoryEvent(snapshot, {
    type: 'execution_started',
    actor: 'codex',
    execution,
    summary: resumedFromFailure ? `Execution resumed: ${execution.capabilityId}` : `Execution started: ${execution.capabilityId}`,
    detail: resumedFromFailure ? { resumedFromStatus: 'failed', retriedResultBlockIds: incompleteResultBlockIds } : undefined,
  });
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return { snapshot, execution };
}

export async function markExecutionAdapterRetryRunning(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  resultBlockId: string;
  adapter: Extract<ExecutionRecord['adapter'], 'codex_app_server' | 'direct_api'>;
}): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = findExecutionOrThrow(snapshot, input.executionId);
  if (execution.status !== 'failed' || execution.adapter !== input.adapter) {
    throw new Error(`Failed ${input.adapter} execution not found for retry: ${input.executionId}`);
  }
  if (!execution.outputBlockIds.includes(input.resultBlockId)) {
    throw new Error(`Result block is not assigned to execution ${input.executionId}: ${input.resultBlockId}`);
  }
  const resultBlock = snapshot.blocks.find((block) => block.blockId === input.resultBlockId);
  if (resultBlock?.type !== 'image' || typeof resultBlock.data.assetId === 'string') {
    throw new Error(`Image result is not available for retry: ${input.resultBlockId}`);
  }

  execution.status = 'running';
  delete execution.completedAt;
  delete execution.errorMessage;
  syncExecutionBlocks(snapshot, execution);
  appendHistoryEvent(snapshot, {
    type: 'execution_started',
    actor: 'codex',
    execution,
    summary: `Execution result retried: ${execution.capabilityId}`,
    detail: { resumedFromStatus: 'failed', retriedResultBlockIds: [input.resultBlockId] },
  });
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return { snapshot, execution };
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
  assertExecutionNotCanceled(execution, 'complete');
  execution.status = 'succeeded';
  execution.outputBlockIds = mergeUnique(execution.outputBlockIds, input.outputBlockIds ?? []);
  execution.outputAssetIds = mergeUnique(execution.outputAssetIds, input.outputAssetIds ?? []);
  syncExecutionOutputContractSnapshot(execution);
  execution.completedAt = new Date().toISOString();
  delete execution.errorMessage;
  markExecutionBlocks(snapshot, input.executionId, 'succeeded');
  appendHistoryEvent(snapshot, { type: 'execution_succeeded', actor: 'codex', execution, summary: `Execution succeeded: ${execution.capabilityId}` });
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  const persisted = await materializeCompletedWorkflowExecution(snapshot, execution);
  return {
    snapshot: persisted,
    execution: findExecutionOrThrow(persisted, input.executionId),
  };
}

export async function failExecution(input: { projectId: string; boardId: string; executionId: string; errorMessage: string }): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = findExecutionOrThrow(snapshot, input.executionId);
  assertExecutionNotCanceled(execution, 'fail');
  const failedResultBlockIds = incompleteExecutionResultBlockIds(snapshot, execution);
  execution.status = 'failed';
  execution.completedAt = new Date().toISOString();
  execution.errorMessage = input.errorMessage;
  const succeeded = execution.outputBlockIds.length - failedResultBlockIds.length;
  execution.resultSummary = {
    requested: execution.outputBlockIds.length,
    succeeded,
    failed: failedResultBlockIds.length,
  };
  syncExecutionOutputContractSnapshot(execution);
  syncExecutionBlocks(snapshot, execution);
  appendHistoryEvent(snapshot, {
    type: 'execution_failed',
    actor: 'codex',
    execution,
    summary: `Execution failed: ${execution.capabilityId}`,
    detail: { errorMessage: input.errorMessage, failedResultBlockIds },
  });
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return { snapshot, execution };
}

export async function recordExecutionRequestPrompts(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  requestPrompts: ExecutionRequestPrompt[];
}): Promise<{ snapshot: BoardSnapshot; execution: ExecutionRecord }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = findExecutionOrThrow(snapshot, input.executionId);
  assertExecutionRunning(execution, 'record request prompts for');
  const promptsByIndex = new Map(
    execution.requestPrompts?.map((requestPrompt) => [requestPrompt.index, requestPrompt]) ?? [],
  );
  for (const requestPrompt of input.requestPrompts) promptsByIndex.set(requestPrompt.index, requestPrompt);
  execution.requestPrompts = structuredClone([...promptsByIndex.values()].sort((left, right) => left.index - right.index));
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  return { snapshot, execution };
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
  return updateMediaResultBlock({ ...input, blockType: 'image' });
}

export async function updateVideoResultBlock(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  assetId: string;
  resultBlockId?: string;
  title?: string;
  body?: string;
}): Promise<{ snapshot: BoardSnapshot; block: BlockRecord; execution: ExecutionRecord }> {
  return updateMediaResultBlock({ ...input, blockType: 'video' });
}

export async function updateDocumentResultBlock(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  assetId: string;
  markdown: string;
  documentKind?: string;
  resultBlockId?: string;
  title?: string;
}): Promise<{ snapshot: BoardSnapshot; block: BlockRecord; execution: ExecutionRecord }> {
  const summary = summarizeMarkdown(input.markdown, input.title?.trim() || 'Generated document');
  return updateMediaResultBlock({
    ...input,
    title: summary.title,
    blockType: 'document',
    data: {
      contentFormat: 'markdown',
      documentCharacterCount: summary.characterCount,
      documentExcerpt: summary.excerpt,
      documentKind: input.documentKind ?? 'general',
      documentOutline: summary.outline,
    },
  });
}

async function updateMediaResultBlock(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  assetId: string;
  resultBlockId?: string;
  title?: string;
  body?: string;
  blockType: 'document' | 'image' | 'video';
  data?: Partial<BlockRecord['data']>;
}): Promise<{ snapshot: BoardSnapshot; block: BlockRecord; execution: ExecutionRecord }> {
  const snapshot = await loadSnapshot(input.projectId, input.boardId);
  const execution = findExecutionOrThrow(snapshot, input.executionId);
  assertExecutionRunning(execution, 'update a result for');
  const asset = await readAssetMetadata(input.projectId, input.assetId);
  if (!snapshot.assets.some((candidate) => candidate.assetId === asset.assetId)) snapshot.assets.unshift(asset);
  const resultBlockId = input.resultBlockId ?? execution.outputBlockIds[0];
  if (!resultBlockId || !execution.outputBlockIds.includes(resultBlockId)) {
    throw new Error(`Result block is not assigned to execution ${input.executionId}: ${resultBlockId ?? 'missing'}`);
  }
  const block = snapshot.blocks.find((candidate) => candidate.blockId === resultBlockId);
  if (!block || block.type !== input.blockType) {
    const label = input.blockType === 'image' ? 'Image' : input.blockType === 'video' ? 'Video' : 'Document';
    throw new Error(`${label} result block not found: ${resultBlockId ?? 'missing'}`);
  }

  const now = new Date().toISOString();
  block.data = {
    ...block.data,
    title: input.title?.trim() || block.data.title,
    body: input.body ?? block.data.body,
    assetId: asset.assetId,
    previewUrl: asset.previewUrl,
    status: 'succeeded',
    sourceExecutionId: input.executionId,
    ...input.data,
  };
  block.updatedAt = now;
  const wasSucceeded = execution.status === 'succeeded';
  execution.outputAssetIds = mergeUnique(execution.outputAssetIds, [input.assetId]);
  execution.outputBlockIds = mergeUnique(execution.outputBlockIds, [block.blockId]);
  syncExecutionOutputContractSnapshot(execution);
  const allOutputsComplete = execution.outputBlockIds.every((outputBlockId) => {
    const outputBlock = snapshot.blocks.find((candidate) => candidate.blockId === outputBlockId);
    return outputBlock?.type === input.blockType && typeof outputBlock.data.assetId === 'string';
  });
  execution.status = allOutputsComplete ? 'succeeded' : 'running';
  if (allOutputsComplete) execution.completedAt = now;
  else delete execution.completedAt;
  delete execution.errorMessage;
  syncExecutionBlocks(snapshot, execution);
  appendHistoryEvent(snapshot, {
    type: 'result_block_updated',
    actor: 'codex',
    execution,
    summary: `Result block updated: ${block.data.title}`,
    assetIds: [asset.assetId],
    blockIds: executionHistoryBlockIds(execution),
    detail: { assetId: asset.assetId, resultBlockId: block.blockId },
  });
  if (allOutputsComplete && !wasSucceeded) {
    appendHistoryEvent(snapshot, { type: 'execution_succeeded', actor: 'codex', execution, summary: `Execution succeeded: ${execution.capabilityId}`, assetIds: execution.outputAssetIds });
  }
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
  const persisted = allOutputsComplete && !wasSucceeded
    ? await materializeCompletedWorkflowExecution(snapshot, execution)
    : snapshot;
  return {
    snapshot: persisted,
    block: persisted.blocks.find((candidate) => candidate.blockId === block.blockId) ?? block,
    execution: findExecutionOrThrow(persisted, input.executionId),
  };
}

export async function assertSourceExecutionAcceptsAssets(projectId: string, executionId: string | undefined): Promise<void> {
  if (!executionId) return;
  const snapshot = await findSnapshotForExecution(projectId, executionId).catch(() => undefined);
  const execution = snapshot?.executions.find((candidate) => candidate.executionId === executionId);
  if (execution) assertExecutionRunning(execution, 'import an asset for');
}

export async function appendAssetImportedHistory(asset: AssetRecord): Promise<void> {
  if (!asset.sourceExecutionId) return;
  const snapshot = await findSnapshotForExecution(asset.projectId, asset.sourceExecutionId).catch(() => undefined);
  if (!snapshot) return;
  const execution = snapshot.executions.find((candidate) => candidate.executionId === asset.sourceExecutionId);
  if (!execution) return;
  if (!snapshot.assets.some((candidate) => candidate.assetId === asset.assetId)) snapshot.assets.unshift(asset);
  appendHistoryEvent(snapshot, {
    type: 'asset_imported',
    actor: 'codex',
    execution,
    summary: `Asset imported: ${asset.assetId}`,
    assetIds: [asset.assetId],
    detail: { assetId: asset.assetId, mimeType: asset.mimeType, storageKey: asset.storageKey },
  });
  touchSnapshot(snapshot);
  await saveSnapshot(snapshot);
}

function findExecutionOrThrow(snapshot: BoardSnapshot, executionId: string): ExecutionRecord {
  const execution = snapshot.executions.find((candidate) => candidate.executionId === executionId);
  if (!execution) throw new Error(`Execution not found: ${executionId}`);
  return execution;
}

function assertExecutionNotCanceled(execution: ExecutionRecord, action: string): void {
  if (execution.status === 'canceled') throw new Error(`Cannot ${action} canceled execution: ${execution.executionId}`);
}

function assertExecutionRunning(execution: ExecutionRecord, action: string): void {
  if (execution.status !== 'running') throw new Error(`Cannot ${action} execution that is ${execution.status}: ${execution.executionId}`);
}

function mergeUnique(existing: string[], incoming: string[]): string[] {
  return Array.from(new Set([...existing, ...incoming]));
}

async function materializeCompletedWorkflowExecution(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
): Promise<BoardSnapshot> {
  if (!execution.workflowRunId || !execution.stepRunId || execution.status !== 'succeeded') {
    return snapshot;
  }
  try {
    const result = await materializeWorkflowOutputArtifacts({
      boardId: snapshot.board.boardId,
      projectId: snapshot.project.projectId,
      trigger: { kind: 'execution_succeeded', executionId: execution.executionId },
    });
    return result.snapshot;
  } catch (error) {
    console.error(
      `Workflow output Artifact materialization failed for ${execution.executionId}:`,
      error,
    );
    return snapshot;
  }
}

function markExecutionBlocks(snapshot: BoardSnapshot, executionId: string, status: ExecutionRecord['status']): void {
  const now = new Date().toISOString();
  for (const block of snapshot.blocks) {
    if (block.data.sourceExecutionId === executionId) {
      block.data.status = status;
      block.updatedAt = now;
    }
  }
}

function syncExecutionBlocks(snapshot: BoardSnapshot, execution: ExecutionRecord): void {
  const now = new Date().toISOString();
  const outputBlockIds = new Set(execution.outputBlockIds);
  for (const block of snapshot.blocks) {
    if (block.data.sourceExecutionId !== execution.executionId) continue;
    if (outputBlockIds.has(block.blockId) && (block.type === 'image' || block.type === 'video' || block.type === 'document') && block.data.assetId) {
      block.data.status = 'succeeded';
    }
    else {
      block.data.status = execution.status;
      if (execution.status === 'queued' || execution.status === 'running' || execution.status === 'failed') delete block.data.statusVisualDismissed;
    }
    block.updatedAt = now;
  }
}

function incompleteExecutionResultBlockIds(snapshot: BoardSnapshot, execution: ExecutionRecord): string[] {
  return execution.outputBlockIds.filter((blockId) => {
    const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
    return (block?.type === 'image' || block?.type === 'video' || block?.type === 'document') && typeof block.data.assetId !== 'string';
  });
}

function appendHistoryEvent(snapshot: BoardSnapshot, input: {
  actor: 'user' | 'codex' | 'system';
  assetIds?: string[];
  blockIds?: string[];
  detail?: Record<string, unknown>;
  execution: ExecutionRecord;
  summary: string;
  type: 'asset_imported' | 'execution_started' | 'execution_succeeded' | 'execution_failed' | 'result_block_updated';
}): void {
  snapshot.historyEvents = [{
    eventId: `history_${randomUUID().slice(0, 8)}`,
    type: input.type,
    createdAt: new Date().toISOString(),
    actor: input.actor,
    executionId: input.execution.executionId,
    blockIds: input.blockIds ?? executionHistoryBlockIds(input.execution),
    assetIds: input.assetIds,
    summary: input.summary,
    detail: input.detail,
  }, ...(snapshot.historyEvents ?? [])].slice(0, 200);
}

async function findSnapshotForExecution(projectId: string, executionId: string): Promise<BoardSnapshot | undefined> {
  const boards = await listProjectBoards(projectId).catch(() => []);
  for (const board of boards) {
    const snapshot = await loadSnapshot(projectId, board.boardId).catch(() => undefined);
    if (snapshot?.executions.some((execution) => execution.executionId === executionId)) return snapshot;
  }
  return undefined;
}

function executionHistoryBlockIds(execution: ExecutionRecord): string[] {
  const operationBlockId = typeof execution.params?.operationBlockId === 'string' ? execution.params.operationBlockId : undefined;
  return [...execution.inputBlockIds, operationBlockId, ...execution.outputBlockIds].filter((blockId): blockId is string => typeof blockId === 'string');
}
