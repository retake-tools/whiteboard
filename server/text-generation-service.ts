import type { BoardSnapshot, ExecutionRecord } from '../src/core/types';
import { generateNativeText, type NativeTextResult } from './ai-sdk-native-text-client';
import { createAssetFromDataUrl } from './local-store/asset-store';
import { resolveExecutionConnection } from './local-store/execution-provider-store';
import { failExecution, markExecutionRunning, updateTextResultBlock } from './local-store/execution-store';
import { loadSnapshot, saveSnapshot } from './local-store/snapshot-store';
import { generateOpenAICompatibleText, type OpenAICompatibleTextResult } from './openai-compatible-client';

type TextGenerationResult = NativeTextResult | OpenAICompatibleTextResult;

interface TextGenerationDependencies {
  generateNative?: typeof generateNativeText;
  generateOpenAICompatible?: typeof generateOpenAICompatibleText;
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
  const connection = await resolveExecutionConnection(input.connectionId);
  const connectorId = connection?.connectorId;
  if (!connection || !connectorId || !isTextConnector(connectorId)) {
    throw new Error('Text generation connection is unavailable. Configure and test it in Retake Settings.');
  }
  const current = await loadSnapshot(input.projectId, input.boardId);
  const queued = current.executions.find((candidate) => candidate.executionId === input.executionId);
  if (!queued || queued.status !== 'queued' || queued.adapter !== 'direct_api' || queued.capabilityId !== 'text.generate') {
    throw new Error(`Queued text.generate execution not found: ${input.executionId}`);
  }
  if (queued.connectionId !== input.connectionId) {
    throw new Error(`Text execution connection mismatch: ${input.connectionId}`);
  }

  const started = await markExecutionRunning(input);
  const completion = executeTextGeneration(started.execution, { ...connection, connectorId }, dependencies).catch(async (error) => {
    await failExecution({
      projectId: input.projectId,
      boardId: input.boardId,
      executionId: input.executionId,
      errorMessage: error instanceof Error ? error.message : 'Text generation failed.',
    }).catch(() => undefined);
    throw error;
  });
  void completion.catch(() => undefined);
  return { ...started, completion };
}

async function executeTextGeneration(
  execution: ExecutionRecord,
  connection: NonNullable<Awaited<ReturnType<typeof resolveExecutionConnection>>> & {
    connectorId: 'anthropic-native' | 'google-native' | 'openai-compatible';
  },
  dependencies: TextGenerationDependencies,
): Promise<void> {
  const config = {
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
    model: connection.model,
  };
  const prompt = execution.prompt?.trim();
  if (!prompt) throw new Error('Text generation requires a non-empty prompt.');
  const maxOutputTokens = requestedMaxOutputTokens(execution);
  const result = connection.connectorId === 'openai-compatible'
    ? await (dependencies.generateOpenAICompatible ?? generateOpenAICompatibleText)(config, { prompt, maxOutputTokens })
    : await (dependencies.generateNative ?? generateNativeText)(connection.connectorId, config, { prompt, maxOutputTokens });
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
  await updateTextResultBlock({
    projectId: execution.projectId,
    boardId: execution.boardId,
    executionId: execution.executionId,
    assetId: asset.assetId,
    resultBlockId: execution.outputBlockIds[0],
    title: 'Generated text',
    markdown,
  });
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
): connectorId is 'anthropic-native' | 'google-native' | 'openai-compatible' {
  return connectorId === 'anthropic-native' || connectorId === 'google-native' || connectorId === 'openai-compatible';
}
