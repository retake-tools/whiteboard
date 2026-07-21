import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

export interface CodexAppServerAvailability {
  available: boolean;
  executablePath?: string;
  reason?: string;
}

export interface CodexAppServerCapabilities {
  imageGeneration: boolean;
  namespaceTools: boolean;
  webSearch: boolean;
}

export interface CodexAppServerProbeResult {
  authMode: string;
  capabilities: CodexAppServerCapabilities;
}

export interface CodexAppServerImageResult {
  itemId: string;
  revisedPrompt?: string;
  savedPath?: string;
  dataUrl?: string;
}

export interface CodexAppServerTurnResult {
  threadId: string;
  turnId: string;
  text: string;
  image?: CodexAppServerImageResult;
}

export interface RunCodexAppServerTurnInput {
  cwd: string;
  model: string;
  prompt: string;
  localImagePaths?: string[];
  sandbox?: 'read-only' | 'workspace-write';
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  onImageGenerationStarted?: () => void;
}

const probeTimeoutMs = 10_000;
const turnTimeoutMs = 10 * 60_000;

export function codexAppServerAvailability(
  environment: NodeJS.ProcessEnv = process.env,
): CodexAppServerAvailability {
  const executablePath = discoverCodexExecutable(environment);
  return executablePath
    ? { available: true, executablePath }
    : { available: false, reason: 'Codex CLI was not found. Install Codex or set CODEX_CLI_PATH on the Retake server.' };
}

export async function probeCodexAppServerConnection(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CodexAppServerProbeResult> {
  const session = createCodexAppServerSession(environment, probeTimeoutMs);
  try {
    await session.initialize();
    const accountResult = await session.request('account/read', { refreshToken: false });
    const account = isRecord(accountResult.account) ? accountResult.account : undefined;
    if (accountResult.requiresOpenaiAuth === true && !account) {
      throw new Error('Codex login is required. Run `codex login` and test the connection again.');
    }
    const capabilitiesResult = await session.request('modelProvider/capabilities/read', {});
    const rawCapabilities = isRecord(capabilitiesResult.capabilities)
      ? capabilitiesResult.capabilities
      : capabilitiesResult;
    return {
      authMode: typeof account?.type === 'string' ? account.type : 'external-provider',
      capabilities: {
        imageGeneration: rawCapabilities.imageGeneration === true,
        namespaceTools: rawCapabilities.namespaceTools === true,
        webSearch: rawCapabilities.webSearch === true,
      },
    };
  } finally {
    session.close();
  }
}

export async function runCodexAppServerTurn(
  input: RunCodexAppServerTurnInput,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CodexAppServerTurnResult> {
  const session = createCodexAppServerSession(environment, turnTimeoutMs);
  let threadId = '';
  let turnId = '';
  let text = '';
  let image: CodexAppServerImageResult | undefined;
  let completed = false;

  const abort = () => {
    if (threadId && turnId) {
      void session.request('turn/interrupt', { threadId, turnId }).catch(() => undefined);
    }
    session.fail(abortError());
  };
  input.signal?.addEventListener('abort', abort, { once: true });

  try {
    await session.initialize();
    session.onNotification((message) => {
      if (message.method === 'item/agentMessage/delta') {
        const delta = isRecord(message.params) && typeof message.params.delta === 'string'
          ? message.params.delta
          : '';
        if (delta) {
          text += delta;
          input.onTextDelta?.(delta);
        }
        return;
      }
      if (message.method === 'item/started') {
        const item = isRecord(message.params) && isRecord(message.params.item) ? message.params.item : undefined;
        if (item?.type === 'imageGeneration') input.onImageGenerationStarted?.();
        return;
      }
      if (message.method === 'item/completed') {
        const item = isRecord(message.params) && isRecord(message.params.item) ? message.params.item : undefined;
        if (item?.type === 'agentMessage' && !text && typeof item.text === 'string') text = item.text;
        if (item?.type === 'imageGeneration' && typeof item.id === 'string') {
          const savedPath = typeof item.savedPath === 'string' ? item.savedPath : undefined;
          image = {
            itemId: item.id,
            ...(typeof item.revisedPrompt === 'string' ? { revisedPrompt: item.revisedPrompt } : {}),
            ...(savedPath ? { savedPath } : {}),
            ...(!savedPath && typeof item.result === 'string' ? { dataUrl: normalizeImageDataUrl(item.result) } : {}),
          };
        }
        return;
      }
      if (message.method === 'turn/completed') {
        const params = isRecord(message.params) ? message.params : {};
        const turn = isRecord(params.turn) ? params.turn : {};
        if (params.threadId !== threadId || (typeof turn.id === 'string' && turn.id !== turnId)) return;
        const status = typeof turn.status === 'string' ? turn.status : 'failed';
        if (status !== 'completed') {
          const error = isRecord(turn.error) ? messageText(turn.error) : undefined;
          session.fail(new Error(error || `Codex App Server turn ended with status ${status}.`));
          return;
        }
        completed = true;
        session.complete();
      }
    });
    const threadResult = await session.request('thread/start', {
      model: input.model,
      cwd: input.cwd,
      approvalPolicy: 'never',
      sandbox: input.sandbox ?? 'read-only',
      ephemeral: true,
    });
    const thread = isRecord(threadResult.thread) ? threadResult.thread : undefined;
    if (!thread || typeof thread.id !== 'string') throw new Error('Codex App Server did not return a thread id.');
    threadId = thread.id;
    const turnResult = await session.request('turn/start', {
      threadId,
      model: input.model,
      input: [
        { type: 'text', text: input.prompt },
        ...(input.localImagePaths ?? []).map((localPath) => ({ type: 'localImage', path: localPath })),
      ],
    });
    const turn = isRecord(turnResult.turn) ? turnResult.turn : undefined;
    if (!turn || typeof turn.id !== 'string') throw new Error('Codex App Server did not return a turn id.');
    turnId = turn.id;
    await session.waitForCompletion();
    if (!completed) throw new Error('Codex App Server closed before the turn completed.');
    return { threadId, turnId, text, ...(image ? { image } : {}) };
  } finally {
    input.signal?.removeEventListener('abort', abort);
    session.close();
  }
}

interface CodexAppServerSession {
  initialize(): Promise<void>;
  request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  onNotification(listener: (message: Record<string, unknown>) => void): void;
  waitForCompletion(): Promise<void>;
  complete(): void;
  fail(error: Error): void;
  close(): void;
}

function createCodexAppServerSession(
  environment: NodeJS.ProcessEnv,
  timeoutMs: number,
): CodexAppServerSession {
  const availability = codexAppServerAvailability(environment);
  if (!availability.available || !availability.executablePath) {
    throw new Error(availability.reason || 'Codex CLI is unavailable.');
  }
  const child = spawn(availability.executablePath, ['app-server', '--listen', 'stdio://'], {
    shell: false,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const lines = createInterface({ input: child.stdout });
  const pending = new Map<number, {
    resolve: (result: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>();
  const notificationListeners = new Set<(message: Record<string, unknown>) => void>();
  let nextId = 1;
  let stderr = '';
  let settled = false;
  let completionResolve: (() => void) | undefined;
  let completionReject: ((error: Error) => void) | undefined;
  const completion = new Promise<void>((resolve, reject) => {
    completionResolve = resolve;
    completionReject = reject;
  });
  void completion.catch(() => undefined);
  const timeout = setTimeout(() => fail(new Error('Codex App Server request timed out.')), timeoutMs);

  function send(message: unknown): void {
    if (settled || !child.stdin.writable) throw new Error('Codex App Server session is closed.');
    child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function request(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try {
        send({ method, id, params });
      } catch (error) {
        pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function fail(error: Error): void {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    pending.forEach((waiter) => waiter.reject(error));
    pending.clear();
    completionReject?.(error);
  }

  function complete(): void {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    completionResolve?.();
  }

  child.stderr.on('data', (chunk: Buffer) => {
    stderr = boundedAppend(stderr, chunk.toString());
  });
  child.on('error', (error) => fail(error));
  child.on('close', (code) => {
    if (!settled) fail(new Error(stderr.trim() || `Codex App Server exited with code ${code}.`));
  });
  lines.on('line', (line) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line) as Record<string, unknown>;
    } catch {
      return;
    }
    if (typeof message.id === 'number' && pending.has(message.id)) {
      const waiter = pending.get(message.id)!;
      pending.delete(message.id);
      if (isRecord(message.error)) waiter.reject(new Error(messageText(message.error) || 'Codex App Server request failed.'));
      else waiter.resolve(isRecord(message.result) ? message.result : {});
      return;
    }
    if (typeof message.method === 'string' && message.method.includes('requestApproval')) {
      fail(new Error(`Codex App Server requested approval during an unattended Retake execution: ${message.method}`));
      return;
    }
    notificationListeners.forEach((listener) => listener(message));
  });

  return {
    async initialize() {
      await request('initialize', {
        clientInfo: {
          name: 'retake_whiteboard',
          title: 'Retake Whiteboard',
          version: '0.1.0',
        },
      });
      send({ method: 'initialized', params: {} });
    },
    request,
    onNotification(listener) {
      notificationListeners.add(listener);
    },
    waitForCompletion() {
      return completion;
    },
    complete,
    fail,
    close() {
      if (!settled) complete();
      clearTimeout(timeout);
      lines.close();
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}

function discoverCodexExecutable(environment: NodeJS.ProcessEnv): string | undefined {
  const configured = environment.CODEX_CLI_PATH?.trim();
  if (configured) {
    const resolved = path.resolve(configured);
    return existsSync(resolved) ? resolved : undefined;
  }
  const pathMatch = (environment.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((directory) => path.join(directory, 'codex'))
    .find((candidate) => existsSync(candidate));
  if (pathMatch) return pathMatch;
  return ['/opt/homebrew/bin/codex', '/usr/local/bin/codex']
    .find((candidate) => existsSync(candidate));
}

function normalizeImageDataUrl(value: string): string {
  return value.startsWith('data:') ? value : `data:image/png;base64,${value}`;
}

function abortError(): Error {
  const error = new Error('Codex App Server execution was canceled.');
  error.name = 'AbortError';
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function messageText(value: Record<string, unknown>): string | undefined {
  return typeof value.message === 'string' ? value.message : undefined;
}

function boundedAppend(current: string, next: string): string {
  const combined = current + next;
  return combined.length <= 8_192 ? combined : combined.slice(combined.length - 8_192);
}
