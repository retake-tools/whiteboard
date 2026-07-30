import { operationReadinessFor } from './capabilities';
import {
  imageComposerGenerationParams,
} from './imageComposer';
import {
  createDraftImageToImageOperation,
  createDraftTextToImageOperation,
} from './imageOperations';
import {
  agentSessionWorkingOutputImageBlockIds,
  setAgentSessionWorkingOperation,
} from './agentSession';
import type {
  AgentRuntimeTurnDecision,
} from './agentSessionContracts';
import { nowIso } from './id';
import type { BoardSnapshot } from './types';

export type AgentOperationExecutionRequest =
  | {
      agentSessionId: string;
      assistantMessageId: string;
      decision: Extract<AgentRuntimeTurnDecision, { kind: 'operation_create_execute' }>;
      kind: 'create_execute';
      sourceMessageId: string;
    }
  | {
      agentSessionId: string;
      assistantMessageId: string;
      decision: Extract<AgentRuntimeTurnDecision, { kind: 'operation_execute' }>;
      kind: 'execute_existing';
      sourceMessageId: string;
    };

export interface AgentOperationApplicationOptions {
  connectionIdForCapability: (
    capabilityId: string,
    snapshot: BoardSnapshot,
  ) => string | undefined;
  operationTitle: string;
  imageToImageOperationTitle?: string;
  imageToImagePromptPlaceholder?: string;
  promptPlaceholder?: string;
  promptTitle: string;
}

export interface AgentOperationApplicationReceipt {
  action: 'created' | 'continued';
  assistantMessageId: string;
  createdBlockIds: string[];
  operationBlockId: string;
  promptBlockId?: string;
}

export function stageAgentOperationExecution(
  snapshot: BoardSnapshot,
  request: AgentOperationExecutionRequest,
  options: AgentOperationApplicationOptions,
): {
  receipt: AgentOperationApplicationReceipt;
  stagedSnapshot: BoardSnapshot;
} {
  const stagedSnapshot = structuredClone(snapshot);
  const existingReceipt = operationReceiptForMessage(
    stagedSnapshot,
    request.assistantMessageId,
  );
  if (existingReceipt) {
    return {
      receipt: {
        action: existingReceipt.action,
        assistantMessageId: request.assistantMessageId,
        createdBlockIds: [],
        operationBlockId: existingReceipt.operationBlockId,
      },
      stagedSnapshot,
    };
  }
  const assistantMessage = requireAssistantMessage(stagedSnapshot, request);
  const sourceMessage = requireSourceMessage(stagedSnapshot, request);
  const receipt = request.kind === 'create_execute'
    ? createAndValidateOperation(stagedSnapshot, request, sourceMessage, options)
    : updateAndValidateExistingOperation(stagedSnapshot, request, sourceMessage);

  const session = stagedSnapshot.agentSessions?.find(
    (candidate) => candidate.agentSessionId === request.agentSessionId,
  );
  const workingSource = request.kind === 'create_execute'
    ? 'agent_created'
    : request.decision.bindingSource === 'message_explicit'
      ? 'user_explicit'
      : session?.workingOperation?.source ?? 'agent_created';
  setAgentSessionWorkingOperation(stagedSnapshot, request.agentSessionId, {
    operationBlockId: receipt.operationBlockId,
    source: workingSource,
  });
  assistantMessage.contextRefs.push({
    action: receipt.action,
    kind: 'operation_receipt',
    operationBlockId: receipt.operationBlockId,
  });
  assistantMessage.recordVersion += 1;
  stagedSnapshot.board.updatedAt = nowIso();
  stagedSnapshot.project.updatedAt = stagedSnapshot.board.updatedAt;
  return { receipt, stagedSnapshot };
}

function createAndValidateOperation(
  snapshot: BoardSnapshot,
  request: Extract<AgentOperationExecutionRequest, { kind: 'create_execute' }>,
  sourceMessage: NonNullable<BoardSnapshot['agentMessages']>[number],
  options: AgentOperationApplicationOptions,
): AgentOperationApplicationReceipt {
  const capabilityId = request.decision.capabilityId;
  const connectionId = options.connectionIdForCapability(capabilityId, snapshot);
  if (!connectionId) {
    throw new Error('No ready automated Connection is available for the Agent-created Operation.');
  }
  const generationParams = imageComposerGenerationParams(
    request.decision.generationParams,
  );
  const draft = capabilityId === 'image.image_to_image'
    ? createAgentImageToImageDraft(
        snapshot,
        request,
        sourceMessage,
        options,
        generationParams,
      )
    : createDraftTextToImageOperation(snapshot, {
        generationParams,
        operationTitle: options.operationTitle,
        textBlockBody: request.decision.operationPrompt,
        textBlockPlaceholder: options.promptPlaceholder,
        textBlockTitle: options.promptTitle,
      });
  draft.operationBlock.data.connectionId = connectionId;
  const readiness = operationReadinessFor(snapshot, draft.operationBlock);
  if (!readiness.canRun) {
    throw new Error(
      `Agent-created Operation is not ready: ${readiness.issues.join(', ') || 'unknown'}.`,
    );
  }
  return {
    action: 'created',
    assistantMessageId: request.assistantMessageId,
    createdBlockIds: [draft.textBlock.blockId, draft.operationBlock.blockId],
    operationBlockId: draft.operationBlock.blockId,
    promptBlockId: draft.textBlock.blockId,
  };
}

function createAgentImageToImageDraft(
  snapshot: BoardSnapshot,
  request: Extract<AgentOperationExecutionRequest, { kind: 'create_execute' }>,
  sourceMessage: NonNullable<BoardSnapshot['agentMessages']>[number],
  options: AgentOperationApplicationOptions,
  generationParams: ReturnType<typeof imageComposerGenerationParams>,
) {
  const sourceImageBlockId = request.decision.sourceImageBlockId;
  const sourceBinding = request.decision.sourceBinding;
  if (!sourceImageBlockId || !sourceBinding) {
    throw new Error('Agent-created image edit has no typed source binding.');
  }
  const sourceIsBound = sourceBinding === 'message_selection'
    ? sourceMessage.contextRefs.some(
        (ref) =>
          ref.kind === 'canvas_image_selection'
          && ref.imageBlockIds.includes(sourceImageBlockId),
      )
    : sessionWorkingOutputImages(snapshot, request.agentSessionId)
      .includes(sourceImageBlockId);
  const sourceImage = snapshot.blocks.find(
    (block) =>
      block.blockId === sourceImageBlockId
      && block.type === 'image'
      && typeof block.data.assetId === 'string',
  );
  if (!sourceIsBound || !sourceImage) {
    throw new Error('Agent-created image edit source is outside the typed message or Session binding.');
  }
  const draft = createDraftImageToImageOperation(snapshot, {
    operation: 'quick_edit',
    operationTitle: options.imageToImageOperationTitle ?? options.operationTitle,
    sourceBlockId: sourceImage.blockId,
    textBlockBody: request.decision.operationPrompt,
    textBlockPlaceholder: options.imageToImagePromptPlaceholder,
    textBlockTitle: options.promptTitle,
  });
  draft.operationBlock.data.generationParams = {
    ...recordValue(draft.operationBlock.data.generationParams),
    ...generationParams,
  };
  return draft;
}

function sessionWorkingOutputImages(
  snapshot: BoardSnapshot,
  agentSessionId: string,
): string[] {
  const operationBlockId = snapshot.agentSessions?.find(
    (session) => session.agentSessionId === agentSessionId,
  )?.workingOperation?.operationBlockId;
  if (!operationBlockId) return [];
  return agentSessionWorkingOutputImageBlockIds(snapshot, operationBlockId);
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function updateAndValidateExistingOperation(
  snapshot: BoardSnapshot,
  request: Extract<AgentOperationExecutionRequest, { kind: 'execute_existing' }>,
  sourceMessage: NonNullable<BoardSnapshot['agentMessages']>[number],
): AgentOperationApplicationReceipt {
  const operation = snapshot.blocks.find(
    (block) =>
      block.blockId === request.decision.operationBlockId
      && block.type === 'operation',
  );
  if (!operation) throw new Error('Agent-selected Operation is no longer available.');
  const session = snapshot.agentSessions?.find(
    (candidate) => candidate.agentSessionId === request.agentSessionId,
  );
  const targetIsBound = request.decision.bindingSource === 'session_working'
    ? session?.workingOperation?.operationBlockId === operation.blockId
    : sourceMessage.contextRefs.some(
        (ref) => ref.kind === 'operation' && ref.operationBlockId === operation.blockId,
      );
  if (!targetIsBound) {
    throw new Error('Agent-selected Operation is not explicitly bound to this request.');
  }
  const prompt = request.decision.operationPrompt?.trim();
  let promptBlockId: string | undefined;
  if (prompt) {
    const promptEdge = snapshot.edges.find(
      (edge) =>
        edge.kind === 'execution_input'
        && edge.targetBlockId === operation.blockId
        && snapshot.blocks.some(
          (block) =>
            block.blockId === edge.sourceBlockId
            && block.type === 'text',
        ),
    );
    const promptBlock = promptEdge
      ? snapshot.blocks.find((block) => block.blockId === promptEdge.sourceBlockId)
      : undefined;
    if (!promptBlock || promptBlock.type !== 'text') {
      throw new Error('Agent-selected Operation has no editable text prompt input.');
    }
    promptBlock.data = { ...promptBlock.data, body: prompt };
    promptBlock.updatedAt = nowIso();
    promptBlockId = promptBlock.blockId;
  }
  const readiness = operationReadinessFor(snapshot, operation);
  if (!readiness.canRun) {
    throw new Error(
      `Agent-selected Operation is no longer ready: ${readiness.issues.join(', ') || 'unknown'}.`,
    );
  }
  return {
    action: 'continued',
    assistantMessageId: request.assistantMessageId,
    createdBlockIds: [],
    operationBlockId: operation.blockId,
    ...(promptBlockId ? { promptBlockId } : {}),
  };
}

function requireAssistantMessage(
  snapshot: BoardSnapshot,
  request: AgentOperationExecutionRequest,
) {
  const message = snapshot.agentMessages?.find(
    (candidate) => candidate.agentMessageId === request.assistantMessageId,
  );
  if (
    !message
    || message.agentSessionId !== request.agentSessionId
    || message.sourceMessageId !== request.sourceMessageId
    || message.role !== 'assistant'
  ) {
    throw new Error('Agent Operation application receipt target is invalid.');
  }
  return message;
}

function requireSourceMessage(
  snapshot: BoardSnapshot,
  request: AgentOperationExecutionRequest,
) {
  const message = snapshot.agentMessages?.find(
    (candidate) => candidate.agentMessageId === request.sourceMessageId,
  );
  if (
    !message
    || message.agentSessionId !== request.agentSessionId
    || message.role !== 'user'
  ) {
    throw new Error('Agent Operation application source message is invalid.');
  }
  return message;
}

function operationReceiptForMessage(
  snapshot: BoardSnapshot,
  assistantMessageId: string,
) {
  const message = snapshot.agentMessages?.find(
    (candidate) => candidate.agentMessageId === assistantMessageId,
  );
  return message?.contextRefs.find((ref) => ref.kind === 'operation_receipt');
}
