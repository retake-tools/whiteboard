import assert from 'node:assert/strict';
import { PluginHostErrorV2 } from '@retake-tools/package-sdk';
import {
  runPluginExecution,
} from '../src/app/usePluginExecutionController';
import {
  createPluginContributionRegistry,
} from '../src/host-kit/plugin';
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
import { replacePluginCapabilityDefinitions } from '../src/core/pluginCapabilityDefinitions';
import {
  createPluginHostReadStore,
} from '../src/host-kit/plugin';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import { defaultSnapshot } from '../src/core/sampleBoard';
import {
  createCanvasHost,
  type CanvasHostCommandsV1,
} from '../src/host-kit';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';
import type {
  AssetRecord,
  BlockRecord,
  BoardSnapshot,
} from '../src/core/types';

const pluginModuleId = 'design.retake.image-studio.fixture';
const onePixelPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const capability = {
  apiVersion: 2,
  definition: {
    capabilityId: 'image.local_adjust',
    category: 'image_editing',
    definitionHash: 'sha256:image-studio-local-adjust-v1',
    displayName: 'Local image adjustment',
    inputSlots: [{
      artifactTypes: [],
      bindingKinds: ['asset', 'block'],
      cardinality: 'one',
      dataTypes: ['image'],
      required: true,
      semanticRole: 'source',
      slotId: 'source_image',
    }],
    outputSlots: [{
      cardinality: 'one',
      dataType: 'image',
      projectionBlockTypes: ['image'],
      semanticRole: 'adjusted_image',
      slotId: 'result_image',
    }],
    runtimeRequirements: ['browser.canvas_2d'],
    schemaVersion: 2,
    supportedAdapterClasses: ['local_canvas'],
    version: '0.1.0',
  },
  kind: 'capability',
} as const;

const snapshot = snapshotWithSourceImage();
const sourceBlock = snapshot.blocks.find(
  (block) => block.blockId === 'block.plugin-source',
)!;
const sourceAsset = snapshot.assets.find(
  (asset) => asset.assetId === 'asset.plugin-source',
)!;
const registry = createPluginContributionRegistry({
  onCapabilitiesChanged: (capabilities) => {
    replacePluginCapabilityDefinitions(
      capabilities.map((candidate) => candidate.definition),
    );
  },
});
const hostStore = createPluginHostReadStore({
  boardId: snapshot.board.boardId,
  boundAssetIds: [sourceAsset.assetId],
  boundBlockIds: [sourceBlock.blockId],
  boundGroupIds: [],
  projectId: snapshot.project.projectId,
  revision: 'fixture-revision-1',
  selectedBlockIds: [sourceBlock.blockId],
}, {
  authorizeExecution: (candidateModuleId, capabilityId) => (
    registry.ownsCapability(candidateModuleId, capabilityId)
  ),
});
const host = hostStore.host(2, pluginModuleId);
hostStore.update(host.getReadSnapshot(), [sourceAsset]);
assert.deepEqual(registry.replace([{
  activation: {
    contributions: [{
      contribution: {
        contributionId: 'design.retake.image-studio.local-adjust',
        definitionHash: capability.definition.definitionHash,
        definitionPath: 'definitions/image.local_adjust.json',
        exportName: 'localAdjustCapability',
        kind: 'capability',
      },
      value: capability,
    }],
  },
  host,
  record: { pluginModuleId },
}]), []);

const scope = {
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
};
const otherSnapshot = createBlankBoardSnapshot({
  boardId: 'board.plugin-other',
  boardName: 'Other Plugin Board',
  projectId: snapshot.project.projectId,
  projectName: snapshot.project.name,
});
const storage = new InMemoryHostStorageAdapter([snapshot, otherSnapshot]);
const canvasHost = await createCanvasHost({
  connections: createNoopHostConnections(),
  environment: {
    colorScheme: 'light',
    contrast: 'normal',
    direction: 'ltr',
    locale: 'en',
    reducedMotion: true,
    themeId: 'retake.plugin-command-test',
  },
  experience: {
    commandOverrides: [],
    profileId: 'retake.plugin-command-test',
    schemaVersion: 1,
  },
  initialScope: scope,
  packageRuntime: createNoopHostPackageRuntime(),
  storage,
});
const snapshotRef = {
  current: structuredClone(canvasHost.readModel.getSnapshot()) as BoardSnapshot,
};
const selectedBlockIds: string[] = [];
let compatibilityPersistCalls = 0;
async function runHostCommand<Result>(
  operation: (commands: CanvasHostCommandsV1) => Promise<Result>,
): Promise<Result> {
  const result = await operation(canvasHost.commands);
  snapshotRef.current = structuredClone(
    canvasHost.readModel.getSnapshot(),
  ) as BoardSnapshot;
  return result;
}
hostStore.setExecutionRunner((request) => runPluginExecution(request, {
  persistSnapshot: async () => {
    compatibilityPersistCalls += 1;
  },
  runHostCommand,
  setSelectedBlock: (_next, blockId) => {
    selectedBlockIds.push(blockId);
  },
  snapshotRef,
  updateSnapshot: () => {
    throw new Error('Plugin command path must not use the compatibility snapshot updater.');
  },
}));

const completed = await host.execution.run({
  capabilityId: 'image.local_adjust',
  execute: async ({ assets, signal }) => {
    assert.equal(signal.aborted, false);
    assert.equal(assets[0]?.assetId, sourceAsset.assetId);
    assert.equal(assets[0]?.previewUrl, sourceAsset.previewUrl);
    assert.equal(snapshotRef.current.executions[0]?.status, 'running');
    return {
      images: [{
        dataUrl: onePixelPng,
        height: 1,
        slotId: 'result_image',
        width: 1,
      }],
    };
  },
  inputBlockIds: [sourceBlock.blockId],
  parameters: {
    brightness: 20,
    contrast: -10,
    saturation: 30,
  },
});

assert.equal(completed.status, 'succeeded');
assert.equal(compatibilityPersistCalls, 0);
assert.equal(snapshotRef.current.executions.length, 1);
const execution = snapshotRef.current.executions[0]!;
assert.equal(execution.executionId, completed.executionId);
assert.equal(execution.status, 'succeeded');
assert.equal(execution.adapter, 'local_canvas');
assert.deepEqual(execution.inputBlockIds, [sourceBlock.blockId]);
assert.deepEqual(execution.params?.pluginParameters, {
  brightness: 20,
  contrast: -10,
  saturation: 30,
});
assert.equal(execution.outputAssetIds.length, 1);
assert.equal(execution.outputBlockIds.length, 1);
assert.equal(
  snapshotRef.current.assets.find(
    (asset) => asset.assetId === execution.outputAssetIds[0],
  )?.sourceExecutionId,
  execution.executionId,
);
assert.equal(
  snapshotRef.current.blocks.find(
    (block) => block.blockId === execution.outputBlockIds[0],
  )?.data.status,
  'succeeded',
);
assert.equal(
  snapshotRef.current.edges.some((edge) => (
    edge.kind === 'execution_input'
    && edge.sourceBlockId === sourceBlock.blockId
  )),
  true,
);
assert.equal(
  snapshotRef.current.edges.some((edge) => (
    edge.kind === 'execution_output'
    && edge.targetBlockId === execution.outputBlockIds[0]
  )),
  true,
);
assert.deepEqual(
  snapshotRef.current.historyEvents?.slice(0, 3).map(
    (event) => event.type,
  ),
  [
    'execution_succeeded',
    'result_block_updated',
    'operation_created',
  ],
);
assert.equal(selectedBlockIds.length, 2);

await assert.rejects(
  host.execution.run({
    capabilityId: 'image.local_adjust',
    execute: async () => {
      throw new Error('fixture processor failed');
    },
    inputBlockIds: [sourceBlock.blockId],
    parameters: {
      brightness: 1,
      contrast: 0,
      saturation: 0,
    },
  }),
  (error: unknown) => (
    error instanceof PluginHostErrorV2
    && error.code === 'internal'
    && error.cause instanceof Error
    && error.cause.message === 'fixture processor failed'
  ),
);
assert.equal(snapshotRef.current.executions[0]?.status, 'failed');
assert.deepEqual(
  snapshotRef.current.executions[0]?.resultSummary,
  { requested: 1, succeeded: 0, failed: 1 },
);
assert.equal(
  snapshotRef.current.historyEvents?.[0]?.type,
  'execution_failed',
);

const executionCountBeforeInvalidParameters =
  snapshotRef.current.executions.length;
await assert.rejects(
  host.execution.run({
    capabilityId: 'image.local_adjust',
    execute: async () => ({ images: [] }),
    inputBlockIds: [sourceBlock.blockId],
    parameters: {
      brightness: Number.NaN,
      contrast: 0,
      saturation: 0,
    },
  }),
  /JSON parameters/,
);
assert.equal(
  snapshotRef.current.executions.length,
  executionCountBeforeInvalidParameters,
);

const cyclicParameters: Record<string, unknown> = {};
cyclicParameters.self = cyclicParameters;
await assert.rejects(
  host.execution.run({
    capabilityId: 'image.local_adjust',
    execute: async () => ({ images: [] }),
    inputBlockIds: [sourceBlock.blockId],
    parameters: cyclicParameters,
  }),
  /JSON parameters/,
);
assert.equal(
  snapshotRef.current.executions.length,
  executionCountBeforeInvalidParameters,
);

const selectedBeforeBoardSwitch = selectedBlockIds.length;
await assert.rejects(
  host.execution.run({
    capabilityId: 'image.local_adjust',
    execute: async () => {
      await canvasHost.setScope({
        boardId: otherSnapshot.board.boardId,
        projectId: otherSnapshot.project.projectId,
      });
      snapshotRef.current = structuredClone(
        canvasHost.readModel.getSnapshot(),
      ) as BoardSnapshot;
      throw new DOMException('board switched', 'AbortError');
    },
    inputBlockIds: [sourceBlock.blockId],
    parameters: {
      brightness: 1,
      contrast: 0,
      saturation: 0,
    },
  }),
  /board switched/,
);
const detachedFailure = await storage.loadBoard(scope);
assert.equal(detachedFailure.board.boardId, snapshot.board.boardId);
assert.equal(detachedFailure.executions[0]?.status, 'failed');
assert.equal(selectedBlockIds.length, selectedBeforeBoardSwitch + 1);
assert.equal(compatibilityPersistCalls, 0);

registry.removeModule(pluginModuleId);
assert.throws(
  () => capabilityDefinitionFor('image.local_adjust'),
  /Unknown legacy capability/,
);
await assert.rejects(
  host.execution.run({
    capabilityId: 'image.local_adjust',
    execute: async () => ({ images: [] }),
    inputBlockIds: [sourceBlock.blockId],
    parameters: {},
  }),
  /does not own/,
);
await canvasHost.dispose();

process.stdout.write(`${JSON.stringify({
  capabilityOwnershipRequired: true,
  commandFacadeOwnsPluginWriteback: true,
  detachedCommandWritebackPreservesCurrentScope: true,
  detachedBoardExecutionPersistsFailureWithoutSelectionWrite: true,
  failedProcessorRecordsExecutionFailure: true,
  imageStudioCapabilityHasNoCoreFallback: true,
  invalidParametersCreateNoExecution: true,
  sourceOperationResultLineage: true,
  succeededAssetUsesExecutionId: true,
})}\n`);

function snapshotWithSourceImage(): BoardSnapshot {
  const next = structuredClone(defaultSnapshot);
  const sourceAsset: AssetRecord = {
    assetId: 'asset.plugin-source',
    createdAt: '2026-07-27T00:00:00.000Z',
    height: 1,
    kind: 'image',
    mimeType: 'image/png',
    previewUrl: onePixelPng,
    projectId: next.project.projectId,
    storageKey: 'local-mock://plugin-source.png',
    storageProvider: 'local_mock',
    width: 1,
  };
  const sourceBlock: BlockRecord = {
    blockId: 'block.plugin-source',
    boardId: next.board.boardId,
    createdAt: sourceAsset.createdAt,
    data: {
      assetId: sourceAsset.assetId,
      title: 'Plugin source',
    },
    layerId: 'layer_default',
    position: { x: 0, y: 0 },
    size: { height: 160, width: 160 },
    type: 'image',
    updatedAt: sourceAsset.createdAt,
    zIndex: 50,
  };
  next.assets.unshift(sourceAsset);
  next.blocks.push(sourceBlock);
  return next;
}
