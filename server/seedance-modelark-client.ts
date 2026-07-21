export interface SeedanceModelArkConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  pollIntervalMs: number;
  taskTimeoutMs: number;
}

export interface SeedanceContentItem {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
  role?: 'first_frame' | 'last_frame' | 'reference_image';
}

export interface SeedanceCreateTaskInput {
  content: SeedanceContentItem[];
  duration: number;
  generateAudio?: boolean;
  ratio?: 'adaptive' | '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '21:9';
  watermark?: boolean;
}

export interface SeedanceTask {
  id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'expired';
  content?: { video_url?: string };
  duration?: number;
  error?: { code?: string; message?: string };
  usage?: Record<string, unknown>;
}

export type FetchLike = typeof fetch;

const DEFAULT_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const DEFAULT_MODEL = 'dreamina-seedance-2-0-260128';

export function readSeedanceModelArkConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SeedanceModelArkConfig | undefined {
  const apiKey = environment.SEEDANCE_MODELARK_API_KEY?.trim() || environment.ARK_API_KEY?.trim();
  if (!apiKey) return undefined;
  return {
    apiKey,
    baseUrl: (environment.SEEDANCE_MODELARK_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, ''),
    model: environment.SEEDANCE_MODELARK_MODEL?.trim() || DEFAULT_MODEL,
    pollIntervalMs: positiveInteger(environment.SEEDANCE_MODELARK_POLL_INTERVAL_MS, 5_000),
    taskTimeoutMs: positiveInteger(environment.SEEDANCE_MODELARK_TASK_TIMEOUT_MS, 30 * 60_000),
  };
}

export function seedanceModelArkAvailability(environment: NodeJS.ProcessEnv = process.env): {
  available: boolean;
  adapterId: string;
  credentialRefType: string;
  model: string;
  reason?: string;
} {
  const config = readSeedanceModelArkConfig(environment);
  return {
    available: Boolean(config),
    adapterId: 'retake.video.seedance-modelark',
    credentialRefType: 'modelark_api_key',
    model: config?.model ?? DEFAULT_MODEL,
    ...(config ? {} : { reason: 'Set SEEDANCE_MODELARK_API_KEY or ARK_API_KEY on the Retake server.' }),
  };
}

export class SeedanceModelArkClient {
  constructor(
    private readonly config: SeedanceModelArkConfig,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async createTask(input: SeedanceCreateTaskInput, signal?: AbortSignal): Promise<{ id: string }> {
    return this.request('/contents/generations/tasks', {
      method: 'POST',
      signal,
      body: JSON.stringify({
        model: this.config.model,
        content: input.content,
        duration: input.duration,
        ratio: input.ratio ?? 'adaptive',
        generate_audio: input.generateAudio ?? true,
        watermark: input.watermark ?? false,
      }),
    });
  }

  async getTask(taskId: string, signal?: AbortSignal): Promise<SeedanceTask> {
    return this.request(`/contents/generations/tasks/${encodeURIComponent(taskId)}`, { method: 'GET', signal });
  }

  async waitForTask(taskId: string, signal?: AbortSignal): Promise<SeedanceTask> {
    const startedAt = Date.now();
    while (true) {
      const task = await this.getTask(taskId, signal);
      if (task.status === 'succeeded') {
        if (!task.content?.video_url) throw new Error(`Seedance task ${taskId} succeeded without a video URL.`);
        return task;
      }
      if (task.status === 'failed' || task.status === 'cancelled' || task.status === 'expired') {
        throw new Error(task.error?.message || `Seedance task ${taskId} ended with status ${task.status}.`);
      }
      if (Date.now() - startedAt >= this.config.taskTimeoutMs) {
        throw new Error(`Seedance task ${taskId} exceeded the Retake polling timeout.`);
      }
      await abortableDelay(this.config.pollIntervalMs, signal);
    }
  }

  async cancelQueuedTask(taskId: string): Promise<boolean> {
    const response = await this.fetchImpl(
      `${this.config.baseUrl}/contents/generations/tasks/${encodeURIComponent(taskId)}`,
      { method: 'DELETE', headers: this.headers() },
    );
    if (response.ok) return true;
    // ModelArk cannot cancel a running task. Local cancellation still prevents write-back.
    if (response.status === 400 || response.status === 409) return false;
    throw await responseError(response, `Seedance task cancellation failed (${response.status}).`);
  }

  private async request<T>(pathname: string, init: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`${this.config.baseUrl}${pathname}`, {
      ...init,
      headers: { ...this.headers(), ...init.headers },
    });
    if (!response.ok) throw await responseError(response, `ModelArk request failed (${response.status}).`);
    return await response.json() as T;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' };
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => undefined) as {
    error?: { message?: string } | string;
    message?: string;
  } | undefined;
  const message = typeof body?.error === 'string'
    ? body.error
    : body?.error?.message ?? body?.message ?? fallback;
  return new Error(message);
}

function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timeout = setTimeout(resolve, milliseconds);
    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}
