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
import type { AgentRunRecord } from './agentRuntimeContracts';

export type BlockType = 'text' | 'document' | 'image' | 'video' | 'operation' | 'group';

export type AssetKind = 'image' | 'video' | 'audio' | 'document' | 'other';

export type ExecutionStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export type ConnectionKind = 'execution_input' | 'execution_output' | 'visual_note';

export type GroupKind = 'execution_results' | 'manual' | 'workflow';

export type GroupLayoutMode = 'free' | 'grid' | 'row';

export type GroupColor = 'blue' | 'green' | 'neutral' | 'rose' | 'transparent' | 'yellow';

export type ExecutionInputRole =
  | 'annotated_composite'
  | 'character_reference'
  | 'composition_reference'
  | 'control_image'
  | 'depth_map'
  | 'edge_map'
  | 'environment_reference'
  | 'first_frame'
  | 'general_reference'
  | 'inpaint_mask'
  | 'last_frame'
  | 'object_reference'
  | 'pose_reference'
  | 'source'
  | 'style_reference';

export type OperationReadinessIssue =
  | 'image_asset_missing'
  | 'image_input_missing'
  | 'image_role_missing'
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
}

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
  >;
  inputBindingsSnapshot?: CapabilityInputBinding[];
  outputSlotResults?: ExecutionOutputSlotResult[];
  resultSummary?: ExecutionResultSummary;
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
  inputRole?: ExecutionInputRole;
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
  | 'prompt'
  | 'role';

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
  contentFormat?: 'markdown';
  documentCharacterCount?: number;
  documentExcerpt?: string;
  documentKind?: string;
  documentOutline?: string[];
  managedDocumentResult?: boolean;
  annotationDraft?: AnnotationDraft;
  annotatedCompositeAssetId?: string;
  annotatedCompositePreviewUrl?: string;
  annotationMarkCount?: number;
  previewUrl?: string;
  resultRetryMode?: 'codex_prompt' | 'direct_retry';
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
  operationInputEdgeId?: string;
  operationInputRole?: ExecutionInputRole;
  operationInputRoleDisabledOptions?: ExecutionInputRole[];
  operationInputRoleLocked?: boolean;
  operationInputRoleOptions?: ExecutionInputRole[];
  operationInputRolePending?: boolean;
  operationCanRun?: boolean;
  operationChangeCount?: number;
  operationChangeKinds?: ExecutionConfigurationChangeKind[];
  operationQueuedConfigurationStale?: boolean;
  operationReadinessIssues?: OperationReadinessIssue[];
  operationSourceAspectRatio?: number;
  packageDigest?: string;
  packageEntryPointId?: string;
  packageId?: string;
  packageVersion?: string;
  sourceExecutionId?: string;
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
  inputRole?: ExecutionInputRole;
  inputSlotId?: string;
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
  workflowRuns?: WorkflowRunRecord[];
  workflowStepRuns?: WorkflowStepRunRecord[];
  historyEvents?: BoardHistoryEvent[];
  groupMigrationVersion?: number;
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
  inputRole?: ExecutionInputRole;
  inputSlotId?: string;
  kind: ConnectionKind;
  proxyEdgeIds?: string[];
  resultCount?: number;
  resultHeight?: number;
  resultIndex?: number;
}>;
