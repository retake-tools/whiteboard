import assert from 'node:assert/strict';
import { compileCreativeRequest } from './creative-request-compiler-service';
import type { AssetRecord, BoardSnapshot } from '../src/core/types';
import { createBlockRecord } from '../src/core/blockFactory';
import { imageGenerateCapabilityId } from '../src/core/imageGenerateContracts';

const snapshot = fixtureSnapshot();
const first = imageAsset(snapshot, 'asset_scene');
const second = imageAsset(snapshot, 'asset_style');
snapshot.assets.push(first, second);
const firstBlock = createBlockRecord(snapshot, 'image');
firstBlock.blockId = 'block_scene';
firstBlock.data = {
  ...firstBlock.data,
  assetId: first.assetId,
  title: '客厅场景',
};
const secondBlock = createBlockRecord(snapshot, 'image');
secondBlock.blockId = 'block_style';
secondBlock.data = {
  ...secondBlock.data,
  assetId: second.assetId,
  title: '水彩风格',
};
snapshot.blocks.push(firstBlock, secondBlock);

const compiled = await compileCreativeRequest({
  boardId: snapshot.board.boardId,
  explicitParameters: { aspectRatioPreset: '16:9', variationCount: 2 },
  instruction: '@客厅场景做场景参考，@水彩风格做风格参考，生成一张落地灯海报。',
  mediaKind: 'image',
  projectId: snapshot.project.projectId,
  references: [
    {
      mention: { blockId: firstBlock.blockId, kind: 'block', slotId: 'references' },
      mentionId: `block:${firstBlock.blockId}:references`,
    },
    {
      mention: { blockId: secondBlock.blockId, kind: 'block', slotId: 'references' },
      mentionId: `block:${secondBlock.blockId}:references`,
    },
  ],
}, {
  getSnapshot: async () => structuredClone(snapshot),
  listSettings: async () => ({
    connectors: [],
    connectionTemplates: [],
    connections: [{
      connectionId: 'codex-app-server',
      connectorId: 'codex-app-server',
      providerLabel: 'Codex',
      displayName: 'Codex App Server',
      description: '',
      connectionKind: 'agent_host',
      implementationKind: 'agent_bridge',
      supportedCapabilityIds: [],
      enabledUseCases: ['text'],
      configurable: true,
      deletable: false,
      enabled: true,
      status: 'ready',
      hasCredential: true,
      modelId: 'test-model',
    }],
    workspaceDefaults: [{ connectionId: 'codex-app-server', useCase: 'text' }],
    projectDefaults: [],
  }),
  resolveAssetPath: async (_projectId, assetId) => `/tmp/${assetId}.png`,
  runTurn: async (input) => {
    assert.deepEqual(input.localImagePaths, [
      '/tmp/asset_scene.png',
      '/tmp/asset_style.png',
    ]);
    assert.equal(input.model, 'test-model');
    const outputSchema = input.outputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    assert.equal('capabilityId' in (outputSchema.properties ?? {}), false);
    assert.deepEqual(outputSchema.required, ['references']);
    const compilerPrompt = JSON.parse(input.prompt) as {
      capability?: { capabilityId?: string };
    };
    assert.equal(compilerPrompt.capability?.capabilityId, imageGenerateCapabilityId);
    return {
      threadId: 'thread_compiler',
      turnId: 'turn_compiler',
      text: JSON.stringify({
        references: [
          {
            inputSlotId: 'references',
            intentInstruction: '保持客厅空间和灯光关系',
            intentLabel: '客厅空间与灯光',
            mentionId: 'block:block_scene:references',
          },
          {
            inputSlotId: 'references',
            intentInstruction: '沿用水彩质感',
            intentLabel: '水彩质感',
            mentionId: 'block:block_style:references',
          },
        ],
      }),
    };
  },
});

assert.equal(compiled.compiler.kind, 'ai');
assert.equal(compiled.compiler.model, 'test-model');
assert.equal(compiled.capabilityId, imageGenerateCapabilityId);
assert.equal(compiled.prompt, '@客厅场景做场景参考，@水彩风格做风格参考，生成一张落地灯海报。');
assert.deepEqual(
  compiled.references.map(({ mentionId, inputSlotId, referenceIntent }) => ({
    inputSlotId,
    mentionId,
    referenceIntent,
  })),
  [
    {
      inputSlotId: 'references',
      mentionId: 'block:block_scene:references',
      referenceIntent: {
        instruction: '保持客厅空间和灯光关系',
        label: '客厅空间与灯光',
        origin: 'ai',
        schemaVersion: 1,
      },
    },
    {
      inputSlotId: 'references',
      mentionId: 'block:block_style:references',
      referenceIntent: {
        instruction: '沿用水彩质感',
        label: '水彩质感',
        origin: 'ai',
        schemaVersion: 1,
      },
    },
  ],
);
assert.deepEqual(compiled.parameters, {
  aspectRatioPreset: '16:9',
  variationCount: 2,
});

let runCalled = false;
const explicit = await compileCreativeRequest({
  boardId: snapshot.board.boardId,
  explicitParameters: {},
  instruction: '以这张图为原图，把窗外改成月色。',
  mediaKind: 'image',
  projectId: snapshot.project.projectId,
  references: [{
    explicitBinding: { inputSlotId: 'source_image' },
    mention: { blockId: firstBlock.blockId, kind: 'block', slotId: 'references' },
    mentionId: `block:${firstBlock.blockId}:references`,
  }],
}, {
  getSnapshot: async () => structuredClone(snapshot),
  resolveAssetPath: async (_projectId, assetId) => `/tmp/${assetId}.png`,
  runTurn: async () => {
    runCalled = true;
    throw new Error('should not run');
  },
});
assert.equal(runCalled, false);
assert.equal(explicit.compiler.kind, 'deterministic');
assert.equal(explicit.capabilityId, imageGenerateCapabilityId);
assert.equal(explicit.references[0]?.inputSlotId, 'source_image');
assert.equal(explicit.references[0]?.referenceIntent, undefined);

const fallback = await compileCreativeRequest({
  boardId: snapshot.board.boardId,
  explicitParameters: {},
  instruction: '参考这张图片生成视频。',
  mediaKind: 'video',
  projectId: snapshot.project.projectId,
  references: [{
    mention: { blockId: firstBlock.blockId, kind: 'block', slotId: 'references' },
    mentionId: `block:${firstBlock.blockId}:references`,
  }],
}, {
  getSnapshot: async () => structuredClone(snapshot),
  listSettings: async () => ({
    connectors: [],
    connectionTemplates: [],
    connections: [],
    workspaceDefaults: [],
    projectDefaults: [],
  }),
  resolveAssetPath: async (_projectId, assetId) => `/tmp/${assetId}.png`,
});
assert.equal(fallback.compiler.kind, 'deterministic');
assert.equal(fallback.references[0]?.inputSlotId, 'general_references');
assert.equal(fallback.unresolved[0]?.code, 'semantic_mapping_unavailable');

console.log(JSON.stringify({
  compiler: compiled.compiler,
  explicitCapability: explicit.capabilityId,
  fallbackUnresolved: fallback.unresolved[0]?.code,
  status: 'ok',
}, null, 2));

function fixtureSnapshot(): BoardSnapshot {
  const now = new Date().toISOString();
  return {
    project: {
      projectId: 'project_creative_compiler',
      name: 'Creative compiler',
      createdAt: now,
      updatedAt: now,
      defaultBoardId: 'board_creative_compiler',
    },
    board: {
      boardId: 'board_creative_compiler',
      projectId: 'project_creative_compiler',
      name: 'Creative compiler',
      createdAt: now,
      updatedAt: now,
    },
    layers: [{
      id: 'layer_default',
      boardId: 'board_creative_compiler',
      name: 'Default',
      visible: true,
      locked: false,
      order: 0,
    }],
    blocks: [],
    edges: [],
    assets: [],
    executions: [],
  };
}

function imageAsset(snapshot: BoardSnapshot, assetId: string): AssetRecord {
  return {
    assetId,
    projectId: snapshot.project.projectId,
    kind: 'image',
    mimeType: 'image/png',
    storageProvider: 'local',
    storageKey: `${assetId}/image.png`,
    previewUrl: `/api/local/assets/${assetId}/image.png`,
    width: 1024,
    height: 1024,
    createdAt: new Date().toISOString(),
  };
}
