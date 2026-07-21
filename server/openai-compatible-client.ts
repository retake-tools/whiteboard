import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';

export interface OpenAICompatibleConnectionConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface OpenAICompatibleTextResult {
  text: string;
  finishReason: string;
  usage: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
}

export async function generateOpenAICompatibleText(
  config: OpenAICompatibleConnectionConfig,
  input: {
    prompt: string;
    maxOutputTokens?: number;
    abortSignal?: AbortSignal;
  },
  fetchImpl?: typeof fetch,
): Promise<OpenAICompatibleTextResult> {
  const provider = createOpenAICompatible({
    name: 'retake-openai-compatible',
    apiKey: config.apiKey,
    baseURL: config.baseUrl.replace(/\/$/, ''),
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const result = await generateText({
    model: provider.chatModel(config.model),
    prompt: input.prompt,
    maxOutputTokens: input.maxOutputTokens ?? 1_024,
    abortSignal: input.abortSignal,
  });
  return {
    text: result.text,
    finishReason: result.finishReason,
    usage: jsonRecord(result.usage),
    ...(result.providerMetadata ? { providerMetadata: jsonRecord(result.providerMetadata) } : {}),
  };
}

export async function probeOpenAICompatibleConnection(
  config: OpenAICompatibleConnectionConfig,
  fetchImpl?: typeof fetch,
): Promise<void> {
  await generateOpenAICompatibleText(config, { prompt: 'Reply with OK.', maxOutputTokens: 4 }, fetchImpl);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : {};
}
