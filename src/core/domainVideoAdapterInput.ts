import type { ExecutionRecord } from './types';

export interface VideoAdapterAssetInputs {
  firstFrame: string[];
  lastFrame: string[];
  references: string[];
}

export function videoAdapterAssetInputs(
  execution: ExecutionRecord,
): VideoAdapterAssetInputs {
  const domainRequest = execution.domainVideoRequestSnapshot;
  if (domainRequest) {
    return {
      firstFrame: domainRequest.referenceBindings
        .filter((binding) => binding.role === 'first_frame')
        .map((binding) => binding.assetId),
      lastFrame: domainRequest.referenceBindings
        .filter((binding) => binding.role === 'last_frame')
        .map((binding) => binding.assetId),
      references: domainRequest.referenceBindings
        .filter((binding) =>
          binding.role !== 'first_frame'
          && binding.role !== 'last_frame',
        )
        .map((binding) => binding.assetId),
    };
  }
  const bindings = execution.inputBindingsSnapshot ?? [];
  return {
    firstFrame: assetIdsForSlot(bindings, 'first_frame'),
    lastFrame: assetIdsForSlot(bindings, 'last_frame'),
    references: [
      ...assetIdsForSlot(bindings, 'character_references'),
      ...assetIdsForSlot(bindings, 'scene_references'),
      ...assetIdsForSlot(bindings, 'general_references'),
    ],
  };
}

function assetIdsForSlot(
  bindings: NonNullable<ExecutionRecord['inputBindingsSnapshot']>,
  slotId: string,
): string[] {
  return bindings
    .find((binding) => binding.slotId === slotId)
    ?.values.flatMap((value) => value.kind === 'asset' ? [value.assetId] : []) ?? [];
}
