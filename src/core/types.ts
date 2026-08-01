import type { Edge, Node } from '@xyflow/react';
import type { AnnotationDraft } from './imageAnnotations';
import type {
  AdapterDefinition,
  BlockExecutionDraft,
  CapabilityDefinitionLock,
  CapabilityInputBinding,
  SkillDefinitionLock,
} from './capabilityContracts';
import type { RetakeSkillSnapshot } from './skillRegistry';
import type { WorkflowRunRecord, WorkflowStepRunRecord, WorkflowStepRunFreshness, WorkflowStepRunStatus } from './workflowRuntimeContracts';
import type {
  WorkflowApprovalDecisionRecord,
  WorkflowApprovalRequestRecord,
  WorkflowGateEvaluationRecord,
} from './workflowGateContracts';
import type { AgentRunRecord } from './agentRuntimeContracts';
import type {
  AgentMessageRecord,
  AgentRuntimeEventRecord,
  AgentRuntimeBindingRecord,
  AgentSessionRecord,
  ChangeDecisionRecord,
  ChangeProposalRecord,
} from './agentSessionContracts';
import type { PluginJsonValueV2 } from '@retake-tools/package-sdk';
import type { ReferenceIntentV1 } from './referenceIntent';

export type BlockType = 'text' | 'document' | 'image' | 'video' | 'operation' | 'group';

export type AssetKind = 'image' | 'video' | 'audio' | 'document' | 'other';

export type ExecutionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type ConnectionKind = 'execution_input' | 'execution_output' | 'visual_note';

export type GroupKind = 'execution_results' | 'manual' | 'workflow';

export type GroupLayoutMode = 'free' | 'grid' | 'row';

export type GroupColor = 'blue' | 'green' | 'neutral' | 'rose' | 'transparent' | 'yellow';

export type OperationReadinessIssue =
  | 'image_asset_missing'
  | 'image_input_missing'
  | 'image_binding_missing'
  | 'input_contract_migration_required'
  | 'prompt_empty'
  | 'source_image_missing'
  | 'text_input_missing'
  | 'workflow_step_not_ready';

export type AdapterKind =
  | 'direct_api'
  | 'provider_cli'
  | 'codex_app_server'
  | 'mcp_agent'
  | 'cli_agent'
  | 'local_canvas'
  | 'manual_import'
  | 'mock';

export type AgentHost = 'codex' | 'claude' | 'cursor' | 'other';

export type TriggerMode =
  | 'manual_agent_session'
  | 'agent_bridge'
  | 'codex_cli'
  | 'acp'
  | 'server_worker'
  | 'local_canvas'
  | 'manual_import'
  | 'local_mock';

export interface GenerationProfileSnapshot {
  generationProfileId: string;
  name: string;
  version: number;
  source: 'builtin' | 'plugin' | 'user';
  adapter: AdapterKind;
  agentHost?: AgentHost;
  provider?: string;
  model?: string;
  connectionId?: string;
}

export interface ProjectRecord {
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  defaultBoardId: string;
  order?: number;
  localRoot?: string;
  codexProjectPath?: string;
  externalBindings?: {
    codex?: CodexProjectBinding;
    [key: string]: unknown;
  };
}

export interface CodexProjectBinding {
  projectPath: string;
  projectId: string;
  boardId: string;
  boundAt: string;
  note?: string;
}

export interface BoardRecord {
  boardId: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  order?: number;
  background?: BoardBackgroundV1;
}

export type BoardBackgroundV1 =
  | { kind: 'default' }
  | { color: string; kind: 'solid' }
  | { assetId: string; fit: 'contain' | 'cover'; kind: 'image' };

export interface LayerRecord {
  id: string;
  boardId: string;
  name: string;
  visible: true;
  locked: false;
  order: number;
}

export interface AssetRecord {
  assetId: string;
  projectId: string;
  kind: AssetKind;
  mimeType: string;
  storageProvider: 'local_mock' | 'local' | 's3' | 'r2' | 'custom';
  storageKey: string;
  previewUrl: string;
  width?: number;
  height?: number;
  duration?: number;
  sourceExecutionId?: string;
  createdAt: string;
}

export interface ExecutionRecord {
  executionId: string;
  projectId: string;
  boardId: string;
  capabilityId: string;
  adapter: AdapterKind;
  status: ExecutionStatus;
  inputBlockIds: string[];
  inputAssetIds?: string[];
  outputBlockIds: string[];
  outputAssetIds: string[];
  agentRunId?: string;
  agentHost?: AgentHost;
  triggerMode?: TriggerMode;
  provider?: string;
  model?: string;
  connectionId?: string;
  skillId?: string;
  workflowRunId?: string;
  stepRunId?: string;
  generationProfile?: GenerationProfileSnapshot;
  prompt?: string;
  agentPrompt?: string;
  requestPrompts?: ExecutionRequestPrompt[];
  params?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
  configuration?: ExecutionConfigurationSnapshot;
  configurationFingerprint?: string;
  operationVersion?: number;
  previousExecutionId?: string;
  requestId?: string;
  capabilityLock?: CapabilityDefinitionLock;
  skillSnapshot?: SkillDefinitionLock | RetakeSkillSnapshot;
  adapterSnapshot?: Pick<
    AdapterDefinition,
    | 'adapterId'
    | 'version'
    | 'definitionHash'
    | 'adapterClass'
    | 'routeKind'
    | 'provider'
    | 'model'
  > & { inputProfileId?: string };
  inputBindingsSnapshot?: CapabilityInputBinding[];
  outputSlotResults?: ExecutionOutputSlotResult[];
  resultSummary?: ExecutionResultSummary;
  domainVideoRequestSnapshot?: import('./domainVideoGenerationContracts').DomainVideoRequestSnapshotV1;
  providerExecutionAuthorization?: import('./domainVideoGenerationContracts').ProviderExecutionAuthorizationV1;
  providerCalls?: import('./domainVideoGenerationContracts').ProviderCallRecord[];
}

export interface ExecutionRequestPrompt {
  index: number;
  outputBlockId?: string;
  prompt: string;
}

export interface ExecutionOutputSlotResult {
  slotId: string;
  assetIds: string[];
}

export interface ExecutionResultSummary {
  requested: number;
  succeeded: number;
  failed: number;
}

export interface ExecutionConfigurationInputSnapshot {
  assetId?: string;
  blockId: string;
  inputSlotId?: string;
  referenceIntent?: ReferenceIntentV1;
  title: string;
}

export interface ExecutionConfigurationSnapshot {
  capabilityId: string;
  connectionId?: string;
  generationParams: Record<string, unknown>;
  generationProfileId?: string;
  imageInputs: ExecutionConfigurationInputSnapshot[];
  parameters?: ExecutionConfigurationParameterSnapshot[];
  prompt: string;
  schemaVersion?: number;
}

export type ExecutionConfigurationParameterValueType =
  | 'array'
  | 'boolean'
  | 'integer'
  | 'number'
  | 'object'
  | 'string'
  | 'unknown';

export interface ExecutionConfigurationParameterSnapshot {
  key: string;
  schemaId: string;
  schemaVersion: number;
  semantic?: string;
  value: unknown;
  valueType: ExecutionConfigurationParameterValueType;
}

export type ExecutionConfigurationChangeKind =
  | 'capability'
  | 'input'
  | 'parameter'
  | 'profile'
  | 'prompt';

export interface OperationReferenceInputPresentation {
  bindingKind: 'reference' | 'source' | 'slot';
  blockId: string;
  edgeId: string;
  editable: boolean;
  inputSlotId?: string;
  previewUrl?: string;
  referenceIntent?: ReferenceIntentV1;
  title: string;
}

export interface ExecutionConfigurationChange {
  blockId?: string;
  current?: unknown;
  key: string;
  kind: ExecutionConfigurationChangeKind;
  previous?: unknown;
  currentParameter?: ExecutionConfigurationParameterSnapshot;
  previousParameter?: ExecutionConfigurationParameterSnapshot;
}

export type BoardHistoryEventType =
  | 'operation_created'
  | 'prompt_copied'
  | 'asset_imported'
  | 'asset_replaced'
  | 'configuration_restored'
  | 'annotation_draft_restored'
  | 'execution_started'
  | 'execution_succeeded'
  | 'execution_failed'
  | 'execution_canceled'
  | 'result_block_updated';

export interface BoardHistoryEvent {
  eventId: string;
  type: BoardHistoryEventType;
  createdAt: string;
  actor: 'user' | 'codex' | 'system';
  executionId?: string;
  blockIds?: string[];
  assetIds?: string[];
  summary: string;
  detail?: {
    prompt?: string;
    [key: string]: unknown;
  };
}

export interface BlockData {
  [key: string]: unknown;
  title: string;
  body?: string;
  assetId?: string;
  artifactId?: string;
  artifactRevisionId?: string;
  contentFormat?: 'markdown';
  documentCharacterCount?: number;
  documentExcerpt?: string;
  documentKind?: string;
  documentOutline?: string[];
  managedDocumentResult?: boolean;
  annotationDraft?: AnnotationDraft;
  retakePluginDrafts?: RetakePluginDraftRecord[];
  annotatedCompositeAssetId?: string;
  annotatedCompositePreviewUrl?: string;
  annotationMarkCount?: number;
  previewUrl?: string;
  rendererContributionId?: string;
  resultRetryMode?: 'codex_prompt' | 'direct_retry';
  reviewStatus?: 'selected';
  status?: ExecutionStatus;
  statusVisualDismissed?: boolean;
  capabilityId?: string;
  composerSourceAssetId?: string;
  composerSourceBlockId?: string;
  skillId?: string;
  connectionId?: string;
  generationProfileId?: string;
  groupColor?: GroupColor;
  groupCollapsed?: boolean;
  groupContentLocked?: boolean;
  groupContentsLocked?: boolean;
  groupDropDetach?: boolean;
  groupDropTarget?: boolean;
  groupExecutionId?: string;
  groupFailedCount?: number;
  groupKind?: GroupKind;
  groupLayoutMode?: GroupLayoutMode;
  groupMediaCount?: number;
  groupMemberCount?: number;
  groupMinHeight?: number;
  groupMinWidth?: number;
  groupPositionLocked?: boolean;
  groupRunningCount?: number;
  groupScopeSelected?: boolean;
  operationReferenceInputs?: OperationReferenceInputPresentation[];
  operationCanRun?: boolean;
  operationCompact?: boolean;
  operationCompactResultCount?: number;
  operationChangeCount?: number;
  operationChangeKinds?: ExecutionConfigurationChangeKind[];
  operationQueuedConfigurationStale?: boolean;
  operationReadinessIssues?: OperationReadinessIssue[];
  operationHasSourceImage?: boolean;
  operationContractMigrationIssue?: 'legacy_image_generate_input_mismatch';
  operationMode?: string;
  operationSourceAspectRatio?: number;
  packageDigest?: string;
  packageEntryPointId?: string;
  packageId?: string;
  packageVersion?: string;
  sourceExecutionId?: string;
  executionDetailsAvailable?: boolean;
  executionChangeCount?: number;
  executionChangeKinds?: ExecutionConfigurationChangeKind[];
  executionVersion?: number;
  executionStatus?: ExecutionStatus;
  executionDraft?: BlockExecutionDraft;
  workflowDefinitionHash?: string;
  workflowDefinitionId?: string;
  workflowDefinitionVersion?: string;
  workflowInputSlotId?: string;
  workflowOutputSlotId?: string;
  workflowProjectionId?: string;
  workflowStepId?: string;
  workflowStepRunFreshness?: WorkflowStepRunFreshness;
  workflowStepRunStatus?: WorkflowStepRunStatus;
}

export interface RetakePluginDraftRecord {
  capabilityId: string;
  pluginModuleId: string;
  revision: string;
  schemaVersion: 1;
  updatedAt: string;
  value: PluginJsonValueV2;
}

export interface BlockRecord {
  blockId: string;
  boardId: string;
  type: BlockType;
  layerId: string;
  parentGroupId?: string;
  position: { x: number; y: number };
  size: { width: number; height: number };
  zIndex: number;
  data: BlockData;
  createdAt: string;
  updatedAt: string;
}

export interface BoardEdgeRecord {
  edgeId: string;
  sourceBlockId: string;
  targetBlockId: string;
  kind: ConnectionKind;
  inputSlotId?: string;
  referenceIntent?: ReferenceIntentV1;
}

export interface BoardSnapshot {
  schemaVersion: 1;
  project: ProjectRecord;
  board: BoardRecord;
  layers: LayerRecord[];
  blocks: BlockRecord[];
  edges: BoardEdgeRecord[];
  assets: AssetRecord[];
  executions: ExecutionRecord[];
  agentRuns?: AgentRunRecord[];
  agentSessions?: AgentSessionRecord[];
  agentMessages?: AgentMessageRecord[];
  agentRuntimeBindings?: AgentRuntimeBindingRecord[];
  agentRuntimeEvents?: AgentRuntimeEventRecord[];
  changeProposals?: ChangeProposalRecord[];
  changeDecisions?: ChangeDecisionRecord[];
  workflowRuns?: WorkflowRunRecord[];
  workflowStepRuns?: WorkflowStepRunRecord[];
  workflowGateEvaluations?: WorkflowGateEvaluationRecord[];
  workflowApprovalRequests?: WorkflowApprovalRequestRecord[];
  workflowApprovalDecisions?: WorkflowApprovalDecisionRecord[];
  historyEvents?: BoardHistoryEvent[];
  groupMigrationVersion?: number;
  imageGenerateMigrationVersion?: number;
}

export interface WorkspaceBoardSummary {
  boardId: string;
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  order?: number;
}

export interface WorkspaceProjectSummary {
  projectId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  defaultBoardId: string;
  order?: number;
  boards: WorkspaceBoardSummary[];
}

export interface WorkspaceSummary {
  defaultProjectId: string;
  projects: WorkspaceProjectSummary[];
}

export type RetakeNode = Node<BlockRecord['data'], BlockType>;
export type RetakeEdge = Edge<{
  inputSlotId?: string;
  kind: ConnectionKind;
  proxyEdgeIds?: string[];
  referenceIntent?: ReferenceIntentV1;
  resultCount?: number;
  resultHeight?: number;
  resultIndex?: number;
}>;
