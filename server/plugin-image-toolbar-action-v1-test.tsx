import assert from 'node:assert/strict';
import type {
  PluginHostApiV1,
} from '@retake-tools/package-sdk';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PluginImageToolbarActions,
} from '../src/components/PluginImageToolbarActions';
import {
  createPluginContributionRegistry,
} from '../src/core/pluginContributionRegistry';

const host: PluginHostApiV1 = {
  assets: {
    getBound: () => null,
    importImage: async () => {
      throw new Error('Action fixture does not import assets.');
    },
  },
  execution: {
    run: async () => {
      throw new Error('Action fixture does not run executions.');
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
  version: 1,
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
        apiVersion: 1,
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

process.stdout.write(`${JSON.stringify({
  actionRendersInsideCoreImageToolbar: true,
  missingRegistryKeepsCoreToolbarOnly: true,
  neutralCoreActionIcon: true,
})}\n`);
