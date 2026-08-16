import { supersedeResolvedAgentRunBlockerProposals } from '../../core/agentChangeApplication';
import {
  attachAgentRunExecution,
  cancelAgentRun,
  createAgentRunForWorkflowArtifactSlice,
  createAgentRunForWorkflowGateSlice,
  createAgentRunForWorkflowRun,
  createAgentRunForWorkflowSlice,
  createAgentRunForWorkflowStageSlice,
  markAgentRunNeedsAttention,
  nextAgentRunExecutionActions,
  pauseAgentRun,
  reconcileAgentRuntime,
  retryAgentRunAfterMissingExecution,
  startAgentRun,
} from '../../core/agentRuntime';
import type {
  AgentRunExecutionAction,
  AgentWorkflowGateCompletion,
} from '../../core/agentRuntimeContracts';
import type { WorkflowApprovalDecisionValue } from '../../core/workflowGateContracts';
import type {
  PackageComposerInlineValue,
  PackageComposerMention,
} from '../../core/packageComposer';
import type { PackageInvocationContext } from '../../core/packageContracts';
import type { TextGenerationLabels } from '../../core/textOperations';
import type { BoardSnapshot } from '../../core/types';
import { decideWorkflowApproval } from '../../core/workflowGateRuntime';
import type { ProjectWorkflowRevisionV1 } from '../../core/workflowAuthoringContracts';
import { projectWorkflowDraft } from '../../core/workflowDraftProjection';
import { moveBlockGroupToNearestFreeArea } from '../../core/workflowPlacement';
import {
  acceptWorkflowStepOutputs,
  createWorkflowRunForGroup,
} from '../../core/workflowRuntime';
import { nowIso } from '../../core/id';
import { upsertProjectWorkflowDefinition } from '../../core/workflowRegistry';
import type { CanvasHostV1 } from '../../host-kit';
import { whiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';
import {
  createWhiteboardAgentWorkspaceCommands,
  type WhiteboardAgentWorkspaceCommandsV1,
} from './whiteboardAgentWorkspaceCommands';
import {
  createWhiteboardAgentAttachmentCommands,
  type WhiteboardAgentAttachmentCommandsV1,
} from './whiteboardAgentAttachmentCommands';
import {
  createWhiteboardPluginCommands,
  type WhiteboardPluginCommandsV1,
} from './whiteboardPluginCommands';
import {
  createWhiteboardArtifactCommands,
  type WhiteboardArtifactCommandsV1,
} from './whiteboardArtifactCommands';
import {
  createWhiteboardAssetCommands,
  type WhiteboardAssetCommandsV1,
} from './whiteboardAssetCommands';
import {
  createWhiteboardExecutionConfigurationCommands,
  type WhiteboardExecutionConfigurationCommandsV1,
} from './whiteboardExecutionConfigurationCommands';
import {
  createWhiteboardOperationDraftCommands,
  type WhiteboardOperationDraftCommandsV1,
} from './whiteboardOperationDraftCommands';
import {
  createWhiteboardTextGenerationCommands,
  type WhiteboardTextGenerationCommandsV1,
} from './whiteboardTextGenerationCommands';
import {
  createWhiteboardVideoGenerationCommands,
  type WhiteboardVideoGenerationCommandsV1,
} from './whiteboardVideoGenerationCommands';
import {
  createWhiteboardImageOperationCommands,
  type WhiteboardImageOperationCommandsV1,
} from './whiteboardImageOperationCommands';
import {
  createWhiteboardImageExecutionCommands,
  type WhiteboardImageExecutionCommandsV1,
} from './whiteboardImageExecutionCommands';
import {
  createWhiteboardHistoryCommands,
  type WhiteboardHistoryCommandsV1,
} from './whiteboardHistoryCommands';
import {
  createWhiteboardExecutionOutputCommands,
  type WhiteboardExecutionOutputCommandsV1,
} from './whiteboardExecutionOutputCommands';
import {
  createWhiteboardConnectedPluginExecutionCommands,
  type WhiteboardConnectedPluginExecutionCommandsV1,
} from './whiteboardConnectedPluginExecutionCommands';
import {
  createWhiteboardBlockCommands,
  type WhiteboardBlockCommandsV1,
} from './whiteboardBlockCommands';
import {
  createWhiteboardCanvasCommands,
  type WhiteboardCanvasCommandsV1,
} from './whiteboardCanvasCommands';
import {
  createWhiteboardOperationInputCommands,
  type WhiteboardOperationInputCommandsV1,
} from './whiteboardOperationInputCommands';
import {
  createWhiteboardBoardCommands,
  type WhiteboardBoardCommandsV1,
} from './whiteboardBoardCommands';

export interface WhiteboardWorkflowCommandsV1 {
  acceptOutput(input: {
    assetId: string;
    expectedStepRunVersion: number;
    stepRunId: string;
  }): Promise<{ stepRunId: string }>;
  createRun(input: { groupId: string }): Promise<{ workflowRunId: string }>;
  decideGate(input: {
    approvalRequestId: string;
    decision: WorkflowApprovalDecisionValue;
    expectedApprovalRequestVersion: number;
  }): Promise<{ workflowRunId?: string }>;
  projectDraft(input: {
    composerInput?: {
      inlineValues?: PackageComposerInlineValue[];
      instruction?: { body: string; slotId: string };
      mentions: PackageComposerMention[];
      parameters?: Record<string, unknown>;
    };
    packageContext?: PackageInvocationContext;
    presentation: WhiteboardWorkflowProjectionPresentationV1;
    projectId: string;
    workflowId: string;
    workflowTitle: string;
  }): Promise<WhiteboardWorkflowProjectionResultV1>;
  projectRevision(input: {
    presentation: WhiteboardWorkflowProjectionPresentationV1;
    revision: ProjectWorkflowRevisionV1;
  }): Promise<WhiteboardWorkflowProjectionResultV1>;
}

export interface WhiteboardWorkflowProjectionPresentationV1 {
  connectionIdsByCapability: Readonly<Record<string, string | undefined>>;
  labelsBySkillId: Readonly<Record<string, TextGenerationLabels>>;
  outputPlaceholder: string;
  placementCenter: { x: number; y: number };
}

export interface WhiteboardWorkflowProjectionResultV1 {
  blockIds: string[];
  groupBlockId: string;
  revisionId?: string;
  workflowProjectionId: string;
}

export interface WhiteboardAgentCommandsV1 {
  control(input: {
    action: 'cancel' | 'pause' | 'resume' | 'retry';
    agentRunId: string;
  }): Promise<{ agentRunId: string }>;
  createWorkflowArtifactSlice(input: {
    workflowOutputSlotId: string;
    workflowRunId: string;
  }): Promise<WhiteboardAgentRunCreationResult>;
  createWorkflowGateSlice(input: {
    completion: AgentWorkflowGateCompletion;
    gateId: string;
    workflowRunId: string;
  }): Promise<WhiteboardAgentRunCreationResult>;
  createWorkflowRun(input: {
    workflowRunId: string;
  }): Promise<WhiteboardAgentRunCreationResult>;
  createWorkflowSlice(input: {
    stepRunId: string;
    workflowRunId: string;
  }): Promise<WhiteboardAgentRunCreationResult>;
  createWorkflowStageSlice(input: {
    stageId: string;
    workflowRunId: string;
  }): Promise<WhiteboardAgentRunCreationResult>;
  reconcileRuntime(): Promise<{
    actions: WhiteboardAgentExecutionActionV1[];
    boardId: string;
    committed: boolean;
  }>;
  settleExecution(input: {
    agentRunId: string;
    errorMessage?: string;
    knownExecutionIds: string[];
    operationBlockId: string;
    stopReason: 'operation_execution_missing' | 'retired_definition';
  }): Promise<{ agentRunId: string; attachedExecution: boolean }>;
}

export interface WhiteboardAgentExecutionActionV1 extends AgentRunExecutionAction {
  knownExecutionIds: string[];
}

export interface WhiteboardAgentRunCreationResult {
  agentRunId: string;
  boardId: string;
  projectId: string;
}

export interface WhiteboardProductCommandsV1 {
  readonly agent: WhiteboardAgentCommandsV1;
  readonly agentAttachment: WhiteboardAgentAttachmentCommandsV1;
  readonly agentWorkspace: WhiteboardAgentWorkspaceCommandsV1;
  readonly artifact: WhiteboardArtifactCommandsV1;
  readonly asset: WhiteboardAssetCommandsV1;
  readonly block: WhiteboardBlockCommandsV1;
  readonly board: WhiteboardBoardCommandsV1;
  readonly canvas: WhiteboardCanvasCommandsV1;
  readonly connectedPluginExecution: WhiteboardConnectedPluginExecutionCommandsV1;
  readonly executionConfiguration: WhiteboardExecutionConfigurationCommandsV1;
  readonly executionOutput: WhiteboardExecutionOutputCommandsV1;
  readonly history: WhiteboardHistoryCommandsV1;
  readonly imageExecution: WhiteboardImageExecutionCommandsV1;
  readonly imageOperation: WhiteboardImageOperationCommandsV1;
  readonly operationDraft: WhiteboardOperationDraftCommandsV1;
  readonly operationInput: WhiteboardOperationInputCommandsV1;
  readonly plugin: WhiteboardPluginCommandsV1;
  readonly textGeneration: WhiteboardTextGenerationCommandsV1;
  readonly videoGeneration: WhiteboardVideoGenerationCommandsV1;
  readonly workflow: WhiteboardWorkflowCommandsV1;
}

export function createWhiteboardProductCommands(
  canvasHost: CanvasHostV1,
): WhiteboardProductCommandsV1 {
  const transactions = whiteboardCanvasHostBridge(canvasHost);
  const createAgentRun = async (
    create: (snapshot: BoardSnapshot) => string,
  ): Promise<WhiteboardAgentRunCreationResult> => {
    const transaction = await transactions.executeProductTransaction((snapshot) => {
      const agentRunId = create(snapshot);
      startAgentRun(snapshot, agentRunId);
      return {
        agentRunId,
        boardId: snapshot.board.boardId,
        projectId: snapshot.project.projectId,
      };
    });
    return transaction.result;
  };
  const agent: WhiteboardAgentCommandsV1 = Object.freeze({
    async control(input: Parameters<WhiteboardAgentCommandsV1['control']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const view = input.action === 'cancel'
          ? cancelAgentRun(snapshot, input.agentRunId)
          : input.action === 'pause'
            ? pauseAgentRun(snapshot, input.agentRunId)
            : input.action === 'retry'
              ? retryAgentRunAfterMissingExecution(snapshot, input.agentRunId)
              : startAgentRun(snapshot, input.agentRunId);
        supersedeResolvedAgentRunBlockerProposals(snapshot);
        return { agentRunId: view.record.agentRunId };
      });
      return transaction.result;
    },
    createWorkflowArtifactSlice(input: Parameters<WhiteboardAgentCommandsV1['createWorkflowArtifactSlice']>[0]) {
      return createAgentRun((snapshot) => createAgentRunForWorkflowArtifactSlice(
        snapshot,
        input.workflowRunId,
        input.workflowOutputSlotId,
      ).record.agentRunId);
    },
    createWorkflowGateSlice(input: Parameters<WhiteboardAgentCommandsV1['createWorkflowGateSlice']>[0]) {
      return createAgentRun((snapshot) => createAgentRunForWorkflowGateSlice(
        snapshot,
        input.workflowRunId,
        input.gateId,
        input.completion,
      ).record.agentRunId);
    },
    createWorkflowRun(input: Parameters<WhiteboardAgentCommandsV1['createWorkflowRun']>[0]) {
      return createAgentRun((snapshot) => createAgentRunForWorkflowRun(
        snapshot,
        input.workflowRunId,
      ).record.agentRunId);
    },
    createWorkflowSlice(input: Parameters<WhiteboardAgentCommandsV1['createWorkflowSlice']>[0]) {
      return createAgentRun((snapshot) => createAgentRunForWorkflowSlice(
        snapshot,
        input.workflowRunId,
        input.stepRunId,
      ).record.agentRunId);
    },
    createWorkflowStageSlice(input: Parameters<WhiteboardAgentCommandsV1['createWorkflowStageSlice']>[0]) {
      return createAgentRun((snapshot) => createAgentRunForWorkflowStageSlice(
        snapshot,
        input.workflowRunId,
        input.stageId,
      ).record.agentRunId);
    },
    async reconcileRuntime() {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        let changed = reconcileAgentRuntime(snapshot);
        changed = supersedeResolvedAgentRunBlockerProposals(snapshot) || changed;
        const knownExecutionIds = snapshot.executions.map((execution) => execution.executionId);
        const actions = nextAgentRunExecutionActions(snapshot).map((action) => ({
          ...action,
          knownExecutionIds,
        }));
        changed = reconcileAgentRuntime(snapshot) || changed;
        changed = supersedeResolvedAgentRunBlockerProposals(snapshot) || changed;
        return {
          changed,
          result: {
            actions,
            boardId: snapshot.board.boardId,
          },
        };
      });
      return {
        ...transaction.result,
        committed: transaction.committed,
      };
    },
    async settleExecution(input: Parameters<WhiteboardAgentCommandsV1['settleExecution']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const knownExecutionIds = new Set(input.knownExecutionIds);
        let attachedExecution = false;
        for (const execution of snapshot.executions) {
          if (
            !knownExecutionIds.has(execution.executionId)
            && execution.params?.operationBlockId === input.operationBlockId
          ) {
            attachAgentRunExecution(snapshot, input.agentRunId, execution.executionId);
            attachedExecution = true;
          }
        }
        if (!attachedExecution) {
          markAgentRunNeedsAttention(
            snapshot,
            input.agentRunId,
            input.errorMessage ?? 'Operation returned without creating an Execution.',
            input.stopReason,
          );
        }
        reconcileAgentRuntime(snapshot);
        supersedeResolvedAgentRunBlockerProposals(snapshot);
        return { agentRunId: input.agentRunId, attachedExecution };
      });
      return transaction.result;
    },
  });
  const workflow: WhiteboardWorkflowCommandsV1 = Object.freeze({
    async acceptOutput(
      input: Parameters<WhiteboardWorkflowCommandsV1['acceptOutput']>[0],
    ) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        acceptWorkflowStepOutputs(snapshot, {
          acceptedOutputAssetIds: [input.assetId],
          expectedStepRunVersion: input.expectedStepRunVersion,
          stepRunId: input.stepRunId,
        });
        reconcileAgentRuntime(snapshot);
        supersedeResolvedAgentRunBlockerProposals(snapshot);
        return { stepRunId: input.stepRunId };
      });
      return transaction.result;
    },
    async createRun(input: Parameters<WhiteboardWorkflowCommandsV1['createRun']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const view = createWorkflowRunForGroup(snapshot, input.groupId);
        return { workflowRunId: view.record.workflowRunId };
      });
      return transaction.result;
    },
    async decideGate(input: Parameters<WhiteboardWorkflowCommandsV1['decideGate']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        const workflowRunId = (snapshot.workflowApprovalRequests ?? []).find(
          (request) => request.approvalRequestId === input.approvalRequestId,
        )?.workflowRunId;
        decideWorkflowApproval(snapshot, {
          approvalRequestId: input.approvalRequestId,
          decision: input.decision,
          expectedApprovalRequestVersion: input.expectedApprovalRequestVersion,
        });
        reconcileAgentRuntime(snapshot);
        supersedeResolvedAgentRunBlockerProposals(snapshot);
        return { workflowRunId };
      });
      return transaction.result;
    },
    async projectDraft(input: Parameters<WhiteboardWorkflowCommandsV1['projectDraft']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        assertProjectScope(snapshot, input.projectId);
        const projection = projectWorkflowDraft(snapshot, {
          composerInput: input.composerInput,
          connectionIdForCapability: (capabilityId) => (
            input.presentation.connectionIdsByCapability[capabilityId]
          ),
          labelsForSkill: (skillId) => labelsForProjection(input.presentation, skillId),
          outputPlaceholder: input.presentation.outputPlaceholder,
          packageContext: input.packageContext,
          workflowId: input.workflowId,
          workflowTitle: input.workflowTitle,
        });
        placeWorkflowProjection(
          snapshot,
          projection.blockIds,
          input.presentation.placementCenter,
        );
        return {
          blockIds: projection.blockIds,
          groupBlockId: projection.groupBlock.blockId,
          workflowProjectionId: projection.projectionId,
        };
      });
      return transaction.result;
    },
    async projectRevision(input: Parameters<WhiteboardWorkflowCommandsV1['projectRevision']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        assertProjectScope(snapshot, input.revision.projectId);
        upsertProjectWorkflowDefinition(
          input.revision.projectId,
          input.revision.definition,
        );
        const projection = projectWorkflowDraft(snapshot, {
          connectionIdForCapability: (capabilityId) => (
            input.presentation.connectionIdsByCapability[capabilityId]
          ),
          labelsForSkill: (skillId) => labelsForProjection(input.presentation, skillId),
          outputPlaceholder: input.presentation.outputPlaceholder,
          projectionTemplate: input.revision.projectionTemplate,
          projectRevisionId: input.revision.revisionId,
          workflowDefinition: input.revision.definition,
          workflowId: input.revision.definition.workflowId,
          workflowTitle: input.revision.definition.name,
        });
        placeWorkflowProjection(
          snapshot,
          projection.blockIds,
          input.presentation.placementCenter,
        );
        return {
          blockIds: projection.blockIds,
          groupBlockId: projection.groupBlock.blockId,
          revisionId: input.revision.revisionId,
          workflowProjectionId: projection.projectionId,
        };
      });
      return transaction.result;
    },
  });

  return Object.freeze({
    agent,
    agentAttachment: createWhiteboardAgentAttachmentCommands(transactions),
    agentWorkspace: createWhiteboardAgentWorkspaceCommands(transactions),
    artifact: createWhiteboardArtifactCommands(transactions),
    asset: createWhiteboardAssetCommands(transactions),
    block: createWhiteboardBlockCommands(transactions),
    board: createWhiteboardBoardCommands(transactions),
    canvas: createWhiteboardCanvasCommands(transactions),
    connectedPluginExecution: createWhiteboardConnectedPluginExecutionCommands(transactions),
    executionConfiguration: createWhiteboardExecutionConfigurationCommands(transactions),
    executionOutput: createWhiteboardExecutionOutputCommands(transactions),
    history: createWhiteboardHistoryCommands(transactions),
    imageExecution: createWhiteboardImageExecutionCommands(transactions),
    imageOperation: createWhiteboardImageOperationCommands(transactions),
    operationDraft: createWhiteboardOperationDraftCommands(transactions),
    operationInput: createWhiteboardOperationInputCommands(transactions),
    plugin: createWhiteboardPluginCommands(transactions),
    textGeneration: createWhiteboardTextGenerationCommands(transactions),
    videoGeneration: createWhiteboardVideoGenerationCommands(transactions),
    workflow,
  });
}

function assertProjectScope(snapshot: BoardSnapshot, projectId: string): void {
  if (snapshot.project.projectId !== projectId) {
    throw new Error(`Workflow projection belongs to another Project: ${projectId}`);
  }
}

function labelsForProjection(
  presentation: WhiteboardWorkflowProjectionPresentationV1,
  skillId: string,
): TextGenerationLabels {
  const labels = presentation.labelsBySkillId[skillId];
  if (!labels) throw new Error(`Workflow projection labels are missing for Skill: ${skillId}`);
  return structuredClone(labels);
}

function placeWorkflowProjection(
  snapshot: BoardSnapshot,
  blockIds: readonly string[],
  placementCenter: { x: number; y: number },
): void {
  const blocks = blockIds
    .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
    .filter((block): block is BoardSnapshot['blocks'][number] => Boolean(block));
  if (blocks.length === 0) return;
  moveBlockGroupToNearestFreeArea(snapshot, blocks, placementCenter);
  const updatedAt = nowIso();
  for (const block of blocks) block.updatedAt = updatedAt;
}
