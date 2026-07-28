import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  retakeWebPluginExternalModuleSpecifiers,
} from '@retake-tools/package-sdk';
import {
  pluginHostExternalModuleSource,
  retakePluginExternalModulePaths,
} from './plugin-host-external-modules';
import {
  installPluginHostExternals,
} from '../src/core/pluginHostExternals';

installPluginHostExternals();
const indexHtml = await readFile(
  new URL('../index.html', import.meta.url),
  'utf8',
);

for (const specifier of retakeWebPluginExternalModuleSpecifiers) {
  const modulePath = retakePluginExternalModulePaths[specifier];
  assert.ok(modulePath, `Missing Host path for ${specifier}`);
  assert.match(
    indexHtml,
    new RegExp(
      `${escapeRegExp(JSON.stringify(specifier))}\\s*:\\s*${escapeRegExp(
        JSON.stringify(`/api/local${modulePath}`),
      )}`,
    ),
  );
  const source = pluginHostExternalModuleSource(modulePath);
  assert.ok(source, `Missing Host module source for ${specifier}`);
  const namespace = await import(
    `data:text/javascript;base64,${
      Buffer.from(source).toString('base64')
    }`
  );
  if (specifier !== '@retake/plugin-api') {
    assert.ok(namespace.default);
  }
}

const reactSource = pluginHostExternalModuleSource(
  retakePluginExternalModulePaths.react,
)!;
const reactNamespace = await import(
  `data:text/javascript;base64,${
    Buffer.from(reactSource).toString('base64')
  }`
);
assert.equal(
  reactNamespace.createElement,
  globalThis.retakePluginHostExternalsV1!.react.createElement,
);

const pluginApiSource = pluginHostExternalModuleSource(
  retakePluginExternalModulePaths['@retake/plugin-api'],
)!;
const pluginApi = await import(
  `data:text/javascript;base64,${
    Buffer.from(pluginApiSource).toString('base64')
  }`
);
const contribution = { component: 'fixture', kind: 'panel' };
assert.equal(pluginApi.definePluginContribution(contribution), contribution);
for (const helper of [
  'defineCapability',
  'defineCommand',
  'defineMessages',
  'definePanel',
  'definePlugin',
  'defineRenderer',
  'defineSettings',
] as const) {
  assert.equal(pluginApi[helper](contribution), contribution);
}
assert.equal(pluginApi.pluginApiVersion, 1);
assert.equal(pluginApi.version, 1);
assert.equal(
  pluginHostExternalModuleSource('/plugin-runtime/externals/v1/missing.js'),
  undefined,
);

process.stdout.write(`${JSON.stringify({
  browserImportMapCoversBuildExternals: true,
  pluginApiIdentityHelpers: true,
  pluginApiVersion: pluginApi.pluginApiVersion,
  reactHostSingletonIdentity: true,
  singletonExternalCount: retakeWebPluginExternalModuleSpecifiers.length,
})}\n`);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
