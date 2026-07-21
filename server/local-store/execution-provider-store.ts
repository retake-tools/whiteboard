import {
  executionConnectionTemplate,
  executionConnectorDefinition,
  listExecutionConnectionTemplates,
  listExecutionConnectorDefinitions,
  type ExecutionCapabilityClass,
  type ExecutionConnectionStatus,
  type ExecutionDefaultSelection,
  type ExecutionProviderSettingsSnapshot,
} from '../../src/core/executionProviders';
import { createId } from '../../src/core/id';
import { probeNativeTextConnection } from '../ai-sdk-native-text-client';
import { codexAppServerAvailability, probeCodexAppServerConnection } from '../codex-app-server-client';
import { dreaminaCliAvailability, probeDreaminaCliConnection } from '../dreamina-cli-client';
import { probeOpenAICompatibleConnection } from '../openai-compatible-client';
import { probeSeedanceModelArkConnection, readSeedanceModelArkConfig } from '../seedance-modelark-client';
import { probeVolcengineArkImageConnection } from '../volcengine-ark-image-client';
import {
  readExecutionConnections,
  readExecutionCredentials,
  readExecutionDefaults,
  writeExecutionConnections,
  writeExecutionCredential,
  writeExecutionCredentials,
  writeExecutionDefaults,
  type StoredExecutionConnection,
} from './execution-provider-storage';

export interface CreateExecutionConnectionInput {
  templateId: string;
  displayName: string;
  providerLabel?: string;
  baseUrl?: string;
  modelId?: string;
  apiKey?: string;
}

export interface UpdateExecutionConnectionInput {
  displayName?: string;
  providerLabel?: string;
  enabled?: boolean;
  baseUrl?: string;
  modelId?: string;
  apiKey?: string;
}

interface FixedConnectionDefinition {
  connectionId: string;
  connectorId: string;
  displayName: string;
  providerLabel: string;
  configurable: boolean;
}

export interface ExecutionConnectionCheckDependencies {
  probeCodexAppServer?: typeof probeCodexAppServerConnection;
  probeDreaminaCli?: typeof probeDreaminaCliConnection;
  probeModelArk?: typeof probeSeedanceModelArkConnection;
  probeNativeText?: typeof probeNativeTextConnection;
  probeOpenAICompatible?: typeof probeOpenAICompatibleConnection;
  probeVolcengineArkImage?: typeof probeVolcengineArkImageConnection;
}

const fixedConnections: FixedConnectionDefinition[] = [
  {
    connectionId: 'retake-mock',
    connectorId: 'retake-mock',
    displayName: 'Retake Mock',
    providerLabel: 'Retake',
    configurable: false,
  },
  {
    connectionId: 'codex-managed',
    connectorId: 'codex-managed',
    displayName: 'Codex MCP',
    providerLabel: 'Codex',
    configurable: false,
  },
  {
    connectionId: 'codex-app-server',
    connectorId: 'codex-app-server',
    displayName: 'Codex App Server',
    providerLabel: 'Codex',
    configurable: false,
  },
  {
    connectionId: 'dreamina',
    connectorId: 'dreamina',
    displayName: 'Dreamina CLI',
    providerLabel: 'Dreamina',
    configurable: false,
  },
  {
    connectionId: 'byteplus-modelark',
    connectorId: 'byteplus-modelark',
    displayName: 'BytePlus ModelArk',
    providerLabel: 'BytePlus ModelArk',
    configurable: true,
  },
];

export async function listExecutionProviderSettings(projectId?: string): Promise<ExecutionProviderSettingsSnapshot> {
  const [connectionsFile, credentialsFile, defaultsFile] = await Promise.all([
    readExecutionConnections(),
    readExecutionCredentials(),
    readExecutionDefaults(),
  ]);
  const storedById = new Map(connectionsFile.connections.map((connection) => [connection.connectionId, connection]));
  const connectionIds = [
    ...fixedConnections.map((connection) => connection.connectionId),
    ...connectionsFile.connections
      .filter((connection) => !fixedConnections.some((fixed) => fixed.connectionId === connection.connectionId))
      .map((connection) => connection.connectionId),
  ];
  const fixedById = new Map(fixedConnections.map((connection) => [connection.connectionId, connection]));

  const connections = await Promise.all(connectionIds.map(async (connectionId) => {
    const fixed = fixedById.get(connectionId);
    const stored = storedById.get(connectionId);
    const connectorId = stored?.connectorId ?? fixed?.connectorId;
    const connector = connectorId ? executionConnectorDefinition(connectorId) : undefined;
    if (!connector) return undefined;
    const template = stored?.templateId ? executionConnectionTemplate(stored.templateId) : undefined;
    const modelId = stored?.modelId || environmentModel(connectionId) || connector.defaultModelId;
    const hasCredential = Boolean(credentialsFile.credentials[connectionId]?.apiKey)
      || hasEnvironmentCredential(connectionId);
    const baseUrl = stored?.baseUrl || environmentBaseUrl(connectionId) || template?.defaultBaseUrl || connector.defaultBaseUrl;
    const enabled = stored?.enabled !== false;
    const status = await passiveStatus({
      baseUrl,
      connectionId,
      connectorId: connector.connectorId,
      modelId,
      enabled,
      hasCredential,
      installStatus: connector.installStatus,
      lastCheckedAt: stored?.lastCheckedAt,
      lastError: stored?.lastError,
      requiresCredential: connector.requiresCredential,
    });
    return {
      connectionId,
      connectorId: connector.connectorId,
      ...(stored?.templateId ? { templateId: stored.templateId } : {}),
      providerLabel: stored?.providerLabel || template?.providerLabel || fixed?.providerLabel || connector.displayName,
      displayName: stored?.displayName || fixed?.displayName || template?.displayName || connector.displayName,
      description: template?.description || connector.description,
      connectionKind: connector.connectionKind,
      implementationKind: connector.implementationKind,
      supportedCapabilityIds: [...connector.supportedCapabilityIds],
      capabilityClasses: [...connector.capabilityClasses],
      configurable: fixed?.configurable ?? connector.connectionMode === 'multiple',
      deletable: !fixed,
      enabled,
      status,
      hasCredential,
      ...(baseUrl ? { baseUrl } : {}),
      ...(modelId ? { modelId } : {}),
      ...(stored?.lastCheckedAt ? { lastCheckedAt: stored.lastCheckedAt } : {}),
      ...(stored?.lastCheckMessage ? { lastCheckMessage: stored.lastCheckMessage } : {}),
      ...(stored?.lastError ? { lastError: stored.lastError } : {}),
    };
  }));

  return {
    connectors: listExecutionConnectorDefinitions(),
    connectionTemplates: listExecutionConnectionTemplates().filter((template) =>
      executionConnectorDefinition(template.connectorId)?.installStatus === 'installed'),
    connections: connections.filter((connection) => connection !== undefined),
    workspaceDefaults: cloneDefaults(defaultsFile.workspace),
    projectDefaults: projectId ? cloneDefaults(defaultsFile.projects[projectId] ?? []) : [],
  };
}

export async function createExecutionConnection(
  input: CreateExecutionConnectionInput,
  projectId?: string,
): Promise<ExecutionProviderSettingsSnapshot> {
  const template = executionConnectionTemplate(input.templateId);
  const connector = template ? executionConnectorDefinition(template.connectorId) : undefined;
  if (!template || !connector || connector.installStatus !== 'installed' || connector.connectionMode !== 'multiple') {
    throw new Error(`Connection template is unavailable: ${input.templateId}`);
  }
  const displayName = requireText(input.displayName, 'Connection name is required.');
  const modelId = cleanOptional(input.modelId) || template.defaultModelId || connector.defaultModelId;
  const connectionId = createId('connection');
  const connectionsFile = await readExecutionConnections();
  connectionsFile.connections.push({
    connectionId,
    connectorId: connector.connectorId,
    templateId: template.templateId,
    providerLabel: cleanOptional(input.providerLabel) || template.providerLabel,
    displayName,
    enabled: true,
    baseUrl: cleanOptional(input.baseUrl) || template.defaultBaseUrl || connector.defaultBaseUrl,
    ...(modelId ? { modelId } : {}),
    updatedAt: new Date().toISOString(),
  });
  await writeExecutionConnections(connectionsFile);
  if (cleanOptional(input.apiKey)) await writeExecutionCredential(connectionId, input.apiKey!.trim());
  return listExecutionProviderSettings(projectId);
}

export async function updateExecutionConnection(
  connectionId: string,
  input: UpdateExecutionConnectionInput,
  projectId?: string,
): Promise<ExecutionProviderSettingsSnapshot> {
  const connectionsFile = await readExecutionConnections();
  const existing = connectionsFile.connections.find((connection) => connection.connectionId === connectionId);
  const fixed = fixedConnections.find((connection) => connection.connectionId === connectionId);
  const connectorId = existing?.connectorId ?? fixed?.connectorId;
  const connector = connectorId ? executionConnectorDefinition(connectorId) : undefined;
  if (!connector || !(fixed?.configurable ?? connector.connectionMode === 'multiple')) {
    throw new Error(`Execution connection is not configurable: ${connectionId}`);
  }
  const template = existing?.templateId ? executionConnectionTemplate(existing.templateId) : undefined;
  const modelId = cleanOptional(input.modelId)
    || existing?.modelId
    || template?.defaultModelId
    || connector.defaultModelId;
  const next: StoredExecutionConnection = {
    connectionId,
    connectorId: connector.connectorId,
    ...(existing?.templateId ? { templateId: existing.templateId } : {}),
    providerLabel: cleanOptional(input.providerLabel) || existing?.providerLabel || template?.providerLabel || connector.displayName,
    displayName: cleanOptional(input.displayName) || existing?.displayName || fixed?.displayName || template?.displayName || connector.displayName,
    enabled: input.enabled ?? existing?.enabled ?? true,
    baseUrl: cleanOptional(input.baseUrl) || existing?.baseUrl || template?.defaultBaseUrl || connector.defaultBaseUrl,
    ...(modelId ? { modelId } : {}),
    updatedAt: new Date().toISOString(),
  };
  connectionsFile.connections = [
    ...connectionsFile.connections.filter((connection) => connection.connectionId !== connectionId),
    next,
  ];
  await writeExecutionConnections(connectionsFile);
  if (cleanOptional(input.apiKey)) await writeExecutionCredential(connectionId, input.apiKey!.trim());
  return listExecutionProviderSettings(projectId);
}

export async function duplicateExecutionConnection(
  sourceConnectionId: string,
  projectId?: string,
): Promise<{ duplicatedConnectionId: string; snapshot: ExecutionProviderSettingsSnapshot }> {
  const [settings, connectionsFile, credentials] = await Promise.all([
    listExecutionProviderSettings(projectId),
    readExecutionConnections(),
    readExecutionCredentials(),
  ]);
  const source = settings.connections.find((connection) => connection.connectionId === sourceConnectionId);
  const connector = source ? executionConnectorDefinition(source.connectorId) : undefined;
  if (!source || !connector || connector.connectionMode !== 'multiple') {
    throw new Error(`Execution connection cannot be duplicated: ${sourceConnectionId}`);
  }
  const existing = connectionsFile.connections.find((connection) => connection.connectionId === sourceConnectionId);
  const templates = listExecutionConnectionTemplates();
  const fallbackTemplate = templates.find((template) => template.templateId === source.connectorId)
    ?? templates.find((template) =>
      template.connectorId === source.connectorId && template.templateId.startsWith('custom-'));
  const sourceTemplateId = existing?.templateId || fallbackTemplate?.templateId;
  const duplicatedConnectionId = createId('connection');
  connectionsFile.connections.push({
    connectionId: duplicatedConnectionId,
    connectorId: source.connectorId,
    ...(sourceTemplateId ? { templateId: sourceTemplateId } : {}),
    providerLabel: source.providerLabel,
    displayName: `${source.displayName} copy`,
    enabled: true,
    ...(source.baseUrl ? { baseUrl: source.baseUrl } : {}),
    ...(source.modelId ? { modelId: source.modelId } : {}),
    updatedAt: new Date().toISOString(),
  });
  const sourceCredential = credentials.credentials[sourceConnectionId];
  if (sourceCredential) {
    credentials.credentials[duplicatedConnectionId] = {
      apiKey: sourceCredential.apiKey,
      updatedAt: new Date().toISOString(),
    };
  }
  await Promise.all([
    writeExecutionConnections(connectionsFile),
    ...(sourceCredential ? [writeExecutionCredentials(credentials)] : []),
  ]);
  return {
    duplicatedConnectionId,
    snapshot: await listExecutionProviderSettings(projectId),
  };
}

export async function deleteExecutionConnection(
  connectionId: string,
  projectId?: string,
): Promise<ExecutionProviderSettingsSnapshot> {
  if (fixedConnections.some((connection) => connection.connectionId === connectionId)) {
    throw new Error(`Built-in connection cannot be deleted: ${connectionId}`);
  }
  const [connectionsFile, credentials, defaults] = await Promise.all([
    readExecutionConnections(),
    readExecutionCredentials(),
    readExecutionDefaults(),
  ]);
  if (!connectionsFile.connections.some((connection) => connection.connectionId === connectionId)) {
    throw new Error(`Execution connection not found: ${connectionId}`);
  }
  connectionsFile.connections = connectionsFile.connections.filter((connection) => connection.connectionId !== connectionId);
  delete credentials.credentials[connectionId];
  defaults.workspace = defaults.workspace.filter((selection) => selection.connectionId !== connectionId);
  Object.keys(defaults.projects).forEach((key) => {
    defaults.projects[key] = defaults.projects[key].filter((selection) => selection.connectionId !== connectionId);
  });
  await Promise.all([
    writeExecutionConnections(connectionsFile),
    writeExecutionCredentials(credentials),
    writeExecutionDefaults(defaults),
  ]);
  return listExecutionProviderSettings(projectId);
}

export async function checkExecutionConnection(
  connectionId: string,
  projectId?: string,
  dependencies: ExecutionConnectionCheckDependencies = {},
): Promise<ExecutionProviderSettingsSnapshot> {
  const settings = await listExecutionProviderSettings(projectId);
  const summary = settings.connections.find((connection) => connection.connectionId === connectionId);
  if (!summary) throw new Error(`Execution connection not found: ${connectionId}`);
  let error: string | undefined;
  let checkMessage: string | undefined;
  try {
    if (summary.connectorId === 'dreamina') {
      await (dependencies.probeDreaminaCli ?? probeDreaminaCliConnection)();
      checkMessage = 'Dreamina CLI executable verified. Login and membership are validated again when a task is submitted.';
    } else if (summary.connectorId === 'codex-app-server') {
      const result = await (dependencies.probeCodexAppServer ?? probeCodexAppServerConnection)();
      checkMessage = `Codex App Server handshake succeeded (${result.authMode}).`;
    } else if (summary.connectorId === 'openai-compatible') {
      const connection = await resolveExecutionConnection(connectionId);
      if (!connection?.apiKey || !connection.baseUrl || !connection.model) {
        throw new Error('API key, base URL, and one model ID are required.');
      }
      await (dependencies.probeOpenAICompatible ?? probeOpenAICompatibleConnection)(connection);
      checkMessage = 'Authenticated model request succeeded.';
    } else if (summary.connectorId === 'anthropic-native' || summary.connectorId === 'google-native') {
      const connection = await resolveExecutionConnection(connectionId);
      if (!connection?.apiKey || !connection.baseUrl || !connection.model) {
        throw new Error('API key, base URL, and one model ID are required.');
      }
      await (dependencies.probeNativeText ?? probeNativeTextConnection)(summary.connectorId, connection);
      checkMessage = `Authenticated ${summary.providerLabel} model request succeeded.`;
    } else if (summary.connectorId === 'byteplus-modelark') {
      const connection = await resolveExecutionConnection(connectionId);
      if (!connection?.apiKey || !connection.baseUrl || !connection.model) {
        throw new Error('API key, base URL, and one model ID are required.');
      }
      await (dependencies.probeModelArk ?? probeSeedanceModelArkConnection)({
        apiKey: connection.apiKey,
        baseUrl: connection.baseUrl,
        model: connection.model,
      });
      checkMessage = 'Authenticated ModelArk task-list request succeeded without creating a generation task.';
    } else if (summary.connectorId === 'volcengine-ark') {
      const connection = await resolveExecutionConnection(connectionId);
      if (!connection?.apiKey || !connection.baseUrl || !connection.model) {
        throw new Error('API key, base URL, and one model ID are required.');
      }
      await (dependencies.probeVolcengineArkImage ?? probeVolcengineArkImageConnection)(connection);
      checkMessage = 'Authenticated Seedream image endpoint validation succeeded without generating an asset.';
    } else if (summary.connectorId === 'codex-managed' || summary.connectorId === 'retake-mock') {
      checkMessage = 'Built-in Retake connection is ready.';
    } else {
      throw new Error(`Connection testing is not implemented for ${summary.connectorId}.`);
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : 'Connection check failed.';
    checkMessage = undefined;
  }

  const connectionsFile = await readExecutionConnections();
  const existing = connectionsFile.connections.find((connection) => connection.connectionId === connectionId);
  const fixed = fixedConnections.find((connection) => connection.connectionId === connectionId);
  const connector = executionConnectorDefinition(existing?.connectorId ?? fixed?.connectorId ?? '');
  if (!connector) throw new Error(`Execution connector not found for connection: ${connectionId}`);
  const now = new Date().toISOString();
  const connection: StoredExecutionConnection = {
    connectionId,
    connectorId: connector.connectorId,
    ...(existing?.templateId ? { templateId: existing.templateId } : {}),
    providerLabel: existing?.providerLabel || summary.providerLabel || fixed?.providerLabel || connector.displayName,
    displayName: existing?.displayName || summary.displayName || fixed?.displayName || connector.displayName,
    enabled: existing?.enabled ?? true,
    baseUrl: existing?.baseUrl || summary.baseUrl || connector.defaultBaseUrl,
    modelId: existing?.modelId || summary.modelId || connector.defaultModelId,
    lastCheckedAt: now,
    ...(checkMessage ? { lastCheckMessage: checkMessage } : {}),
    lastError: error,
    updatedAt: now,
  };
  connectionsFile.connections = [
    ...connectionsFile.connections.filter((candidate) => candidate.connectionId !== connectionId),
    connection,
  ];
  await writeExecutionConnections(connectionsFile);
  return listExecutionProviderSettings(projectId);
}

export async function saveExecutionDefault(input: {
  capabilityClass: ExecutionCapabilityClass;
  connectionId?: string;
  projectId?: string;
  responseProjectId?: string;
}): Promise<ExecutionProviderSettingsSnapshot> {
  const defaults = await readExecutionDefaults();
  if (!input.connectionId) {
    if (input.projectId) {
      defaults.projects[input.projectId] = removeDefault(defaults.projects[input.projectId] ?? [], input.capabilityClass);
    } else {
      defaults.workspace = removeDefault(defaults.workspace, input.capabilityClass);
    }
    await writeExecutionDefaults(defaults);
    return listExecutionProviderSettings(input.responseProjectId ?? input.projectId);
  }
  const settings = await listExecutionProviderSettings(input.responseProjectId ?? input.projectId);
  const connection = settings.connections.find((candidate) => candidate.connectionId === input.connectionId);
  if (!connection?.capabilityClasses.includes(input.capabilityClass)) {
    throw new Error(`${input.connectionId} does not support ${input.capabilityClass}.`);
  }
  if (connection.status !== 'ready') {
    throw new Error(`${input.connectionId} is not ready and cannot be selected as a default.`);
  }
  const selection: ExecutionDefaultSelection = {
    capabilityClass: input.capabilityClass,
    connectionId: input.connectionId,
  };
  if (input.projectId) {
    defaults.projects[input.projectId] = replaceDefault(defaults.projects[input.projectId] ?? [], selection);
  } else {
    defaults.workspace = replaceDefault(defaults.workspace, selection);
  }
  await writeExecutionDefaults(defaults);
  return listExecutionProviderSettings(input.responseProjectId ?? input.projectId);
}

export async function resolveExecutionConnection(connectionId: string): Promise<{
  connectionId: string;
  connectorId: string;
  providerLabel: string;
  apiKey: string;
  baseUrl: string;
  model: string;
} | undefined> {
  const [settings, credentials] = await Promise.all([listExecutionProviderSettings(), readExecutionCredentials()]);
  const connection = settings.connections.find((candidate) => candidate.connectionId === connectionId);
  if (!connection || !connection.enabled) return undefined;
  const apiKey = credentials.credentials[connectionId]?.apiKey || environmentApiKey(connectionId);
  const model = connection.modelId;
  if (!apiKey || !connection.baseUrl || !model) return undefined;
  return {
    connectionId,
    connectorId: connection.connectorId,
    providerLabel: connection.providerLabel,
    apiKey,
    baseUrl: connection.baseUrl.replace(/\/$/, ''),
    model,
  };
}

async function passiveStatus(input: {
  baseUrl?: string;
  connectionId: string;
  connectorId: string;
  modelId?: string;
  enabled: boolean;
  hasCredential: boolean;
  installStatus: 'installed' | 'available';
  lastCheckedAt?: string;
  lastError?: string;
  requiresCredential: boolean;
}): Promise<ExecutionConnectionStatus> {
  if (input.installStatus !== 'installed') return 'not_installed';
  if (!input.enabled) return 'unavailable';
  if (input.connectorId === 'dreamina') {
    if (!(await dreaminaCliAvailability()).available) return 'not_installed';
    if (!input.lastCheckedAt) return 'untested';
    return input.lastError ? 'unavailable' : 'ready';
  }
  if (input.connectorId === 'codex-app-server') {
    if (!codexAppServerAvailability().available) return 'not_installed';
    if (!input.lastCheckedAt) return 'untested';
    return input.lastError ? 'unavailable' : 'ready';
  }
  if (input.connectorId === 'codex-managed' || input.connectorId === 'retake-mock') return 'ready';
  if (input.requiresCredential && !input.hasCredential) return 'needs_credentials';
  if (!input.baseUrl || !input.modelId) return 'unavailable';
  if (!input.lastCheckedAt) return 'untested';
  if (input.lastError) return 'unavailable';
  return 'ready';
}

function hasEnvironmentCredential(connectionId: string): boolean {
  return Boolean(environmentApiKey(connectionId));
}

function environmentApiKey(connectionId: string): string | undefined {
  if (connectionId === 'byteplus-modelark') return readSeedanceModelArkConfig()?.apiKey;
  if (connectionId === 'openai-compatible') return process.env.OPENAI_COMPATIBLE_API_KEY?.trim();
  return undefined;
}

function environmentBaseUrl(connectionId: string): string | undefined {
  if (connectionId === 'byteplus-modelark') return readSeedanceModelArkConfig()?.baseUrl;
  if (connectionId === 'openai-compatible') return process.env.OPENAI_COMPATIBLE_BASE_URL?.trim();
  return undefined;
}

function environmentModel(connectionId: string): string | undefined {
  if (connectionId === 'byteplus-modelark') return readSeedanceModelArkConfig()?.model;
  if (connectionId === 'openai-compatible') return process.env.OPENAI_COMPATIBLE_MODEL?.trim();
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

function requireText(value: string | undefined, message: string): string {
  const cleaned = cleanOptional(value);
  if (!cleaned) throw new Error(message);
  return cleaned;
}

function cleanOptional(value: string | undefined): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}
