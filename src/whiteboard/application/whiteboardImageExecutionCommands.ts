import { projectAgentCallableCapability } from '../../core/agentCallableCapabilities';
import { tryCapabilityDefinitionFor } from '../../core/capabilityRegistry';
import { executionConnection } from '../../core/executionProviderPreferences';
import { blockLockedByGroup } from '../../core/grouping';
import {
  executeExistingImageOperationBlock,
  type ImageGenerationParams,
  type SwitchableOperationMode,
} from '../../core/imageOperations';
import { executeExistingStoryboardSheetOperation } from '../../core/storyboardSheetOperations';
import { storyboardSheetCapabilityId } from '../../core/storyboardSheetContracts';
import type { BlockRecord, BoardSnapshot } from '../../core/types';
import type { CanvasHostScopeV1 } from '../../host-kit';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export type WhiteboardImageExecutionRouteV1 =
  | 'codex_app_server'
  | 'mcp_agent'
  | 'volcengine_ark';

export interface WhiteboardImageExecutionCommandsV1 {
  queue(input: {
    connectionAdapterUnavailableMessage: string;
    connectionUnavailableMessage: string;
    expectedScope: CanvasHostScopeV1;
    inputBindingRequiredMessage: string;
    operation: SwitchableOperationMode;
    operationBlockId: string;
  }): Promise<{
    connectionId: string;
    executionId: string;
    inputBlockIds: string[];
    prompt: string;
    resultBlockIds: string[];
    route: WhiteboardImageExecutionRouteV1;
    scope: CanvasHostScopeV1;
  }>;
}

export function createWhiteboardImageExecutionCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardImageExecutionCommandsV1 {
  return Object.freeze({
    async queue(input: Parameters<WhiteboardImageExecutionCommandsV1['queue']>[0]) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        const operationBlock = requireEditableOperation(snapshot, input.operationBlockId);
        const connectionId = typeof operationBlock.data.connectionId === 'string'
          ? operationBlock.data.connectionId
          : 'codex-managed';
        const connection = executionConnection(connectionId, snapshot.project.projectId);
        const capabilityId = executionCapabilityId(operationBlock);
        if (
          !connection
          || connection.status !== 'ready'
          || !connection.enabledUseCases.includes('image')
          || !connection.supportedCapabilityIds.includes(capabilityId)
        ) {
          throw new Error(input.connectionUnavailableMessage);
        }
        const route = routeForConnector(connection.connectorId);
        if (!route) throw new Error(input.connectionAdapterUnavailableMessage);
        if (
          capabilityId !== storyboardSheetCapabilityId
          && hasUnboundImageInput(snapshot, operationBlock.blockId)
        ) {
          throw new Error(input.inputBindingRequiredMessage);
        }
        const result = capabilityId === storyboardSheetCapabilityId
          ? executeExistingStoryboardSheetOperation(snapshot, {
              connection,
              operationBlockId: operationBlock.blockId,
            })
          : executeExistingImageOperationBlock(snapshot, {
              capabilityId,
              connection,
              generationParams: generationParamsFromBlock(operationBlock),
              instruction: '',
              operation: input.operation,
              operationBlockId: operationBlock.blockId,
            });
        return {
          connectionId,
          executionId: result.execution.executionId,
          inputBlockIds: [...result.execution.inputBlockIds],
          prompt: result.execution.prompt ?? '',
          resultBlockIds: result.resultBlocks.map((block) => block.blockId),
          route,
          scope: scopeFor(snapshot),
        };
      });
      return transaction.result;
    },
  });
}

function assertScope(snapshot: BoardSnapshot, scope: CanvasHostScopeV1): void {
  if (
    snapshot.project.projectId !== scope.projectId
    || snapshot.board.boardId !== scope.boardId
  ) {
    throw new Error('Image execution belongs to another Project or Board.');
  }
}

function requireEditableOperation(snapshot: BoardSnapshot, blockId: string): BlockRecord {
  const operation = snapshot.blocks.find(
    (block) => block.blockId === blockId && block.type === 'operation',
  );
  if (!operation) throw new Error(`Image Operation not found: ${blockId}`);
  if (blockLockedByGroup(snapshot, blockId)) {
    throw new Error(`Image Operation is locked by its Group: ${blockId}`);
  }
  return operation;
}

function executionCapabilityId(operation: BlockRecord): string {
  const storedCapabilityId = typeof operation.data.capabilityId === 'string'
    ? operation.data.capabilityId
    : undefined;
  if (storedCapabilityId === storyboardSheetCapabilityId) return storyboardSheetCapabilityId;
  if (storedCapabilityId === 'image.annotation_edit') return 'image.annotation_edit';
  const definition = storedCapabilityId
    ? tryCapabilityDefinitionFor(storedCapabilityId)
    : undefined;
  if (
    storedCapabilityId
    && definition
    && projectAgentCallableCapability(definition)?.authoringKind === 'source_image_edit'
  ) {
    return storedCapabilityId;
  }
  return 'image.generate';
}

function hasUnboundImageInput(snapshot: BoardSnapshot, operationBlockId: string): boolean {
  return snapshot.edges.some((edge) => {
    if (
      edge.targetBlockId !== operationBlockId
      || edge.kind !== 'execution_input'
      || edge.inputSlotId
    ) return false;
    const source = snapshot.blocks.find((block) => block.blockId === edge.sourceBlockId);
    return source?.type === 'image' && typeof source.data.assetId === 'string';
  });
}

function routeForConnector(connectorId: string): WhiteboardImageExecutionRouteV1 | undefined {
  if (connectorId === 'codex-app-server') return 'codex_app_server';
  if (connectorId === 'volcengine-ark') return 'volcengine_ark';
  if (connectorId === 'codex-managed') return 'mcp_agent';
  return undefined;
}

function generationParamsFromBlock(block: BlockRecord): ImageGenerationParams | undefined {
  const value = block.data.generationParams;
  if (!isRecord(value)) return undefined;
  return {
    aspectRatioPreset: stringValue(value.aspectRatioPreset),
    durationSeconds: finiteNumber(value.durationSeconds),
    model: stringValue(value.model) === 'codex-mcp' ? undefined : stringValue(value.model),
    motion: stringValue(value.motion),
    strength: finiteNumber(value.strength),
    targetAspectRatio: finiteNumber(value.targetAspectRatio),
    targetHeight: finiteNumber(value.targetHeight),
    targetResolution: stringValue(value.targetResolution),
    targetWidth: finiteNumber(value.targetWidth),
    variationCount: finiteNumber(value.variationCount),
  };
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function scopeFor(snapshot: BoardSnapshot): CanvasHostScopeV1 {
  return { boardId: snapshot.board.boardId, projectId: snapshot.project.projectId };
}
