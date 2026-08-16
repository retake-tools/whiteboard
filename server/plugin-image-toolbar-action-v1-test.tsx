import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import type {
  PluginHostApiV2,
} from '@retake-tools/package-sdk';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  PluginImageToolbarActions,
  waitForPluginImageToolbarBlockBinding,
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
} from '../src/host-kit/plugin';
import {
  commandShortcutFromKeyboardEvent,
} from '../src/app/useCanvasController';
import { I18nProvider } from '../src/i18n';
import type {
  AssetRecord,
  BlockRecord,
  ExecutionRecord,
} from '../src/core/types';

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: () => 'en',
    setItem: () => undefined,
  },
});
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { language: 'en-US' },
});

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
      contrast: 'normal',
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
  settings: {
    getSnapshot: () => null,
    subscribe: () => () => undefined,
    update: async () => {
      throw new Error('Command fixture does not update settings.');
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
        exportName: 'fixtureCommand',
        kind: 'command',
      },
      value: {
        apiVersion: 1,
        commandId: 'retake.contribution.download-fixture',
        contextKind: 'image',
        defaultBindings: [{
          surfaceId: 'image.context-toolbar',
        }],
        icon: 'adjustments',
        kind: 'command',
        label: 'Download with Plugin',
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
assert.match(markup, /lucide-sliders-horizontal/);
assert.match(markup, />Download with Plugin</);
assert.match(markup, /<button/);

const unavailableRegistry = createPluginContributionRegistry();
assert.deepEqual(unavailableRegistry.replace([{
  activation: {
    contributions: [{
      contribution: {
        contributionId: 'retake.contribution.unavailable-fixture',
        exportName: 'unavailableFixtureCommand',
        kind: 'command',
      },
      value: {
        apiVersion: 1,
        availability: () => ({
          enabled: false,
          reason: 'Add an image connection first.',
          visible: true,
        }),
        commandId: 'retake.contribution.unavailable-fixture',
        contextKind: 'image',
        defaultBindings: [{ surfaceId: 'image.context-toolbar' }],
        icon: 'smart-edit',
        kind: 'command',
        label: 'Connected edit',
        run: () => undefined,
      },
    }],
  },
  host,
  record: { pluginModuleId: 'retake.plugin.unavailable-fixture' },
}]), []);
const unavailableMenuMarkup = renderToStaticMarkup(
  <I18nProvider>
    <PluginImageToolbarActions
      assetId="asset.fixture"
      blockId="block.fixture"
      onOpenSettings={() => undefined}
      registry={unavailableRegistry}
      title="Fixture image"
      variant="menu"
    />
  </I18nProvider>,
);
assert.match(unavailableMenuMarkup, /Connected edit/);
assert.match(unavailableMenuMarkup, /Add an image connection first\./);
assert.match(unavailableMenuMarkup, />Open settings</);

const emptyMarkup = renderToStaticMarkup(
  <PluginImageToolbarActions
    assetId="asset.fixture"
    blockId="block.fixture"
    title="Fixture image"
  />,
);
assert.equal(emptyMarkup, '');

let bindingSnapshot = {
  ...host.getReadSnapshot(),
  boundBlockIds: [] as string[],
  selectedBlockIds: [] as string[],
};
let bindingListener: (() => void) | undefined;
let bindingUnsubscribed = false;
const bindingHost: PluginHostApiV2 = {
  ...host,
  getReadSnapshot: () => bindingSnapshot,
  subscribeReadSnapshot: (listener) => {
    bindingListener = listener;
    return () => {
      bindingUnsubscribed = true;
      bindingListener = undefined;
    };
  },
};
const bindingReady = waitForPluginImageToolbarBlockBinding(
  bindingHost,
  'block.hovered',
  100,
);
assert.equal(typeof bindingListener, 'function');
bindingSnapshot = {
  ...bindingSnapshot,
  boundBlockIds: ['block.hovered'],
  selectedBlockIds: ['block.hovered'],
};
bindingListener?.();
await bindingReady;
assert.equal(bindingUnsubscribed, true);
const canvasSource = await readFile(
  new URL('../src/app/WhiteboardCanvas.tsx', import.meta.url),
  'utf8',
);
const toolbarStyles = await readFile(
  new URL('../src/styles/toolbars.css', import.meta.url),
  'utf8',
);
const contextToolbarSource = await readFile(
  new URL('../src/components/ContextToolbar.tsx', import.meta.url),
  'utf8',
);
const imageContextMenuSource = await readFile(
  new URL('../src/components/ImageContextCommandMenu.tsx', import.meta.url),
  'utf8',
);
const imageContextMenuStyles = await readFile(
  new URL('../src/components/image-context-command-menu.css', import.meta.url),
  'utf8',
);
const pluginPanelHostSource = await readFile(
  new URL('../src/components/PluginPanelHost.tsx', import.meta.url),
  'utf8',
);
const pluginPanelHostStyles = await readFile(
  new URL('../src/components/plugin-panel-host.css', import.meta.url),
  'utf8',
);
const pluginImageToolbarSource = await readFile(
  new URL('../src/components/PluginImageToolbarActions.tsx', import.meta.url),
  'utf8',
);
assert.match(pluginImageToolbarSource, /await onInvoke\?\.\(\)/);
assert.match(canvasSource, /onBeforeImagePluginAction/);
assert.match(canvasSource, /suspendInspectorNavigation/);
assert.doesNotMatch(canvasSource, /setInspectorBlockId\(undefined\)/);
assert.match(canvasSource, /hoveredImageBlockId/);
assert.match(canvasSource, /handleCanvasPointerMove/);
assert.match(canvasSource, /onFocusCapture=\{handleCanvasFocus\}/);
assert.match(canvasSource, /image-context-toolbar-bridge/);
assert.match(canvasSource, /pointerEvents: 'all'/);
assert.match(canvasSource, /startExistingOperationBlock/);
assert.match(canvasSource, /onRegenerate=\{imageToolbarOperation/);
assert.match(contextToolbarSource, /pluginMenuActions/);
assert.match(imageContextMenuSource, /context\.regenerate/);
assert.match(imageContextMenuStyles, /\.image-context-primary-action/);
assert.match(imageContextMenuStyles, /min-height: 44px/);
assert.match(imageContextMenuStyles, /transform: translateX\(-50%\);/);
assert.doesNotMatch(contextToolbarSource, /canvasZoom|context-popover-scale/);
assert.doesNotMatch(imageContextMenuStyles, /context-popover-scale/);
assert.doesNotMatch(toolbarStyles, /context-popover-scale/);
assert.doesNotMatch(contextToolbarSource, /quick-edit|create-similar/);
assert.match(toolbarStyles, /\.image-context-toolbar-bridge\s*\{[\s\S]*pointer-events: auto/);
assert.match(pluginPanelHostSource, /plugin-panel-host nodrag nopan nowheel/);
assert.match(pluginPanelHostSource, /hasVisiblePanel/);
assert.match(pluginPanelHostSource, /isVisiblePanelElement/);
assert.match(pluginPanelHostSource, /presentation=\{presentation\}/);
assert.match(pluginPanelHostSource, /onVisibilityChange/);
assert.match(pluginPanelHostSource, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/);
assert.match(pluginPanelHostSource, /onWheel=\{\(event\) => event\.stopPropagation\(\)\}/);
assert.match(pluginPanelHostStyles, /max-width: calc\(100vw - 32px\)/);
assert.match(pluginPanelHostStyles, /\.plugin-panel-host__panel:empty\s*\{[^}]*display: none/s);
assert.match(pluginPanelHostStyles, /\.plugin-panel-host\.is-focus-editor/);

const selectionRegistry = createPluginContributionRegistry();
assert.deepEqual(selectionRegistry.replace([{
  activation: {
    contributions: [{
      contribution: {
        contributionId: 'retake.contribution.selection-fixture',
        exportName: 'fixtureSelectionCommand',
        kind: 'command',
      },
      value: {
        apiVersion: 1,
        availability: ({ blocks }: { blocks: readonly unknown[] }) => ({
          enabled: blocks.length === 2,
          visible: blocks.length === 2,
        }),
        commandId: 'retake.contribution.selection-fixture',
        contextKind: 'selection',
        defaultBindings: [{
          surfaceId: 'selection.context-toolbar',
        }],
        icon: 'smart-edit',
        kind: 'command',
        label: 'Edit selected pair',
        run: () => undefined,
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
assert.match(selectionMarkup, /lucide-wand-sparkles/);
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
        exportName: 'fixtureOperationCommand',
        kind: 'command',
      },
      value: {
        apiVersion: 1,
        commandId: 'retake.contribution.operation-fixture',
        contextKind: 'operation',
        defaultBindings: [{
          surfaceId: 'operation.inspector',
        }],
        kind: 'command',
        label: {
          default: 'Reopen edit',
          locales: { 'zh-CN': '重新编辑' },
        },
        ownedCapabilityId: 'image.annotation_edit',
        run: () => undefined,
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
assert.equal(commandShortcutFromKeyboardEvent({
  altKey: false,
  ctrlKey: false,
  key: 'a',
  metaKey: true,
  shiftKey: true,
}), 'Mod+Shift+A');
assert.equal(commandShortcutFromKeyboardEvent({
  altKey: false,
  ctrlKey: false,
  key: 'Escape',
  metaKey: false,
  shiftKey: false,
}), null);

process.stdout.write(`${JSON.stringify({
  commandRendersInsideCoreImageToolbar: true,
  hoverAndFocusPreviewToolbar: true,
  hoverCommandWaitsForBoundScope: true,
  missingRegistryKeepsCoreToolbarOnly: true,
  declaredToolbarActionIcons: true,
  operationInspectorProjectsCurrentSourceOnly: true,
  selectionCommandUsesAvailabilityContract: true,
  shortcutEventsUseCanonicalCommandKeys: true,
})}\n`);
