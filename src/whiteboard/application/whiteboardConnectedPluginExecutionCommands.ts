import type { PluginConnectedExecutionRunInputV2 } from '@retake-tools/package-sdk';
import { capabilityDefinitionFor } from '../../core/capabilityRegistry';
import {
  currentExecutionProviderSettings,
  resolveExecutionConnectionPreference,
} from '../../core/executionProviderPreferences';
import { addImageCodexOperation } from '../../core/imageOperations';
import {
  outpaintCapabilityId,
  readOutpaintParameters,
  type OutpaintParameters,
} from '../../core/outpaintContracts';
import { annotationManifestFromUnknown } from '../../core/restoreAnnotationDraft';
import type { AssetRecord, BlockRecord, BoardSnapshot } from '../../core/types';
import type { CanvasHostScopeV1 } from '../../host-kit';
import type { WhiteboardCanvasHostBridge } from '../../host-kit/internal/whiteboardCompatibility';

export interface WhiteboardConnectedPluginExecutionCommandsV1 {
  queue(input: {
    expectedScope: CanvasHostScopeV1;
    importedAssets?: readonly AssetRecord[];
    request: PluginConnectedExecutionRunInputV2;
  }): Promise<{
    capabilityId: string;
    connectionId: string;
    executionId: string;
    operationBlockId: string;
    outputBlockIds: string[];
    route: 'codex_app_server' | 'mcp_agent';
    scope: CanvasHostScopeV1;
  }>;
}

export function createWhiteboardConnectedPluginExecutionCommands(
  transactions: WhiteboardCanvasHostBridge,
): WhiteboardConnectedPluginExecutionCommandsV1 {
  return Object.freeze({
    async queue(
      input: Parameters<WhiteboardConnectedPluginExecutionCommandsV1['queue']>[0],
    ) {
      const transaction = await transactions.executeProductTransaction((snapshot) => {
        assertScope(snapshot, input.expectedScope);
        const prepared = prepareConnectedExecution(
          snapshot,
          input.request,
          input.importedAssets ?? [],
        );
        const result = addImageCodexOperation(snapshot, {
          additionalInputBlocks: prepared.additionalInputs.flatMap(
            ({ block, slotId }) => block ? [{
              blockId: block.blockId,
              inputSlotId: slotId,
            }] : [],
          ),
          additionalInputAssets: prepared.additionalInputs.flatMap(
            ({ asset, block, slotId }) => !block ? [{
              asset,
              inputSlotId: slotId,
            }] : [],
          ),
          capabilityId: input.request.capabilityId,
          connection: prepared.connection,
          generationParams: sourceGenerationParams(
            snapshot,
            prepared.source.block,
            input.request.outputCount ?? 1,
            prepared.outpaintParameters,
          ),
          instruction: input.request.prompt.trim(),
          ...(prepared.annotationManifest
            ? { annotationManifest: prepared.annotationManifest }
            : {}),
          ...(prepared.annotatedComposite
            ? { annotatedCompositeAsset: prepared.annotatedComposite.asset }
            : {}),
          operation: prepared.isAnnotationEdit ? 'annotation_edit' : 'quick_edit',
          params: structuredClone(input.request.parameters),
          sourceBlockId: prepared.source.block.blockId,
          taskTitle: prepared.displayName,
          waitingBody: 'Waiting for the connected image editor.',
        });
        return {
          capabilityId: input.request.capabilityId,
          connectionId: prepared.connection.connectionId,
          executionId: result.execution.executionId,
          operationBlockId: result.operationBlock.blockId,
          outputBlockIds: [...result.execution.outputBlockIds],
          route: prepared.connection.connectorId === 'codex-app-server'
            ? 'codex_app_server' as const
            : 'mcp_agent' as const,
          scope: scopeFor(snapshot),
        };
      });
      return transaction.result;
    },
  });
}

function prepareConnectedExecution(
  snapshot: BoardSnapshot,
  input: PluginConnectedExecutionRunInputV2,
  importedAssets: readonly AssetRecord[],
) {
  const definition = capabilityDefinitionFor(input.capabilityId);
  if (
    !definition.supportedAdapterClasses.includes('agent_runtime.media')
    || definition.outputSlots.length !== 1
    || definition.outputSlots[0]?.dataType !== 'image'
  ) {
    throw new Error(
      `Plugin Capability is not supported by connected image execution: ${input.capabilityId}`,
    );
  }
  const bindings = input.inputs.map((binding) => {
    const slot = definition.inputSlots.find(
      (candidate) => candidate.slotId === binding.slotId,
    );
    const block = binding.blockId
      ? snapshot.blocks.find((candidate) => candidate.blockId === binding.blockId)
      : undefined;
    const asset = binding.assetId
      ? snapshot.assets.find((candidate) => candidate.assetId === binding.assetId)
        ?? importedAssets.find((candidate) => candidate.assetId === binding.assetId)
      : snapshot.assets.find((candidate) => candidate.assetId === block?.data.assetId);
    if (
      !slot
      || slot.cardinality !== 'one'
      || !slot.dataTypes.includes('image')
      || !asset
      || asset.kind !== 'image'
      || asset.projectId !== snapshot.project.projectId
      || (
        block !== undefined
        && (
          block.type !== 'image'
          || typeof block.data.assetId !== 'string'
          || block.data.assetId !== asset.assetId
        )
      )
    ) {
      throw new Error(
        `Connected Plugin input does not match an Image slot: ${binding.slotId}`,
      );
    }
    return {
      asset,
      block,
      semanticRole: slot.semanticRole,
      slotId: slot.slotId,
    };
  });
  for (const slot of definition.inputSlots) {
    if (
      slot.required
      && slot.dataTypes.includes('image')
      && !bindings.some((binding) => binding.slotId === slot.slotId)
    ) {
      throw new Error(
        `Connected Plugin execution is missing required input slot: ${slot.slotId}`,
      );
    }
  }
  const source = bindings.find((binding) => binding.semanticRole === 'source');
  if (!source?.block) {
    throw new Error('Connected Plugin image execution requires a source Image Block.');
  }
  const isAnnotationEdit = input.capabilityId === 'image.annotation_edit';
  const annotatedComposite = bindings.find(
    (binding) => binding.semanticRole === 'annotated_composite',
  );
  const annotationManifest = isAnnotationEdit
    ? annotationManifestFromUnknown(input.parameters.manifest)
    : undefined;
  if (isAnnotationEdit && (!annotatedComposite || !annotationManifest)) {
    throw new Error(
      'Annotation Plugin execution requires a valid manifest and annotated composite.',
    );
  }
  const additionalInputs = bindings.filter(
    (binding) => binding !== source && binding !== annotatedComposite,
  );
  if (additionalInputs.some((binding) => binding.semanticRole === 'source')) {
    throw new Error('Connected Plugin image execution accepts only one source image.');
  }
  const outpaintParameters = input.capabilityId === outpaintCapabilityId
    ? readOutpaintParameters(input.parameters)
    : undefined;
  assertConnectedImageGeometry(source.asset, additionalInputs, outpaintParameters);

  const settings = currentExecutionProviderSettings();
  const preference = resolveExecutionConnectionPreference({
    capabilityId: input.capabilityId,
    explicitConnectionId: input.connectionId,
    initialConnectionId: 'codex-app-server',
    projectId: snapshot.project.projectId,
    settings,
    useCase: 'image',
  });
  const connection = preference.isUsable
    ? preference.connection
    : !input.connectionId
      ? settings?.connections.find((candidate) => (
          candidate.enabled
          && candidate.status === 'ready'
          && candidate.enabledUseCases.includes('image')
          && candidate.supportedCapabilityIds.includes(input.capabilityId)
        ))
      : undefined;
  if (!connection) {
    throw new Error(
      `The selected Retake image Connection is not ready for ${input.capabilityId}: ${preference.connectionId ?? 'none'}`,
    );
  }
  if (
    connection.connectorId !== 'codex-app-server'
    && connection.connectorId !== 'codex-managed'
  ) {
    throw new Error(
      `The selected Connection has no masked image Adapter: ${connection.connectionId}`,
    );
  }
  return {
    additionalInputs,
    annotatedComposite,
    annotationManifest,
    connection,
    displayName: definition.displayName,
    isAnnotationEdit,
    outpaintParameters,
    source: { asset: source.asset, block: source.block },
  };
}

function assertConnectedImageGeometry(
  sourceAsset: AssetRecord,
  additionalInputs: Array<{
    asset: AssetRecord;
    semanticRole: string;
    slotId: string;
  }>,
  outpaintParameters: OutpaintParameters | undefined,
): void {
  if (outpaintParameters) {
    const guide = additionalInputs.find(
      (binding) => binding.semanticRole === 'control_image',
    )?.asset;
    const mask = additionalInputs.find(
      (binding) => binding.semanticRole === 'inpaint_mask',
    )?.asset;
    if (!guide || !mask || guide.mimeType !== 'image/png' || mask.mimeType !== 'image/png') {
      throw new Error(
        'Outpaint execution requires PNG control_image and inpaint_mask Assets.',
      );
    }
    assertKnownDimensions(
      sourceAsset,
      outpaintParameters.sourceWidth,
      outpaintParameters.sourceHeight,
      'Outpaint source',
    );
    assertKnownDimensions(
      guide,
      outpaintParameters.guideWidth,
      outpaintParameters.guideHeight,
      'Outpaint guide',
    );
    assertKnownDimensions(
      mask,
      outpaintParameters.guideWidth,
      outpaintParameters.guideHeight,
      'Outpaint mask',
    );
    return;
  }
  const mask = additionalInputs.find(
    (binding) => binding.semanticRole === 'inpaint_mask',
  )?.asset;
  if (!mask) return;
  if (mask.mimeType !== 'image/png') {
    throw new Error('Masked image execution requires source and PNG Mask Assets.');
  }
  if (
    sourceAsset.width !== undefined
    && sourceAsset.height !== undefined
    && mask.width !== undefined
    && mask.height !== undefined
    && (sourceAsset.width !== mask.width || sourceAsset.height !== mask.height)
  ) {
    throw new Error('Selection Mask dimensions must match the source image.');
  }
}

function sourceGenerationParams(
  snapshot: BoardSnapshot,
  sourceBlock: BlockRecord,
  variationCount: 1 | 2 | 3 | 4,
  outpaintParameters?: OutpaintParameters,
): {
  targetHeight?: number;
  targetWidth?: number;
  variationCount: number;
} {
  const asset = snapshot.assets.find(
    (candidate) => candidate.assetId === sourceBlock.data.assetId,
  );
  return {
    ...(outpaintParameters
      ? {
          targetHeight: outpaintParameters.targetHeight,
          targetWidth: outpaintParameters.targetWidth,
        }
      : {
          ...(asset?.height ? { targetHeight: asset.height } : {}),
          ...(asset?.width ? { targetWidth: asset.width } : {}),
        }),
    variationCount,
  };
}

function assertKnownDimensions(
  asset: AssetRecord,
  width: number,
  height: number,
  label: string,
): void {
  if (
    (asset.width !== undefined && asset.width !== width)
    || (asset.height !== undefined && asset.height !== height)
  ) {
    throw new Error(`${label} dimensions must be ${width}x${height}.`);
  }
}

function assertScope(snapshot: BoardSnapshot, scope: CanvasHostScopeV1): void {
  if (
    snapshot.project.projectId !== scope.projectId
    || snapshot.board.boardId !== scope.boardId
  ) {
    throw new Error('Connected Plugin execution belongs to another Project or Board.');
  }
}

function scopeFor(snapshot: BoardSnapshot): CanvasHostScopeV1 {
  return { boardId: snapshot.board.boardId, projectId: snapshot.project.projectId };
}
