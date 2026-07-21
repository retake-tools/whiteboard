import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';

export interface CodexAppServerAvailability {
  available: boolean;
  executablePath?: string;
  reason?: string;
}

export interface CodexAppServerProbeResult {
  authMode: string;
}

const probeTimeoutMs = 10_000;

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
  const availability = codexAppServerAvailability(environment);
  if (!availability.available || !availability.executablePath) {
    throw new Error(availability.reason || 'Codex CLI is unavailable.');
  }

  return new Promise((resolve, reject) => {
    const child = spawn(availability.executablePath!, ['app-server', '--listen', 'stdio://'], {
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines = createInterface({ input: child.stdout });
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => finish(new Error('Codex App Server connection test timed out.')), probeTimeoutMs);

    function finish(error?: Error, result?: CodexAppServerProbeResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      lines.close();
      child.kill('SIGTERM');
      if (error) reject(error);
      else resolve(result!);
    }

    function send(message: unknown): void {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }

    child.stderr.on('data', (chunk: Buffer) => {
      stderr = boundedAppend(stderr, chunk.toString());
    });
    child.on('error', (error) => finish(error));
    child.on('close', (code) => {
      if (!settled) finish(new Error(stderr.trim() || `Codex App Server exited with code ${code}.`));
    });
    lines.on('line', (line) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.id === 1) {
        if (isRecord(message.error)) {
          finish(new Error(messageText(message.error) || 'Codex App Server initialization failed.'));
          return;
        }
        send({ method: 'initialized', params: {} });
        send({ method: 'account/read', id: 2, params: { refreshToken: false } });
        return;
      }
      if (message.id !== 2) return;
      if (isRecord(message.error)) {
        finish(new Error(messageText(message.error) || 'Codex account check failed.'));
        return;
      }
      const result = isRecord(message.result) ? message.result : {};
      const account = isRecord(result.account) ? result.account : undefined;
      if (result.requiresOpenaiAuth === true && !account) {
        finish(new Error('Codex login is required. Run `codex login` and test the connection again.'));
        return;
      }
      finish(undefined, { authMode: typeof account?.type === 'string' ? account.type : 'external-provider' });
    });

    send({
      method: 'initialize',
      id: 1,
      params: {
        clientInfo: {
          name: 'retake_whiteboard',
          title: 'Retake Whiteboard',
          version: '0.1.0',
        },
      },
    });
  });
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
