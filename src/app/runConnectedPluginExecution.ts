import type {
  PluginConnectedExecutionRunInputV1,
  PluginConnectedExecutionViewV1,
} from '@retake-tools/package-sdk';
import { loadBoardSnapshot } from '../core/boardStore';
import { capabilityDefinitionFor } from '../core/capabilityRegistry';
import {
  currentExecutionProviderSettings,
  resolveExecutionConnectionPreference,
} from '../core/executionProviderPreferences';
import { addImageCodexOperation } from '../core/imageOperations';
import { isExecutionInputRole } from '../core/inputRoles';
import { startCodexAppServerImage } from '../core/codexAppServerImageClient';
import type {
  BlockRecord,
  BoardSnapshot,
  ExecutionInputRole,
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
  input: PluginConnectedExecutionRunInputV1,
  signal: AbortSignal,
  options: ConnectedPluginExecutionOptions,
): Promise<PluginConnectedExecutionViewV1> {
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
    const block = initial.blocks.find(
      (candidate) => candidate.blockId === binding.blockId,
    );
    if (
      !slot
      || slot.cardinality !== 'one'
      || !slot.dataTypes.includes('image')
      || !block
      || block.type !== 'image'
      || typeof block.data.assetId !== 'string'
    ) {
      throw new Error(
        `Connected Plugin input does not match an Image slot: ${binding.slotId}`,
      );
    }
    return {
      block,
      inputRole: inputRoleForSlot(slot.slotId, slot.semanticRole),
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
    (binding) => binding.inputRole === 'source',
  );
  if (!source) {
    throw new Error(
      'Connected Plugin image execution requires one source image.',
    );
  }
  const additionalInputs = bindings.filter(
    (binding) => binding !== source,
  );
  if (additionalInputs.some((binding) => binding.inputRole === 'source')) {
    throw new Error(
      'Connected Plugin image execution accepts only one source image.',
    );
  }
  assertMaskGeometry(initial, source.block, additionalInputs);

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
        ({ block, inputRole }) => ({
          blockId: block.blockId,
          inputRole: inputRole as Exclude<
            ExecutionInputRole,
            'source'
          >,
        }),
      ),
      capabilityId: input.capabilityId,
      connection,
      generationParams: sourceGenerationParams(current, source.block),
      instruction: input.prompt.trim(),
      operation: 'quick_edit',
      params: structuredClone(input.parameters),
      sourceBlockId: source.block.blockId,
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

function inputRoleForSlot(
  slotId: string,
  semanticRole: string,
): ExecutionInputRole {
  if (slotId === 'source_image' || semanticRole === 'source') {
    return 'source';
  }
  if (isExecutionInputRole(slotId)) return slotId;
  if (isExecutionInputRole(semanticRole)) return semanticRole;
  throw new Error(
    `Connected image input slot has no supported role: ${slotId}`,
  );
}

function assertMaskGeometry(
  snapshot: BoardSnapshot,
  sourceBlock: BlockRecord,
  additionalInputs: Array<{
    block: BlockRecord;
    inputRole: ExecutionInputRole;
  }>,
): void {
  const mask = additionalInputs.find(
    (binding) => binding.inputRole === 'inpaint_mask',
  );
  if (!mask) return;
  const sourceAsset = snapshot.assets.find(
    (asset) => asset.assetId === sourceBlock.data.assetId,
  );
  const maskAsset = snapshot.assets.find(
    (asset) => asset.assetId === mask.block.data.assetId,
  );
  if (!sourceAsset || !maskAsset || maskAsset.mimeType !== 'image/png') {
    throw new Error(
      'Masked image execution requires source and PNG Mask Assets.',
    );
  }
  if (
    sourceAsset.width !== undefined
    && sourceAsset.height !== undefined
    && maskAsset.width !== undefined
    && maskAsset.height !== undefined
    && (
      sourceAsset.width !== maskAsset.width
      || sourceAsset.height !== maskAsset.height
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
): {
  targetHeight?: number;
  targetWidth?: number;
  variationCount: number;
} {
  const asset = snapshot.assets.find(
    (candidate) => candidate.assetId === sourceBlock.data.assetId,
  );
  return {
    ...(asset?.height ? { targetHeight: asset.height } : {}),
    ...(asset?.width ? { targetWidth: asset.width } : {}),
    variationCount: 1,
  };
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
