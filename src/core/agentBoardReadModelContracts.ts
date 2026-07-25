import type { OperationReadiness } from './capabilities';
import type { AgentRunRecord } from './agentRuntimeContracts';
import type { PackageLock } from './packageContracts';
import type {
  AssetKind,
  BlockType,
  ExecutionInputRole,
  ExecutionResultSummary,
  ExecutionStatus,
} from './types';
import type {
  WorkflowGateEvaluationStatus,
  WorkflowGateFreshness,
} from './workflowGateContracts';
import type {
  WorkflowRunStatus,
  WorkflowStepRunFreshness,
  WorkflowStepRunStatus,
} from './workflowRuntimeContracts';

export const agentBoardReadModelBudget = {
  maxBlockSummaries: 24,
  maxGateSummaries: 8,
  maxInputBindingsPerOperation: 12,
  maxOperationSummaries: 24,
  maxOutputBlockIdsPerOperation: 8,
  maxTextPreviewCharacters: 240,
  maxTitleCharacters: 120,
  maxWorkflowRunSummaries: 8,
} as const;

export interface AgentBoardReadModelFocusV1 {
  activeAgentRun?: AgentRunRecord;
  mentionedBlockIds: string[];
}

export interface AgentBoardReadModelV1 {
  blocks: AgentBoardBlockSummaryV1[];
  budget: typeof agentBoardReadModelBudget;
  gates: AgentBoardGateSummaryV1[];
  operations: AgentBoardOperationSummaryV1[];
  schemaRef: 'retake.agent-board-read-model/v1';
  source: {
    boardId: string;
    boardUpdatedAt: string;
    fingerprint: string;
    projectId: string;
  };
  summary: AgentBoardSummaryV1;
  truncation: {
    blocksOmitted: number;
    gatesOmitted: number;
    operationsOmitted: number;
    stringsTruncated: boolean;
    workflowRunsOmitted: number;
  };
  workflowRuns: AgentBoardWorkflowRunSummaryV1[];
}

export interface AgentBoardSummaryV1 {
  assetCount: number;
  blockCounts: Record<BlockType, number>;
  boardName: string;
  currentGateCounts: {
    failed: number;
    passed: number;
    waitingApproval: number;
  };
  edgeCount: number;
  executionCounts: Record<ExecutionStatus, number>;
  operationCounts: {
    active: number;
    blocked: number;
    failed: number;
    ready: number;
    total: number;
  };
  projectName: string;
  workflowRunCounts: Record<WorkflowRunStatus, number>;
}

export interface AgentBoardBlockSummaryV1 {
  artifact?: {
    artifactId?: string;
    artifactRevisionId?: string;
    artifactType?: string;
  };
  blockId: string;
  media?: {
    assetId: string;
    duration?: number;
    height?: number;
    kind: AssetKind;
    mimeType: string;
    sourceExecutionId?: string;
    width?: number;
  };
  parentGroupId?: string;
  reviewStatus?: 'selected';
  text?: {
    kind: 'document_excerpt' | 'text_body';
    preview: string;
    truncated: boolean;
  };
  title: string;
  type: BlockType;
  updatedAt: string;
}

export interface AgentBoardOperationSummaryV1 {
  capabilityId?: string;
  inputBindings: Array<{
    inputRole?: ExecutionInputRole;
    inputSlotId?: string;
    sourceBlockId: string;
    sourceBlockType: BlockType;
  }>;
  inputBindingsOmitted: number;
  latestExecution?: {
    completedAt?: string;
    executionId: string;
    hasError: boolean;
    model?: string;
    provider?: string;
    resultSummary?: ExecutionResultSummary;
    startedAt: string;
    status: ExecutionStatus;
  };
  operationBlockId: string;
  outputBlockIds: string[];
  outputBlockIdsOmitted: number;
  package?: {
    digest?: string;
    entrypointId?: string;
    packageId: string;
    version?: string;
  };
  readiness: OperationReadiness;
  skillId?: string;
  status?: ExecutionStatus;
  title: string;
  workflowStep?: {
    acceptedOutputAssetIds: string[];
    freshness: WorkflowStepRunFreshness;
    stageId?: string;
    status: WorkflowStepRunStatus;
    stepId: string;
    stepRunId: string;
    workflowRunId: string;
  };
}

export interface AgentBoardWorkflowRunSummaryV1 {
  currentStepIds: string[];
  outdatedStepCount: number;
  package?: PackageLock;
  status: WorkflowRunStatus;
  stepCounts: Record<WorkflowStepRunStatus, number>;
  workflowDefinitionId: string;
  workflowRunId: string;
  workflowVersion: string;
}

export interface AgentBoardGateSummaryV1 {
  approvalRequestId: string;
  freshness: WorkflowGateFreshness;
  gateEvaluationId: string;
  gateId: string;
  name: string;
  status: WorkflowGateEvaluationStatus;
  subjectArtifactRevisionId?: string;
  subjectOperationBlockId?: string;
  workflowRunId: string;
}
