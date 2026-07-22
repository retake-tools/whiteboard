import { textDocumentCapabilityIds } from './capabilityRegistry';

export type ExecutionConnectionKind = 'model_provider' | 'agent_host' | 'provider_cli' | 'local';

export type AdapterImplementationKind =
  | 'ai_sdk'
  | 'native_api'
  | 'native_async'
  | 'provider_cli'
  | 'agent_bridge'
  | 'local';

export type ExecutionConnectionStatus =
  | 'not_installed'
  | 'needs_credentials'
  | 'needs_login'
  | 'untested'
  | 'checking'
  | 'ready'
  | 'unavailable';

export type ExecutionUseCase = 'text' | 'image' | 'video' | 'audio';

export interface ExecutionConnectorDefinition {
  connectorId: string;
  displayName: string;
  description: string;
  connectionKind: ExecutionConnectionKind;
  implementationKind: AdapterImplementationKind;
  installStatus: 'installed' | 'available';
  connectionMode: 'fixed' | 'multiple';
  requiresCredential: boolean;
  supportedCapabilityIds: string[];
  defaultUseCases: ExecutionUseCase[];
  defaultBaseUrl?: string;
  defaultModelId?: string;
}

export interface ExecutionConnectionTemplate {
  templateId: string;
  connectorId: string;
  displayName: string;
  description: string;
  providerLabel: string;
  defaultUseCases: ExecutionUseCase[];
  defaultBaseUrl?: string;
  defaultModelId?: string;
}

export interface ExecutionConnectionSummary {
  connectionId: string;
  connectorId: string;
  templateId?: string;
  providerLabel: string;
  displayName: string;
  description: string;
  connectionKind: ExecutionConnectionKind;
  implementationKind: AdapterImplementationKind;
  supportedCapabilityIds: string[];
  enabledUseCases: ExecutionUseCase[];
  configurable: boolean;
  deletable: boolean;
  enabled: boolean;
  status: ExecutionConnectionStatus;
  hasCredential: boolean;
  baseUrl?: string;
  modelId?: string;
  lastCheckedAt?: string;
  lastCheckMessage?: string;
  lastError?: string;
}

export interface ExecutionDefaultSelection {
  useCase: ExecutionUseCase;
  connectionId: string;
}

export interface ExecutionProviderSettingsSnapshot {
  connectors: ExecutionConnectorDefinition[];
  connectionTemplates: ExecutionConnectionTemplate[];
  connections: ExecutionConnectionSummary[];
  workspaceDefaults: ExecutionDefaultSelection[];
  projectDefaults: ExecutionDefaultSelection[];
}

const connectors: ExecutionConnectorDefinition[] = [
  {
    connectorId: 'retake-mock',
    displayName: 'Retake Mock',
    description: 'Local no-cost contract adapter for workflow testing.',
    connectionKind: 'local',
    implementationKind: 'local',
    installStatus: 'installed',
    connectionMode: 'fixed',
    requiresCredential: false,
    supportedCapabilityIds: ['video.generate'],
    defaultUseCases: ['video'],
    defaultModelId: 'contract-placeholder',
  },
  {
    connectorId: 'codex-managed',
    displayName: 'Codex MCP',
    description: 'Prompt-driven Codex route with the Retake MCP bridge and installed skills.',
    connectionKind: 'agent_host',
    implementationKind: 'agent_bridge',
    installStatus: 'installed',
    connectionMode: 'fixed',
    requiresCredential: false,
    supportedCapabilityIds: ['image.annotation_edit', 'image.image_to_image', 'image.text_to_image'],
    defaultUseCases: ['image'],
  },
  {
    connectorId: 'codex-app-server',
    displayName: 'Codex App Server',
    description: 'Local Codex rich-client protocol for authentication, threads, approvals, and streamed agent events.',
    connectionKind: 'agent_host',
    implementationKind: 'agent_bridge',
    installStatus: 'installed',
    connectionMode: 'multiple',
    requiresCredential: false,
    supportedCapabilityIds: [...textDocumentCapabilityIds, 'image.annotation_edit', 'image.image_to_image', 'image.text_to_image'],
    defaultUseCases: ['text', 'image'],
  },
  {
    connectorId: 'dreamina',
    displayName: 'Dreamina CLI',
    description: 'Local Dreamina membership route for Seedance video generation.',
    connectionKind: 'provider_cli',
    implementationKind: 'provider_cli',
    installStatus: 'installed',
    connectionMode: 'fixed',
    requiresCredential: false,
    supportedCapabilityIds: ['video.generate'],
    defaultUseCases: ['video'],
    defaultModelId: 'seedance2.0_vip',
  },
  {
    connectorId: 'byteplus-modelark',
    displayName: 'BytePlus ModelArk',
    description: 'Global Ark connection using the durable native Seedance task adapter.',
    connectionKind: 'model_provider',
    implementationKind: 'native_async',
    installStatus: 'installed',
    connectionMode: 'multiple',
    requiresCredential: true,
    supportedCapabilityIds: ['video.generate'],
    defaultUseCases: ['video'],
    defaultBaseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    defaultModelId: 'dreamina-seedance-2-0-260128',
  },
  {
    connectorId: 'openai-compatible',
    displayName: 'OpenAI-compatible',
    description: 'AI SDK connector shared by OpenAI, OpenRouter, DeepSeek, internal gateways, and compatible APIs.',
    connectionKind: 'model_provider',
    implementationKind: 'ai_sdk',
    installStatus: 'installed',
    connectionMode: 'multiple',
    requiresCredential: true,
    supportedCapabilityIds: textDocumentCapabilityIds,
    defaultUseCases: ['text'],
  },
  {
    connectorId: 'anthropic-native',
    displayName: 'Anthropic native',
    description: 'Official Vercel AI SDK provider for Anthropic-native language models.',
    connectionKind: 'model_provider',
    implementationKind: 'ai_sdk',
    installStatus: 'installed',
    connectionMode: 'multiple',
    requiresCredential: true,
    supportedCapabilityIds: textDocumentCapabilityIds,
    defaultUseCases: ['text'],
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModelId: 'claude-sonnet-4-6',
  },
  {
    connectorId: 'google-native',
    displayName: 'Google Gemini native',
    description: 'Official Vercel AI SDK provider for Google Generative AI language models.',
    connectionKind: 'model_provider',
    implementationKind: 'ai_sdk',
    installStatus: 'installed',
    connectionMode: 'multiple',
    requiresCredential: true,
    supportedCapabilityIds: textDocumentCapabilityIds,
    defaultUseCases: ['text'],
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModelId: 'gemini-2.5-flash',
  },
  {
    connectorId: 'volcengine-ark',
    displayName: 'Volcengine Ark',
    description: 'Mainland China Ark connection using the native Seedream image adapter.',
    connectionKind: 'model_provider',
    implementationKind: 'native_api',
    installStatus: 'installed',
    connectionMode: 'multiple',
    requiresCredential: true,
    supportedCapabilityIds: ['image.image_to_image', 'image.text_to_image'],
    defaultUseCases: ['image'],
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModelId: 'doubao-seedream-5-0-260128',
  },
];

const connectionTemplates: ExecutionConnectionTemplate[] = [
  {
    templateId: 'codex-app-server',
    connectorId: 'codex-app-server',
    displayName: 'Codex App Server',
    description: 'Another local Codex App Server connection with one explicit model.',
    providerLabel: 'Codex',
    defaultUseCases: ['text', 'image'],
  },
  {
    templateId: 'openai',
    connectorId: 'openai-compatible',
    displayName: 'OpenAI',
    description: 'OpenAI API through the shared OpenAI-compatible connector.',
    providerLabel: 'OpenAI',
    defaultUseCases: ['text'],
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    templateId: 'openrouter',
    connectorId: 'openai-compatible',
    displayName: 'OpenRouter',
    description: 'OpenRouter multi-provider API using its OpenAI-compatible endpoint.',
    providerLabel: 'OpenRouter',
    defaultUseCases: ['text'],
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    templateId: 'deepseek',
    connectorId: 'openai-compatible',
    displayName: 'DeepSeek',
    description: 'DeepSeek API using its OpenAI-compatible endpoint.',
    providerLabel: 'DeepSeek',
    defaultUseCases: ['text'],
    defaultBaseUrl: 'https://api.deepseek.com',
  },
  {
    templateId: 'custom-openai-compatible',
    connectorId: 'openai-compatible',
    displayName: 'Custom OpenAI-compatible',
    description: 'Any internal gateway or provider that implements the compatible chat API.',
    providerLabel: 'Custom',
    defaultUseCases: ['text'],
  },
  {
    templateId: 'byteplus-modelark',
    connectorId: 'byteplus-modelark',
    displayName: 'BytePlus ModelArk',
    description: 'Another BytePlus account, region, or endpoint using the installed native async connector.',
    providerLabel: 'BytePlus ModelArk',
    defaultUseCases: ['video'],
    defaultBaseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    defaultModelId: 'dreamina-seedance-2-0-260128',
  },
  {
    templateId: 'anthropic-native',
    connectorId: 'anthropic-native',
    displayName: 'Anthropic',
    description: 'Claude through the official Vercel AI SDK Anthropic provider.',
    providerLabel: 'Anthropic',
    defaultUseCases: ['text'],
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModelId: 'claude-sonnet-4-6',
  },
  {
    templateId: 'google-native',
    connectorId: 'google-native',
    displayName: 'Google Gemini',
    description: 'Gemini through the official Vercel AI SDK Google Generative AI provider.',
    providerLabel: 'Google',
    defaultUseCases: ['text'],
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModelId: 'gemini-2.5-flash',
  },
  {
    templateId: 'volcengine-ark-seedream',
    connectorId: 'volcengine-ark',
    displayName: 'Volcengine Ark Seedream',
    description: 'Seedream text-to-image and image-to-image through the mainland China Ark API.',
    providerLabel: 'Volcengine Ark',
    defaultUseCases: ['image'],
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModelId: 'doubao-seedream-5-0-260128',
  },
];

export function listExecutionConnectorDefinitions(): ExecutionConnectorDefinition[] {
  return connectors.map(cloneConnector);
}

export function executionConnectorDefinition(connectorId: string): ExecutionConnectorDefinition | undefined {
  const definition = connectors.find((candidate) => candidate.connectorId === connectorId);
  return definition ? cloneConnector(definition) : undefined;
}

export function listExecutionConnectionTemplates(): ExecutionConnectionTemplate[] {
  return connectionTemplates.map(cloneTemplate);
}

export function executionConnectionTemplate(templateId: string): ExecutionConnectionTemplate | undefined {
  const template = connectionTemplates.find((candidate) => candidate.templateId === templateId);
  return template ? cloneTemplate(template) : undefined;
}

function cloneConnector(definition: ExecutionConnectorDefinition): ExecutionConnectorDefinition {
  return {
    ...definition,
    supportedCapabilityIds: [...definition.supportedCapabilityIds],
    defaultUseCases: [...definition.defaultUseCases],
    ...(definition.defaultModelId ? { defaultModelId: definition.defaultModelId } : {}),
  };
}

function cloneTemplate(template: ExecutionConnectionTemplate): ExecutionConnectionTemplate {
  return { ...template, defaultUseCases: [...template.defaultUseCases] };
}
