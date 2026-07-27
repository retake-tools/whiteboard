import { useCallback, type RefObject } from 'react';
import type {
  PluginConnectedExecutionViewV2,
  PluginAssetV2,
  PluginExecutionViewV2,
} from '@retake-tools/package-sdk';
import { createImageAssetFromDataUrl } from '../core/assetStore';
import {
  capabilityDefinitionFor,
} from '../core/capabilityRegistry';
import {
  addPluginImageOperation,
  completePluginImageOperation,
  failPluginImageOperation,
} from '../core/imageOperations';
import type {
  PluginExecutionRunnerRequestV2,
  PluginExecutionRunnerV2,
} from '../core/pluginWebModuleLoader';
import type {
  AssetRecord,
  BoardSnapshot,
} from '../core/types';
import {
  runConnectedPluginExecution,
} from './runConnectedPluginExecution';

interface PluginExecutionControllerOptions {
  persistSnapshot: (
    snapshot: BoardSnapshot,
    options?: { requireLocalApi?: boolean },
  ) => Promise<void>;
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
}: PluginExecutionControllerOptions): PluginExecutionRunnerV2 {
  return useCallback(
    (request: PluginExecutionRunnerRequestV2) => (
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
  request: PluginExecutionRunnerRequestV2,
  {
    persistSnapshot,
    setSelectedBlock,
    snapshotRef,
    updateSnapshot,
  }: PluginExecutionControllerOptions,
): Promise<PluginConnectedExecutionViewV2 | PluginExecutionViewV2> {
  if (request.kind === 'connected') {
    return runConnectedPluginExecution(
      request.input,
      request.signal,
      {
        persistSnapshot,
        setSelectedBlock,
        snapshotRef,
        updateSnapshot,
      },
      request.importedAssets,
    );
  }
  const { input, signal } = request;
  const definition = assertSupportedPluginImageExecution(input.capabilityId);
  if (input.inputBlockIds.length !== 1) {
    throw new Error(
      'Plugin image execution requires exactly one input Image Block.',
    );
  }
  const sourceBlockId = input.inputBlockIds[0]!;
  const parameters = pluginExecutionParameters(input.parameters);
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
      'Plugin image execution requires a bound Image Block with an Asset.',
    );
  }

  let executionId = '';
  let operationBlockId = '';
  let resultBlockId = '';
  const runningSnapshot = updateSnapshot((current) => {
    const started = addPluginImageOperation(current, {
      body: definition.displayName,
      capabilityId: definition.capabilityId,
      params: parameters,
      sourceBlockId,
      title: definition.displayName,
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
        'Plugin image execution must return exactly one Image output.',
      );
    }
    const image = output.images[0]!;
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
          completePluginImageOperation(current, { asset, executionId });
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
          failPluginImageOperation(current, {
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

function assertSupportedPluginImageExecution(
  capabilityId: string,
): ReturnType<typeof capabilityDefinitionFor> {
  const definition = capabilityDefinitionFor(capabilityId);
  if (
    !definition.supportedAdapterClasses.includes('local_canvas')
    || definition.inputSlots.length !== 1
    || !definition.inputSlots[0]?.dataTypes.includes('image')
    || definition.outputSlots.length !== 1
    || definition.outputSlots[0]?.dataType !== 'image'
  ) {
    throw new Error(
      `Plugin Capability is not supported by the local image execution projection: ${capabilityId}`,
    );
  }
  return definition;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw new DOMException('Plugin execution was aborted.', 'AbortError');
}

function pluginExecutionParameters(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  if (!isFiniteJsonValue(input, new WeakSet())) {
    throw new Error(
      'Plugin execution parameters must contain only finite JSON values.',
    );
  }
  return structuredClone(input);
}

function isFiniteJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
): boolean {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'boolean'
  ) {
    return true;
  }
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return false;
  if (ancestors.has(value)) return false;

  const prototype = Object.getPrototypeOf(value);
  if (
    !Array.isArray(value)
    && prototype !== Object.prototype
    && prototype !== null
  ) {
    return false;
  }

  ancestors.add(value);
  const valid = (
    Array.isArray(value)
      ? value.every((entry) => isFiniteJsonValue(entry, ancestors))
      : Object.values(value).every(
          (entry) => isFiniteJsonValue(entry, ancestors),
        )
  );
  ancestors.delete(value);
  return valid;
}

function completeDetachedExecution(
  snapshot: BoardSnapshot,
  asset: AssetRecord,
  executionId: string,
): BoardSnapshot {
  completePluginImageOperation(snapshot, { asset, executionId });
  return snapshot;
}

function failDetachedExecution(
  snapshot: BoardSnapshot,
  executionId: string,
  errorMessage: string,
): BoardSnapshot {
  failPluginImageOperation(snapshot, { errorMessage, executionId });
  return snapshot;
}

function isCurrentExecutionScope(
  snapshot: BoardSnapshot,
  scope: { boardId: string; projectId: string },
): boolean {
  return snapshot.board.boardId === scope.boardId
    && snapshot.project.projectId === scope.projectId;
}

function toPluginAsset(asset: AssetRecord): PluginAssetV2 {
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
