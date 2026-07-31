import type {
  PluginConnectedExecutionRunInputV2,
  PluginConnectedExecutionViewV2,
  PluginExecutionConnectionViewV2,
} from '@retake-tools/package-sdk';
import { loadBoardSnapshot } from '../core/boardStore';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';
import {
  currentExecutionProviderSettings,
  resolveExecutionConnectionPreference,
} from '../core/executionProviderPreferences';
import { addImageCodexOperation } from '../core/imageOperations';
import { startCodexAppServerImage } from '../core/codexAppServerImageClient';
import {
  annotationManifestFromUnknown,
} from '../core/restoreAnnotationDraft';
import {
  outpaintCapabilityId,
  readOutpaintParameters,
  type OutpaintParameters,
} from '../core/outpaintContracts';
import type {
  BlockRecord,
  BoardSnapshot,
} from '../core/types';

interface ConnectedPluginExecutionOptions {
  persistSnapshot: (
    snapshot: BoardSnapshot,
    options?: { requireLocalApi?: boolean },
  ) => Promise<void>;
  setSelectedBlock: (
    snapshot: BoardSnapshot,
    blockId: string,
  ) => void;
  snapshotRef: { current: BoardSnapshot };
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: {
      history?: boolean;
      persist?: boolean;
      syncFlow?: boolean;
    },
  ) => BoardSnapshot;
}

export async function runConnectedPluginExecution(
  input: PluginConnectedExecutionRunInputV2,
  signal: AbortSignal,
  options: ConnectedPluginExecutionOptions,
  importedAssets: readonly import('../core/types').AssetRecord[] = [],
): Promise<PluginConnectedExecutionViewV2> {
  throwIfAborted(signal);
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

  const initial = options.snapshotRef.current;
  const bindings = input.inputs.map((binding) => {
    const slot = definition.inputSlots.find(
      (candidate) => candidate.slotId === binding.slotId,
    );
    const block = binding.blockId
      ? initial.blocks.find(
          (candidate) => candidate.blockId === binding.blockId,
        )
      : undefined;
    const asset = binding.assetId
      ? (
          initial.assets.find(
            (candidate) => candidate.assetId === binding.assetId,
          )
          ?? importedAssets.find(
            (candidate) => candidate.assetId === binding.assetId,
          )
        )
      : initial.assets.find(
          (candidate) => candidate.assetId === block?.data.assetId,
        );
    if (
      !slot
      || slot.cardinality !== 'one'
      || !slot.dataTypes.includes('image')
      || !asset
      || asset.kind !== 'image'
      || (
        block !== undefined
        && (
          block.type !== 'image'
          || typeof block.data.assetId !== 'string'
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

  const source = bindings.find(
    (binding) => binding.semanticRole === 'source',
  );
  if (!source?.block) {
    throw new Error(
      'Connected Plugin image execution requires a source Image Block.',
    );
  }
  const sourceBlock = source.block;
  const isAnnotationEdit = input.capabilityId === 'image.annotation_edit';
  const annotatedComposite = bindings.find(
    (binding) => binding.semanticRole === 'annotated_composite',
  );
  const annotationManifest = isAnnotationEdit
    ? annotationManifestFromUnknown(input.parameters.manifest)
    : undefined;
  if (
    isAnnotationEdit
    && (!annotatedComposite || !annotationManifest)
  ) {
    throw new Error(
      'Annotation Plugin execution requires a valid manifest and annotated composite.',
    );
  }
  const additionalInputs = bindings.filter(
    (binding) => (
      binding !== source
      && binding !== annotatedComposite
    ),
  );
  if (additionalInputs.some((binding) => binding.semanticRole === 'source')) {
    throw new Error(
      'Connected Plugin image execution accepts only one source image.',
    );
  }
  const outpaintParameters = input.capabilityId === outpaintCapabilityId
    ? readOutpaintParameters(input.parameters)
    : undefined;
  assertConnectedImageGeometry(
    source.asset,
    additionalInputs,
    outpaintParameters,
  );

  const preference = resolveExecutionConnectionPreference({
    capabilityId: input.capabilityId,
    explicitConnectionId: input.connectionId,
    initialConnectionId: 'codex-managed',
    projectId: initial.project.projectId,
    settings: currentExecutionProviderSettings(),
    useCase: 'image',
  });
  const connection = preference.connection;
  if (!connection || !preference.isUsable) {
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

  let executionId = '';
  let outputBlockIds: string[] = [];
  let operationBlockId = '';
  const queued = options.updateSnapshot((current) => {
    const result = addImageCodexOperation(current, {
      additionalInputBlocks: additionalInputs.map(
        ({ block, slotId }) => block ? ({
          blockId: block.blockId,
          inputSlotId: slotId,
        }) : undefined,
      ).filter((binding): binding is NonNullable<typeof binding> => (
        binding !== undefined
      )),
      additionalInputAssets: additionalInputs.map(
        ({ asset, block, slotId }) => !block ? ({
          asset,
          inputSlotId: slotId,
        }) : undefined,
      ).filter((binding): binding is NonNullable<typeof binding> => (
        binding !== undefined
      )),
      capabilityId: input.capabilityId,
      connection,
      generationParams: sourceGenerationParams(
        current,
        sourceBlock,
        input.outputCount ?? 1,
        outpaintParameters,
      ),
      instruction: input.prompt.trim(),
      ...(annotationManifest ? { annotationManifest } : {}),
      ...(annotatedComposite
        ? { annotatedCompositeAsset: annotatedComposite.asset }
        : {}),
      operation: isAnnotationEdit ? 'annotation_edit' : 'quick_edit',
      params: structuredClone(input.parameters),
      sourceBlockId: sourceBlock.blockId,
      taskTitle: definition.displayName,
      waitingBody: 'Waiting for the connected image editor.',
    });
    executionId = result.execution.executionId;
    operationBlockId = result.operationBlock.blockId;
    outputBlockIds = result.execution.outputBlockIds;
    return current;
  }, { history: true });
  options.setSelectedBlock(queued, operationBlockId);
  await options.persistSnapshot(queued, { requireLocalApi: true });
  throwIfAborted(signal);

  if (connection.connectorId === 'codex-managed') {
    return {
      capabilityId: input.capabilityId,
      connectionId: connection.connectionId,
      executionId,
      outputBlockIds,
      status: 'queued',
    };
  }

  const started = await startCodexAppServerImage({
    projectId: queued.project.projectId,
    boardId: queued.board.boardId,
    executionId,
    connectionId: connection.connectionId,
  });
  const running = options.updateSnapshot(
    () => started.snapshot,
    { history: true, persist: false },
  );
  options.setSelectedBlock(
    running,
    started.execution.outputBlockIds[0] ?? operationBlockId,
  );
  void pollConnectedExecution(
    executionId,
    running,
    options,
  ).catch(() => undefined);
  return {
    capabilityId: input.capabilityId,
    connectionId: connection.connectionId,
    executionId,
    outputBlockIds: [...started.execution.outputBlockIds],
    status: 'running',
  };
}

export function listConnectedPluginExecutionConnections(input: {
  capabilityId: string;
  projectId: string;
}): readonly PluginExecutionConnectionViewV2[] {
  const definition = capabilityDefinitionFor(input.capabilityId);
  if (!definition.supportedAdapterClasses.includes('agent_runtime.media')) {
    return [];
  }
  const settings = currentExecutionProviderSettings();
  if (!settings) return [];
  const preferred = resolveExecutionConnectionPreference({
    capabilityId: input.capabilityId,
    initialConnectionId: 'codex-managed',
    projectId: input.projectId,
    settings,
    useCase: 'image',
  }).connectionId;
  return settings.connections
    .filter((connection) => (
      connection.enabled
      && connection.status === 'ready'
      && connection.enabledUseCases.includes('image')
      && connection.supportedCapabilityIds.includes(input.capabilityId)
    ))
    .map((connection) => Object.freeze({
      connectionId: connection.connectionId,
      displayName: connection.displayName,
      ...(connection.modelId ? { modelLabel: connection.modelId } : {}),
      providerLabel: connection.providerLabel,
      selectedByDefault: connection.connectionId === preferred,
    }));
}

function assertConnectedImageGeometry(
  sourceAsset: import('../core/types').AssetRecord,
  additionalInputs: Array<{
    asset: import('../core/types').AssetRecord;
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
    throw new Error(
      'Masked image execution requires source and PNG Mask Assets.',
    );
  }
  if (
    sourceAsset.width !== undefined
    && sourceAsset.height !== undefined
    && mask.width !== undefined
    && mask.height !== undefined
    && (
      sourceAsset.width !== mask.width
      || sourceAsset.height !== mask.height
    )
  ) {
    throw new Error(
      'Selection Mask dimensions must match the source image.',
    );
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
  asset: import('../core/types').AssetRecord,
  width: number,
  height: number,
  label: string,
): void {
  if (
    (asset.width !== undefined && asset.width !== width)
    || (asset.height !== undefined && asset.height !== height)
  ) {
    throw new Error(
      `${label} dimensions must be ${width}x${height}.`,
    );
  }
}

async function pollConnectedExecution(
  executionId: string,
  scope: BoardSnapshot,
  options: ConnectedPluginExecutionOptions,
): Promise<void> {
  while (true) {
    await delay(1_500);
    const latest = await loadBoardSnapshot({
      projectId: scope.project.projectId,
      boardId: scope.board.boardId,
    });
    const execution = latest.executions.find(
      (candidate) => candidate.executionId === executionId,
    );
    if (
      options.snapshotRef.current.project.projectId
        === scope.project.projectId
      && options.snapshotRef.current.board.boardId === scope.board.boardId
    ) {
      options.updateSnapshot(
        () => latest,
        { history: false, persist: false },
      );
    }
    if (!execution) {
      throw new Error(
        `Connected image execution disappeared: ${executionId}`,
      );
    }
    if (
      execution.status !== 'queued'
      && execution.status !== 'running'
    ) return;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new DOMException(
    'Connected Plugin execution was aborted.',
    'AbortError',
  );
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}
