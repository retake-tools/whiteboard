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

export type ExecutionCapabilityClass = 'text' | 'document' | 'image' | 'video' | 'audio' | 'agent';

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
  capabilityClasses: ExecutionCapabilityClass[];
  defaultBaseUrl?: string;
  defaultModelId?: string;
}

export interface ExecutionConnectionTemplate {
  templateId: string;
  connectorId: string;
  displayName: string;
  description: string;
  providerLabel: string;
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
  capabilityClasses: ExecutionCapabilityClass[];
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
  capabilityClass: ExecutionCapabilityClass;
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
    capabilityClasses: ['video'],
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
    capabilityClasses: ['image', 'agent'],
  },
  {
    connectorId: 'codex-app-server',
    displayName: 'Codex App Server',
    description: 'Local Codex rich-client protocol for authentication, threads, approvals, and streamed agent events.',
    connectionKind: 'agent_host',
    implementationKind: 'agent_bridge',
    installStatus: 'installed',
    connectionMode: 'fixed',
    requiresCredential: false,
    supportedCapabilityIds: [],
    capabilityClasses: [],
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
    capabilityClasses: ['video'],
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
    capabilityClasses: ['video'],
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
    supportedCapabilityIds: [],
    capabilityClasses: ['text', 'document'],
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
    supportedCapabilityIds: [],
    capabilityClasses: ['text', 'document'],
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
    supportedCapabilityIds: [],
    capabilityClasses: ['text', 'document'],
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
    capabilityClasses: ['image'],
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModelId: 'doubao-seedream-5-0-260128',
  },
];

const connectionTemplates: ExecutionConnectionTemplate[] = [
  {
    templateId: 'openai',
    connectorId: 'openai-compatible',
    displayName: 'OpenAI',
    description: 'OpenAI API through the shared OpenAI-compatible connector.',
    providerLabel: 'OpenAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
  {
    templateId: 'openrouter',
    connectorId: 'openai-compatible',
    displayName: 'OpenRouter',
    description: 'OpenRouter multi-provider API using its OpenAI-compatible endpoint.',
    providerLabel: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
  },
  {
    templateId: 'deepseek',
    connectorId: 'openai-compatible',
    displayName: 'DeepSeek',
    description: 'DeepSeek API using its OpenAI-compatible endpoint.',
    providerLabel: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
  },
  {
    templateId: 'custom-openai-compatible',
    connectorId: 'openai-compatible',
    displayName: 'Custom OpenAI-compatible',
    description: 'Any internal gateway or provider that implements the compatible chat API.',
    providerLabel: 'Custom',
  },
  {
    templateId: 'byteplus-modelark',
    connectorId: 'byteplus-modelark',
    displayName: 'BytePlus ModelArk',
    description: 'Another BytePlus account, region, or endpoint using the installed native async connector.',
    providerLabel: 'BytePlus ModelArk',
    defaultBaseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    defaultModelId: 'dreamina-seedance-2-0-260128',
  },
  {
    templateId: 'anthropic-native',
    connectorId: 'anthropic-native',
    displayName: 'Anthropic',
    description: 'Claude through the official Vercel AI SDK Anthropic provider.',
    providerLabel: 'Anthropic',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    defaultModelId: 'claude-sonnet-4-6',
  },
  {
    templateId: 'google-native',
    connectorId: 'google-native',
    displayName: 'Google Gemini',
    description: 'Gemini through the official Vercel AI SDK Google Generative AI provider.',
    providerLabel: 'Google',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModelId: 'gemini-2.5-flash',
  },
  {
    templateId: 'volcengine-ark-seedream',
    connectorId: 'volcengine-ark',
    displayName: 'Volcengine Ark Seedream',
    description: 'Seedream text-to-image and image-to-image through the mainland China Ark API.',
    providerLabel: 'Volcengine Ark',
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
  return connectionTemplates.map((template) => ({ ...template }));
}

export function executionConnectionTemplate(templateId: string): ExecutionConnectionTemplate | undefined {
  const template = connectionTemplates.find((candidate) => candidate.templateId === templateId);
  return template ? { ...template } : undefined;
}

function cloneConnector(definition: ExecutionConnectorDefinition): ExecutionConnectorDefinition {
  return {
    ...definition,
    supportedCapabilityIds: [...definition.supportedCapabilityIds],
    capabilityClasses: [...definition.capabilityClasses],
    ...(definition.defaultModelId ? { defaultModelId: definition.defaultModelId } : {}),
  };
}
