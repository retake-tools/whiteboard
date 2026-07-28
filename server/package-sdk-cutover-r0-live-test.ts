import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalPackageManagerService } from './local-package-manager-service';
import { installTrustedRegistryPackage } from './trusted-package-registry-installer';
import {
  TrustedPackageRegistryStateStore,
  fetchTrustedRegistryCatalogWithState,
} from './trusted-package-registry-state-store';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), 'retake-package-sdk-cutover-live-'),
);
try {
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  const root = JSON.parse(
    await readFile(
      path.join(
        repositoryRoot,
        'vendor',
        'package-toolchain',
        '0.1.1',
        'official-registry-root.v1.json',
      ),
      'utf8',
    ),
  ) as unknown;
  const stateStore = new TrustedPackageRegistryStateStore({ workspaceRoot });
  const verifiedCatalog = await fetchTrustedRegistryCatalogWithState({
    root,
    stateStore,
  });
  const manager = new LocalPackageManagerService({
    hostVersion: '0.1.2',
    workspaceRoot,
  });
  const installed = await installTrustedRegistryPackage({
    action: 'install',
    manager,
    packageId: 'retake.package.story-production-starter',
    selector: { channel: 'stable', kind: 'channel' },
    verifiedCatalog,
  });
  assert.equal(installed.registryId, 'retake.registry.official');
  assert.deepEqual(
    installed.installedCandidates.map((entry) => entry.packageId),
    [
      'retake.package.story-production-starter',
      'retake.package.story-production-agent',
    ],
  );
  assert.equal(installed.lockfile.resolvedPackages.length, 2);
  const runtimeRegistry = await manager.loadRegistry();
  assert.equal(runtimeRegistry.skills.size, 8);
  assert.equal(runtimeRegistry.workflows.size, 4);
  assert.equal(runtimeRegistry.agentPresets.size, 1);
  process.stdout.write(`${JSON.stringify({
    catalogVersion: installed.catalogVersion,
    installedCandidates: installed.installedCandidates,
    registryId: installed.registryId,
    runtimeProjection: {
      agentPresets: runtimeRegistry.agentPresets.size,
      skills: runtimeRegistry.skills.size,
      workflows: runtimeRegistry.workflows.size,
    },
  })}\n`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}
