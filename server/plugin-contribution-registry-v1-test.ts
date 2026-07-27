import assert from 'node:assert/strict';
import type {
  PluginHostApiV1,
} from '@retake-tools/package-sdk';
import {
  createPluginContributionRegistry,
  type PluginContributionSessionV1,
} from '../src/core/pluginContributionRegistry';

const host: PluginHostApiV1 = {
  assets: {
    getBound: () => null,
    importImage: async () => {
      throw new Error('Fixture does not import assets.');
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
  subscribeReadSnapshot: () => () => {},
  version: 1,
};
const FixturePanel = () => null;
const FixtureRenderer = () => null;
const fixtureActionRun = () => undefined;
const registry = createPluginContributionRegistry();
let notifications = 0;
const unsubscribe = registry.subscribe(() => {
  notifications += 1;
});
const failures = registry.replace([
  panelSession('retake.plugin.panel-fixture', {
    apiVersion: 1,
    component: FixturePanel,
    kind: 'panel',
    placement: 'workspace.overlay',
  }),
]);
assert.deepEqual(failures, []);
assert.equal(registry.getSnapshot().length, 1);
assert.equal(registry.getSnapshot()[0]!.component, FixturePanel);
assert.equal(registry.getSnapshot()[0]!.failure, null);
assert.equal(notifications, 1);
registry.replace([
  panelSession('retake.plugin.panel-fixture', {
    apiVersion: 1,
    component: FixturePanel,
    kind: 'panel',
    placement: 'workspace.overlay',
  }),
]);
assert.equal(notifications, 1);
registry.failModule('retake.plugin.panel-fixture', 'fixture render crash');
assert.equal(
  registry.getSnapshot()[0]!.failure,
  'fixture render crash',
);

const rendererFailures = registry.replace([
  rendererSession('retake.plugin.renderer-fixture', {
    apiVersion: 1,
    component: FixtureRenderer,
    kind: 'renderer',
    placement: 'block.body',
    supportedBlockTypes: ['image'],
  }),
]);
assert.deepEqual(rendererFailures, []);
assert.equal(registry.getSnapshot().length, 0);
assert.equal(registry.getRendererSnapshot().length, 1);
assert.equal(
  registry.getRendererSnapshot()[0]!.component,
  FixtureRenderer,
);
assert.equal(
  Object.isFrozen(
    registry.getRendererSnapshot()[0]!.supportedBlockTypes,
  ),
  true,
);
registry.failModule(
  'retake.plugin.renderer-fixture',
  'fixture renderer crash',
);
assert.equal(
  registry.getRendererSnapshot()[0]!.failure,
  'fixture renderer crash',
);

const actionFailures = registry.replace([
  actionSession('retake.plugin.action-fixture', {
    apiVersion: 1,
    kind: 'action',
    label: 'Fixture action',
    placement: 'image.toolbar',
    run: fixtureActionRun,
  }),
]);
assert.deepEqual(actionFailures, []);
assert.equal(registry.getActionSnapshot().length, 1);
assert.equal(
  registry.getActionSnapshot()[0]!.run,
  fixtureActionRun,
);
registry.failModule(
  'retake.plugin.action-fixture',
  'fixture action crash',
);
assert.equal(
  registry.getActionSnapshot()[0]!.failure,
  'fixture action crash',
);

const malformedAction = registry.replace([
  actionSession('retake.plugin.malformed-action', {
    apiVersion: 1,
    kind: 'action',
    label: '',
    placement: 'image.toolbar',
    run: fixtureActionRun,
  }),
]);
assert.deepEqual(malformedAction, [{
  error: 'Plugin action contribution must use the Retake Image Toolbar Action V1 contract.',
  pluginModuleId: 'retake.plugin.malformed-action',
}]);
assert.equal(registry.getActionSnapshot().length, 0);

const malformedRenderer = registry.replace([
  rendererSession('retake.plugin.malformed-renderer', {
    component: FixtureRenderer,
    kind: 'renderer',
  }),
]);
assert.deepEqual(malformedRenderer, [{
  error: 'Plugin renderer contribution must use the Retake Block Renderer V1 contract.',
  pluginModuleId: 'retake.plugin.malformed-renderer',
}]);
assert.equal(registry.getRendererSnapshot().length, 0);

const unsupportedGroupRenderer = registry.replace([
  rendererSession('retake.plugin.group-renderer', {
    apiVersion: 1,
    component: FixtureRenderer,
    kind: 'renderer',
    placement: 'block.body',
    supportedBlockTypes: ['group'],
  }),
]);
assert.deepEqual(unsupportedGroupRenderer, [{
  error: 'Plugin renderer contribution must use the Retake Block Renderer V1 contract.',
  pluginModuleId: 'retake.plugin.group-renderer',
}]);
assert.equal(registry.getRendererSnapshot().length, 0);

const malformed = registry.replace([
  panelSession('retake.plugin.malformed-panel', {
    component: FixturePanel,
    kind: 'panel',
  }),
]);
assert.deepEqual(malformed, [{
  error: 'Plugin panel contribution must use the Retake Panel V1 contract.',
  pluginModuleId: 'retake.plugin.malformed-panel',
}]);
assert.equal(registry.getSnapshot().length, 0);
registry.replace([
  panelSession('retake.plugin.panel-fixture', {
    apiVersion: 1,
    component: FixturePanel,
    kind: 'panel',
    placement: 'workspace.overlay',
  }),
]);
registry.removeModule('retake.plugin.panel-fixture');
assert.equal(registry.getActionSnapshot().length, 0);
assert.equal(registry.getSnapshot().length, 0);
assert.equal(registry.getRendererSnapshot().length, 0);
unsubscribe();

process.stdout.write(`${JSON.stringify({
  imageToolbarActionContract: true,
  malformedPanelBecomesProtocolFailure: true,
  moduleFailureKeepsCoreFallbackDescriptor: true,
  moduleRemovalDetachesContributions: true,
  nativePanelContract: 'workspace.overlay',
  nativeRendererContract: 'block.body',
  rendererCannotReplaceCoreGroupShell: true,
  rendererFailureKeepsCoreBlockFallback: true,
  repeatedRegistrySnapshotDeduplicated: true,
  registryUsesExternalStoreSubscription: true,
})}\n`);

function panelSession(
  pluginModuleId: string,
  value: unknown,
): PluginContributionSessionV1 {
  return {
    activation: {
      contributions: [{
        contribution: {
          contributionId: `${pluginModuleId}.panel`,
          definitionHash: null,
          definitionPath: null,
          exportName: 'fixturePanel',
          kind: 'panel',
        },
        value,
      }],
    },
    host,
    record: { pluginModuleId },
  };
}

function actionSession(
  pluginModuleId: string,
  value: unknown,
): PluginContributionSessionV1 {
  return {
    activation: {
      contributions: [{
        contribution: {
          contributionId: `${pluginModuleId}.action`,
          definitionHash: null,
          definitionPath: null,
          exportName: 'fixtureAction',
          kind: 'action',
        },
        value,
      }],
    },
    host,
    record: { pluginModuleId },
  };
}

function rendererSession(
  pluginModuleId: string,
  value: unknown,
): PluginContributionSessionV1 {
  return {
    activation: {
      contributions: [{
        contribution: {
          contributionId: `${pluginModuleId}.renderer`,
          definitionHash: null,
          definitionPath: null,
          exportName: 'fixtureRenderer',
          kind: 'renderer',
        },
        value,
      }],
    },
    host,
    record: { pluginModuleId },
  };
}
