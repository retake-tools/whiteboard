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
import { retakeRoot } from './local-store/context';
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
  await runtime.reconcile();
  await runtime.grant({
    permissions: ['retake.block.read.bound'],
    pluginModuleId: 'retake.plugin.react-browser-fixture',
  });
  await runtime.trustUserCode('retake.plugin.react-browser-fixture');
  const enabled = await runtime.enable(
    'retake.plugin.react-browser-fixture',
  );
  process.stdout.write(`${JSON.stringify({
    digest: enabled.packageLock.digest,
    pluginModuleId: enabled.pluginModuleId,
    status: enabled.status,
    workspaceRoot: retakeRoot,
  })}\n`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
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
    contributions: [{
      contributionId: 'retake.contribution.react-browser-fixture-panel',
      definitionHash: null,
      definitionPath: null,
      exportName: 'fixturePanel',
      kind: 'panel',
    }],
    definitionHash: 'sha256:react-browser-fixture-v1',
    description: 'Disposable React Host singleton browser fixture.',
    name: 'React browser fixture',
    permissions: ['retake.block.read.bound'],
    pluginModuleId: 'retake.plugin.react-browser-fixture',
    runtime: {
      entrypoint: 'dist/index.js',
      hostApi: {
        maximumVersion: 1,
        minimumVersion: 1,
      },
      kind: 'web_module',
    },
    schemaVersion: 1,
    version: '0.1.0',
  });
  await writeFile(
    path.join(sourceRoot, 'src', 'index.tsx'),
    [
      "import React, { useSyncExternalStore } from 'react';",
      "import { createPortal } from 'react-dom';",
      "import { createRoot } from 'react-dom/client';",
      "import { jsx } from 'react/jsx-runtime';",
      "import { jsxDEV } from 'react/jsx-dev-runtime';",
      "import { definePluginContribution } from '@retake/plugin-api';",
      '',
      'export function ReactBrowserFixturePanel({ host }: { host: {',
      '  getReadSnapshot(): { revision: string; selectedBlockIds: readonly string[] };',
      '  subscribeReadSnapshot(listener: () => void): () => void;',
      '} }) {',
      '  const snapshot = useSyncExternalStore(',
      '    host.subscribeReadSnapshot,',
      '    host.getReadSnapshot,',
      '    host.getReadSnapshot,',
      '  );',
      '  if (globalThis.retakeReactPluginBrowserFixture?.crashPanel) {',
      '    throw new Error("fixture panel crash");',
      '  }',
      '  return <output data-retake-plugin="react-browser-fixture">{`${snapshot.revision}:${snapshot.selectedBlockIds.join(",")}`}</output>;',
      '}',
      '',
      'export const fixturePanel = definePluginContribution({',
      '  apiVersion: 1,',
      '  component: ReactBrowserFixturePanel,',
      '  kind: "panel",',
      '  placement: "workspace.overlay",',
      '});',
      '',
      'export function activate(context: { host: {',
      '  getReadSnapshot(): { revision: string; selectedBlockIds: readonly string[] };',
      '  subscribeReadSnapshot(listener: () => void): () => void;',
      '} }) {',
      '  const hostReact = globalThis.retakePluginHostExternalsV1.react;',
      '  globalThis.retakeReactPluginBrowserFixture = {',
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

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
