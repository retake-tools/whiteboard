import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject } from 'ai';
import { jsonSchema } from '@ai-sdk/provider-utils';

export type DirectAgentRuntimeConnector =
  | 'anthropic-native'
  | 'google-native'
  | 'openai-compatible';

export interface DirectAgentRuntimeConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface DirectAgentRuntimeResult {
  object: Record<string, unknown>;
  finishReason: string;
  providerMetadata?: Record<string, unknown>;
  usage: Record<string, unknown>;
}

export async function generateDirectAgentDecision(
  connectorId: DirectAgentRuntimeConnector,
  config: DirectAgentRuntimeConfig,
  input: {
    abortSignal?: AbortSignal;
    instructions: string;
    outputSchema: Record<string, unknown>;
    prompt: string;
  },
  fetchImpl?: typeof fetch,
): Promise<DirectAgentRuntimeResult> {
  const model = connectorId === 'anthropic-native'
    ? createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl.replace(/\/$/, ''),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    })(config.model)
    : connectorId === 'google-native'
      ? createGoogleGenerativeAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl.replace(/\/$/, ''),
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      })(config.model)
      : createOpenAICompatible({
        name: 'retake-agent-runtime',
        apiKey: config.apiKey,
        baseURL: config.baseUrl.replace(/\/$/, ''),
        ...(fetchImpl ? { fetch: fetchImpl } : {}),
      }).chatModel(config.model);
  const result = await generateObject({
    model,
    schema: jsonSchema<Record<string, unknown>>(input.outputSchema),
    schemaName: 'retake_agent_runtime_decision',
    schemaDescription: 'One bounded Retake Agent Runtime decision.',
    system: input.instructions,
    prompt: input.prompt,
    abortSignal: input.abortSignal,
    maxOutputTokens: 4_096,
  });
  if (!result.object || typeof result.object !== 'object' || Array.isArray(result.object)) {
    throw new Error('Direct Agent Runtime returned a non-object decision.');
  }
  return {
    object: normalizeDirectAgentDecisionObject(
      result.object as Record<string, unknown>,
    ),
    finishReason: result.finishReason,
    usage: jsonRecord(result.usage),
    ...(result.providerMetadata
      ? { providerMetadata: jsonRecord(result.providerMetadata) }
      : {}),
  };
}

export function normalizeDirectAgentDecisionObject(
  object: Record<string, unknown>,
): Record<string, unknown> {
  if (
    object.kind === 'reply'
    && (typeof object.message !== 'string' || !object.message.trim())
    && typeof object.reply === 'string'
    && object.reply.trim()
  ) {
    const { reply, ...rest } = object;
    return { ...rest, message: reply };
  }
  return object;
}

export function isDirectAgentRuntimeConnector(
  connectorId: string,
): connectorId is DirectAgentRuntimeConnector {
  return connectorId === 'anthropic-native'
    || connectorId === 'google-native'
    || connectorId === 'openai-compatible';
}

function jsonRecord(value: unknown): Record<string, unknown> {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : {};
}
