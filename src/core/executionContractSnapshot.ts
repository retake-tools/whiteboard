import type {
  CapabilityBindingValue,
  CapabilityDefinition,
  CapabilityInputBinding,
} from './capabilityContracts';
import { capabilityBindingValueForBlock } from './artifactLibrary';
import { capabilityDefinitionFor } from './capabilityRegistry';
import type { BlockRecord, BoardSnapshot, ExecutionRecord } from './types';
import { normalizeReferenceIntent, type ReferenceIntentV1 } from './referenceIntent';
import { resolveWorkflowInputBlock } from './workflowInputResolution';

export function recordExecutionContractSnapshot(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  operationBlock: BlockRecord,
): void {
  const definition = capabilityDefinitionFor(execution.capabilityId);
  execution.capabilityLock = {
    capabilityId: definition.capabilityId,
    version: definition.version,
    definitionHash: definition.definitionHash,
  };
  execution.inputBindingsSnapshot = executionInputBindings(snapshot, execution, operationBlock, definition);
  execution.adapterSnapshot = executionAdapterSnapshot(execution, definition);
  execution.skillSnapshot = execution.skillSnapshot ?? (execution.skillId
    ? {
        skillId: execution.skillId,
        version: '0.1.0',
        definitionHash: `legacy:skill:${execution.skillId}:v1`,
      }
    : undefined);
  execution.outputSlotResults = definition.outputSlots.map((slot) => ({
    slotId: slot.slotId,
    assetIds: outputAssetIdsForSlot(execution, slot.dataType),
  }));
  execution.resultSummary = executionResultSummary(execution);
}

export function syncExecutionOutputContractSnapshot(execution: ExecutionRecord): void {
  const definition = safeLegacyDefinition(execution.capabilityId);
  if (definition) {
    execution.outputSlotResults = definition.outputSlots.map((slot) => ({
      slotId: slot.slotId,
      assetIds: outputAssetIdsForSlot(execution, slot.dataType),
    }));
  }
  execution.resultSummary = executionResultSummary(execution);
}

function executionInputBindings(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  operationBlock: BlockRecord,
  definition: CapabilityDefinition,
): CapabilityInputBinding[] {
  const inputBlocks = execution.inputBlockIds
    .map((blockId) => {
      const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
      const inputSlotId = snapshot.edges.find((edge) => (
        edge.kind === 'execution_input'
        && edge.sourceBlockId === blockId
        && edge.targetBlockId === operationBlock.blockId
      ))?.inputSlotId;
      return block
        ? resolveWorkflowInputBlock(snapshot, operationBlock.blockId, inputSlotId, block)
        : undefined;
    })
    .filter((block): block is BlockRecord => Boolean(block));
  const edgeByBlockId = new Map(
    snapshot.edges
      .filter((edge) => edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input')
      .map((edge) => [edge.sourceBlockId, edge]),
  );
  const parameterBindings = executionParameterImageBindings(execution);

  return definition.inputSlots.flatMap((slot): CapabilityInputBinding[] => {
    const values = valuesForSlot(
      slot.slotId,
      slot.semanticRole,
      inputBlocks,
      edgeByBlockId,
      operationBlock,
      parameterBindings,
    );
    return values.length > 0 ? [{ slotId: slot.slotId, values }] : [];
  });
}

function valuesForSlot(
  slotId: string,
  semanticRole: string,
  inputBlocks: BlockRecord[],
  edgeByBlockId: Map<string, BoardSnapshot['edges'][number]>,
  operationBlock: BlockRecord,
  parameterBindings: Array<{
    assetId: string;
    blockId?: string;
    inputSlotId: string;
    referenceIntent?: ReferenceIntentV1;
  }>,
): CapabilityBindingValue[] {
  if (semanticRole === 'prompt') {
    const promptBlock = inputBlocks.find(
      (block) => block.type === 'text' || block.type === 'document',
    );
    if (promptBlock) return [bindingValueForBlock(promptBlock)];
    const inlinePrompt = typeof operationBlock.data.body === 'string' ? operationBlock.data.body.trim() : '';
    return inlinePrompt ? [{ kind: 'inline', value: inlinePrompt }] : [];
  }

  if (semanticRole === 'annotated_composite') {
    const assetId = typeof operationBlock.data.annotatedCompositeAssetId === 'string'
      ? operationBlock.data.annotatedCompositeAssetId
      : undefined;
    return assetId ? [{ kind: 'asset', assetId }] : [];
  }

  const matchingBlocks = inputBlocks.filter((block) => {
    if (block.type !== 'image' && block.type !== 'video') return false;
    if (typeof block.data.assetId !== 'string') return false;
    return edgeByBlockId.get(block.blockId)?.inputSlotId === slotId;
  });
  const blockValues = matchingBlocks.map((block): CapabilityBindingValue => {
    const value = bindingValueForBlock(block);
    const referenceIntent = edgeByBlockId.get(block.blockId)?.referenceIntent;
    return referenceIntent && value.kind !== 'inline'
      ? { ...value, referenceIntent: structuredClone(referenceIntent) }
      : value;
  });
  const blockAssetIds = new Set(
    matchingBlocks.flatMap((block) =>
      typeof block.data.assetId === 'string' ? [block.data.assetId] : [],
    ),
  );
  const parameterValues = parameterBindings
    .filter((binding) => {
      if (blockAssetIds.has(binding.assetId)) return false;
      return binding.inputSlotId === slotId;
    })
    .map((binding): CapabilityBindingValue => ({
      kind: 'asset',
      assetId: binding.assetId,
      ...(binding.blockId ? { blockId: binding.blockId } : {}),
      ...(binding.referenceIntent
        ? { referenceIntent: structuredClone(binding.referenceIntent) }
        : {}),
    }));
  return [...blockValues, ...parameterValues];
}

function executionParameterImageBindings(
  execution: ExecutionRecord,
): Array<{
  assetId: string;
  blockId?: string;
  inputSlotId: string;
  referenceIntent?: ReferenceIntentV1;
}> {
  const bindings = Array.isArray(execution.params?.inputBindings) ? execution.params.inputBindings : [];
  return bindings.flatMap((binding) => {
    if (!binding || typeof binding !== 'object') return [];
    const record = binding as Record<string, unknown>;
    if (
      typeof record.assetId !== 'string'
      || typeof record.inputSlotId !== 'string'
      || !record.inputSlotId.trim()
    ) return [];
    const referenceIntent = normalizeReferenceIntent(record.referenceIntent);
    return [{
      assetId: record.assetId,
      blockId: typeof record.blockId === 'string' ? record.blockId : undefined,
      inputSlotId: record.inputSlotId,
      ...(referenceIntent ? { referenceIntent } : {}),
    }];
  });
}

function bindingValueForBlock(block: BlockRecord): CapabilityBindingValue {
  return capabilityBindingValueForBlock(block);
}

function outputAssetIdsForSlot(
  execution: ExecutionRecord,
  dataType: CapabilityDefinition['outputSlots'][number]['dataType'],
): string[] {
  if (dataType !== 'image' && dataType !== 'video' && dataType !== 'text' && dataType !== 'document') return [];
  return [...execution.outputAssetIds];
}

function executionResultSummary(execution: ExecutionRecord): ExecutionRecord['resultSummary'] {
  const requested = execution.outputBlockIds.length;
  const succeeded = execution.outputAssetIds.length;
  return {
    requested,
    succeeded,
    failed: execution.status === 'failed' ? Math.max(0, requested - succeeded) : 0,
  };
}

function executionAdapterSnapshot(
  execution: ExecutionRecord,
  definition: CapabilityDefinition,
): NonNullable<ExecutionRecord['adapterSnapshot']> {
  const adapterId = execution.generationProfile?.generationProfileId ?? `legacy.${execution.adapter}`;
  return {
    adapterId,
    version: '0.1.0',
    definitionHash: `legacy:adapter:${adapterId}:v1`,
    adapterClass: definition.supportedAdapterClasses[0] ?? 'legacy.unknown',
    routeKind: legacyAdapterRouteKind(execution.adapter),
    provider: execution.provider ?? execution.generationProfile?.provider,
    model: execution.model ?? execution.generationProfile?.model,
  };
}

function legacyAdapterRouteKind(adapter: ExecutionRecord['adapter']): NonNullable<ExecutionRecord['adapterSnapshot']>['routeKind'] {
  if (adapter === 'direct_api') return 'direct_api';
  if (adapter === 'provider_cli') return 'provider_cli';
  if (adapter === 'codex_app_server') return 'codex_app_server';
  if (adapter === 'cli_agent') return 'cli_agent';
  if (adapter === 'mcp_agent') return 'mcp_manual';
  if (adapter === 'manual_import') return 'manual';
  return 'local';
}

function safeLegacyDefinition(capabilityId: string): CapabilityDefinition | undefined {
  try {
    return capabilityDefinitionFor(capabilityId);
  } catch {
    return undefined;
  }
}
