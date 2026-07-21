import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  executionConnectorDefinition,
  type ExecutionDefaultSelection,
  type ExecutionUseCase,
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
  modelId?: string;
  enabledUseCases?: ExecutionUseCase[];
  lastCheckedAt?: string;
  lastCheckMessage?: string;
  lastError?: string;
  updatedAt: string;
}

export interface StoredConnectionsFile {
  schemaVersion: 4;
  connections: StoredExecutionConnection[];
}

export interface StoredCredentialsFile {
  schemaVersion: 1;
  credentials: Record<string, { apiKey: string; updatedAt: string }>;
}

export interface StoredDefaultsFile {
  schemaVersion: 3;
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
    if (parsed.schemaVersion === 4) return parsed as unknown as StoredConnectionsFile;
    return {
      schemaVersion: 4,
      connections: (parsed.connections ?? []).flatMap(
        parsed.schemaVersion === 3
          ? migrateV3Connection
          : parsed.schemaVersion === 2
            ? migrateV2Connection
            : migrateV1Connection,
      ),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 4, connections: [] };
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
  const parsed = await readOptionalJson<{
    workspace?: Array<Record<string, unknown>>;
    projects?: Record<string, Array<Record<string, unknown>>>;
  }>(defaultsPath, { workspace: [], projects: {} });
  return {
    schemaVersion: 3,
    workspace: normalizeDefaults(parsed.workspace ?? []),
    projects: Object.fromEntries(Object.entries(parsed.projects ?? {}).map(
      ([projectId, defaults]) => [projectId, normalizeDefaults(defaults)],
    )),
  };
}

export async function writeExecutionDefaults(defaults: StoredDefaultsFile): Promise<void> {
  await writeJson(defaultsPath, defaults);
}

function migrateV1Connection(value: Record<string, unknown>): StoredExecutionConnection[] {
  const providerId = typeof value.providerId === 'string' ? value.providerId : undefined;
  if (!providerId || !executionConnectorDefinition(providerId)) return [];
  const connector = executionConnectorDefinition(providerId)!;
  const modelId = cleanString(value.model) || connector.defaultModelId;
  return [{
    connectionId: typeof value.connectionId === 'string' ? value.connectionId : providerId,
    connectorId: providerId,
    providerLabel: connector.displayName,
    displayName: typeof value.displayName === 'string' && value.displayName.trim() ? value.displayName.trim() : connector.displayName,
    enabled: value.enabled !== false,
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : connector.defaultBaseUrl,
    ...(modelId ? { modelId } : {}),
    enabledUseCases: [...connector.defaultUseCases],
    ...(typeof value.lastCheckedAt === 'string' ? { lastCheckedAt: value.lastCheckedAt } : {}),
    ...(typeof value.lastCheckMessage === 'string' ? { lastCheckMessage: value.lastCheckMessage } : {}),
    ...(typeof value.lastError === 'string' ? { lastError: value.lastError } : {}),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString(),
  }];
}

function migrateV2Connection(value: Record<string, unknown>): StoredExecutionConnection[] {
  const connectorId = cleanString(value.connectorId);
  if (!connectorId || !executionConnectorDefinition(connectorId)) return [];
  const models = Array.isArray(value.models) ? value.models : [];
  const defaultModelId = cleanString(value.defaultModelId);
  const configuredModelIds = models.flatMap((model) => {
    if (!model || typeof model !== 'object') return [];
    const modelId = cleanString((model as Record<string, unknown>).modelId);
    return modelId ? [modelId] : [];
  });
  const modelId = defaultModelId && configuredModelIds.includes(defaultModelId)
    ? defaultModelId
    : configuredModelIds[0] || executionConnectorDefinition(connectorId)?.defaultModelId;
  return [{
    connectionId: cleanString(value.connectionId) || connectorId,
    connectorId,
    ...(cleanString(value.templateId) ? { templateId: cleanString(value.templateId) } : {}),
    ...(cleanString(value.providerLabel) ? { providerLabel: cleanString(value.providerLabel) } : {}),
    displayName: cleanString(value.displayName) || executionConnectorDefinition(connectorId)!.displayName,
    enabled: value.enabled !== false,
    ...(cleanString(value.baseUrl) ? { baseUrl: cleanString(value.baseUrl) } : {}),
    ...(modelId ? { modelId } : {}),
    enabledUseCases: [...executionConnectorDefinition(connectorId)!.defaultUseCases],
    ...(cleanString(value.lastCheckedAt) ? { lastCheckedAt: cleanString(value.lastCheckedAt) } : {}),
    ...(cleanString(value.lastCheckMessage) ? { lastCheckMessage: cleanString(value.lastCheckMessage) } : {}),
    ...(cleanString(value.lastError) ? { lastError: cleanString(value.lastError) } : {}),
    updatedAt: cleanString(value.updatedAt) || new Date().toISOString(),
  }];
}

function migrateV3Connection(value: Record<string, unknown>): StoredExecutionConnection[] {
  const connectorId = cleanString(value.connectorId);
  if (!connectorId || !executionConnectorDefinition(connectorId)) return [];
  const connector = executionConnectorDefinition(connectorId)!;
  return [{
    connectionId: cleanString(value.connectionId) || connectorId,
    connectorId,
    ...(cleanString(value.templateId) ? { templateId: cleanString(value.templateId) } : {}),
    ...(cleanString(value.providerLabel) ? { providerLabel: cleanString(value.providerLabel) } : {}),
    displayName: cleanString(value.displayName) || connector.displayName,
    enabled: value.enabled !== false,
    ...(cleanString(value.baseUrl) ? { baseUrl: cleanString(value.baseUrl) } : {}),
    ...(cleanString(value.modelId) ? { modelId: cleanString(value.modelId) } : {}),
    enabledUseCases: normalizeUseCases(value.enabledUseCases, connector.defaultUseCases),
    ...(cleanString(value.lastCheckedAt) ? { lastCheckedAt: cleanString(value.lastCheckedAt) } : {}),
    ...(cleanString(value.lastCheckMessage) ? { lastCheckMessage: cleanString(value.lastCheckMessage) } : {}),
    ...(cleanString(value.lastError) ? { lastError: cleanString(value.lastError) } : {}),
    updatedAt: cleanString(value.updatedAt) || new Date().toISOString(),
  }];
}

function cleanString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeDefaults(values: Array<Record<string, unknown>>): ExecutionDefaultSelection[] {
  const defaults = values.flatMap((value) => {
    const rawUseCase = cleanString(value.useCase) || cleanString(value.capabilityClass);
    const useCase = rawUseCase === 'document' ? 'text' : rawUseCase;
    const connectionId = cleanString(value.connectionId);
    if (!useCase || !isExecutionUseCase(useCase) || !connectionId) return [];
    return [{ useCase, connectionId }];
  });
  return [...new Map(defaults.map((selection) => [selection.useCase, selection])).values()];
}

function normalizeUseCases(value: unknown, fallback: ExecutionUseCase[]): ExecutionUseCase[] {
  if (!Array.isArray(value)) return [...fallback];
  return [...new Set(value.filter((candidate): candidate is ExecutionUseCase =>
    typeof candidate === 'string' && isExecutionUseCase(candidate)))];
}

function isExecutionUseCase(value: string): value is ExecutionUseCase {
  return value === 'text' || value === 'image' || value === 'video' || value === 'audio';
}

async function readOptionalJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}
