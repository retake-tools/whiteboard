import { operationReadinessFor } from './capabilities';
import { projectAgentCallableCapability } from './agentCallableCapabilities';
import { capabilityDefinitionFor } from './capabilityRegistry';
import {
  imageComposerGenerationParams,
} from './imageComposer';
import {
  createDraftImageToImageOperation,
  createDraftTextToImageOperation,
} from './imageOperations';
import type { ImageGenerationParams } from './imageOperations';
import {
  agentSessionWorkingOutputImageBlockIds,
  setAgentSessionWorkingOperation,
} from './agentSession';
import type {
  AgentImageInputBinding,
  AgentRuntimeTurnDecision,
} from './agentSessionContracts';
import { createId, nowIso } from './id';
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
  operationTitleForCapability?: (capabilityId: string) => string;
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
  const definition = capabilityDefinitionFor(capabilityId);
  const callableCapability = projectAgentCallableCapability(definition);
  if (!callableCapability) {
    throw new Error(`Agent-created Capability is not safely authorable: ${capabilityId}.`);
  }
  const connectionId = options.connectionIdForCapability(capabilityId, snapshot);
  if (!connectionId) {
    throw new Error('No ready automated Connection is available for the Agent-created Operation.');
  }
  const imageInputs = validateAgentImageInputs(
    snapshot,
    request,
    sourceMessage,
    callableCapability.authoringKind,
  );
  const sourceImageBlockId = imageInputs.find(
    (input) => input.inputRole === 'source',
  )?.blockId;
  const draft = callableCapability.authoringKind === 'source_image_edit'
    ? createAgentImageToImageDraft(
        snapshot,
        request,
        options,
        definition,
        sourceImageBlockId,
      )
    : createDraftTextToImageOperation(snapshot, {
        generationParams: imageComposerGenerationParams(
          request.decision.generationParams,
        ),
        operationTitle: options.operationTitle,
        textBlockBody: request.decision.operationPrompt,
        textBlockPlaceholder: options.promptPlaceholder,
        textBlockTitle: options.promptTitle,
      });
  for (const imageInput of imageInputs) {
    ensureAgentImageInputEdge(
      snapshot,
      imageInput.blockId,
      draft.operationBlock.blockId,
      imageInput.inputRole,
    );
  }
  bindAgentCapabilitySlots(
    snapshot,
    draft.operationBlock.blockId,
    draft.textBlock.blockId,
    imageInputs,
    definition,
  );
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
  options: AgentOperationApplicationOptions,
  definition: ReturnType<typeof capabilityDefinitionFor>,
  sourceImageBlockId: string | undefined,
) {
  if (!sourceImageBlockId) {
    throw new Error('Agent-created image edit has no typed source binding.');
  }
  const sourceImage = snapshot.blocks.find(
    (block) =>
      block.blockId === sourceImageBlockId
      && block.type === 'image'
      && typeof block.data.assetId === 'string',
  );
  if (!sourceImage) {
    throw new Error('Agent-created image edit source is outside the typed message or Session binding.');
  }
  const draft = createDraftImageToImageOperation(snapshot, {
    capabilityId: request.decision.capabilityId,
    generationParams: agentImageToImageGenerationParams(
      request.decision.generationParams,
    ),
    operation: 'quick_edit',
    operationTitle: options.operationTitleForCapability?.(definition.capabilityId)
      ?? options.imageToImageOperationTitle
      ?? definition.displayName
      ?? options.operationTitle,
    sourceBlockId: sourceImage.blockId,
    textBlockBody: request.decision.operationPrompt,
    textBlockPlaceholder: options.imageToImagePromptPlaceholder,
    textBlockTitle: options.promptTitle,
  });
  return draft;
}

function bindAgentCapabilitySlots(
  snapshot: BoardSnapshot,
  operationBlockId: string,
  promptBlockId: string,
  imageInputs: readonly AgentImageInputBinding[],
  definition: ReturnType<typeof capabilityDefinitionFor>,
): void {
  const promptSlot = definition.inputSlots.find(
    (slot) => slot.required
      && slot.semanticRole === 'prompt'
      && slot.dataTypes.includes('text'),
  );
  const sourceSlot = definition.inputSlots.find(
    (slot) => slot.required
      && slot.semanticRole === 'source'
      && slot.dataTypes.includes('image'),
  );
  const referenceSlot = definition.inputSlots.find(
    (slot) =>
      !slot.required
      && slot.semanticRole === 'reference'
      && slot.dataTypes.includes('image'),
  );
  if (
    imageInputs.some((input) => input.inputRole !== 'source')
    && !referenceSlot
  ) {
    throw new Error('Agent-created Capability does not declare a compatible image reference Slot.');
  }
  const imageInputByBlockId = new Map(
    imageInputs.map((input) => [input.blockId, input]),
  );
  for (const edge of snapshot.edges) {
    if (edge.targetBlockId !== operationBlockId || edge.kind !== 'execution_input') continue;
    if (edge.sourceBlockId === promptBlockId && promptSlot) {
      edge.inputSlotId = promptSlot.slotId;
    }
    const imageInput = imageInputByBlockId.get(edge.sourceBlockId);
    if (imageInput?.inputRole === 'source' && sourceSlot) {
      edge.inputRole = imageInput.inputRole;
      edge.inputSlotId = sourceSlot.slotId;
    } else if (imageInput && referenceSlot) {
      edge.inputRole = imageInput.inputRole;
      edge.inputSlotId = referenceSlot.slotId;
    }
  }
}

function validateAgentImageInputs(
  snapshot: BoardSnapshot,
  request: Extract<AgentOperationExecutionRequest, { kind: 'create_execute' }>,
  sourceMessage: NonNullable<BoardSnapshot['agentMessages']>[number],
  authoringKind: 'image_generate' | 'source_image_edit',
): AgentImageInputBinding[] {
  const inputs = request.decision.imageInputs?.length
    ? request.decision.imageInputs
    : request.decision.sourceImageBlockId && request.decision.sourceBinding
      ? [{
          bindingSource: request.decision.sourceBinding,
          blockId: request.decision.sourceImageBlockId,
          inputRole: 'source' as const,
        }]
      : [];
  if (inputs.length !== new Set(inputs.map((input) => input.blockId)).size) {
    throw new Error('Agent-created image inputs contain duplicate Blocks.');
  }
  const sourceCount = inputs.filter((input) => input.inputRole === 'source').length;
  if (
    authoringKind === 'image_generate'
      ? sourceCount > 0
      : sourceCount !== 1
  ) {
    throw new Error('Agent-created image inputs do not match the Capability source contract.');
  }
  for (const input of inputs) {
    const block = snapshot.blocks.find(
      (candidate) =>
        candidate.blockId === input.blockId
        && candidate.type === 'image'
        && typeof candidate.data.assetId === 'string',
    );
    if (!block || !agentImageInputIsBound(
      snapshot,
      request.agentSessionId,
      sourceMessage,
      input,
    )) {
      throw new Error('Agent-created image input is outside the typed message or Session binding.');
    }
  }
  return inputs.map((input) => ({ ...input }));
}

function agentImageInputIsBound(
  snapshot: BoardSnapshot,
  agentSessionId: string,
  sourceMessage: NonNullable<BoardSnapshot['agentMessages']>[number],
  input: AgentImageInputBinding,
): boolean {
  if (input.bindingSource === 'message_selection') {
    return sourceMessage.contextRefs.some(
      (ref) =>
        ref.kind === 'canvas_image_selection'
        && ref.imageBlockIds.includes(input.blockId),
    );
  }
  if (input.bindingSource === 'message_attachment') {
    return sourceMessage.contextRefs.some(
      (ref) =>
        ref.kind === 'block'
        && ref.slotId === 'agent_attachment'
        && ref.blockId === input.blockId,
    );
  }
  if (input.bindingSource === 'message_mention') {
    return sourceMessage.contextRefs.some(
      (ref) =>
        ref.kind === 'block'
        && ref.slotId !== 'agent_attachment'
        && ref.blockId === input.blockId,
    );
  }
  return sessionWorkingOutputImages(snapshot, agentSessionId).includes(input.blockId);
}

function ensureAgentImageInputEdge(
  snapshot: BoardSnapshot,
  sourceBlockId: string,
  operationBlockId: string,
  inputRole: AgentImageInputBinding['inputRole'],
): void {
  const existing = snapshot.edges.find(
    (edge) =>
      edge.kind === 'execution_input'
      && edge.sourceBlockId === sourceBlockId
      && edge.targetBlockId === operationBlockId,
  );
  if (existing) {
    existing.inputRole = inputRole;
    return;
  }
  snapshot.edges.push({
    edgeId: createId('edge'),
    kind: 'execution_input',
    sourceBlockId,
    targetBlockId: operationBlockId,
    inputRole,
  });
}

function agentImageToImageGenerationParams(
  input: ImageGenerationParams | undefined,
): ImageGenerationParams {
  const normalized = imageComposerGenerationParams(input);
  const explicitlyChangesAspectRatio = (
    (typeof input?.aspectRatioPreset === 'string'
      && input.aspectRatioPreset !== 'source')
    || typeof input?.targetAspectRatio === 'number'
    || (
      typeof input?.targetWidth === 'number'
      && typeof input.targetHeight === 'number'
    )
  );
  if (explicitlyChangesAspectRatio) return normalized;
  const {
    aspectRatioPreset: _aspectRatioPreset,
    targetAspectRatio: _targetAspectRatio,
    targetHeight: _targetHeight,
    targetWidth: _targetWidth,
    ...sourcePreservingParams
  } = normalized;
  return sourcePreservingParams;
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
