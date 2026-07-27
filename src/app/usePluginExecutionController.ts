import { useCallback, type RefObject } from 'react';
import type {
  PluginAssetV1,
  PluginExecutionViewV1,
} from '@retake-tools/package-sdk';
import { createImageAssetFromDataUrl } from '../core/assetStore';
import {
  capabilityDefinitionFor,
} from '../core/capabilityRegistry';
import {
  addLocalImageOperation,
  completeLocalImageOperation,
  failLocalImageOperation,
} from '../core/imageOperations';
import type {
  PluginExecutionRunnerRequestV1,
  PluginExecutionRunnerV1,
} from '../core/pluginWebModuleLoader';
import type {
  AssetRecord,
  BoardSnapshot,
} from '../core/types';

interface PluginExecutionControllerOptions {
  persistSnapshot: (snapshot: BoardSnapshot) => Promise<void>;
  setSelectedBlock: (
    snapshot: BoardSnapshot,
    blockId: string,
  ) => void;
  snapshotRef: RefObject<BoardSnapshot>;
  updateSnapshot: (
    updater: (current: BoardSnapshot) => BoardSnapshot,
    options?: {
      history?: boolean;
      persist?: boolean;
      syncFlow?: boolean;
    },
  ) => BoardSnapshot;
}

export function usePluginExecutionController({
  persistSnapshot,
  setSelectedBlock,
  snapshotRef,
  updateSnapshot,
}: PluginExecutionControllerOptions): PluginExecutionRunnerV1 {
  return useCallback(
    (request: PluginExecutionRunnerRequestV1) => (
      runPluginExecution(request, {
        persistSnapshot,
        setSelectedBlock,
        snapshotRef,
        updateSnapshot,
      })
    ),
    [
      persistSnapshot,
      setSelectedBlock,
      snapshotRef,
      updateSnapshot,
    ],
  );
}

export async function runPluginExecution(
  {
    input,
    signal,
  }: PluginExecutionRunnerRequestV1,
  {
    persistSnapshot,
    setSelectedBlock,
    snapshotRef,
    updateSnapshot,
  }: PluginExecutionControllerOptions,
): Promise<PluginExecutionViewV1> {
  assertSupportedLocalImageExecution(input.capabilityId);
  if (input.inputBlockIds.length !== 1) {
    throw new Error(
      'Local image adjustment requires exactly one input Image Block.',
    );
  }
  const sourceBlockId = input.inputBlockIds[0]!;
  const parameters = localAdjustParameters(input.parameters);
  const initial = snapshotRef.current;
  const sourceBlock = initial.blocks.find(
    (block) => block.blockId === sourceBlockId,
  );
  const sourceAsset = initial.assets.find(
    (asset) => asset.assetId === sourceBlock?.data.assetId,
  );
  if (
    !sourceBlock
    || sourceBlock.type !== 'image'
    || !sourceAsset
    || sourceAsset.kind !== 'image'
  ) {
    throw new Error(
      'Local image adjustment requires a bound Image Block with an Asset.',
    );
  }

  let executionId = '';
  let operationBlockId = '';
  let resultBlockId = '';
  const runningSnapshot = updateSnapshot((current) => {
    const started = addLocalImageOperation(current, {
      body: 'Adjust',
      capabilityId: 'image.local_adjust',
      params: parameters,
      sourceBlockId,
      title: 'Adjust',
    });
    executionId = started.execution.executionId;
    operationBlockId = started.operationBlock.blockId;
    resultBlockId = started.resultBlock.blockId;
    return current;
  }, { history: true });
  const executionScope = {
    boardId: runningSnapshot.board.boardId,
    projectId: runningSnapshot.project.projectId,
  };
  setSelectedBlock(runningSnapshot, operationBlockId);

  try {
    await persistSnapshot(runningSnapshot);
    throwIfAborted(signal);
    const output = await input.execute({
      assets: [toPluginAsset(sourceAsset)],
      signal,
    });
    throwIfAborted(signal);
    if (output.images.length !== 1) {
      throw new Error(
        'Local image adjustment must return exactly one Image output.',
      );
    }
    const image = output.images[0]!;
    const definition = capabilityDefinitionFor(input.capabilityId);
    const outputSlotId = definition.outputSlots[0]?.slotId;
    if (
      image.slotId !== undefined
      && image.slotId !== outputSlotId
    ) {
      throw new Error(
        `Plugin image output uses an unknown slot: ${image.slotId}`,
      );
    }
    if (!image.dataUrl.startsWith('data:image/')) {
      throw new Error(
        'Plugin image output must use an image data URL.',
      );
    }
    const asset = await createImageAssetFromDataUrl({
      dataUrl: image.dataUrl,
      fileName: image.fileName
        ?? `plugin-result-${executionId}.png`,
      height: image.height,
      projectId: runningSnapshot.project.projectId,
      sourceExecutionId: executionId,
      width: image.width,
    });
    const completedSnapshot = isCurrentExecutionScope(
      snapshotRef.current,
      executionScope,
    )
      ? updateSnapshot((current) => {
          completeLocalImageOperation(current, { asset, executionId });
          return current;
        })
      : completeDetachedExecution(
          runningSnapshot,
          asset,
          executionId,
        );
    await persistSnapshot(completedSnapshot);
    if (isCurrentExecutionScope(snapshotRef.current, executionScope)) {
      setSelectedBlock(completedSnapshot, resultBlockId);
    }
    return {
      capabilityId: input.capabilityId,
      executionId,
      outputAssetIds: [asset.assetId],
      outputBlockIds: [resultBlockId],
      status: 'succeeded',
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Plugin image execution failed.';
    const failedSnapshot = isCurrentExecutionScope(
      snapshotRef.current,
      executionScope,
    )
      ? updateSnapshot((current) => {
          failLocalImageOperation(current, {
            errorMessage: message,
            executionId,
          });
          return current;
        })
      : failDetachedExecution(
          runningSnapshot,
          executionId,
          message,
        );
    await persistSnapshot(failedSnapshot);
    if (isCurrentExecutionScope(snapshotRef.current, executionScope)) {
      setSelectedBlock(failedSnapshot, operationBlockId);
    }
    throw error;
  }
}

function assertSupportedLocalImageExecution(
  capabilityId: string,
): void {
  const definition = capabilityDefinitionFor(capabilityId);
  if (
    capabilityId !== 'image.local_adjust'
    || !definition.supportedAdapterClasses.includes('local_canvas')
    || definition.inputSlots.length !== 1
    || !definition.inputSlots[0]?.dataTypes.includes('image')
    || definition.outputSlots.length !== 1
    || definition.outputSlots[0]?.dataType !== 'image'
  ) {
    throw new Error(
      `Plugin Capability is not supported by the P9.1 execution bridge: ${capabilityId}`,
    );
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new DOMException('Plugin execution was aborted.', 'AbortError');
}

function localAdjustParameters(
  input: Readonly<Record<string, unknown>>,
): Record<string, number> {
  const keys = Object.keys(input).sort();
  if (
    keys.join('\u0000')
      !== ['brightness', 'contrast', 'saturation'].join('\u0000')
  ) {
    throw new Error(
      'Local image adjustment requires brightness, contrast, and saturation parameters.',
    );
  }
  const result: Record<string, number> = {};
  for (const key of keys) {
    const value = input[key];
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || value < -100
      || value > 100
    ) {
      throw new Error(
        `Local image adjustment parameter is outside -100..100: ${key}`,
      );
    }
    result[key] = value;
  }
  return result;
}

function completeDetachedExecution(
  snapshot: BoardSnapshot,
  asset: AssetRecord,
  executionId: string,
): BoardSnapshot {
  completeLocalImageOperation(snapshot, { asset, executionId });
  return snapshot;
}

function failDetachedExecution(
  snapshot: BoardSnapshot,
  executionId: string,
  errorMessage: string,
): BoardSnapshot {
  failLocalImageOperation(snapshot, { errorMessage, executionId });
  return snapshot;
}

function isCurrentExecutionScope(
  snapshot: BoardSnapshot,
  scope: { boardId: string; projectId: string },
): boolean {
  return snapshot.board.boardId === scope.boardId
    && snapshot.project.projectId === scope.projectId;
}

function toPluginAsset(asset: AssetRecord): PluginAssetV1 {
  return Object.freeze({
    assetId: asset.assetId,
    createdAt: asset.createdAt,
    ...(asset.duration === undefined ? {} : {
      duration: asset.duration,
    }),
    ...(asset.height === undefined ? {} : { height: asset.height }),
    kind: asset.kind,
    mimeType: asset.mimeType,
    previewUrl: asset.previewUrl,
    ...(asset.width === undefined ? {} : { width: asset.width }),
  });
}
