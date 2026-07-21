import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  executionConnectorDefinition,
  type ExecutionDefaultSelection,
  type ExecutionModelConfiguration,
} from '../../src/core/executionProviders';
import { retakeRoot, writeJson } from './context';

export interface StoredExecutionConnection {
  connectionId: string;
  connectorId: string;
  templateId?: string;
  providerLabel?: string;
  displayName: string;
  enabled: boolean;
  baseUrl?: string;
  models: ExecutionModelConfiguration[];
  defaultModelId?: string;
  lastCheckedAt?: string;
  lastError?: string;
  updatedAt: string;
}

export interface StoredConnectionsFile {
  schemaVersion: 2;
  connections: StoredExecutionConnection[];
}

export interface StoredCredentialsFile {
  schemaVersion: 1;
  credentials: Record<string, { apiKey: string; updatedAt: string }>;
}

export interface StoredDefaultsFile {
  schemaVersion: 1;
  workspace: ExecutionDefaultSelection[];
  projects: Record<string, ExecutionDefaultSelection[]>;
}

const settingsRoot = path.join(retakeRoot, 'settings');
const connectionsPath = path.join(settingsRoot, 'execution-connections.json');
const credentialsPath = path.join(settingsRoot, 'credentials.json');
const defaultsPath = path.join(settingsRoot, 'execution-defaults.json');

export async function readExecutionConnections(): Promise<StoredConnectionsFile> {
  try {
    const parsed = JSON.parse(await readFile(connectionsPath, 'utf8')) as {
      schemaVersion?: number;
      connections?: Array<Record<string, unknown>>;
    };
    if (parsed.schemaVersion === 2) return parsed as unknown as StoredConnectionsFile;
    return {
      schemaVersion: 2,
      connections: (parsed.connections ?? []).flatMap(migrateV1Connection),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 2, connections: [] };
    throw error;
  }
}

export async function writeExecutionConnections(connections: StoredConnectionsFile): Promise<void> {
  await writeJson(connectionsPath, connections);
}

export async function readExecutionCredentials(): Promise<StoredCredentialsFile> {
  return readOptionalJson(credentialsPath, { schemaVersion: 1, credentials: {} });
}

export async function writeExecutionCredential(connectionId: string, apiKey: string): Promise<void> {
  const credentials = await readExecutionCredentials();
  credentials.credentials[connectionId] = { apiKey, updatedAt: new Date().toISOString() };
  await writeExecutionCredentials(credentials);
}

export async function writeExecutionCredentials(credentials: StoredCredentialsFile): Promise<void> {
  await mkdir(settingsRoot, { recursive: true });
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(credentialsPath, 0o600);
}

export async function readExecutionDefaults(): Promise<StoredDefaultsFile> {
  return readOptionalJson(defaultsPath, { schemaVersion: 1, workspace: [], projects: {} });
}

export async function writeExecutionDefaults(defaults: StoredDefaultsFile): Promise<void> {
  await writeJson(defaultsPath, defaults);
}

function migrateV1Connection(value: Record<string, unknown>): StoredExecutionConnection[] {
  const providerId = typeof value.providerId === 'string' ? value.providerId : undefined;
  if (!providerId || !executionConnectorDefinition(providerId)) return [];
  const connector = executionConnectorDefinition(providerId)!;
  const model = typeof value.model === 'string' && value.model.trim() ? value.model.trim() : connector.defaultModels?.[0]?.modelId;
  const models = model ? [{ modelId: model }] : [];
  return [{
    connectionId: typeof value.connectionId === 'string' ? value.connectionId : providerId,
    connectorId: providerId,
    providerLabel: connector.displayName,
    displayName: typeof value.displayName === 'string' && value.displayName.trim() ? value.displayName.trim() : connector.displayName,
    enabled: value.enabled !== false,
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : connector.defaultBaseUrl,
    models,
    ...(model ? { defaultModelId: model } : {}),
    ...(typeof value.lastCheckedAt === 'string' ? { lastCheckedAt: value.lastCheckedAt } : {}),
    ...(typeof value.lastError === 'string' ? { lastError: value.lastError } : {}),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  }];
}

async function readOptionalJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}
