import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  executionProviderDefinition,
  listExecutionProviderDefinitions,
  type ExecutionCapabilityClass,
  type ExecutionConnectionStatus,
  type ExecutionDefaultSelection,
  type ExecutionProviderSettingsSnapshot,
} from '../../src/core/executionProviders';
import { dreaminaCliAvailability } from '../dreamina-cli-client';
import { probeOpenAICompatibleConnection } from '../openai-compatible-client';
import { readSeedanceModelArkConfig } from '../seedance-modelark-client';
import { retakeRoot, writeJson } from './context';

interface StoredExecutionConnection {
  connectionId: string;
  providerId: string;
  displayName?: string;
  enabled: boolean;
  baseUrl?: string;
  model?: string;
  lastCheckedAt?: string;
  lastError?: string;
  updatedAt: string;
}

interface StoredConnectionsFile {
  schemaVersion: 1;
  connections: StoredExecutionConnection[];
}

interface StoredCredential {
  apiKey: string;
  updatedAt: string;
}

interface StoredCredentialsFile {
  schemaVersion: 1;
  credentials: Record<string, StoredCredential>;
}

interface StoredDefaultsFile {
  schemaVersion: 1;
  workspace: ExecutionDefaultSelection[];
  projects: Record<string, ExecutionDefaultSelection[]>;
}

export interface UpdateExecutionConnectionInput {
  providerId: string;
  displayName?: string;
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
}

const settingsRoot = path.join(retakeRoot, 'settings');
const connectionsPath = path.join(settingsRoot, 'execution-connections.json');
const credentialsPath = path.join(settingsRoot, 'credentials.json');
const defaultsPath = path.join(settingsRoot, 'execution-defaults.json');

export async function listExecutionProviderSettings(projectId?: string): Promise<ExecutionProviderSettingsSnapshot> {
  const [connectionsFile, credentialsFile, defaultsFile] = await Promise.all([
    readConnections(),
    readCredentials(),
    readDefaults(),
  ]);
  const storedByProvider = new Map(connectionsFile.connections.map((connection) => [connection.providerId, connection]));

  const connections = await Promise.all(listExecutionProviderDefinitions().map(async (definition) => {
    const stored = storedByProvider.get(definition.providerId);
    const hasCredential = Boolean(credentialsFile.credentials[definition.providerId]?.apiKey)
      || hasEnvironmentCredential(definition.providerId);
    const status = await passiveStatus(
      definition.providerId,
      definition.packageStatus,
      hasCredential,
      stored?.enabled !== false,
      stored?.lastError,
    );
    return {
      connectionId: definition.providerId,
      providerId: definition.providerId,
      displayName: stored?.displayName || definition.displayName,
      description: definition.description,
      connectionKind: definition.connectionKind,
      implementationKind: definition.implementationKind,
      packageStatus: definition.packageStatus,
      supportedCapabilityIds: [...definition.supportedCapabilityIds],
      capabilityClasses: [...definition.capabilityClasses],
      configurable: definition.configurable,
      enabled: stored?.enabled !== false,
      status,
      hasCredential,
      baseUrl: stored?.baseUrl || definition.defaultBaseUrl,
      model: stored?.model || definition.defaultModel,
      lastCheckedAt: stored?.lastCheckedAt,
      lastError: stored?.lastError,
    };
  }));

  return {
    connections,
    workspaceDefaults: cloneDefaults(defaultsFile.workspace),
    projectDefaults: projectId ? cloneDefaults(defaultsFile.projects[projectId] ?? []) : [],
  };
}

export async function updateExecutionConnection(
  input: UpdateExecutionConnectionInput,
  projectId?: string,
): Promise<ExecutionProviderSettingsSnapshot> {
  const definition = executionProviderDefinition(input.providerId);
  if (!definition || definition.packageStatus !== 'installed' || !definition.configurable) {
    throw new Error(`Execution provider is not configurable: ${input.providerId}`);
  }
  const connectionsFile = await readConnections();
  const existing = connectionsFile.connections.find((connection) => connection.providerId === input.providerId);
  const now = new Date().toISOString();
  const next: StoredExecutionConnection = {
    connectionId: input.providerId,
    providerId: input.providerId,
    displayName: cleanOptional(input.displayName) || existing?.displayName,
    enabled: input.enabled ?? existing?.enabled ?? true,
    baseUrl: cleanOptional(input.baseUrl) || existing?.baseUrl || definition.defaultBaseUrl,
    model: cleanOptional(input.model) || existing?.model || definition.defaultModel,
    updatedAt: now,
  };
  connectionsFile.connections = [
    ...connectionsFile.connections.filter((connection) => connection.providerId !== input.providerId),
    next,
  ];
  await writeJson(connectionsPath, connectionsFile);
  if (cleanOptional(input.apiKey)) await writeCredential(input.providerId, input.apiKey!.trim());
  return listExecutionProviderSettings(projectId);
}

export async function checkExecutionConnection(
  providerId: string,
  projectId?: string,
): Promise<ExecutionProviderSettingsSnapshot> {
  const definition = executionProviderDefinition(providerId);
  if (!definition || definition.packageStatus !== 'installed') throw new Error(`Provider package is not installed: ${providerId}`);
  const connectionsFile = await readConnections();
  const existing = connectionsFile.connections.find((connection) => connection.providerId === providerId);
  let error: string | undefined;
  try {
    if (providerId === 'dreamina') {
      const availability = await dreaminaCliAvailability();
      if (!availability.available) throw new Error(availability.reason);
    } else if (providerId === 'openai-compatible') {
      const connection = await resolveExecutionConnection(providerId);
      if (!connection?.apiKey || !connection.baseUrl || !connection.model) {
        throw new Error('API key, base URL, and model are required.');
      }
      await probeOpenAICompatibleConnection(connection);
    } else if (providerId === 'byteplus-modelark' && !await resolveExecutionConnection(providerId)) {
      throw new Error('API key is required.');
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Connection check failed.';
  }

  const now = new Date().toISOString();
  const connection: StoredExecutionConnection = {
    connectionId: providerId,
    providerId,
    displayName: existing?.displayName,
    enabled: existing?.enabled ?? true,
    baseUrl: existing?.baseUrl || definition.defaultBaseUrl,
    model: existing?.model || definition.defaultModel,
    lastCheckedAt: now,
    lastError: error,
    updatedAt: now,
  };
  connectionsFile.connections = [
    ...connectionsFile.connections.filter((candidate) => candidate.providerId !== providerId),
    connection,
  ];
  await writeJson(connectionsPath, connectionsFile);
  return listExecutionProviderSettings(projectId);
}

export async function saveExecutionDefault(input: {
  capabilityClass: ExecutionCapabilityClass;
  connectionId?: string;
  projectId?: string;
  responseProjectId?: string;
  model?: string;
}): Promise<ExecutionProviderSettingsSnapshot> {
  const defaults = await readDefaults();
  if (!input.connectionId) {
    if (input.projectId) {
      defaults.projects[input.projectId] = removeDefault(defaults.projects[input.projectId] ?? [], input.capabilityClass);
    } else {
      defaults.workspace = removeDefault(defaults.workspace, input.capabilityClass);
    }
    await writeJson(defaultsPath, defaults);
    return listExecutionProviderSettings(input.responseProjectId ?? input.projectId);
  }
  const definition = executionProviderDefinition(input.connectionId);
  if (!definition?.capabilityClasses.includes(input.capabilityClass)) {
    throw new Error(`${input.connectionId} does not support ${input.capabilityClass}.`);
  }
  const connection = (await listExecutionProviderSettings(input.responseProjectId ?? input.projectId))
    .connections.find((candidate) => candidate.connectionId === input.connectionId);
  if (connection?.status !== 'ready') {
    throw new Error(`${input.connectionId} is not ready and cannot be selected as a default.`);
  }
  const selection: ExecutionDefaultSelection = {
    capabilityClass: input.capabilityClass,
    connectionId: input.connectionId,
    ...(cleanOptional(input.model) ? { model: input.model!.trim() } : {}),
  };
  if (input.projectId) {
    defaults.projects[input.projectId] = replaceDefault(defaults.projects[input.projectId] ?? [], selection);
  } else {
    defaults.workspace = replaceDefault(defaults.workspace, selection);
  }
  await writeJson(defaultsPath, defaults);
  return listExecutionProviderSettings(input.responseProjectId ?? input.projectId);
}

export async function resolveExecutionConnection(providerId: string): Promise<{
  apiKey: string;
  baseUrl: string;
  model: string;
} | undefined> {
  const definition = executionProviderDefinition(providerId);
  if (!definition) return undefined;
  const [connections, credentials] = await Promise.all([readConnections(), readCredentials()]);
  const stored = connections.connections.find((connection) => connection.providerId === providerId);
  const apiKey = credentials.credentials[providerId]?.apiKey || environmentApiKey(providerId);
  const baseUrl = stored?.baseUrl || environmentBaseUrl(providerId) || definition.defaultBaseUrl;
  const model = stored?.model || environmentModel(providerId) || definition.defaultModel;
  if (!apiKey || !baseUrl || !model || stored?.enabled === false) return undefined;
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, ''), model };
}

async function passiveStatus(
  providerId: string,
  packageStatus: 'installed' | 'available',
  hasCredential: boolean,
  enabled: boolean,
  lastError?: string,
): Promise<ExecutionConnectionStatus> {
  if (packageStatus !== 'installed') return 'not_installed';
  if (!enabled) return 'unavailable';
  if (providerId === 'dreamina') return (await dreaminaCliAvailability()).available ? 'ready' : 'needs_login';
  if (providerId === 'codex-managed' || providerId === 'retake-mock') return 'ready';
  if (!hasCredential) return 'needs_credentials';
  if (lastError) return 'unavailable';
  return 'ready';
}

async function readConnections(): Promise<StoredConnectionsFile> {
  return readOptionalJson(connectionsPath, { schemaVersion: 1, connections: [] });
}

async function readCredentials(): Promise<StoredCredentialsFile> {
  return readOptionalJson(credentialsPath, { schemaVersion: 1, credentials: {} });
}

async function readDefaults(): Promise<StoredDefaultsFile> {
  return readOptionalJson(defaultsPath, { schemaVersion: 1, workspace: [], projects: {} });
}

async function readOptionalJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeCredential(connectionId: string, apiKey: string): Promise<void> {
  const credentials = await readCredentials();
  credentials.credentials[connectionId] = { apiKey, updatedAt: new Date().toISOString() };
  await mkdir(settingsRoot, { recursive: true });
  await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(credentialsPath, 0o600);
}

function hasEnvironmentCredential(providerId: string): boolean {
  return Boolean(environmentApiKey(providerId));
}

function environmentApiKey(providerId: string): string | undefined {
  if (providerId === 'byteplus-modelark') return readSeedanceModelArkConfig()?.apiKey;
  if (providerId === 'openai-compatible') return process.env.OPENAI_COMPATIBLE_API_KEY?.trim();
  return undefined;
}

function environmentBaseUrl(providerId: string): string | undefined {
  if (providerId === 'byteplus-modelark') return readSeedanceModelArkConfig()?.baseUrl;
  if (providerId === 'openai-compatible') return process.env.OPENAI_COMPATIBLE_BASE_URL?.trim();
  return undefined;
}

function environmentModel(providerId: string): string | undefined {
  if (providerId === 'byteplus-modelark') return readSeedanceModelArkConfig()?.model;
  if (providerId === 'openai-compatible') return process.env.OPENAI_COMPATIBLE_MODEL?.trim();
  return undefined;
}

function replaceDefault(
  defaults: ExecutionDefaultSelection[],
  selection: ExecutionDefaultSelection,
): ExecutionDefaultSelection[] {
  return [...defaults.filter((candidate) => candidate.capabilityClass !== selection.capabilityClass), selection];
}

function removeDefault(
  defaults: ExecutionDefaultSelection[],
  capabilityClass: ExecutionCapabilityClass,
): ExecutionDefaultSelection[] {
  return defaults.filter((candidate) => candidate.capabilityClass !== capabilityClass);
}

function cloneDefaults(defaults: ExecutionDefaultSelection[]): ExecutionDefaultSelection[] {
  return defaults.map((selection) => ({ ...selection }));
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}
