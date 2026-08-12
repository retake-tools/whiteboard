import {
  appendAgentRuntimeRecovery,
  applyAuthorizedOperationSuggestion,
  applyAgentRuntimeTurn,
} from '../../core/agentSession';
import { appendAgentRuntimeEvent } from '../../core/agentChangeApplication';
import type {
  AgentRuntimeEvent,
  AgentRuntimeTurnDecision,
  AgentMessageRecord,
  ChangeProposalCommand,
} from '../../core/agentSessionContracts';
import {
  stageAgentOperationExecution,
  type AgentOperationExecutionRequest,
} from '../../core/agentOperationExecution';
import type { BoardSnapshot } from '../../core/types';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';
import { applyWhiteboardImageComposerLayout } from './whiteboardImageComposerLayout';

export interface WhiteboardAgentWorkspaceRuntimeCommandsV1 {
  authorizeOperationSuggestion(input: {
    agentSessionId: string;
    operationBlockId: string;
    presentation: WhiteboardAgentOperationPresentationV1;
    sourceMessageId: string;
  }): Promise<WhiteboardAgentOperationStageResultV1>;
  appendRuntimeEvent(input: {
    event: AgentRuntimeEvent;
    sourceMessageId: string;
  }): Promise<{
    committed: boolean;
    runtimeEventId: string;
    sequence: number;
  }>;
  applyRuntimeTurn(input: {
    agentSessionId: string;
    decision: AgentRuntimeTurnDecision;
    externalThreadId: string;
    runtimeModel: string;
    runtimeTurnId: string;
    operationPresentation: WhiteboardAgentOperationPresentationV1;
    sourceMessageId: string;
  }): Promise<WhiteboardAgentRuntimeTurnResultV1>;
  recordRuntimeRecovery(input: {
    agentSessionId: string;
    content: string;
    error: string;
    externalThreadId?: string;
    kind: 'operation_application' | 'runtime_unavailable';
    runtimeModel?: string;
    runtimeTurnId?: string;
    sourceMessageId: string;
    suggestions: string[];
  }): Promise<{ assistantMessageId: string; committed: boolean }>;
}

export interface WhiteboardAgentOperationPresentationV1 {
  connectionId?: string;
  imageToImagePromptPlaceholder: string;
  operationTitle: string;
  placementCenter: { x: number; y: number };
  promptPlaceholder: string;
  promptTitle: string;
}

export interface WhiteboardAgentOperationStageResultV1 {
  action: 'created' | 'continued';
  assistantMessageId: string;
  committed: boolean;
  createdBlockIds: string[];
  operationBlockId: string;
  operationScopeIds: string[];
  promptBlockId?: string;
}

export interface WhiteboardAgentRuntimeTurnResultV1 {
  assistantMessageId: string;
  committed: boolean;
  operationStage?: Omit<WhiteboardAgentOperationStageResultV1, 'committed'>;
  proposal?: {
    proposalId: string;
    proposalVersion: number;
    proposedCommandKind: ChangeProposalCommand['kind'];
  };
}

export function createWhiteboardAgentWorkspaceRuntimeCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardAgentWorkspaceRuntimeCommandsV1 {
  return Object.freeze({
    async authorizeOperationSuggestion(
      input: Parameters<WhiteboardAgentWorkspaceRuntimeCommandsV1['authorizeOperationSuggestion']>[0],
    ) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        const existing = (snapshot.agentMessages ?? []).find(
          (message) => message.role === 'assistant' && message.sourceMessageId === input.sourceMessageId,
        );
        const applied = existing
          ? applyAuthorizedOperationSuggestion(structuredClone(snapshot), input)
          : applyAuthorizedOperationSuggestion(snapshot, input);
        if (existing) {
          if (
            existing.agentSessionId !== input.agentSessionId
            || existing.content !== applied.assistantMessage.content
          ) throw new Error('Agent Operation suggestion conflicts with another persisted result.');
          applied.operationExecution.assistantMessageId = existing.agentMessageId;
        }
        const staged = stageOperationExecutionInSnapshot(
          snapshot,
          applied.operationExecution,
          input.presentation,
        );
        return {
          changed: !existing || staged.changed,
          result: staged.result,
        };
      });
      return { ...transaction.result, committed: transaction.committed };
    },
    async appendRuntimeEvent(
      input: Parameters<WhiteboardAgentWorkspaceRuntimeCommandsV1['appendRuntimeEvent']>[0],
    ) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        const changed = !(snapshot.agentRuntimeEvents ?? []).some(
          (event) => event.runtimeEventId === input.event.runtimeEventId,
        );
        const event = appendAgentRuntimeEvent(snapshot, input);
        return {
          changed,
          result: {
            runtimeEventId: event.runtimeEventId,
            sequence: event.sequence,
          },
        };
      });
      return { ...transaction.result, committed: transaction.committed };
    },
    async applyRuntimeTurn(
      input: Parameters<WhiteboardAgentWorkspaceRuntimeCommandsV1['applyRuntimeTurn']>[0],
    ) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        const existing = (snapshot.agentMessages ?? []).find(
          (message) => message.role === 'assistant' && message.runtimeTurnId === input.runtimeTurnId,
        );
        let turnResult: Omit<WhiteboardAgentRuntimeTurnResultV1, 'committed'>;
        if (existing) {
          assertExistingRuntimeTurn(existing, input);
          turnResult = runtimeTurnResult(snapshot, input, existing.agentMessageId);
        } else {
          const applied = applyAgentRuntimeTurn(snapshot, input);
          turnResult = runtimeTurnResult(
            snapshot,
            input,
            applied.assistantMessage.agentMessageId,
          );
        }
        const operationExecution = operationExecutionForTurn(
          input,
          turnResult.assistantMessageId,
        );
        const staged = operationExecution
          ? stageOperationExecutionInSnapshot(
              snapshot,
              operationExecution,
              input.operationPresentation,
            )
          : undefined;
        return {
          changed: !existing || Boolean(staged?.changed),
          result: {
            ...turnResult,
            ...(staged ? { operationStage: staged.result } : {}),
          },
        };
      });
      return { ...transaction.result, committed: transaction.committed };
    },
    async recordRuntimeRecovery(
      input: Parameters<WhiteboardAgentWorkspaceRuntimeCommandsV1['recordRuntimeRecovery']>[0],
    ) {
      const transaction = await transactions.executeConditionalProductTransaction((snapshot) => {
        assertActiveRuntimeSession(snapshot, input.agentSessionId);
        const existing = (snapshot.agentMessages ?? []).find(
          (message) =>
            message.role === 'assistant'
            && message.sourceMessageId === input.sourceMessageId
            && message.recovery?.kind === input.kind,
        );
        const recovery = appendAgentRuntimeRecovery(snapshot, input);
        return {
          changed: !existing,
          result: { assistantMessageId: recovery.agentMessageId },
        };
      });
      return { ...transaction.result, committed: transaction.committed };
    },
  });
}

function stageOperationExecutionInSnapshot(
  snapshot: BoardSnapshot,
  executionRequest: AgentOperationExecutionRequest,
  presentation: WhiteboardAgentOperationPresentationV1,
): {
  changed: boolean;
  result: Omit<WhiteboardAgentOperationStageResultV1, 'committed'>;
} {
  const existingReceipt = operationReceipt(snapshot, executionRequest.assistantMessageId);
  if (existingReceipt) {
    assertOperationReceiptRetry(snapshot, executionRequest, existingReceipt);
  }
  const hadReceipt = Boolean(existingReceipt);
  const staged = stageAgentOperationExecution(snapshot, executionRequest, {
    connectionIdForCapability: () => presentation.connectionId,
    imageToImageOperationTitle: presentation.operationTitle,
    imageToImagePromptPlaceholder: presentation.imageToImagePromptPlaceholder,
    operationTitle: presentation.operationTitle,
    operationTitleForCapability: () => presentation.operationTitle,
    promptPlaceholder: presentation.promptPlaceholder,
    promptTitle: presentation.promptTitle,
  });
  const attachmentBlockIds = agentMessageAttachmentBlockIds(executionRequest);
  if (!hadReceipt) {
    if (
      staged.receipt.action === 'created'
      && staged.receipt.promptBlockId
      && attachmentBlockIds.length > 0
    ) {
      applyWhiteboardImageComposerLayout(staged.stagedSnapshot, {
        operationBlockId: staged.receipt.operationBlockId,
        referenceBlockIds: attachmentBlockIds,
        textBlockId: staged.receipt.promptBlockId,
      }, presentation.placementCenter);
    }
    Object.assign(snapshot, staged.stagedSnapshot);
  }
  return {
    changed: !hadReceipt,
    result: {
      ...staged.receipt,
      createdBlockIds: [...staged.receipt.createdBlockIds],
      operationScopeIds: [
        ...attachmentBlockIds,
        ...(staged.receipt.createdBlockIds.length > 0
          ? staged.receipt.createdBlockIds
          : [staged.receipt.operationBlockId]),
      ],
    },
  };
}

function operationReceipt(snapshot: BoardSnapshot, assistantMessageId: string) {
  return snapshot.agentMessages?.find(
    (message) => message.agentMessageId === assistantMessageId,
  )?.contextRefs.find((ref) => ref.kind === 'operation_receipt');
}

function assertOperationReceiptRetry(
  snapshot: BoardSnapshot,
  request: AgentOperationExecutionRequest,
  receipt: Extract<AgentMessageRecord['contextRefs'][number], { kind: 'operation_receipt' }>,
): void {
  const assistant = snapshot.agentMessages?.find(
    (message) => message.agentMessageId === request.assistantMessageId,
  );
  const operation = snapshot.blocks.find(
    (block) => block.blockId === receipt.operationBlockId && block.type === 'operation',
  );
  const operationMatches = request.kind === 'execute_existing'
    ? request.decision.operationBlockId === receipt.operationBlockId
    : operation?.data.capabilityId === request.decision.capabilityId;
  if (
    !assistant
    || assistant.role !== 'assistant'
    || assistant.agentSessionId !== request.agentSessionId
    || assistant.sourceMessageId !== request.sourceMessageId
    || !operationMatches
  ) throw new Error('Agent Operation receipt conflicts with another staged request.');
}

function agentMessageAttachmentBlockIds(
  request: AgentOperationExecutionRequest,
): string[] {
  if (request.kind !== 'create_execute') return [];
  const imageInputs = request.decision.imageInputs?.length
    ? request.decision.imageInputs
    : request.decision.sourceImageBlockId && request.decision.sourceBinding
      ? [{
          bindingSource: request.decision.sourceBinding,
          blockId: request.decision.sourceImageBlockId,
        }]
      : [];
  return imageInputs
    .filter((input) => input.bindingSource === 'message_attachment')
    .map((input) => input.blockId);
}

function assertActiveRuntimeSession(snapshot: BoardSnapshot, agentSessionId: string): void {
  const session = (snapshot.agentSessions ?? []).find(
    (candidate) => candidate.agentSessionId === agentSessionId,
  );
  if (
    !session
    || session.status !== 'active'
    || session.projectId !== snapshot.project.projectId
    || session.boardId !== snapshot.board.boardId
  ) throw new Error('Agent Session is not active in the current Board.');
}

function assertExistingRuntimeTurn(
  existing: AgentMessageRecord,
  input: Parameters<WhiteboardAgentWorkspaceRuntimeCommandsV1['applyRuntimeTurn']>[0],
): void {
  const content = input.decision.message.trim() || 'Agent completed without a message.';
  if (
    existing.agentSessionId !== input.agentSessionId
    || existing.sourceMessageId !== input.sourceMessageId
    || existing.content !== content
  ) throw new Error('Agent Runtime turn id conflicts with another persisted result.');
}

function runtimeTurnResult(
  snapshot: BoardSnapshot,
  input: Parameters<WhiteboardAgentWorkspaceRuntimeCommandsV1['applyRuntimeTurn']>[0],
  assistantMessageId: string,
): Omit<WhiteboardAgentRuntimeTurnResultV1, 'committed'> {
  const proposal = (snapshot.changeProposals ?? []).find(
    (candidate) => candidate.sourceMessageId === input.sourceMessageId,
  );
  return {
    assistantMessageId,
    ...(proposal ? {
      proposal: {
        proposalId: proposal.proposalId,
        proposalVersion: proposal.recordVersion,
        proposedCommandKind: proposal.proposedCommand.kind,
      },
    } : {}),
  };
}

function operationExecutionForTurn(
  input: Parameters<WhiteboardAgentWorkspaceRuntimeCommandsV1['applyRuntimeTurn']>[0],
  assistantMessageId: string,
): AgentOperationExecutionRequest | undefined {
  return input.decision.kind === 'operation_create_execute'
    ? {
        agentSessionId: input.agentSessionId,
        assistantMessageId,
        decision: structuredClone(input.decision),
        kind: 'create_execute',
        sourceMessageId: input.sourceMessageId,
      }
    : input.decision.kind === 'operation_execute'
      ? {
          agentSessionId: input.agentSessionId,
          assistantMessageId,
          decision: structuredClone(input.decision),
          kind: 'execute_existing',
          sourceMessageId: input.sourceMessageId,
        }
      : undefined;
}
