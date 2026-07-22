import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { capabilityDefinitionFor, isTextDocumentCapability } from '../src/core/capabilityRegistry';
import { generateNativeText, type NativeTextResult } from './ai-sdk-native-text-client';
import { runCodexAppServerTurn } from './codex-app-server-client';
import { publishExecutionEvent } from './execution-events';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { listExecutionProviderSettings, resolveExecutionConnection } from './local-store/execution-provider-store';
import {
  failExecution,
  markExecutionRunning,
  recordExecutionRequestPrompts,
  updateDocumentResultBlock,
} from './local-store/execution-store';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';
import { generateOpenAICompatibleText, type OpenAICompatibleTextResult } from './openai-compatible-client';
import { resolveTextExecutionPrompt } from './skill-prompt-resolver';

type TextGenerationResult = NativeTextResult | OpenAICompatibleTextResult;

interface TextGenerationDependencies {
  generateNative?: typeof generateNativeText;
  generateOpenAICompatible?: typeof generateOpenAICompatibleText;
  runCodexAppServer?: typeof runCodexAppServerTurn;
}

export async function startTextGeneration(input: {
  projectId: string;
  boardId: string;
  executionId: string;
  connectionId: string;
}, dependencies: TextGenerationDependencies = {}): Promise<{
  snapshot: BoardSnapshot;
  execution: ExecutionRecord;
  completion: Promise<void>;
}> {
  const settings = await listExecutionProviderSettings(input.projectId);
  const connectionSummary = settings.connections.find((candidate) => candidate.connectionId === input.connectionId);
  const connectorId = connectionSummary?.connectorId;
  if (!connectionSummary || connectionSummary.status !== 'ready' || !connectorId || !isTextConnector(connectorId)) {
    throw new Error('Text generation connection is unavailable. Configure and test it in Retake Settings.');
  }
  const current = await loadSnapshot(input.projectId, input.boardId);
  const queued = current.executions.find((candidate) => candidate.executionId === input.executionId);
  const expectedAdapter = connectorId === 'codex-app-server' ? 'codex_app_server' : 'direct_api';
  if (!queued || queued.status !== 'queued' || queued.adapter !== expectedAdapter || !isTextDocumentCapability(queued.capabilityId)) {
    throw new Error(`Queued text document execution not found: ${input.executionId}`);
  }
  if (queued.connectionId !== input.connectionId) {
    throw new Error(`Text execution connection mismatch: ${input.connectionId}`);
  }
  if (!connectionSummary.supportedCapabilityIds.includes(queued.capabilityId)) {
    throw new Error(`Connection cannot execute ${queued.capabilityId}: ${input.connectionId}`);
  }

  const started = await markExecutionRunning(input);
  publishExecutionEvent(input.executionId, { type: 'execution.started' });
  const completion = executeTextGeneration(started.execution, connectionSummary, dependencies).catch(async (error) => {
    const failed = await failExecution({
      projectId: input.projectId,
      boardId: input.boardId,
      executionId: input.executionId,
      errorMessage: error instanceof Error ? error.message : 'Text generation failed.',
    }).catch(() => undefined);
    publishExecutionEvent(input.executionId, {
      type: 'execution.failed',
      errorMessage: error instanceof Error ? error.message : 'Text generation failed.',
      ...(failed ? { snapshot: failed.snapshot } : {}),
    });
    throw error;
  });
  void completion.catch(() => undefined);
  return { ...started, completion };
}

async function executeTextGeneration(
  execution: ExecutionRecord,
  connection: Awaited<ReturnType<typeof listExecutionProviderSettings>>['connections'][number],
  dependencies: TextGenerationDependencies,
): Promise<void> {
  const snapshot = await loadSnapshot(execution.projectId, execution.boardId);
  const providerPrompt = await resolveTextExecutionPrompt(execution, snapshot);
  await recordExecutionRequestPrompts({
    projectId: execution.projectId,
    boardId: execution.boardId,
    executionId: execution.executionId,
    requestPrompts: [{
      index: 0,
      outputBlockId: execution.outputBlockIds[0],
      prompt: providerPrompt,
    }],
  });
  const maxOutputTokens = requestedMaxOutputTokens(execution);
  let result: TextGenerationResult;
  if (connection.connectorId === 'codex-app-server') {
    const codexResult = await (dependencies.runCodexAppServer ?? runCodexAppServerTurn)({
      cwd: process.env.TMPDIR || '/tmp',
      model: connection.modelId || 'gpt-5.4',
      prompt: providerPrompt,
      sandbox: 'read-only',
      onTextDelta: (delta) => publishExecutionEvent(execution.executionId, {
        type: 'text.delta',
        delta,
        resultBlockId: execution.outputBlockIds[0] ?? '',
      }),
    });
    result = {
      text: codexResult.text,
      finishReason: 'stop',
      usage: {},
      providerMetadata: {
        codexAppServer: {
          threadId: codexResult.threadId,
          turnId: codexResult.turnId,
        },
      },
    };
  } else {
    const resolved = await resolveExecutionConnection(connection.connectionId);
    if (!resolved || !isDirectTextConnector(resolved.connectorId)) {
      throw new Error('Text generation credentials are unavailable. Configure the connection in Retake Settings.');
    }
    const config = {
      apiKey: resolved.apiKey,
      baseUrl: resolved.baseUrl,
      model: resolved.model,
    };
    result = resolved.connectorId === 'openai-compatible'
      ? await (dependencies.generateOpenAICompatible ?? generateOpenAICompatibleText)(config, { prompt: providerPrompt, maxOutputTokens })
      : await (dependencies.generateNative ?? generateNativeText)(resolved.connectorId, config, { prompt: providerPrompt, maxOutputTokens });
  }
  const markdown = result.text.trim();
  if (!markdown) throw new Error('The provider returned an empty text result.');

  await recordProviderResult(execution, result);
  const asset = await createAssetFromDataUrl({
    projectId: execution.projectId,
    sourceExecutionId: execution.executionId,
    dataUrl: `data:text/markdown;base64,${Buffer.from(markdown, 'utf8').toString('base64')}`,
    fileName: 'generated.md',
    kind: 'document',
  });
  const completed = await updateDocumentResultBlock({
    projectId: execution.projectId,
    boardId: execution.boardId,
    executionId: execution.executionId,
    assetId: asset.assetId,
    resultBlockId: execution.outputBlockIds[0],
    title: capabilityDefinitionFor(execution.capabilityId).displayName,
    documentKind: capabilityDefinitionFor(execution.capabilityId).outputSlots[0]?.artifactType,
    markdown,
  });
  publishExecutionEvent(execution.executionId, { type: 'execution.snapshot', snapshot: completed.snapshot });
}

async function recordProviderResult(execution: ExecutionRecord, result: TextGenerationResult): Promise<void> {
  const snapshot = await loadSnapshot(execution.projectId, execution.boardId);
  const persisted = snapshot.executions.find((candidate) => candidate.executionId === execution.executionId);
  if (!persisted || persisted.status !== 'running') throw new Error('Text execution is no longer running.');
  persisted.params = {
    ...persisted.params,
    textGeneration: {
      finishReason: result.finishReason,
      usage: result.usage,
      ...(result.providerMetadata ? { providerMetadata: result.providerMetadata } : {}),
    },
  };
  await saveSnapshot(snapshot);
}

function requestedMaxOutputTokens(execution: ExecutionRecord): number {
  const value = execution.params?.maxOutputTokens;
  if (typeof value !== 'number' || !Number.isFinite(value)) return 4_096;
  return Math.min(32_768, Math.max(1, Math.round(value)));
}

function isTextConnector(
  connectorId: string,
): connectorId is 'anthropic-native' | 'codex-app-server' | 'google-native' | 'openai-compatible' {
  return connectorId === 'anthropic-native' || connectorId === 'codex-app-server' || connectorId === 'google-native' || connectorId === 'openai-compatible';
}

function isDirectTextConnector(
  connectorId: string,
): connectorId is 'anthropic-native' | 'google-native' | 'openai-compatible' {
  return connectorId === 'anthropic-native' || connectorId === 'google-native' || connectorId === 'openai-compatible';
}
