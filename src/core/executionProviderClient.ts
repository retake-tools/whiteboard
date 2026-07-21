import type {
  ExecutionCapabilityClass,
  ExecutionProviderSettingsSnapshot,
} from './executionProviders';
import { cacheExecutionProviderSettings } from './executionProviderPreferences';

export async function loadExecutionProviderSettings(projectId?: string): Promise<ExecutionProviderSettingsSnapshot> {
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  const snapshot = await readJsonResponse<ExecutionProviderSettingsSnapshot>(await fetch(`/api/local/settings/execution${query}`));
  cacheExecutionProviderSettings(projectId, snapshot);
  return snapshot;
}

export async function updateExecutionProviderConnection(input: {
  providerId: string;
  projectId?: string;
  displayName?: string;
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}): Promise<ExecutionProviderSettingsSnapshot> {
  const snapshot = await readJsonResponse<ExecutionProviderSettingsSnapshot>(await fetch(
    `/api/local/settings/execution/connections/${encodeURIComponent(input.providerId)}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  ));
  cacheExecutionProviderSettings(input.projectId, snapshot);
  return snapshot;
}

export async function checkExecutionProviderConnection(
  providerId: string,
  projectId?: string,
): Promise<ExecutionProviderSettingsSnapshot> {
  const snapshot = await readJsonResponse<ExecutionProviderSettingsSnapshot>(await fetch(
    `/api/local/settings/execution/connections/${encodeURIComponent(providerId)}/check`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId }),
    },
  ));
  cacheExecutionProviderSettings(projectId, snapshot);
  return snapshot;
}

export async function saveExecutionProviderDefault(input: {
  capabilityClass: ExecutionCapabilityClass;
  connectionId?: string;
  projectId?: string;
  responseProjectId?: string;
  model?: string;
}): Promise<ExecutionProviderSettingsSnapshot> {
  const snapshot = await readJsonResponse<ExecutionProviderSettingsSnapshot>(await fetch('/api/local/settings/execution/defaults', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }));
  cacheExecutionProviderSettings(input.responseProjectId ?? input.projectId, snapshot);
  return snapshot;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => undefined) as T & { error?: string } | undefined;
  if (!response.ok) throw new Error(body?.error ?? `Execution provider request failed (${response.status}).`);
  return body as T;
}
