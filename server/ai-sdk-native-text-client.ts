import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';

export interface NativeTextConnectionConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface NativeTextResult {
  text: string;
  finishReason: string;
  usage: Record<string, unknown>;
  providerMetadata?: Record<string, unknown>;
}

export type NativeTextProvider = 'anthropic-native' | 'google-native';

export async function generateNativeText(
  providerId: NativeTextProvider,
  config: NativeTextConnectionConfig,
  input: {
    prompt: string;
    maxOutputTokens?: number;
    abortSignal?: AbortSignal;
  },
  fetchImpl?: typeof fetch,
): Promise<NativeTextResult> {
  const model = providerId === 'anthropic-native'
    ? createAnthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl.replace(/\/$/, ''),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    })(config.model)
    : createGoogleGenerativeAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl.replace(/\/$/, ''),
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    })(config.model);
  const result = await generateText({
    model,
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

export async function probeNativeTextConnection(
  providerId: NativeTextProvider,
  config: NativeTextConnectionConfig,
  fetchImpl?: typeof fetch,
): Promise<void> {
  await generateNativeText(providerId, config, { prompt: 'Reply with OK.', maxOutputTokens: 4 }, fetchImpl);
}

function jsonRecord(value: unknown): Record<string, unknown> {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  return normalized && typeof normalized === 'object' && !Array.isArray(normalized)
    ? normalized as Record<string, unknown>
    : {};
}
