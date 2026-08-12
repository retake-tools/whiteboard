import { useCallback, type RefObject } from 'react';
import type {
  PluginConnectedExecutionViewV2,
  PluginAssetV2,
  PluginExecutionViewV2,
} from '@retake-tools/package-sdk';
import { imageMimeTypeFromDataUrl } from '../core/assetStore';
import {
  capabilityDefinitionFor,
} from '../core/capabilityRegistry';
import type {
  PluginExecutionRunnerRequestV2,
  PluginExecutionRunnerV2,
} from '../host-kit/plugin';
import type {
  AssetRecord,
  BoardSnapshot,
} from '../core/types';
import type { CanvasHostCommandsV1 } from '../host-kit';
import type { WhiteboardProductCommandsV1 } from '../whiteboard/application/whiteboardProductCommands';
import {
  runConnectedPluginExecution,
} from './runConnectedPluginExecution';

interface PluginExecutionControllerOptions {
  adoptDurableSnapshot: (snapshot: BoardSnapshot) => void;
  runHostCommand?: <Result>(
    operation: (commands: CanvasHostCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  runProductCommand?: <Result>(
    operation: (commands: WhiteboardProductCommandsV1) => Promise<Result>,
    options?: { history?: boolean; syncFlow?: boolean },
  ) => Promise<Result>;
  setSelectedBlock: (
    snapshot: BoardSnapshot,
    blockId: string,
  ) => void;
  snapshotRef: RefObject<BoardSnapshot>;
}

export function usePluginExecutionController({
  adoptDurableSnapshot,
  runHostCommand,
  runProductCommand,
  setSelectedBlock,
  snapshotRef,
}: PluginExecutionControllerOptions): PluginExecutionRunnerV2 {
  return useCallback(
    (request: PluginExecutionRunnerRequestV2) => (
      runPluginExecution(request, {
        adoptDurableSnapshot,
        runHostCommand,
        runProductCommand,
        setSelectedBlock,
        snapshotRef,
      })
    ),
    [
      adoptDurableSnapshot,
      runHostCommand,
      runProductCommand,
      setSelectedBlock,
      snapshotRef,
    ],
  );
}

export async function runPluginExecution(
  request: PluginExecutionRunnerRequestV2,
  {
    adoptDurableSnapshot,
    runHostCommand,
    runProductCommand,
    setSelectedBlock,
    snapshotRef,
  }: PluginExecutionControllerOptions,
): Promise<PluginConnectedExecutionViewV2 | PluginExecutionViewV2> {
  if (request.kind === 'connected') {
    if (!runProductCommand) {
      throw new Error('Whiteboard product command facade is required for connected Plugin execution.');
    }
    return runConnectedPluginExecution(
      request.input,
      request.signal,
      {
        adoptDurableSnapshot,
        runHostCommand: runHostCommand ?? (() => {
          throw new Error('Canvas Host command facade is required for connected Plugin execution.');
        }),
        runProductCommand,
        setSelectedBlock,
        snapshotRef,
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
  if (!runHostCommand) {
    throw new Error('Canvas Host command facade is required for local Plugin execution.');
  }

  const started = await runHostCommand(
    (commands) => commands.startLocalImageExecution({
      body: definition.displayName,
      capabilityDefinition: definition,
      capabilityId: definition.capabilityId,
      params: parameters,
      sourceBlockId,
      title: definition.displayName,
    }),
    { history: true },
  );
  const executionId = started.execution.executionId;
  const operationBlockId = started.operationBlock.blockId;
  const resultBlockId = started.resultBlock.blockId;
  const runningSnapshot = structuredClone(snapshotRef.current);
  const executionScope = {
    boardId: runningSnapshot.board.boardId,
    projectId: runningSnapshot.project.projectId,
  };
  setSelectedBlock(runningSnapshot, operationBlockId);

  try {
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
    const fileName = image.fileName ?? `plugin-result-${executionId}.png`;
    const completed = await runHostCommand(
      (commands) => commands.completeLocalImageExecution({
        asset: {
          fileName,
          height: image.height,
          kind: 'image',
          mimeType: imageMimeTypeFromDataUrl(image.dataUrl),
          previewUrl: image.dataUrl,
          storageKey: `plugin-output://${executionId}/${fileName}`,
          storageProvider: 'custom',
          width: image.width,
        },
        executionId,
        scope: executionScope,
      }),
    );
    if (isCurrentExecutionScope(snapshotRef.current, executionScope)) {
      setSelectedBlock(snapshotRef.current, resultBlockId);
    }
    return {
      capabilityId: input.capabilityId,
      executionId,
      outputAssetIds: [completed.asset.assetId],
      outputBlockIds: [completed.resultBlock.blockId],
      status: 'succeeded',
    };
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : 'Plugin image execution failed.';
    try {
      await runHostCommand(
        (commands) => commands.failLocalImageExecution({
          errorMessage: message,
          executionId,
          scope: executionScope,
        }),
      );
    } catch (writebackError) {
      console.error('Plugin execution failure writeback failed.', writebackError);
    }
    if (isCurrentExecutionScope(snapshotRef.current, executionScope)) {
      setSelectedBlock(snapshotRef.current, operationBlockId);
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
