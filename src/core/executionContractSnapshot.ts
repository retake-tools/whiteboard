import type {
  CapabilityBindingValue,
  CapabilityDefinition,
  CapabilityInputBinding,
} from './capabilityContracts';
import { definitionForLegacyCapability } from './legacyCapabilityAdapter';
import { capabilityDefinitionFor } from './capabilityRegistry';
import type { BlockRecord, BoardSnapshot, ExecutionInputRole, ExecutionRecord } from './types';

export function recordLegacyExecutionContractSnapshot(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  operationBlock: BlockRecord,
): void {
  const definition = definitionForLegacyCapability(execution.capabilityId);
  execution.capabilityLock = {
    capabilityId: definition.capabilityId,
    version: definition.version,
    definitionHash: definition.definitionHash,
  };
  execution.inputBindingsSnapshot = legacyInputBindings(snapshot, execution, operationBlock, definition);
  execution.adapterSnapshot = legacyAdapterSnapshot(execution, definition);
  execution.skillSnapshot = execution.skillId
    ? {
        skillId: execution.skillId,
        version: '0.1.0',
        definitionHash: `legacy:skill:${execution.skillId}:v1`,
      }
    : undefined;
  execution.outputSlotResults = definition.outputSlots.map((slot) => ({
    slotId: slot.slotId,
    assetIds: outputAssetIdsForSlot(execution, slot.dataType),
  }));
  execution.resultSummary = executionResultSummary(execution);
}

export function syncExecutionOutputContractSnapshot(execution: ExecutionRecord): void {
  const definition = safeLegacyDefinition(execution.capabilityId);
  if (!definition) return;
  execution.outputSlotResults = definition.outputSlots.map((slot) => ({
    slotId: slot.slotId,
    assetIds: outputAssetIdsForSlot(execution, slot.dataType),
  }));
  execution.resultSummary = executionResultSummary(execution);
}

function legacyInputBindings(
  snapshot: BoardSnapshot,
  execution: ExecutionRecord,
  operationBlock: BlockRecord,
  definition: CapabilityDefinition,
): CapabilityInputBinding[] {
  const inputBlocks = execution.inputBlockIds
    .map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId))
    .filter((block): block is BlockRecord => Boolean(block));
  const roleByBlockId = new Map(
    snapshot.edges
      .filter((edge) => edge.targetBlockId === operationBlock.blockId && edge.kind === 'execution_input')
      .map((edge) => [edge.sourceBlockId, edge.inputRole]),
  );

  return definition.inputSlots.flatMap((slot): CapabilityInputBinding[] => {
    const values = valuesForSlot(slot.slotId, slot.semanticRole, inputBlocks, roleByBlockId, operationBlock);
    return values.length > 0 ? [{ slotId: slot.slotId, values }] : [];
  });
}

function valuesForSlot(
  slotId: string,
  semanticRole: string,
  inputBlocks: BlockRecord[],
  roleByBlockId: Map<string, ExecutionInputRole | undefined>,
  operationBlock: BlockRecord,
): CapabilityBindingValue[] {
  if (semanticRole === 'prompt') {
    const promptBlock = inputBlocks.find((block) => block.type === 'text');
    if (promptBlock) return [{ kind: 'block', blockId: promptBlock.blockId }];
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
    const role = roleByBlockId.get(block.blockId);
    if (slotId === 'references' || semanticRole === 'reference') return role !== 'source';
    if (slotId === 'source_image' || semanticRole === 'source') return role === 'source';
    return role === semanticRole;
  });
  return matchingBlocks.map(bindingValueForBlock);
}

function bindingValueForBlock(block: BlockRecord): CapabilityBindingValue {
  return typeof block.data.assetId === 'string'
    ? { kind: 'asset', assetId: block.data.assetId, blockId: block.blockId }
    : { kind: 'block', blockId: block.blockId };
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

function legacyAdapterSnapshot(
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
