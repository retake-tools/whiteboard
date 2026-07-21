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

export interface ExecutionProviderDefinition {
  providerId: string;
  displayName: string;
  description: string;
  connectionKind: ExecutionConnectionKind;
  implementationKind: AdapterImplementationKind;
  packageStatus: 'installed' | 'available';
  supportedCapabilityIds: string[];
  capabilityClasses: ExecutionCapabilityClass[];
  configurable: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
}

export interface ExecutionConnectionSummary {
  connectionId: string;
  providerId: string;
  displayName: string;
  description: string;
  connectionKind: ExecutionConnectionKind;
  implementationKind: AdapterImplementationKind;
  packageStatus: 'installed' | 'available';
  supportedCapabilityIds: string[];
  capabilityClasses: ExecutionCapabilityClass[];
  configurable: boolean;
  enabled: boolean;
  status: ExecutionConnectionStatus;
  hasCredential: boolean;
  baseUrl?: string;
  model?: string;
  lastCheckedAt?: string;
  lastError?: string;
}

export interface ExecutionDefaultSelection {
  capabilityClass: ExecutionCapabilityClass;
  connectionId: string;
  model?: string;
}

export interface ExecutionProviderSettingsSnapshot {
  connections: ExecutionConnectionSummary[];
  workspaceDefaults: ExecutionDefaultSelection[];
  projectDefaults: ExecutionDefaultSelection[];
}

const definitions: ExecutionProviderDefinition[] = [
  {
    providerId: 'retake-mock',
    displayName: 'Retake Mock',
    description: 'Local no-cost contract adapter for workflow testing.',
    connectionKind: 'local',
    implementationKind: 'local',
    packageStatus: 'installed',
    supportedCapabilityIds: ['video.generate'],
    capabilityClasses: ['video'],
    configurable: false,
    defaultModel: 'contract-placeholder',
  },
  {
    providerId: 'codex-managed',
    displayName: 'Codex Managed',
    description: 'Codex host with the Retake MCP bridge and installed skills.',
    connectionKind: 'agent_host',
    implementationKind: 'agent_bridge',
    packageStatus: 'installed',
    supportedCapabilityIds: ['image.annotation_edit', 'image.image_to_image', 'image.text_to_image'],
    capabilityClasses: ['image', 'agent'],
    configurable: false,
  },
  {
    providerId: 'dreamina',
    displayName: 'Dreamina CLI',
    description: 'Local Dreamina membership route for Seedance video generation.',
    connectionKind: 'provider_cli',
    implementationKind: 'provider_cli',
    packageStatus: 'installed',
    supportedCapabilityIds: ['video.generate'],
    capabilityClasses: ['video'],
    configurable: false,
    defaultModel: 'seedance2.0_vip',
  },
  {
    providerId: 'byteplus-modelark',
    displayName: 'BytePlus ModelArk',
    description: 'Global Ark connection using the durable native Seedance task adapter.',
    connectionKind: 'model_provider',
    implementationKind: 'native_async',
    packageStatus: 'installed',
    supportedCapabilityIds: ['video.generate'],
    capabilityClasses: ['video'],
    configurable: true,
    defaultBaseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    defaultModel: 'dreamina-seedance-2-0-260128',
  },
  {
    providerId: 'openai-compatible',
    displayName: 'OpenAI-compatible API',
    description: 'AI SDK connection foundation for future text and document execution adapters.',
    connectionKind: 'model_provider',
    implementationKind: 'ai_sdk',
    packageStatus: 'installed',
    supportedCapabilityIds: [],
    capabilityClasses: [],
    configurable: true,
  },
  ...[
    ['openai', 'OpenAI', 'Official AI SDK provider package.'],
    ['anthropic', 'Anthropic', 'Official AI SDK provider package.'],
    ['google', 'Google Gemini', 'Official AI SDK provider package.'],
    ['openrouter', 'OpenRouter', 'Aggregated model provider connection.'],
    ['deepseek', 'DeepSeek', 'Direct model provider connection.'],
    ['volcengine-ark', 'Volcengine Ark', 'Mainland China Ark image and video provider connection.'],
  ].map(([providerId, displayName, description]): ExecutionProviderDefinition => ({
    providerId,
    displayName,
    description,
    connectionKind: 'model_provider',
    implementationKind: providerId === 'volcengine-ark' ? 'native_async' : 'ai_sdk',
    packageStatus: 'available',
    supportedCapabilityIds: [],
    capabilityClasses: [],
    configurable: false,
  })),
];

export function listExecutionProviderDefinitions(): ExecutionProviderDefinition[] {
  return definitions.map((definition) => ({
    ...definition,
    supportedCapabilityIds: [...definition.supportedCapabilityIds],
    capabilityClasses: [...definition.capabilityClasses],
  }));
}

export function executionProviderDefinition(providerId: string): ExecutionProviderDefinition | undefined {
  return listExecutionProviderDefinitions().find((definition) => definition.providerId === providerId);
}
