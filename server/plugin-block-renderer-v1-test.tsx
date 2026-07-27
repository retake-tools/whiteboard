import assert from 'node:assert/strict';
import type {
  PluginHostApiV1,
} from '@retake-tools/package-sdk';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PluginBlockRendererProvider,
  PluginBlockRendererSlot,
} from '../src/components/PluginBlockRendererHost';
import {
  createPluginContributionRegistry,
} from '../src/core/pluginContributionRegistry';

const host: PluginHostApiV1 = {
  assets: {
    getBound: () => null,
    importImage: async () => {
      throw new Error('Renderer fixture does not import assets.');
    },
  },
  execution: {
    run: async () => {
      throw new Error('Renderer fixture does not run executions.');
    },
  },
  getReadSnapshot: () => ({
    boardId: 'board.fixture',
    boundAssetIds: [],
    boundBlockIds: [],
    boundGroupIds: [],
    projectId: 'project.fixture',
    revision: 'revision.fixture',
    selectedBlockIds: [],
  }),
  subscribeReadSnapshot: () => () => undefined,
  version: 1,
};
const registry = createPluginContributionRegistry();
const Renderer = ({
  block,
  selected,
}: {
  block: { blockId: string; previewUrl?: string; title: string };
  selected: boolean;
}) => (
  <figure
    data-block-frozen={Object.isFrozen(block)}
    data-block-id={block.blockId}
    data-selected={selected}
  >
    <img alt={block.title} src={block.previewUrl} />
  </figure>
);
const failures = registry.replace([{
  activation: {
    contributions: [{
      contribution: {
        contributionId: 'retake.contribution.renderer-fixture',
        definitionHash: null,
        definitionPath: null,
        exportName: 'fixtureRenderer',
        kind: 'renderer',
      },
      value: {
        apiVersion: 1,
        component: Renderer,
        kind: 'renderer',
        placement: 'block.body',
        supportedBlockTypes: ['image'],
      },
    }],
  },
  host,
  record: {
    pluginModuleId: 'retake.plugin.renderer-fixture',
  },
}]);
assert.deepEqual(failures, []);

const pluginMarkup = renderSlot({
  rendererContributionId: 'retake.contribution.renderer-fixture',
  type: 'image',
});
assert.match(
  pluginMarkup,
  /data-retake-plugin-renderer="retake\.contribution\.renderer-fixture"/,
);
assert.match(pluginMarkup, /data-block-frozen="true"/);
assert.match(pluginMarkup, /data-block-id="block\.fixture"/);
assert.doesNotMatch(pluginMarkup, /data-core-fallback/);

const incompatibleMarkup = renderSlot({
  rendererContributionId: 'retake.contribution.renderer-fixture',
  type: 'text',
});
assert.match(incompatibleMarkup, /data-core-fallback/);
assert.doesNotMatch(incompatibleMarkup, /data-retake-plugin-renderer/);

const missingMarkup = renderSlot({
  rendererContributionId: 'retake.contribution.missing',
  type: 'image',
});
assert.match(missingMarkup, /data-core-fallback/);
assert.doesNotMatch(missingMarkup, /data-retake-plugin-renderer/);

process.stdout.write(`${JSON.stringify({
  coreFallbackForIncompatibleRenderer: true,
  coreFallbackForMissingRenderer: true,
  immutableBlockProjection: true,
  nativeRendererOwnsBlockBodyOnly: true,
})}\n`);

function renderSlot(input: {
  rendererContributionId: string;
  type: 'image' | 'text';
}): string {
  return renderToStaticMarkup(
    <PluginBlockRendererProvider registry={registry}>
      <PluginBlockRendererSlot
        blockId="block.fixture"
        coreFallback={<span data-core-fallback>Core fallback</span>}
        data={{
          assetId: 'asset.fixture',
          previewUrl: '/api/local/assets/project.fixture/asset.fixture/image.png',
          rendererContributionId: input.rendererContributionId,
          title: 'Fixture block',
        }}
        selected={false}
        type={input.type}
      />
    </PluginBlockRendererProvider>,
  );
}
