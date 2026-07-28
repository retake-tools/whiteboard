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
const fixtureCommandRun = () => undefined;
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

const commandFailures = registry.replace([
  commandSession('retake.plugin.command-fixture', {
    apiVersion: 1,
    commandId: 'retake.plugin.command-fixture.command',
    contextKind: 'image',
    defaultBindings: [{
      order: 20,
      surfaceId: 'image.context-toolbar',
    }],
    icon: 'annotation',
    kind: 'command',
    label: 'Fixture command',
    recommendedShortcuts: ['Mod+Shift+F'],
    run: fixtureCommandRun,
  }),
]);
assert.deepEqual(commandFailures, []);
assert.equal(registry.getCommandSnapshot().length, 1);
assert.equal(
  registry.getCommandSnapshot()[0]!.run,
  fixtureCommandRun,
);
assert.equal(
  registry.getCommandSnapshot()[0]?.icon,
  'annotation',
);
assert.equal(
  registry.commandsForSurface('image.context-toolbar')[0]?.commandId,
  'retake.plugin.command-fixture.command',
);
assert.deepEqual(
  registry.availability(
    registry.getCommandSnapshot()[0]!,
    {
      block: {
        assetId: 'asset.fixture',
        blockId: 'block.fixture',
        title: 'Fixture',
      },
      host,
      kind: 'image',
    },
  ),
  { enabled: true, visible: true },
);
assert.deepEqual(registry.getShortcutResolution().bindings, [
  {
    commandId: 'retake.plugin.command-fixture.command',
    shortcut: 'Mod+Shift+F',
    source: 'plugin',
  },
  {
    commandId: 'retake.command.redo',
    shortcut: 'Mod+Shift+Z',
    source: 'host',
  },
  {
    commandId: 'retake.command.redo',
    shortcut: 'Mod+Y',
    source: 'host',
  },
  {
    commandId: 'retake.command.undo',
    shortcut: 'Mod+Z',
    source: 'host',
  },
]);
const shortcutConflictRegistry = createPluginContributionRegistry();
assert.deepEqual(shortcutConflictRegistry.replace([
  commandSession('retake.plugin.shortcut-conflict', {
    apiVersion: 1,
    commandId: 'retake.plugin.shortcut-conflict.command',
    contextKind: 'image',
    defaultBindings: [{ surfaceId: 'image.context-toolbar' }],
    kind: 'command',
    label: 'Shortcut conflict',
    recommendedShortcuts: ['Mod+Z'],
    run: fixtureCommandRun,
  }),
]), []);
assert.deepEqual(shortcutConflictRegistry.getShortcutResolution().conflicts, [{
  commandIds: ['retake.plugin.shortcut-conflict.command'],
  reason: 'reserved_by_host',
  shortcut: 'Mod+Z',
}]);
assert.equal(
  shortcutConflictRegistry.getShortcutResolution().bindings.some(
    (binding) => (
      binding.commandId === 'retake.plugin.shortcut-conflict.command'
    ),
  ),
  false,
);
registry.failModule(
  'retake.plugin.command-fixture',
  'fixture command crash',
);
assert.equal(
  registry.getCommandSnapshot()[0]!.failure,
  'fixture command crash',
);

const selectionCommandFailures = registry.replace([
  commandSession('retake.plugin.selection-command-fixture', {
    apiVersion: 1,
    availability: ({ blocks }: { blocks: readonly unknown[] }) => ({
      enabled: blocks.length === 2,
      visible: blocks.length === 2,
    }),
    commandId: 'retake.plugin.selection-command-fixture.command',
    contextKind: 'selection',
    defaultBindings: [{
      surfaceId: 'selection.context-toolbar',
    }],
    kind: 'command',
    label: 'Fixture selection command',
    run: fixtureCommandRun,
  }),
]);
assert.deepEqual(selectionCommandFailures, []);
assert.equal(registry.getCommandSnapshot().length, 1);
assert.equal(
  registry.commandsForSurface('selection.context-toolbar')[0]?.contextKind,
  'selection',
);
registry.setCommandExperience([{
  commandId: 'retake.plugin.selection-command-fixture.command',
  hidden: true,
}]);
assert.equal(
  registry.commandsForSurface('selection.context-toolbar').length,
  0,
);
registry.setCommandExperience([]);

const malformedCommand = registry.replace([
  commandSession('retake.plugin.malformed-command', {
    apiVersion: 1,
    commandId: 'retake.plugin.malformed-command.command',
    contextKind: 'image',
    defaultBindings: [{ surfaceId: 'image.context-toolbar' }],
    kind: 'command',
    label: '',
    run: fixtureCommandRun,
  }),
]);
assert.deepEqual(malformedCommand, [{
  error: 'Plugin command contribution must use the Retake Command V1 contract.',
  pluginModuleId: 'retake.plugin.malformed-command',
}]);
assert.equal(registry.getCommandSnapshot().length, 0);

const malformedCommandIcon = registry.replace([
  commandSession('retake.plugin.malformed-command-icon', {
    apiVersion: 1,
    commandId: 'retake.plugin.malformed-command-icon.command',
    contextKind: 'image',
    defaultBindings: [{ surfaceId: 'image.context-toolbar' }],
    icon: 'same-icon-for-everything',
    kind: 'command',
    label: 'Invalid icon',
    run: fixtureCommandRun,
  }),
]);
assert.deepEqual(malformedCommandIcon, [{
  error: 'Plugin command contribution must use the Retake Command V1 contract.',
  pluginModuleId: 'retake.plugin.malformed-command-icon',
}]);
assert.equal(registry.getCommandSnapshot().length, 0);

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
const operationCommandFailures = registry.replace([
  capabilitySession(
    'retake.plugin.operation-command-fixture',
    fixtureCapability,
  ),
  commandSession('retake.plugin.operation-command-fixture', {
    apiVersion: 1,
    commandId: 'retake.plugin.operation-command-fixture.command',
    contextKind: 'operation',
    defaultBindings: [{ surfaceId: 'operation.inspector' }],
    kind: 'command',
    label: {
      default: 'Reopen edit',
      locales: { 'zh-CN': '重新编辑' },
    },
    ownedCapabilityId: 'image.local_adjust',
    run: fixtureCommandRun,
  }),
]);
assert.deepEqual(operationCommandFailures, []);
assert.equal(
  registry.commandsForSurface('operation.inspector')[0]?.ownedCapabilityId,
  'image.local_adjust',
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
assert.equal(registry.getCommandSnapshot().length, 0);
assert.equal(registry.getCapabilitySnapshot().length, 0);
assert.equal(registry.getSnapshot().length, 0);
assert.equal(registry.getRendererSnapshot().length, 0);
unsubscribe();

process.stdout.write(`${JSON.stringify({
  capabilityConflictDisablesAllProviders: true,
  capabilityRegistrationRequiresActiveProvider: true,
  commandExperienceOverridesAreHostOwned: true,
  imageContextToolbarCommandContract: true,
  imageSelectionContextToolbarCommandContract: true,
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

function commandSession(
  pluginModuleId: string,
  value: unknown,
): PluginContributionSessionV1 {
  return {
    activation: {
      contributions: [{
        contribution: {
          contributionId: `${pluginModuleId}.command`,
          exportName: 'fixtureCommand',
          kind: 'command',
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
