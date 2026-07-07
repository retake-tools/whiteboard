import type { Edge, Node, Viewport } from '@xyflow/react';

export type BlockType = 'text' | 'image' | 'video' | 'task' | 'frame';

export type AssetKind = 'image' | 'video' | 'audio' | 'document' | 'other';

export type ExecutionStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type ConnectionKind = 'reference' | 'execution_input' | 'derived_from' | 'visual_note';

export type AdapterKind = 'direct_api' | 'mcp_agent' | 'cli_agent' | 'manual_import' | 'mock';

export type AgentHost = 'codex' | 'claude' | 'cursor' | 'other';

export type TriggerMode =
  | 'manual_agent_session'
  | 'agent_bridge'
  | 'codex_cli'
  | 'acp'
  | 'server_worker'
  | 'manual_import'
  | 'local_mock';

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
  agentHost?: AgentHost;
  triggerMode?: TriggerMode;
  provider?: string;
  model?: string;
  skillId?: string;
  prompt?: string;
  agentPrompt?: string;
  params?: Record<string, unknown>;
  startedAt: string;
  completedAt?: string;
  errorMessage?: string;
}

export type BoardHistoryEventType =
  | 'operation_created'
  | 'prompt_copied'
  | 'asset_imported'
  | 'execution_succeeded'
  | 'execution_failed'
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
  previewUrl?: string;
  status?: ExecutionStatus;
  statusVisualDismissed?: boolean;
  capabilityId?: string;
  sourceExecutionId?: string;
}

export interface BlockRecord {
  blockId: string;
  boardId: string;
  type: BlockType;
  layerId: string;
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
  historyEvents?: BoardHistoryEvent[];
  viewport: Viewport;
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
export type RetakeEdge = Edge<{ kind: ConnectionKind }>;
