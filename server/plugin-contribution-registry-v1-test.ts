import assert from 'node:assert/strict';
import type {
  PluginHostApiV1,
} from '@retake-tools/package-sdk';
import {
  createPluginContributionRegistry,
  type PluginContributionSessionV1,
} from '../src/core/pluginContributionRegistry';

const host: PluginHostApiV1 = {
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
assert.equal(registry.getSnapshot().length, 0);
unsubscribe();

process.stdout.write(`${JSON.stringify({
  malformedPanelBecomesProtocolFailure: true,
  moduleFailureKeepsCoreFallbackDescriptor: true,
  moduleRemovalDetachesContributions: true,
  nativePanelContract: 'workspace.overlay',
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
