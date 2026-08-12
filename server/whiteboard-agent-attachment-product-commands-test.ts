import assert from 'node:assert/strict';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import type { AssetRecord, BoardSnapshot } from '../src/core/types';
import { createCanvasHost } from '../src/host-kit';
import type {
  DeepReadonly,
  HostPersistAssetOptionsV1,
  HostStorageAdapterV1,
} from '../src/host-kit';
import {
  createNoopHostConnections,
  createNoopHostPackageRuntime,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';
import { createWhiteboardProductCommands } from '../src/whiteboard/application/whiteboardProductCommands';

class RecordingStorage extends InMemoryHostStorageAdapter {
  readonly fileNames: Array<string | undefined> = [];
  readonly persistedAssetIds: string[] = [];

  constructor(
    snapshots: readonly BoardSnapshot[],
    private readonly failAt?: number,
    private readonly remapIds = false,
  ) {
    super(snapshots);
  }

  override async persistAsset(
    asset: DeepReadonly<AssetRecord>,
    options?: HostPersistAssetOptionsV1,
  ): Promise<AssetRecord> {
    const attempt = this.fileNames.length + 1;
    this.fileNames.push(options?.fileName);
    if (attempt === this.failAt) throw new Error('Injected Asset persistence failure.');
    const canonical = this.remapIds
      ? {
          ...structuredClone(asset),
          assetId: `persisted_${this.fileNames.length}`,
          previewUrl: `/assets/persisted_${this.fileNames.length}`,
          storageKey: `assets/persisted_${this.fileNames.length}`,
          storageProvider: 'local' as const,
        }
      : asset;
    const persisted = await super.persistAsset(canonical, options);
    this.persistedAssetIds.push(persisted.assetId);
    return persisted;
  }
}

const initial = board('board_agent_attachment_success');
const storage = new RecordingStorage([initial], undefined, true);
const host = await hostFor(initial, storage);
const commands = createWhiteboardProductCommands(host);
let publications = 0;
const unsubscribe = host.readModel.subscribe(() => {
  publications += 1;
});

const empty = await commands.agentAttachment.attach({
  placementCenter: { x: 500, y: 400 },
  scope: scopeFor(initial),
  uploads: [],
});
assert.deepEqual(empty, { assetIds: [], blockIds: [], mentions: [] });
assert.equal(publications, 0);
assert.equal(storage.persistedAssetIds.length, 0);

const attached = await commands.agentAttachment.attach({
  placementCenter: { x: 500, y: 400 },
  scope: scopeFor(initial),
  uploads: [
    {
      dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
      fileName: 'hero.png',
      height: 100,
      width: 200,
    },
    {
      dataUrl: 'data:text/markdown,%23%20Creative%20brief',
      fileName: 'brief.md',
    },
    {
      dataUrl: 'data:video/mp4;base64,AAAA',
      fileName: 'reference.mp4',
    },
    {
      dataUrl: 'data:audio/mpeg;base64,AAAA',
      fileName: 'voice.mp3',
    },
  ],
});
assert.equal(publications, 1, 'All attachment Board facts publish in one transaction.');
assert.equal(storage.persistedAssetIds.length, 4);
assert.deepEqual(storage.fileNames, ['hero.png', 'brief.md', 'reference.mp4', 'voice.mp3']);
assert.equal(attached.assetIds.length, 4);
assert.deepEqual(attached.assetIds, storage.persistedAssetIds);
assert.equal(attached.blockIds.length, 3);
assert.deepEqual(attached.mentions.map((mention) => mention.kind), [
  'block',
  'block',
  'block',
  'asset',
]);

const current = host.readModel.getSnapshot();
assert.equal(current.assets.length, 4);
assert.deepEqual(
  attached.blockIds.map((blockId) => current.blocks.find((block) => block.blockId === blockId)?.type),
  ['image', 'document', 'video'],
);
const imageBlock = current.blocks.find((block) => block.blockId === attached.blockIds[0]);
assert.equal(imageBlock?.data.composerSourceAssetId, attached.assetIds[0]);
assert.deepEqual(imageBlock?.size, { height: 190, width: 380 });
assert.deepEqual(imageBlock?.position, { x: 136, y: 201 });
assert.deepEqual(
  current.blocks.find((block) => block.blockId === attached.blockIds[1])?.position,
  { x: 544, y: 176 },
);
assert.deepEqual(
  current.blocks.find((block) => block.blockId === attached.blockIds[2])?.position,
  { x: 350, y: 444 },
);
const durable = await storage.loadBoard(scopeFor(initial));
assert.equal(durable.assets.length, 4);
assert.deepEqual(new Set(durable.blocks.map((block) => block.blockId)), new Set(attached.blockIds));

unsubscribe();
await host.dispose();

const failedInitial = board('board_agent_attachment_failure');
const failedStorage = new RecordingStorage([failedInitial], 2);
const failedHost = await hostFor(failedInitial, failedStorage);
const failedCommands = createWhiteboardProductCommands(failedHost);
let failedPublications = 0;
const unsubscribeFailed = failedHost.readModel.subscribe(() => {
  failedPublications += 1;
});

await assert.rejects(
  failedCommands.agentAttachment.attach({
    placementCenter: { x: 0, y: 0 },
    scope: scopeFor(failedInitial),
    uploads: [
      { dataUrl: 'not-a-data-url', fileName: 'invalid.bin' },
      { dataUrl: 'data:image/png;base64,AAAA', fileName: 'never-persisted.png' },
    ],
  }),
  /valid data URL/,
);
assert.equal(failedStorage.persistedAssetIds.length, 0, 'Input validation precedes byte writes.');

await assert.rejects(
  failedCommands.agentAttachment.attach({
    placementCenter: { x: 0, y: 0 },
    scope: { ...scopeFor(failedInitial), boardId: 'board_wrong_scope' },
    uploads: [{ dataUrl: 'data:image/png;base64,AAAA', fileName: 'wrong-scope.png' }],
  }),
  /outside the requested scope/,
);
assert.equal(failedStorage.persistedAssetIds.length, 0, 'Scope validation precedes byte writes.');

await assert.rejects(
  failedCommands.agentAttachment.attach({
    placementCenter: { x: 0, y: 0 },
    scope: scopeFor(failedInitial),
    uploads: [
      { dataUrl: 'data:image/png;base64,AAAA', fileName: 'orphan-after-failure.png' },
      { dataUrl: 'data:text/plain,fail', fileName: 'fails.txt' },
    ],
  }),
  /Injected Asset persistence failure/,
);
assert.equal(failedPublications, 0);
assert.equal(failedHost.readModel.getSnapshot().assets.length, 0);
assert.equal(failedHost.readModel.getSnapshot().blocks.length, 0);
assert.equal(
  failedStorage.readAsset(failedInitial.project.projectId, failedStorage.persistedAssetIds[0])?.assetId,
  failedStorage.persistedAssetIds[0],
  'A byte write completed before an adapter failure may remain as an unreferenced orphan.',
);
assert.equal((await failedStorage.loadBoard(scopeFor(failedInitial))).assets.length, 0);

unsubscribeFailed();
await failedHost.dispose();

console.log({
  agentAttachmentBoardCommitIsAtomic: true,
  agentAttachmentMentionsPreserveOrder: true,
  agentAttachmentPersistenceFailureDoesNotPublish: true,
  agentAttachmentScopeValidatedBeforePersistence: true,
  unreferencedBytesBoundaryExplicit: true,
});

function board(boardId: string): BoardSnapshot {
  return createBlankBoardSnapshot({
    boardId,
    boardName: 'Agent attachment product commands',
    projectId: 'project_agent_attachment_commands',
    projectName: 'Agent attachment product commands',
  });
}

function scopeFor(snapshot: BoardSnapshot) {
  return {
    boardId: snapshot.board.boardId,
    projectId: snapshot.project.projectId,
  };
}

function hostFor(snapshot: BoardSnapshot, storage: HostStorageAdapterV1) {
  return createCanvasHost({
    connections: createNoopHostConnections(),
    environment: {
      colorScheme: 'light',
      contrast: 'normal',
      direction: 'ltr',
      locale: 'en',
      reducedMotion: true,
      themeId: 'retake.whiteboard.test',
    },
    experience: {
      commandOverrides: [],
      profileId: 'retake.whiteboard.test',
      schemaVersion: 1,
    },
    initialScope: scopeFor(snapshot),
    packageRuntime: createNoopHostPackageRuntime(),
    storage,
  });
}
