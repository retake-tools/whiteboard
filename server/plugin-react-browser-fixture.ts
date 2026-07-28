import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  retakeWebPluginV1Toolchain,
} from '@retake-tools/package-sdk';
import {
  createBlockRecord,
  touchBoard,
} from '../src/core/blockFactory';
import { retakeRoot } from './local-store/context';
import {
  createAssetFromDataUrl,
  ensureDefaultSnapshot,
  saveSnapshot,
} from './local-store';
import { LocalPackageManagerService } from './local-package-manager-service';
import { PluginRuntimeService } from './plugin-runtime-service';

const fixtureWorkspaceName = '.retake-test-plugin-react-browser';
if (path.basename(retakeRoot) !== fixtureWorkspaceName) {
  throw new Error(
    `React Plugin browser fixture requires RETAKE_WORKSPACE_DIR=${
      fixtureWorkspaceName
    }.`,
  );
}

await rm(retakeRoot, { force: true, recursive: true });
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), 'retake-react-plugin-browser-'),
);
try {
  const sourceRoot = path.join(temporaryRoot, 'source');
  await writeReactPluginSource(sourceRoot);
  const manager = new LocalPackageManagerService({
    hostVersion: '0.1.2',
    workspaceRoot: retakeRoot,
  });
  await manager.install(sourceRoot);
  const runtime = new PluginRuntimeService({
    hostVersion: '0.1.2',
    workspaceRoot: retakeRoot,
  });
  const installed = await runtime.reconcile();
  const fixtureState = parseFixtureState(
    process.env.RETAKE_PLUGIN_RUNTIME_FIXTURE_STATE,
  );
  let record = installed.modules[0]!;
  if (fixtureState === 'enabled') {
    await runtime.grant({
      permissions: [
        'retake.asset.create',
        'retake.asset.read.bound',
        'retake.block.read.bound',
      ],
      pluginModuleId: 'retake.plugin.react-browser-fixture',
    });
    await runtime.trustUserCode('retake.plugin.react-browser-fixture');
    record = await runtime.enable(
      'retake.plugin.react-browser-fixture',
    );
  }
  const rendererBlockCount = await installRendererFixtureBlocks();
  process.stdout.write(`${JSON.stringify({
    digest: record.packageLock.digest,
    pluginModuleId: record.pluginModuleId,
    rendererBlockCount,
    status: record.status,
    workspaceRoot: retakeRoot,
  })}\n`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

function parseFixtureState(
  value: string | undefined,
): 'enabled' | 'installed' {
  if (!value || value === 'enabled') return 'enabled';
  if (value === 'installed') return 'installed';
  throw new Error(
    'RETAKE_PLUGIN_RUNTIME_FIXTURE_STATE must be enabled or installed.',
  );
}

async function writeReactPluginSource(sourceRoot: string): Promise<void> {
  await mkdir(path.join(sourceRoot, 'src'), { recursive: true });
  await writeJson(path.join(sourceRoot, 'retake.package.json'), {
    build: {
      entrypoint: 'src/index.tsx',
      profile: 'retake_web_plugin_v1',
      toolchain: retakeWebPluginV1Toolchain,
    },
    components: {
      agentPresets: [],
      pluginModules: [{
        definitionHash: 'sha256:react-browser-fixture-v1',
        definitionPath: 'retake.plugin.json',
        pluginModuleId: 'retake.plugin.react-browser-fixture',
        resourcePaths: [],
        version: '0.1.0',
      }],
      skills: [],
      workflows: [],
    },
    dependencies: [],
    description: 'Disposable React Host singleton browser fixture.',
    entrypoints: [],
    files: [
      'retake.plugin.json',
      'src/index.tsx',
    ],
    integrity: 'sha256:auto',
    license: 'MIT',
    name: 'React browser fixture',
    optionalDependencies: [],
    packageId: 'retake.package.react-browser-fixture',
    permissions: [],
    publisher: {
      name: 'Retake',
      publisherId: 'retake.publisher.official',
    },
    retakeHostCompatibility: '^0.1.0',
    schemaVersion: 1,
    signature: null,
    version: '0.1.0',
  });
  await writeJson(path.join(sourceRoot, 'retake.plugin.json'), {
    contributions: [
      {
        contributionId: 'retake.contribution.react-browser-fixture-command',
        exportName: 'fixtureCommand',
        kind: 'command',
      },
      {
        contributionId: 'retake.contribution.react-browser-fixture-panel',
        exportName: 'fixturePanel',
        kind: 'panel',
      },
      {
        contributionId: 'retake.contribution.react-browser-fixture-renderer',
        exportName: 'fixtureRenderer',
        kind: 'renderer',
      },
    ],
    definitionHash: 'sha256:react-browser-fixture-v1',
    description: {
      default: 'Disposable React Host singleton browser fixture.',
      locales: {
        'zh-CN': '一次性的 React Host 单例浏览器夹具。',
      },
    },
    name: {
      default: 'React browser fixture',
      locales: {
        'zh-CN': 'React 浏览器夹具',
      },
    },
    permissions: [
      'retake.asset.create',
      'retake.asset.read.bound',
      'retake.block.read.bound',
    ],
    pluginModuleId: 'retake.plugin.react-browser-fixture',
    runtime: {
      entrypoint: 'dist/index.js',
      hostApi: {
        maximumVersion: 2,
        minimumVersion: 2,
      },
      kind: 'web_module',
    },
    schemaVersion: 2,
    version: '0.1.0',
  });
  await writeFile(
    path.join(sourceRoot, 'src', 'index.tsx'),
    [
      "import React, { useState, useSyncExternalStore } from 'react';",
      "import { createPortal } from 'react-dom';",
      "import { createRoot } from 'react-dom/client';",
      "import { jsx } from 'react/jsx-runtime';",
      "import { jsxDEV } from 'react/jsx-dev-runtime';",
      "import { definePluginContribution } from '@retake/plugin-api';",
      '',
      'export function ReactBrowserFixturePanel({ host }: { host: {',
      '  assets: {',
      '    getBound(assetId: string): { assetId: string; previewUrl: string } | null;',
      '    importImage(input: { dataUrl: string; fileName?: string; height?: number; width?: number }): Promise<{ assetId: string; previewUrl: string }>;',
      '  };',
      '  environment: {',
      '    getSnapshot(): { locale: string; revision: string };',
      '    subscribe(listener: () => void): () => void;',
      '  };',
      '  getReadSnapshot(): { revision: string; selectedBlockIds: readonly string[] };',
      '  subscribeReadSnapshot(listener: () => void): () => void;',
      '} }) {',
      '  const [importedAsset, setImportedAsset] = useState<{ assetId: string; previewUrl: string } | null>(null);',
      '  const environment = useSyncExternalStore(',
      '    host.environment.subscribe,',
      '    host.environment.getSnapshot,',
      '    host.environment.getSnapshot,',
      '  );',
      '  const snapshot = useSyncExternalStore(',
      '    host.subscribeReadSnapshot,',
      '    host.getReadSnapshot,',
      '    host.getReadSnapshot,',
      '  );',
      '  if (globalThis.retakeReactPluginBrowserFixture?.crashPanel) {',
      '    throw new Error("fixture panel crash");',
      '  }',
      '  return <section data-retake-plugin="react-browser-fixture">',
      '    <output>{`${snapshot.revision}:${snapshot.selectedBlockIds.join(",")}`}</output>',
      '    <output data-plugin-locale>{environment.locale}</output>',
      '    <button type="button" onClick={async () => {',
      '      const asset = await host.assets.importImage({',
      '        dataUrl: "data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22%3E%3Crect width=%2216%22 height=%2216%22 fill=%22%2314b8a6%22/%3E%3C/svg%3E",',
      '        fileName: "plugin-fixture.svg",',
      '        height: 16,',
      '        width: 16,',
      '      });',
      '      setImportedAsset(asset);',
      '      globalThis.retakeReactPluginBrowserFixture.importedAsset = asset;',
      '    }}>Import fixture image</button>',
      '    {importedAsset ? <img alt="Imported fixture" height="16" src={importedAsset.previewUrl} width="16" /> : null}',
      '  </section>;',
      '}',
      '',
      'export const fixturePanel = definePluginContribution({',
      '  apiVersion: 1,',
      '  component: ReactBrowserFixturePanel,',
      '  kind: "panel",',
      '  placement: "workspace.overlay",',
      '});',
      '',
      'export function ReactBrowserFixtureRenderer({ block, selected }: {',
      '  block: { blockId: string; previewUrl?: string; title: string; type: string };',
      '  selected: boolean;',
      '}) {',
      '  if (globalThis.retakeReactPluginBrowserFixture?.crashRenderer) {',
      '    throw new Error("fixture renderer crash");',
      '  }',
      '  if (globalThis.retakeReactPluginBrowserFixture) {',
      '    globalThis.retakeReactPluginBrowserFixture.rendererRenderCount = (globalThis.retakeReactPluginBrowserFixture.rendererRenderCount ?? 0) + 1;',
      '  }',
      '  return <figure data-plugin-renderer-block={block.blockId} data-selected={selected ? "true" : "false"}>',
      '    {block.previewUrl ? <img alt={block.title} src={block.previewUrl} /> : null}',
      '    <figcaption>{`Plugin renderer: ${block.title}`}</figcaption>',
      '  </figure>;',
      '}',
      '',
      'export const fixtureRenderer = definePluginContribution({',
      '  apiVersion: 1,',
      '  component: ReactBrowserFixtureRenderer,',
      '  kind: "renderer",',
      '  placement: "block.body",',
      '  supportedBlockTypes: ["image"],',
      '});',
      '',
      'export const fixtureCommand = definePluginContribution({',
      '  apiVersion: 1,',
      '  commandId: "retake.contribution.react-browser-fixture-command",',
      '  contextKind: "image",',
      '  defaultBindings: [{ surfaceId: "image.context-toolbar" }],',
      '  kind: "command",',
      '  label: {',
      '    default: "Plugin download image",',
      '    locales: { "zh-CN": "插件下载图片" },',
      '  },',
      '  recommendedShortcuts: ["Mod+Shift+D"],',
      '  run({ block, host }: {',
      '    block: { assetId: string; blockId: string; title: string };',
      '    host: { assets: { getBound(assetId: string): { assetId: string; previewUrl: string } | null } };',
      '  }) {',
      '    if (globalThis.retakeReactPluginBrowserFixture?.crashAction) {',
      '      throw new Error("fixture action crash");',
      '    }',
      '    const asset = host.assets.getBound(block.assetId);',
      '    if (!asset) throw new Error("fixture action asset is not bound");',
      '    const link = document.createElement("a");',
      '    link.href = asset.previewUrl;',
      '    link.download = `${block.title}.svg`;',
      '    document.body.append(link);',
      '    link.click();',
      '    link.remove();',
      '    const fixture = globalThis.retakeReactPluginBrowserFixture;',
      '    fixture.commandInvocationCount = (fixture.commandInvocationCount ?? 0) + 1;',
      '    fixture.lastCommandAssetId = asset.assetId;',
      '  },',
      '});',
      '',
      'export function activate(context: { host: {',
      '  assets: {',
      '    getBound(assetId: string): { assetId: string; previewUrl: string } | null;',
      '    importImage(input: { dataUrl: string; fileName?: string; height?: number; width?: number }): Promise<{ assetId: string; previewUrl: string }>;',
      '  };',
      '  getReadSnapshot(): { revision: string; selectedBlockIds: readonly string[] };',
      '  subscribeReadSnapshot(listener: () => void): () => void;',
      '} }) {',
      '  const hostReact = globalThis.retakePluginHostExternalsV2.react;',
      '  globalThis.retakeReactPluginBrowserFixture = {',
      '    activationCount: 1,',
      '    createElementIdentity: React.createElement === hostReact.createElement,',
      '    createPortalType: typeof createPortal,',
      '    createRootType: typeof createRoot,',
      '    jsxDevType: typeof jsxDEV,',
      '    jsxElementType: jsx("span", { children: "fixture" }).type,',
      '    revision: context.host.getReadSnapshot().revision,',
      '    selectedBlockIds: context.host.getReadSnapshot().selectedBlockIds,',
      '    version: React.version,',
      '  };',
      '  const unsubscribe = context.host.subscribeReadSnapshot(() => {',
      '    const snapshot = context.host.getReadSnapshot();',
      '    globalThis.retakeReactPluginBrowserFixture.revision = snapshot.revision;',
      '    globalThis.retakeReactPluginBrowserFixture.selectedBlockIds = snapshot.selectedBlockIds;',
      '  });',
      '  return { dispose() {',
      '    unsubscribe();',
      '    delete globalThis.retakeReactPluginBrowserFixture;',
      '  } };',
      '}',
      '',
    ].join('\n'),
  );
}

async function installRendererFixtureBlocks(): Promise<number> {
  const rendererBlockCount = parseRendererBlockCount(
    process.env.RETAKE_PLUGIN_RENDERER_BLOCK_COUNT,
  );
  const snapshot = await ensureDefaultSnapshot();
  const asset = await createAssetFromDataUrl({
    dataUrl: [
      'data:image/svg+xml,',
      '%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 ',
      'width=%22320%22 height=%22200%22%3E',
      '%3Crect width=%22320%22 height=%22200%22 fill=%22%230f172a%22/%3E',
      '%3Ccircle cx=%22160%22 cy=%22100%22 r=%2260%22 fill=%22%2314b8a6%22/%3E',
      '%3C/svg%3E',
    ].join(''),
    fileName: 'plugin-renderer-fixture.svg',
    height: 200,
    kind: 'image',
    projectId: snapshot.project.projectId,
    width: 320,
  });
  snapshot.assets.push(asset);
  for (let index = 0; index < rendererBlockCount; index += 1) {
    const block = createBlockRecord(snapshot, 'image');
    block.blockId = index === 0
      ? 'block_plugin_renderer_fixture'
      : `block_plugin_renderer_fixture_${index + 1}`;
    block.position = {
      x: 340 + (index % 10) * 340,
      y: -150 + Math.floor(index / 10) * 280,
    };
    block.size = { width: 320, height: 260 };
    block.data = {
      assetId: asset.assetId,
      previewUrl: asset.previewUrl,
      rendererContributionId:
        'retake.contribution.react-browser-fixture-renderer',
      title: index === 0
        ? 'Native Plugin Renderer'
        : `Native Plugin Renderer ${index + 1}`,
    };
    snapshot.blocks.push(block);
  }
  touchBoard(snapshot);
  await saveSnapshot(snapshot);
  return rendererBlockCount;
}

function parseRendererBlockCount(value: string | undefined): number {
  if (value === undefined) return 1;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new Error(
      'RETAKE_PLUGIN_RENDERER_BLOCK_COUNT must be between 1 and 500.',
    );
  }
  return parsed;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
