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
  capabilityDefinition: {
    capabilityId: 'image.local_adjust',
    category: 'image_editing',
    definitionHash: 'sha256:image-local-adjust-v2',
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
      artifactType: 'image',
      cardinality: 'one',
      dataType: 'image',
      projectionBlockTypes: ['image'],
      semanticRole: 'adjusted_image',
      slotId: 'result_image',
    }],
    parametersSchemaRef: 'definitions/image.local_adjust.parameters.json',
    runtimeRequirements: ['browser.canvas_2d'],
    schemaVersion: 1,
    supportedAdapterClasses: ['local_canvas'],
    version: '0.2.0',
  },
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
