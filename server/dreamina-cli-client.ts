import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { access, mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export interface DreaminaCliConfig {
  executablePath: string;
  modelVersion: string;
  videoResolution: string;
  sessionId: number;
  pollIntervalMs: number;
  taskTimeoutMs: number;
  commandTimeoutMs: number;
}

export interface DreaminaCliResult {
  payload: unknown;
  stdout: string;
  stderr: string;
}

export type DreaminaCommandRunner = (
  executablePath: string,
  args: string[],
  options: { signal?: AbortSignal; timeoutMs: number },
) => Promise<DreaminaCliResult>;

const allowedSubcommands = new Set([
  'text2video',
  'image2video',
  'frames2video',
  'multimodal2video',
  'query_result',
]);

export function readDreaminaCliConfig(environment: NodeJS.ProcessEnv = process.env): DreaminaCliConfig | undefined {
  const executablePath = discoverDreaminaExecutable(environment);
  if (!executablePath) return undefined;
  return {
    executablePath,
    modelVersion: environment.DREAMINA_MODEL_VERSION?.trim() || 'seedance2.0_vip',
    videoResolution: environment.DREAMINA_VIDEO_RESOLUTION?.trim() || '720p',
    sessionId: nonNegativeInteger(environment.DREAMINA_SESSION_ID, 0),
    pollIntervalMs: positiveInteger(environment.DREAMINA_POLL_INTERVAL_MS, 5_000),
    taskTimeoutMs: positiveInteger(environment.DREAMINA_TASK_TIMEOUT_MS, 30 * 60_000),
    commandTimeoutMs: positiveInteger(environment.DREAMINA_COMMAND_TIMEOUT_MS, 120_000),
  };
}

export async function dreaminaCliAvailability(environment: NodeJS.ProcessEnv = process.env): Promise<{
  available: boolean;
  adapterId: string;
  credentialRefType: string;
  executablePath?: string;
  model: string;
  reason?: string;
}> {
  const config = readDreaminaCliConfig(environment);
  if (!config) return unavailable('Dreamina CLI was not found. Install it or set DREAMINA_CLI_PATH on the Retake server.');
  try {
    await access(config.executablePath);
    return {
      available: true,
      adapterId: 'retake.video.dreamina-cli',
      credentialRefType: 'dreamina_oauth_session',
      executablePath: config.executablePath,
      model: config.modelVersion,
    };
  } catch {
    return unavailable(`Dreamina CLI is not accessible: ${config.executablePath}`);
  }
}

export async function probeDreaminaCliConnection(
  environment: NodeJS.ProcessEnv = process.env,
  runner: DreaminaCommandRunner = runDreaminaCommand,
): Promise<void> {
  const config = readDreaminaCliConfig(environment);
  if (!config) throw new Error('Dreamina CLI was not found. Install it or set DREAMINA_CLI_PATH on the Retake server.');
  await runner(config.executablePath, ['--version'], { timeoutMs: config.commandTimeoutMs });
}

export class DreaminaCliClient {
  constructor(
    private readonly config: DreaminaCliConfig,
    private readonly runner: DreaminaCommandRunner = runDreaminaCommand,
  ) {}

  async submit(args: string[], signal?: AbortSignal): Promise<{ submitId: string; payload: unknown }> {
    const result = await this.run(args, signal);
    const submitId = firstString(result.payload, new Set(['submit_id', 'submitId', 'task_id', 'taskId', 'id']));
    if (!submitId) throw new Error('Dreamina CLI submit succeeded without returning a submit_id.');
    return { submitId, payload: result.payload };
  }

  async waitForTask(submitId: string, signal?: AbortSignal): Promise<unknown> {
    const startedAt = Date.now();
    while (true) {
      const result = await this.run(['query_result', '--submit_id', submitId], signal);
      const status = normalizedStatus(result.payload);
      if (status === 'succeeded') return result.payload;
      if (status === 'failed') throw new Error(providerError(result.payload) || `Dreamina task ${submitId} failed.`);
      if (Date.now() - startedAt >= this.config.taskTimeoutMs) {
        throw new Error(`Dreamina task ${submitId} exceeded the Retake polling timeout.`);
      }
      await abortableDelay(this.config.pollIntervalMs, signal);
    }
  }

  async downloadTask(submitId: string, outputDir: string, signal?: AbortSignal): Promise<string[]> {
    await mkdir(outputDir, { recursive: true });
    await this.run(['query_result', '--submit_id', submitId, '--download_dir', outputDir], signal);
    const files = await videoFiles(outputDir);
    if (files.length === 0) throw new Error(`Dreamina task ${submitId} completed without a downloaded video file.`);
    return files;
  }

  private async run(args: string[], signal?: AbortSignal): Promise<DreaminaCliResult> {
    if (!allowedSubcommands.has(args[0])) throw new Error(`Dreamina CLI subcommand is not allowed: ${args[0]}`);
    return this.runner(this.config.executablePath, args, { signal, timeoutMs: this.config.commandTimeoutMs });
  }
}

export async function runDreaminaCommand(
  executablePath: string,
  args: string[],
  options: { signal?: AbortSignal; timeoutMs: number },
): Promise<DreaminaCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executablePath, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Dreamina CLI command timed out after ${options.timeoutMs}ms.`));
    }, options.timeoutMs);
    const abort = () => {
      child.kill('SIGTERM');
      reject(options.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    options.signal?.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => { stdout = boundedAppend(stdout, chunk.toString()); });
    child.stderr.on('data', (chunk: Buffer) => { stderr = boundedAppend(stderr, chunk.toString()); });
    child.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      if (options.signal?.aborted) return;
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Dreamina CLI exited with code ${code}.`));
        return;
      }
      resolve({ payload: parseJsonOutput(stdout), stdout, stderr });
    });
  });
}

function discoverDreaminaExecutable(environment: NodeJS.ProcessEnv): string | undefined {
  const configured = environment.DREAMINA_CLI_PATH?.trim();
  if (configured) return path.resolve(configured);
  const pathMatch = (environment.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, 'dreamina'))
    .find((candidate) => existsSync(candidate));
  const knownUserPath = path.join(homedir(), '.local', 'bin', 'dreamina');
  return pathMatch ?? (existsSync(knownUserPath) ? knownUserPath : undefined);
}

function unavailable(reason: string) {
  return {
    available: false,
    adapterId: 'retake.video.dreamina-cli',
    credentialRefType: 'dreamina_oauth_session',
    model: 'seedance2.0_vip',
    reason,
  };
}

function parseJsonOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return {};
  try { return JSON.parse(text) as unknown; } catch { /* continue */ }
  const starts = [...new Set([text.indexOf('{'), text.indexOf('[')])].filter((index) => index >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    try { return JSON.parse(text.slice(start)) as unknown; } catch { /* continue */ }
  }
  return { raw: text };
}

function normalizedStatus(payload: unknown): 'pending' | 'succeeded' | 'failed' {
  const raw = firstString(payload, new Set(['status', 'gen_status', 'task_status', 'state'])).toLowerCase();
  if (['success', 'succeeded', 'done', 'completed', 'complete'].includes(raw)) return 'succeeded';
  if (['failed', 'fail', 'error', 'cancelled', 'canceled'].includes(raw)) return 'failed';
  return 'pending';
}

function providerError(payload: unknown): string {
  return firstString(payload, new Set(['error_message', 'errorMessage', 'message', 'error']));
}

function firstString(value: unknown, names: Set<string>): string {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstString(item, names);
      if (found) return found;
    }
    return '';
  }
  if (!value || typeof value !== 'object') return '';
  for (const [key, item] of Object.entries(value)) {
    if (names.has(key) && typeof item === 'string' && item) return item;
    const found = firstString(item, names);
    if (found) return found;
  }
  return '';
}

async function videoFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await videoFiles(absolutePath));
    else if (/\.(mp4|mov|webm)$/i.test(entry.name)) files.push(absolutePath);
  }
  return files.sort();
}

function boundedAppend(current: string, incoming: string): string {
  const combined = current + incoming;
  return combined.length > 10 * 1024 * 1024 ? combined.slice(-10 * 1024 * 1024) : combined;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
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
