import {
  createCanvasHostBoardSnapshot,
  type CanvasHostBoardSnapshotV1,
  type CanvasHostV1,
} from '..';

declare const host: CanvasHostV1;

const initialSnapshot: CanvasHostBoardSnapshotV1 = createCanvasHostBoardSnapshot({
  boardId: 'board_initial',
  boardName: 'Initial Board',
  projectId: 'project_initial',
  projectName: 'Initial Project',
});
void initialSnapshot;

const canvasProps: import('../react').CanvasSurfaceProps = {
  onSelectionChange(blockIds) {
    void blockIds;
  },
};
void canvasProps;

void host.commands.createGroup({ blockIds: ['block_a', 'block_b'] });
void host.commands.layoutGroup({ groupId: 'group_a', layoutMode: 'row' });
void host.commands.dissolveGroup({ groupId: 'group_a' });
void host.commands.attachAsset({
  blockId: 'block_image',
  fileName: 'portable.png',
  kind: 'image',
  mimeType: 'image/png',
  previewUrl: 'data:image/png;base64,',
  storageKey: 'import://portable.png',
  storageProvider: 'custom',
});
void host.commands.cancelExecution({ executionId: 'execution_a' });
void host.commands.startLocalImageExecution({
  capabilityId: 'image.local_adjust',
  sourceBlockId: 'block_image',
  title: 'Local image adjustment',
});
void host.commands.completeLocalImageExecution({
  asset: {
    kind: 'image',
    mimeType: 'image/png',
    previewUrl: 'data:image/png;base64,',
    storageKey: 'plugin-output://execution_a/result.png',
    storageProvider: 'custom',
  },
  executionId: 'execution_a',
  scope: { boardId: 'board_a', projectId: 'project_a' },
});
void host.commands.failLocalImageExecution({
  errorMessage: 'Processor failed.',
  executionId: 'execution_a',
  scope: { boardId: 'board_a', projectId: 'project_a' },
});

// @ts-expect-error Host consumers cannot mutate the readonly Board collection.
host.readModel.getSnapshot().blocks.push({});

// @ts-expect-error Host consumers never receive the internal snapshot mutator.
host.updateSnapshot(() => undefined);

// @ts-expect-error Host consumers cannot replace the command facade.
host.commands = {};

// @ts-expect-error Adapters must declare the exact V1 boundary.
const incompatibleStorage: import('../contracts').HostStorageAdapterV1 = { adapterVersion: 2 };
