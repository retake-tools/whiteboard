import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React, { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { PluginRuntimeSnapshotV1 } from '@retake-tools/package-sdk';
import { createBlankBoardSnapshot } from '../src/core/application/createBlankBoardSnapshot';
import { createCanvasHost } from '../src/host-kit';
import type {
  HostPackageRuntimeAdapterV1,
  HostPackageRuntimeSnapshotV1,
} from '../src/host-kit';
import {
  CanvasHostProvider,
  CanvasSurface,
  createCanvasNodeProjector,
  type HostReactPluginSurfaceV1,
} from '../src/host-kit/react';
import {
  createNoopHostConnections,
  InMemoryHostStorageAdapter,
} from '../src/host-kit/testing';

const initial = createBlankBoardSnapshot({
  boardId: 'board_host_ui_v1',
  boardName: 'Host UI V1',
  projectId: 'project_host_ui_v1',
  projectName: 'Host UI Tests',
});
const host = await createCanvasHost({
  connections: createNoopHostConnections(),
  environment: {
    colorScheme: 'light',
    contrast: 'normal',
    direction: 'ltr',
    locale: 'en',
    reducedMotion: true,
    themeId: 'retake.test',
  },
  experience: {
    commandOverrides: [],
    profileId: 'retake.host.ui-test',
    schemaVersion: 1,
  },
  initialScope: {
    boardId: initial.board.boardId,
    projectId: initial.project.projectId,
  },
  packageRuntime: createFixturePackageRuntime(),
  storage: new InMemoryHostStorageAdapter([initial]),
});
const portableBlock = await host.commands.createBlock({
  body: 'Rendered without Whiteboard App shell.',
  title: 'Portable Canvas',
  type: 'text',
});

const pluginSurface: HostReactPluginSurfaceV1 = {
  commands: [{
    commandId: 'fixture.add-note',
    label: 'Add plugin note',
    async run(commands) {
      await commands.createBlock({
        body: 'Created by the fixture Plugin command.',
        title: 'Plugin note',
        type: 'text',
      });
    },
  }],
  renderers: [{
    rendererId: 'fixture.text-renderer',
    supportedBlockTypes: ['text'],
    render(block) {
      return createElement('strong', { 'data-fixture-renderer': true }, `Plugin: ${block.data.title}`);
    },
  }],
  revision: 'fixture:1',
};
await pluginSurface.commands[0]!.run(host.commands);
assert.equal(host.runtime.getSnapshot().pluginRuntime.modules.length, 1);
assert.equal(host.readModel.getSnapshot().blocks.length, 2);
const pluginBlock = host.readModel.getSnapshot().blocks.find(
  (block) => block.blockId !== portableBlock.blockId,
)!;
const group = await host.commands.createGroup({
  blockIds: [portableBlock.blockId, pluginBlock.blockId],
  title: 'Portable group',
});
const snapshot = host.readModel.getSnapshot();
const projected = createCanvasNodeProjector().project({
  assetById: new Map(),
  selectedIds: [],
  snapshot,
});
const projectedChild = projected.find((node) => node.id === portableBlock.blockId)!;
const durableChild = snapshot.blocks.find((block) => block.blockId === portableBlock.blockId)!;
assert.deepEqual(projectedChild.position, {
  x: durableChild.position.x - group.position.x,
  y: durableChild.position.y - group.position.y,
});
assert.equal(projected[0]?.id, group.blockId);

const markup = renderToStaticMarkup(
  <CanvasHostProvider host={host}>
    <CanvasSurface pluginSurface={pluginSurface} />
  </CanvasHostProvider>,
);
assert.match(markup, /retake-canvas-host/);
assert.match(markup, /Add plugin note/);
assert.match(markup, /data-fixture-renderer="true"/);
assert.match(markup, /Portable Canvas/);
assert.doesNotMatch(markup, /workspace-load-shell|top-bar|unified-composer/);

const css = readFileSync(
  new URL('../src/host-kit/styles/canvas-host.css', import.meta.url),
  'utf8',
);
assert.match(css, /^\.retake-canvas-host\s*\{/);
assert.doesNotMatch(css, /(^|[},]\s*)(:root|body|html|\*)\s*\{/m);

await host.dispose();
console.log({
  cssBytes: Buffer.byteLength(css),
  hostKitUiFixture: 'passed',
  markupBytes: Buffer.byteLength(markup),
  pluginModules: 1,
  groupedChildUsesRelativePosition: true,
});

function createFixturePackageRuntime(): HostPackageRuntimeAdapterV1 {
  const listeners = new Set<(snapshot: HostPackageRuntimeSnapshotV1) => void>();
  const runtime: PluginRuntimeSnapshotV1 = {
    modules: [{
      definitionHash: 'sha256:host-kit-ui-fixture',
      desiredState: 'enabled',
      failure: null,
      grant: null,
      manifest: {
        contributions: [{
          contributionId: 'fixture.text-renderer',
          exportName: 'activate',
          kind: 'renderer',
        }],
        definitionHash: 'sha256:host-kit-ui-fixture',
        description: 'Host Kit UI fixture Plugin.',
        name: 'Host Kit UI fixture',
        permissions: [],
        pluginModuleId: 'retake.plugin.host-kit-ui-fixture',
        runtime: {
          entrypoint: 'dist/index.js',
          hostApi: { maximumVersion: 2, minimumVersion: 2 },
          kind: 'web_module',
        },
        schemaVersion: 2,
        version: '0.1.0',
      },
      negotiatedHostApiVersion: 2,
      packageLock: {
        digest: `sha256:${'a'.repeat(64)}`,
        installationId: 'installation.host-kit-ui-fixture',
        packageId: 'retake.package.host-kit-ui-fixture',
        version: '0.1.0',
      },
      pluginModuleId: 'retake.plugin.host-kit-ui-fixture',
      publisherId: 'retake.publisher.fixture',
      status: 'enabled',
      trust: null,
      updatedAt: '2026-08-10T00:00:00.000Z',
    }],
    safeMode: false,
    schemaVersion: 1,
    updatedAt: '2026-08-10T00:00:00.000Z',
  };
  const snapshot = (): HostPackageRuntimeSnapshotV1 => ({
    failures: [],
    pluginRuntime: runtime,
    revision: runtime.updatedAt,
    schemaVersion: 1,
  });
  return {
    adapterVersion: 1,
    async bootstrap() { return snapshot(); },
    async dispose() { listeners.clear(); },
    async setScope() {
      const next = snapshot();
      for (const listener of listeners) listener(next);
      return next;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
