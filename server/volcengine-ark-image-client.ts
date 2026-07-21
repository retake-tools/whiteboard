export interface VolcengineArkImageConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface VolcengineArkImageRequest {
  prompt: string;
  images?: string[];
  size?: string;
  abortSignal?: AbortSignal;
}

export interface VolcengineArkGeneratedImage {
  dataUrl: string;
  width?: number;
  height?: number;
}

export interface VolcengineArkImageResult {
  images: VolcengineArkGeneratedImage[];
  model?: string;
  usage?: Record<string, unknown>;
}

export class VolcengineArkImageClient {
  readonly config: VolcengineArkImageConfig;
  readonly fetchImpl: typeof fetch;

  constructor(config: VolcengineArkImageConfig, fetchImpl: typeof fetch = fetch) {
    this.config = { ...config, baseUrl: config.baseUrl.replace(/\/$/, '') };
    this.fetchImpl = fetchImpl;
  }

  async generateImage(input: VolcengineArkImageRequest): Promise<VolcengineArkImageResult> {
    const response = await this.fetchImpl(`${this.config.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.config.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        prompt: input.prompt,
        ...(input.images?.length ? { image: input.images } : {}),
        size: input.size || '2K',
        sequential_image_generation: 'disabled',
        stream: false,
        response_format: 'b64_json',
        watermark: false,
      }),
      signal: input.abortSignal,
    });
    const payload = await readJson(response);
    if (!response.ok) throw new Error(providerError(payload) || `Volcengine Ark image generation failed (${response.status}).`);
    const data = Array.isArray(payload.data) ? payload.data : [];
    const images = data.flatMap((item) => {
      if (!isRecord(item) || typeof item.b64_json !== 'string' || !item.b64_json) return [];
      const dimensions = parseDimensions(typeof item.size === 'string' ? item.size : undefined);
      return [{
        dataUrl: item.b64_json.startsWith('data:') ? item.b64_json : `data:image/jpeg;base64,${item.b64_json}`,
        ...dimensions,
      }];
    });
    if (images.length === 0) throw new Error('Volcengine Ark returned no base64 image result.');
    return {
      images,
      ...(typeof payload.model === 'string' ? { model: payload.model } : {}),
      ...(isRecord(payload.usage) ? { usage: payload.usage } : {}),
    };
  }
}

export async function probeVolcengineArkImageConnection(
  config: VolcengineArkImageConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const response = await fetchImpl(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      'content-type': 'application/json',
    },
    // Deliberately omit prompt. A valid Ark image endpoint rejects this request
    // before creating a paid image, which lets Settings validate the route and
    // credential without producing an untracked asset.
    body: JSON.stringify({ model: config.model }),
  });
  const payload = await readJson(response);
  const error = providerError(payload) || `Volcengine Ark validation failed (${response.status}).`;
  if ((response.status === 400 || response.status === 422) && /prompt|required|missing/i.test(error)) return;
  if (response.ok) {
    throw new Error('Volcengine Ark accepted a validation request without a prompt; no test image was retained.');
  }
  throw new Error(error);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    if (!response.ok) throw new Error(text.slice(0, 1_000));
    throw new Error('Volcengine Ark returned invalid JSON.');
  }
}

function providerError(payload: Record<string, unknown>): string | undefined {
  if (isRecord(payload.error) && typeof payload.error.message === 'string') return payload.error.message;
  return typeof payload.message === 'string' ? payload.message : undefined;
}

function parseDimensions(size: string | undefined): { width?: number; height?: number } {
  const match = size?.match(/^(\d+)x(\d+)$/i);
  if (!match) return {};
  return { width: Number(match[1]), height: Number(match[2]) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
