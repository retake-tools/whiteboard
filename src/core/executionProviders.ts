export type ExecutionConnectionKind = 'model_provider' | 'agent_host' | 'provider_cli' | 'local';

export type AdapterImplementationKind =
  | 'ai_sdk'
  | 'native_async'
  | 'provider_cli'
  | 'agent_bridge'
  | 'local';

export type ExecutionConnectionStatus =
  | 'not_installed'
  | 'needs_credentials'
  | 'needs_login'
  | 'checking'
  | 'ready'
  | 'unavailable';

export type ExecutionCapabilityClass = 'text' | 'document' | 'image' | 'video' | 'audio' | 'agent';

export interface ExecutionModelConfiguration {
  modelId: string;
  displayName?: string;
}

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
  defaultModels?: ExecutionModelConfiguration[];
}

export interface ExecutionConnectionTemplate {
  templateId: string;
  connectorId: string;
  displayName: string;
  description: string;
  providerLabel: string;
  defaultBaseUrl?: string;
  defaultModels: ExecutionModelConfiguration[];
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
  models: ExecutionModelConfiguration[];
  defaultModelId?: string;
  lastCheckedAt?: string;
  lastError?: string;
}

export interface ExecutionDefaultSelection {
  capabilityClass: ExecutionCapabilityClass;
  connectionId: string;
  model?: string;
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
    defaultModels: [{ modelId: 'contract-placeholder' }],
  },
  {
    connectorId: 'codex-managed',
    displayName: 'Codex Managed',
    description: 'Codex host with the Retake MCP bridge and installed skills.',
    connectionKind: 'agent_host',
    implementationKind: 'agent_bridge',
    installStatus: 'installed',
    connectionMode: 'fixed',
    requiresCredential: false,
    supportedCapabilityIds: ['image.annotation_edit', 'image.image_to_image', 'image.text_to_image'],
    capabilityClasses: ['image', 'agent'],
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
    defaultModels: [{ modelId: 'seedance2.0_vip' }],
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
    defaultModels: [{ modelId: 'dreamina-seedance-2-0-260128' }],
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
    capabilityClasses: [],
  },
  {
    connectorId: 'anthropic-native',
    displayName: 'Anthropic native',
    description: 'Future official AI SDK connector for Anthropic-native endpoints.',
    connectionKind: 'model_provider',
    implementationKind: 'ai_sdk',
    installStatus: 'available',
    connectionMode: 'multiple',
    requiresCredential: true,
    supportedCapabilityIds: [],
    capabilityClasses: [],
  },
  {
    connectorId: 'google-native',
    displayName: 'Google Gemini native',
    description: 'Future official AI SDK connector for Gemini-native endpoints.',
    connectionKind: 'model_provider',
    implementationKind: 'ai_sdk',
    installStatus: 'available',
    connectionMode: 'multiple',
    requiresCredential: true,
    supportedCapabilityIds: [],
    capabilityClasses: [],
  },
  {
    connectorId: 'volcengine-ark',
    displayName: 'Volcengine Ark',
    description: 'Future mainland China Ark image and video connector.',
    connectionKind: 'model_provider',
    implementationKind: 'native_async',
    installStatus: 'available',
    connectionMode: 'multiple',
    requiresCredential: true,
    supportedCapabilityIds: [],
    capabilityClasses: [],
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
    defaultModels: [],
  },
  {
    templateId: 'openrouter',
    connectorId: 'openai-compatible',
    displayName: 'OpenRouter',
    description: 'OpenRouter multi-provider API using its OpenAI-compatible endpoint.',
    providerLabel: 'OpenRouter',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    defaultModels: [],
  },
  {
    templateId: 'deepseek',
    connectorId: 'openai-compatible',
    displayName: 'DeepSeek',
    description: 'DeepSeek API using its OpenAI-compatible endpoint.',
    providerLabel: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com',
    defaultModels: [],
  },
  {
    templateId: 'custom-openai-compatible',
    connectorId: 'openai-compatible',
    displayName: 'Custom OpenAI-compatible',
    description: 'Any internal gateway or provider that implements the compatible chat API.',
    providerLabel: 'Custom',
    defaultModels: [],
  },
  {
    templateId: 'byteplus-modelark',
    connectorId: 'byteplus-modelark',
    displayName: 'BytePlus ModelArk',
    description: 'Another BytePlus account, region, or endpoint using the installed native async connector.',
    providerLabel: 'BytePlus ModelArk',
    defaultBaseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    defaultModels: [{ modelId: 'dreamina-seedance-2-0-260128' }],
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
  return connectionTemplates.map((template) => ({
    ...template,
    defaultModels: cloneModels(template.defaultModels),
  }));
}

export function executionConnectionTemplate(templateId: string): ExecutionConnectionTemplate | undefined {
  const template = connectionTemplates.find((candidate) => candidate.templateId === templateId);
  return template ? { ...template, defaultModels: cloneModels(template.defaultModels) } : undefined;
}

function cloneConnector(definition: ExecutionConnectorDefinition): ExecutionConnectorDefinition {
  return {
    ...definition,
    supportedCapabilityIds: [...definition.supportedCapabilityIds],
    capabilityClasses: [...definition.capabilityClasses],
    ...(definition.defaultModels ? { defaultModels: cloneModels(definition.defaultModels) } : {}),
  };
}

function cloneModels(models: ExecutionModelConfiguration[]): ExecutionModelConfiguration[] {
  return models.map((model) => ({ ...model }));
}
