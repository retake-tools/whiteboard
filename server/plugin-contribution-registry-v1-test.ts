import assert from 'node:assert/strict';
import type {
  PluginHostApiV2,
} from '@retake-tools/package-sdk';
import {
  createPluginContributionRegistry,
  type PluginContributionSessionV1,
} from '../src/core/pluginContributionRegistry';
import {
  capabilityDefinitionFor,
} from '../src/core/capabilityRegistry';

const host: PluginHostApiV2 = {
  assets: {
    getBound: () => null,
    importImage: async () => {
      throw new Error('Fixture does not import assets.');
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
    subscribe: () => () => {},
  },
  execution: {
    listConnections: () => [],
    run: async () => {
      throw new Error('Fixture does not run executions.');
    },
    runConnected: async () => {
      throw new Error('Fixture does not run connected executions.');
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
  version: 2,
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
    apiVersion: 2,
    icon: 'annotation',
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
assert.equal(
  registry.getActionSnapshot()[0]?.placement === 'image.toolbar'
    ? registry.getActionSnapshot()[0].icon
    : null,
  'annotation',
);
registry.failModule(
  'retake.plugin.action-fixture',
  'fixture action crash',
);
assert.equal(
  registry.getActionSnapshot()[0]!.failure,
  'fixture action crash',
);

const selectionActionFailures = registry.replace([
  actionSession('retake.plugin.selection-action-fixture', {
    apiVersion: 2,
    kind: 'action',
    label: 'Fixture selection action',
    placement: 'selection.toolbar',
    run: fixtureActionRun,
    selectionCount: {
      max: 2,
      min: 2,
    },
  }),
]);
assert.deepEqual(selectionActionFailures, []);
assert.equal(registry.getActionSnapshot().length, 1);
assert.equal(
  registry.getActionSnapshot()[0]?.placement,
  'selection.toolbar',
);
assert.deepEqual(
  registry.getActionSnapshot()[0]?.placement === 'selection.toolbar'
    ? registry.getActionSnapshot()[0].selectionCount
    : null,
  { max: 2, min: 2 },
);
assert.equal(
  Object.isFrozen(
    registry.getActionSnapshot()[0]?.placement === 'selection.toolbar'
      ? registry.getActionSnapshot()[0].selectionCount
      : null,
  ),
  true,
);

const malformedAction = registry.replace([
  actionSession('retake.plugin.malformed-action', {
    apiVersion: 2,
    kind: 'action',
    label: '',
    placement: 'image.toolbar',
    run: fixtureActionRun,
  }),
]);
assert.deepEqual(malformedAction, [{
  error: 'Plugin action contribution must use a Retake Toolbar Action V2 contract.',
  pluginModuleId: 'retake.plugin.malformed-action',
}]);
assert.equal(registry.getActionSnapshot().length, 0);

const malformedActionIcon = registry.replace([
  actionSession('retake.plugin.malformed-action-icon', {
    apiVersion: 2,
    icon: 'same-icon-for-everything',
    kind: 'action',
    label: 'Invalid icon',
    placement: 'image.toolbar',
    run: fixtureActionRun,
  }),
]);
assert.deepEqual(malformedActionIcon, [{
  error: 'Plugin action contribution must use a Retake Toolbar Action V2 contract.',
  pluginModuleId: 'retake.plugin.malformed-action-icon',
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

const fixtureCapability = {
  apiVersion: 2,
  definition: {
    capabilityId: 'image.local_adjust',
    category: 'image_editing',
    definitionHash: 'sha256:plugin-local-adjust-fixture-v1',
    displayName: {
      default: 'Plugin local adjustment',
      locales: {
        'zh-CN': '插件局部调整',
      },
    },
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
};
const capabilityFailures = registry.replace([
  capabilitySession(
    'retake.plugin.capability-fixture',
    fixtureCapability,
  ),
]);
assert.deepEqual(capabilityFailures, []);
assert.equal(registry.getCapabilitySnapshot().length, 1);
assert.equal(
  registry.ownsCapability(
    'retake.plugin.capability-fixture',
    'image.local_adjust',
  ),
  true,
);
assert.equal(
  capabilityDefinitionFor('image.local_adjust').definitionHash,
  fixtureCapability.definition.definitionHash,
);
registry.setLocale('zh-CN');
assert.equal(
  capabilityDefinitionFor('image.local_adjust').displayName,
  '插件局部调整',
);
const operationActionFailures = registry.replace([
  capabilitySession(
    'retake.plugin.operation-action-fixture',
    fixtureCapability,
  ),
  actionSession('retake.plugin.operation-action-fixture', {
    apiVersion: 2,
    kind: 'action',
    label: {
      default: 'Reopen edit',
      locales: { 'zh-CN': '重新编辑' },
    },
    placement: 'operation.inspector',
    run: fixtureActionRun,
    supportedCapabilityIds: ['image.local_adjust'],
  }),
]);
assert.deepEqual(operationActionFailures, []);
assert.equal(
  registry.getActionSnapshot()[0]?.placement,
  'operation.inspector',
);

const capabilityConflictFailures = registry.replace([
  capabilitySession(
    'retake.plugin.capability-fixture-a',
    fixtureCapability,
  ),
  capabilitySession(
    'retake.plugin.capability-fixture-b',
    fixtureCapability,
  ),
]);
assert.deepEqual(
  capabilityConflictFailures.map((failure) => failure.pluginModuleId),
  [
    'retake.plugin.capability-fixture-a',
    'retake.plugin.capability-fixture-b',
  ],
);
assert.equal(registry.getCapabilitySnapshot().length, 0);
assert.throws(
  () => capabilityDefinitionFor('image.local_adjust'),
  /Unknown legacy capability/,
);

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
assert.equal(registry.getCapabilitySnapshot().length, 0);
assert.equal(registry.getSnapshot().length, 0);
assert.equal(registry.getRendererSnapshot().length, 0);
unsubscribe();

process.stdout.write(`${JSON.stringify({
  capabilityConflictDisablesAllProviders: true,
  capabilityRegistrationRequiresActiveProvider: true,
  imageToolbarActionContract: true,
  imageSelectionToolbarActionContract: true,
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

function capabilitySession(
  pluginModuleId: string,
  value: typeof fixtureCapability,
): PluginContributionSessionV1 {
  return {
    activation: {
      contributions: [{
        contribution: {
          contributionId: `${pluginModuleId}.capability`,
          definitionHash: value.definition.definitionHash,
          definitionPath: 'definitions/image.local_adjust.json',
          exportName: 'fixtureCapability',
          kind: 'capability',
        },
        value,
      }],
    },
    host,
    record: { pluginModuleId },
  };
}
