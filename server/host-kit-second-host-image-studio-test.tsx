import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readDeterministicPackageArchive } from '@retake-tools/package-archive';
import {
  retakePluginModuleManifestV2Schema,
} from '@retake-tools/package-contracts';
import type {
  PluginModuleRuntimeRecordV1,
  PluginRuntimeSnapshotV1,
} from '@retake-tools/package-sdk';
import { activatePluginWebModule } from '@retake-tools/plugin-runtime';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createPluginContributionRegistry,
  createPluginHostReadStore,
  createPluginWebModuleRuntime,
} from '../src/host-kit/plugin';
import { PluginPanelSurface } from '../src/host-kit/plugin-react';

const repositoryRoot = process.cwd();
const archivePath = path.join(
  repositoryRoot,
  'packages/bootstrap/image-studio-0.12.6.retakepkg',
);
const bootstrap = JSON.parse(await readFile(
  path.join(repositoryRoot, 'packages/bootstrap/retake.bootstrap.json'),
  'utf8',
)) as {
  packages: Array<{
    archiveDigest: string;
    digest: string;
    packageId: string;
    version: string;
  }>;
};
const reference = bootstrap.packages.find(
  (candidate) => candidate.packageId === 'design.retake.image-studio',
);
assert(reference, 'The exact Image Studio bootstrap reference is missing.');
const archive = await readFile(archivePath);
assert.equal(
  `sha256:${createHash('sha256').update(archive).digest('hex')}`,
  reference.archiveDigest,
);
const files = readDeterministicPackageArchive(archive);
const manifest = retakePluginModuleManifestV2Schema.parse(
  JSON.parse(requiredFile(files, 'retake.plugin.json').toString('utf8')),
);
const moduleBytes = requiredFile(files, manifest.runtime.entrypoint);

const temporaryRoot = await mkdtemp(
  path.join(repositoryRoot, '.retake-test-second-host-image-studio-'),
);
try {
  const modulePath = path.join(temporaryRoot, 'image-studio.mjs');
  await writeFile(modulePath, moduleBytes);
  const namespace = await import(
    `${pathToFileURL(modulePath).href}?digest=${encodeURIComponent(reference.digest)}`
  );
  const registry = createPluginContributionRegistry();
  const importedAssetIds: string[] = [];
  const readStore = createPluginHostReadStore({
    boardId: 'board.second-host',
    boundAssetIds: ['asset.source'],
    boundBlockIds: ['block.source'],
    boundGroupIds: [],
    projectId: 'project.second-host',
    revision: 'revision-1',
    selectedBlockIds: ['block.source'],
  }, {
    authorizeExecution: (pluginModuleId, capabilityId) => (
      registry.ownsCapability(pluginModuleId, capabilityId)
    ),
    async importImage(input) {
      const assetId = `asset.imported-${importedAssetIds.length + 1}`;
      importedAssetIds.push(assetId);
      return {
        assetId,
        createdAt: '2026-08-12T00:00:00.000Z',
        height: input.height,
        kind: 'image',
        mimeType: input.dataUrl.slice(5, input.dataUrl.indexOf(';')),
        previewUrl: input.dataUrl,
        projectId: input.projectId,
        storageKey: `second-host/${assetId}`,
        storageProvider: 'custom',
        width: input.width,
      };
    },
  });
  readStore.update(readStore.host(2, manifest.pluginModuleId).getReadSnapshot(), [{
    assetId: 'asset.source',
    createdAt: '2026-08-12T00:00:00.000Z',
    height: 768,
    kind: 'image',
    mimeType: 'image/png',
    previewUrl: 'data:image/png;base64,AA==',
    projectId: 'project.second-host',
    storageKey: 'second-host/asset.source',
    storageProvider: 'custom',
    width: 1024,
  }]);
  readStore.setConnectionLister(({ capabilityId, projectId }) => (
    capabilityId === 'image.annotation_edit'
    && projectId === 'project.second-host'
      ? [{
          connectionId: 'connection.direct-api-fixture',
          displayName: 'Direct API fixture',
          modelLabel: 'fixture-model',
          providerLabel: 'Fixture Provider',
          selectedByDefault: true,
        }]
      : []
  ));
  let connectedExecutionCapability = '';
  readStore.setExecutionRunner(async (request) => {
    connectedExecutionCapability = request.input.capabilityId;
    if (request.kind === 'connected') {
      assert.equal(request.importedAssets.length, 1);
      return {
        capabilityId: request.input.capabilityId,
        connectionId: request.input.connectionId
          ?? 'connection.direct-api-fixture',
        executionId: 'execution.second-host',
        outputBlockIds: ['block.result'],
        status: 'queued',
      };
    }
    return {
      capabilityId: request.input.capabilityId,
      executionId: 'execution.local-second-host',
      outputAssetIds: ['asset.local-result'],
      outputBlockIds: ['block.local-result'],
      status: 'succeeded',
    };
  });

  const record = runtimeRecord(manifest, reference);
  const runtimeSnapshot = {
    modules: [record],
    safeMode: false,
    schemaVersion: 1,
    updatedAt: '2026-08-12T00:00:00.000Z',
  } satisfies PluginRuntimeSnapshotV1;
  const moduleRuntime = createPluginWebModuleRuntime();
  const reconciled = await moduleRuntime.reconcile({
    activate: (candidate, host) => activatePluginWebModule({
      host,
      manifest: candidate.manifest,
      module: namespace,
      packageDigest: candidate.packageLock.digest,
    }),
    createHost: (candidate) => readStore.host(
      candidate.negotiatedHostApiVersion!,
      candidate.pluginModuleId,
      candidate.manifest.permissions,
    ),
    snapshot: runtimeSnapshot,
    validateSessions: (sessions) => registry.replace(sessions),
  });
  assert.equal(reconciled.failures.length, 0);
  assert.equal(reconciled.sessions.length, 1);
  assert.equal(registry.getCapabilitySnapshot().length, 7);
  assert.equal(registry.getCommandSnapshot().length, 6);
  assert.equal(registry.getSnapshot().length, 5);
  await readStore.setSettingsDefinitions(
    registry.getSettingsSnapshot().map((entry) => ({
      definition: entry.definition,
      pluginModuleId: entry.pluginModuleId,
    })),
  );

  const adjust = registry.getCommandSnapshot().find(
    (command) => command.commandId
      === 'design.retake.image-studio.command.adjust',
  );
  assert(adjust && adjust.contextKind === 'image');
  await registry.invoke(adjust, {
    block: {
      assetId: 'asset.source',
      blockId: 'block.source',
      previewUrl: 'data:image/png;base64,AA==',
      title: 'Second Host source',
      type: 'image',
    },
    host: adjust.host,
    kind: 'image',
  });
  const markup = renderToStaticMarkup(createElement(PluginPanelSurface, {
    registry,
  }));
  assert.match(markup, /data-retake-image-studio="adjust"/);
  assert.match(markup, /data-retake-plugin-slot="workspace.overlay"/);

  const pluginHost = reconciled.sessions[0]!.host;
  const composite = await pluginHost.assets.importImage({
    dataUrl: 'data:image/png;base64,AQ==',
    fileName: 'annotation-composite.png',
    height: 768,
    width: 1024,
  });
  assert.equal(composite.assetId, 'asset.imported-1');
  assert.equal(
    pluginHost.execution.listConnections({
      capabilityId: 'image.annotation_edit',
    })[0]?.connectionId,
    'connection.direct-api-fixture',
  );
  const connected = await pluginHost.execution.runConnected({
    capabilityId: 'image.annotation_edit',
    connectionId: 'connection.direct-api-fixture',
    inputs: [
      { blockId: 'block.source', slotId: 'source_image' },
      { assetId: composite.assetId, slotId: 'annotated_composite' },
    ],
    parameters: { schemaVersion: 1 },
    prompt: 'Apply the visible annotations without changing other content.',
  });
  assert.equal(connected.executionId, 'execution.second-host');
  assert.equal(connectedExecutionCapability, 'image.annotation_edit');

  await moduleRuntime.disposeAll();
  assert.equal(registry.getSnapshot().length, 5);
  process.stdout.write(`${JSON.stringify({
    archiveDigest: reference.archiveDigest,
    capabilities: 7,
    commands: 6,
    connectedExecution: connected.executionId,
    exactImageStudioVersion: reference.version,
    panels: 5,
    secondHostPrivateImports: 0,
  })}\n`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

function requiredFile(
  files: ReadonlyMap<string, Buffer>,
  filePath: string,
): Buffer {
  const value = files.get(filePath);
  assert(value, `Packaged Image Studio file is missing: ${filePath}`);
  return value;
}

function runtimeRecord(
  manifest: ReturnType<typeof retakePluginModuleManifestV2Schema.parse>,
  reference: {
    digest: string;
    packageId: string;
    version: string;
  },
): PluginModuleRuntimeRecordV1 {
  return {
    definitionHash: manifest.definitionHash,
    desiredState: 'enabled',
    failure: null,
    grant: {
      grantId: 'grant.second-host',
      grantedAt: '2026-08-12T00:00:00.000Z',
      grantedBy: 'user',
      permissions: [...manifest.permissions],
      pluginModuleId: manifest.pluginModuleId,
      publisherId: 'retake.publisher.official',
      schemaVersion: 1,
    },
    manifest,
    negotiatedHostApiVersion: 2,
    packageLock: {
      digest: reference.digest,
      installationId: 'installation.second-host',
      packageId: reference.packageId,
      version: reference.version,
    },
    pluginModuleId: manifest.pluginModuleId,
    publisherId: 'retake.publisher.official',
    status: 'enabled',
    trust: {
      definitionHash: manifest.definitionHash,
      packageDigest: reference.digest,
      pluginModuleId: manifest.pluginModuleId,
      publisherId: 'retake.publisher.official',
      schemaVersion: 1,
      trustChannel: 'bundled_official',
      trustedAt: '2026-08-12T00:00:00.000Z',
      trustedBy: 'system',
      trustId: 'trust.second-host',
      updatePolicy: 'exact_digest',
    },
    updatedAt: '2026-08-12T00:00:00.000Z',
  };
}
