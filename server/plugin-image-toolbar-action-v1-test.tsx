import assert from 'node:assert/strict';
import type {
  PluginHostApiV2,
} from '@retake-tools/package-sdk';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PluginImageToolbarActions,
} from '../src/components/PluginImageToolbarActions';
import {
  PluginSelectionToolbarActions,
} from '../src/components/PluginSelectionToolbarActions';
import {
  PluginOperationInspectorActions,
  projectPluginOperationInspectorView,
} from '../src/components/PluginOperationInspectorActions';
import {
  createPluginContributionRegistry,
} from '../src/core/pluginContributionRegistry';
import type {
  AssetRecord,
  BlockRecord,
  ExecutionRecord,
} from '../src/core/types';

const host: PluginHostApiV2 = {
  assets: {
    getBound: () => null,
    importImage: async () => {
      throw new Error('Action fixture does not import assets.');
    },
  },
  drafts: {
    getBound: () => null,
    saveBound: async () => null,
  },
  environment: {
    getSnapshot: () => ({
      colorScheme: 'light',
      direction: 'ltr',
      locale: 'en',
      reducedMotion: false,
      revision: 'fixture',
    }),
    subscribe: () => () => undefined,
  },
  execution: {
    listConnections: () => [],
    run: async () => {
      throw new Error('Action fixture does not run executions.');
    },
    runConnected: async () => {
      throw new Error('Action fixture does not run connected executions.');
    },
  },
  getReadSnapshot: () => ({
    boardId: 'board.fixture',
    boundAssetIds: ['asset.fixture'],
    boundBlockIds: ['block.fixture'],
    boundGroupIds: [],
    projectId: 'project.fixture',
    revision: 'revision.fixture',
    selectedBlockIds: ['block.fixture'],
  }),
  subscribeReadSnapshot: () => () => undefined,
  version: 2,
};
const registry = createPluginContributionRegistry();
const failures = registry.replace([{
  activation: {
    contributions: [{
      contribution: {
        contributionId: 'retake.contribution.download-fixture',
        definitionHash: null,
        definitionPath: null,
        exportName: 'fixtureAction',
        kind: 'action',
      },
      value: {
        apiVersion: 2,
        kind: 'action',
        label: 'Download with Plugin',
        placement: 'image.toolbar',
        run: () => undefined,
      },
    }],
  },
  host,
  record: {
    pluginModuleId: 'retake.plugin.action-fixture',
  },
}]);
assert.deepEqual(failures, []);

const markup = renderToStaticMarkup(
  <PluginImageToolbarActions
    assetId="asset.fixture"
    blockId="block.fixture"
    previewUrl="/api/local/assets/project.fixture/asset.fixture/image.png"
    registry={registry}
    title="Fixture image"
  />,
);
assert.match(markup, /aria-label="Download with Plugin"/);
assert.match(markup, /plugin-image-toolbar-action/);
assert.match(markup, /<button/);

const emptyMarkup = renderToStaticMarkup(
  <PluginImageToolbarActions
    assetId="asset.fixture"
    blockId="block.fixture"
    title="Fixture image"
  />,
);
assert.equal(emptyMarkup, '');

const selectionRegistry = createPluginContributionRegistry();
assert.deepEqual(selectionRegistry.replace([{
  activation: {
    contributions: [{
      contribution: {
        contributionId: 'retake.contribution.selection-fixture',
        definitionHash: null,
        definitionPath: null,
        exportName: 'fixtureSelectionAction',
        kind: 'action',
      },
      value: {
        apiVersion: 2,
        kind: 'action',
        label: 'Edit selected pair',
        placement: 'selection.toolbar',
        run: () => undefined,
        selectionCount: { max: 2, min: 2 },
      },
    }],
  },
  host,
  record: {
    pluginModuleId: 'retake.plugin.selection-action-fixture',
  },
}]), []);
const selectionMarkup = renderToStaticMarkup(
  <PluginSelectionToolbarActions
    blocks={[
      {
        assetId: 'asset.fixture',
        blockId: 'block.fixture',
        title: 'Source',
        type: 'image',
      },
      {
        assetId: 'asset.mask',
        blockId: 'block.mask',
        title: 'Mask',
        type: 'image',
      },
    ]}
    registry={selectionRegistry}
  />,
);
assert.match(selectionMarkup, /aria-label="Plugin selection actions"/);
assert.match(selectionMarkup, /aria-label="Edit selected pair"/);
const wrongCountMarkup = renderToStaticMarkup(
  <PluginSelectionToolbarActions
    blocks={[{
      assetId: 'asset.fixture',
      blockId: 'block.fixture',
      title: 'Source',
      type: 'image',
    }]}
    registry={selectionRegistry}
  />,
);
assert.equal(wrongCountMarkup, '');

const operationRegistry = createPluginContributionRegistry();
assert.deepEqual(operationRegistry.replace([{
  activation: {
    contributions: [{
      contribution: {
        contributionId: 'retake.contribution.operation-fixture',
        definitionHash: null,
        definitionPath: null,
        exportName: 'fixtureOperationAction',
        kind: 'action',
      },
      value: {
        apiVersion: 2,
        kind: 'action',
        label: {
          default: 'Reopen edit',
          locales: { 'zh-CN': '重新编辑' },
        },
        placement: 'operation.inspector',
        run: () => undefined,
        supportedCapabilityIds: ['image.annotation_edit'],
      },
    }],
  },
  host,
  record: {
    pluginModuleId: 'retake.plugin.operation-action-fixture',
  },
}]), []);
const operationBlock = {
  blockId: 'block.operation',
} as BlockRecord;
const sourceBlock = {
  blockId: 'block.source',
  data: {
    assetId: 'asset.source',
    title: 'Source image',
  },
  type: 'image',
} as BlockRecord;
const sourceAsset = {
  assetId: 'asset.source',
  createdAt: '2026-07-27T00:00:00.000Z',
  kind: 'image',
  mimeType: 'image/png',
  previewUrl: '/api/local/assets/project.fixture/asset.source/image.png',
} as AssetRecord;
const execution = {
  capabilityId: 'image.annotation_edit',
  executionId: 'execution.fixture',
  params: {
    pluginParameters: {
      manifest: {
        schemaVersion: 1,
      },
    },
  },
  status: 'succeeded',
} as ExecutionRecord;
const operationView = projectPluginOperationInspectorView({
  execution,
  inputAssets: [sourceAsset],
  operationBlock,
  sourceBlock,
});
assert.equal(operationView.source?.blockId, 'block.source');
assert.deepEqual(operationView.parameters, {
  manifest: {
    schemaVersion: 1,
  },
});
assert.equal(
  projectPluginOperationInspectorView({
    execution,
    inputAssets: [{
      ...sourceAsset,
      assetId: 'asset.historical-source',
    }],
    operationBlock,
    sourceBlock,
  }).source,
  null,
);
const operationMarkup = renderToStaticMarkup(
  <PluginOperationInspectorActions
    execution={execution}
    inputAssets={[sourceAsset]}
    operationBlock={operationBlock}
    registry={operationRegistry}
    sourceBlock={sourceBlock}
  />,
);
assert.match(operationMarkup, /data-retake-plugin-ui="operation-inspector"/);
assert.match(operationMarkup, />Reopen edit</);

process.stdout.write(`${JSON.stringify({
  actionRendersInsideCoreImageToolbar: true,
  missingRegistryKeepsCoreToolbarOnly: true,
  neutralCoreActionIcon: true,
  operationInspectorProjectsCurrentSourceOnly: true,
  selectionActionRequiresDeclaredImageCount: true,
})}\n`);
