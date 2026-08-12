import type {
  AdapterKind,
  AssetKind,
  AssetRecord,
  BlockData,
  BlockRecord,
  BlockType,
  BoardEdgeRecord,
  BoardSnapshot,
  ConnectionKind,
  ExecutionRecord,
  ExecutionStatus,
  GroupColor,
  GroupLayoutMode,
  TriggerMode,
} from '../../core/types';
import type { DeepReadonly } from './readonly';
import type { CanvasHostScopeV1 } from './storage';

export interface CreateBoardCommandV1 {
  readonly boardId?: string;
  readonly boardName: string;
  readonly projectId?: string;
  readonly projectName: string;
}

export interface CreateBlockCommandV1 {
  readonly body?: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly position?: { readonly x: number; readonly y: number };
  readonly size?: { readonly height: number; readonly width: number };
  readonly title?: string;
  readonly type: BlockType;
}

export interface AttachAssetCommandV1 {
  readonly assetId?: string;
  readonly blockId?: string;
  /** Preserves the user-facing import name and enables imported Block presentation semantics. */
  readonly fileName?: string;
  readonly height?: number;
  readonly kind: AssetKind;
  readonly mimeType: string;
  readonly previewUrl: string;
  readonly sourceExecutionId?: string;
  readonly storageKey: string;
  readonly storageProvider: AssetRecord['storageProvider'];
  readonly width?: number;
}

export interface CreateExecutionCommandV1 {
  readonly adapter: AdapterKind;
  readonly capabilityId: string;
  readonly connectionId?: string;
  readonly inputAssetIds?: readonly string[];
  readonly inputBlockIds: readonly string[];
  readonly operationBlockId?: string;
  readonly outputBlockIds?: readonly string[];
  readonly params?: Readonly<Record<string, unknown>>;
  readonly prompt?: string;
  readonly provider?: string;
  readonly triggerMode?: TriggerMode;
}

export interface TransitionExecutionCommandV1 {
  readonly completedAt?: string;
  readonly errorMessage?: string;
  readonly executionId: string;
  readonly outputAssetIds?: readonly string[];
  readonly outputBlockIds?: readonly string[];
  readonly status: ExecutionStatus;
}

export interface CancelExecutionCommandV1 {
  readonly executionId: string;
}

export interface CancelExecutionResultV1 {
  readonly execution: DeepReadonly<ExecutionRecord>;
  readonly removedBlockIds: readonly string[];
}

export interface StartLocalImageExecutionCommandV1 {
  readonly body?: string;
  readonly capabilityId: string;
  readonly params?: Readonly<Record<string, unknown>>;
  readonly sourceBlockId: string;
  readonly title: string;
}

export interface LocalImageExecutionResultV1 {
  readonly execution: DeepReadonly<ExecutionRecord>;
  readonly operationBlock: DeepReadonly<BlockRecord>;
  readonly resultBlock: DeepReadonly<BlockRecord>;
}

export interface CompleteLocalImageExecutionCommandV1 {
  readonly asset: Omit<AttachAssetCommandV1, 'blockId' | 'sourceExecutionId'>;
  readonly executionId: string;
  readonly scope: CanvasHostScopeV1;
}

export interface CompleteLocalImageExecutionResultV1 extends LocalImageExecutionResultV1 {
  readonly asset: DeepReadonly<AssetRecord>;
}

export interface FailLocalImageExecutionCommandV1 {
  readonly errorMessage: string;
  readonly executionId: string;
  readonly scope: CanvasHostScopeV1;
}

export interface MoveBlocksCommandV1 {
  readonly moves: readonly {
    readonly blockId: string;
    readonly position: { readonly x: number; readonly y: number };
  }[];
}

export interface ResizeBlockCommandV1 {
  readonly blockId: string;
  readonly size: { readonly height: number; readonly width: number };
}

export interface ConnectBlocksCommandV1 {
  readonly edgeId?: string;
  readonly inputSlotId?: string;
  readonly kind?: ConnectionKind;
  readonly sourceBlockId: string;
  readonly targetBlockId: string;
}

export interface RemoveBlocksCommandV1 {
  readonly blockIds: readonly string[];
  readonly includeDescendants?: boolean;
}

export interface RemoveConnectionsCommandV1 {
  readonly edgeIds: readonly string[];
}

export interface UpdateBlockCommandV1 {
  readonly blockId: string;
  readonly body?: string;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly title?: string;
}

export interface CreateGroupCommandV1 {
  readonly blockIds: readonly string[];
  readonly color?: GroupColor;
  readonly layoutMode?: GroupLayoutMode;
  readonly title?: string;
}

export interface UpdateGroupCommandV1 {
  readonly color?: GroupColor;
  readonly contentsLocked?: boolean;
  readonly groupId: string;
  readonly positionLocked?: boolean;
  readonly title?: string;
}

export interface ResizeGroupCommandV1 {
  readonly groupId: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly size: { readonly height: number; readonly width: number };
}

export interface FitGroupCommandV1 {
  readonly groupId: string;
}

export interface LayoutGroupCommandV1 {
  readonly groupId: string;
  readonly layoutMode: GroupLayoutMode;
}

export interface DissolveGroupCommandV1 {
  readonly groupId: string;
}

export interface DissolveGroupResultV1 {
  readonly childBlockIds: readonly string[];
  readonly groupId: string;
}

export interface CanvasHostCommandsV1 {
  attachAsset(input: AttachAssetCommandV1): Promise<DeepReadonly<AssetRecord>>;
  cancelExecution(input: CancelExecutionCommandV1): Promise<DeepReadonly<CancelExecutionResultV1>>;
  completeLocalImageExecution(
    input: CompleteLocalImageExecutionCommandV1,
  ): Promise<DeepReadonly<CompleteLocalImageExecutionResultV1>>;
  connectBlocks(input: ConnectBlocksCommandV1): Promise<DeepReadonly<BoardEdgeRecord>>;
  createBlock(input: CreateBlockCommandV1): Promise<DeepReadonly<BlockRecord>>;
  createBoard(input: CreateBoardCommandV1): Promise<DeepReadonly<BoardSnapshot>>;
  createExecution(input: CreateExecutionCommandV1): Promise<DeepReadonly<ExecutionRecord>>;
  createGroup(input: CreateGroupCommandV1): Promise<DeepReadonly<BlockRecord>>;
  dissolveGroup(input: DissolveGroupCommandV1): Promise<DeepReadonly<DissolveGroupResultV1>>;
  fitGroup(input: FitGroupCommandV1): Promise<DeepReadonly<BlockRecord>>;
  failLocalImageExecution(
    input: FailLocalImageExecutionCommandV1,
  ): Promise<DeepReadonly<ExecutionRecord>>;
  layoutGroup(input: LayoutGroupCommandV1): Promise<DeepReadonly<BlockRecord>>;
  moveBlocks(input: MoveBlocksCommandV1): Promise<readonly DeepReadonly<BlockRecord>[]>;
  removeBlocks(input: RemoveBlocksCommandV1): Promise<readonly string[]>;
  removeConnections(input: RemoveConnectionsCommandV1): Promise<readonly string[]>;
  resizeBlock(input: ResizeBlockCommandV1): Promise<DeepReadonly<BlockRecord>>;
  resizeGroup(input: ResizeGroupCommandV1): Promise<DeepReadonly<BlockRecord>>;
  startLocalImageExecution(
    input: StartLocalImageExecutionCommandV1,
  ): Promise<DeepReadonly<LocalImageExecutionResultV1>>;
  transitionExecution(input: TransitionExecutionCommandV1): Promise<DeepReadonly<ExecutionRecord>>;
  updateBlock(input: UpdateBlockCommandV1): Promise<DeepReadonly<BlockRecord>>;
  updateGroup(input: UpdateGroupCommandV1): Promise<DeepReadonly<BlockRecord>>;
}

/** Public helpers may read Block data but never receive its mutable reference. */
export type CanvasHostBlockDataV1 = DeepReadonly<BlockData>;
