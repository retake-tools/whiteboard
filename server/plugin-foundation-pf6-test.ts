import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  retakeWebPluginV1Toolchain,
} from '@retake-tools/package-sdk';
import {
  handlePackageDevelopmentRequest,
} from './package-development-api';
import {
  PackageDevelopmentService,
  type PackageDevelopmentSnapshotV1,
} from './package-development-service';
import { PluginRuntimeService } from './plugin-runtime-service';
import {
  resolveCandidateActivationDecision,
} from '../src/core/pluginDevelopmentActivation';
import type {
  PackageDevelopmentLinkV1 as BrowserPackageDevelopmentLinkV1,
} from '../src/core/packageLifecycleContracts';

const temporaryRoot = await mkdtemp(
  path.join(tmpdir(), 'retake-whiteboard-pf6-'),
);
try {
  const sourceRoot = path.join(temporaryRoot, 'linked-source');
  const workspaceRoot = path.join(temporaryRoot, 'workspace');
  await createFixture(sourceRoot);
  let invalidations = 0;
  const service = new PackageDevelopmentService({
    hostVersion: '0.1.2',
    onChange: () => {
      invalidations += 1;
    },
    workspaceRoot,
  });

  const denied = await request(service, {
    action: 'link',
    confirmTrust: false,
    sourceRoot,
  });
  assert.equal(denied.statusCode, 400);

  const linked = await service.link(sourceRoot, true);
  const linkId = linked.links[0]!.linkId;
  await service.setWatching(linkId, false);
  assert.equal(JSON.stringify(linked).includes(sourceRoot), false);
  assert.equal(
    JSON.stringify(linked).includes('sourceIdentity'),
    false,
  );
  const firstLastGood = linked.links[0]!.lastGood;

  const initialRuntime = await new PluginRuntimeService({
    hostVersion: '0.1.2',
    workspaceRoot,
  }).reconcile();
  assert.equal(
    initialRuntime.modules[0]?.trust?.trustChannel,
    'linked_source',
  );

  await writeFile(
    path.join(sourceRoot, 'src', 'index.ts'),
    'export const linkedValue = 2;\n',
  );
  const stagedResult = await request(service, {
    action: 'rebuild',
    linkId,
  });
  assert.equal(stagedResult.statusCode, undefined);
  const staged = stagedResult.value as PackageDevelopmentSnapshotV1;
  const candidate = staged.links[0]!.candidate;
  assert.ok(candidate);
  assert.equal(staged.links[0]!.lastGood.digest, firstLastGood.digest);
  assert.notEqual(candidate.lastGood.digest, firstLastGood.digest);

  const candidateRuntime = await new PluginRuntimeService({
    hostVersion: '0.1.2',
    workspaceRoot,
  }).reconcile();
  assert.equal(
    candidateRuntime.modules[0]?.packageLock.digest,
    candidate.lastGood.digest,
  );
  assert.equal(
    candidateRuntime.modules[0]?.trust?.trustChannel,
    'linked_source',
  );
  const emptyActivationResult = {
    activated: [],
    failures: [],
    fallbacks: [],
    sessions: [],
  };
  assert.equal(resolveCandidateActivationDecision({
    effectiveSnapshot: candidateRuntime,
    link: staged.links[0] as BrowserPackageDevelopmentLinkV1,
    result: emptyActivationResult,
  }).accept, true);
  assert.equal(resolveCandidateActivationDecision({
    effectiveSnapshot: {
      ...candidateRuntime,
      modules: candidateRuntime.modules.map((record) => ({
        ...record,
        status: 'enabled',
      })),
    },
    link: staged.links[0] as BrowserPackageDevelopmentLinkV1,
    result: emptyActivationResult,
  }).accept, false);

  const acceptedResult = await request(service, {
    action: 'accept_candidate',
    digest: candidate.lastGood.digest,
    linkId,
  });
  const accepted = acceptedResult.value as PackageDevelopmentSnapshotV1;
  assert.equal(accepted.links[0]!.candidate, null);
  assert.equal(
    accepted.links[0]!.lastGood.digest,
    candidate.lastGood.digest,
  );

  await writeFile(
    path.join(sourceRoot, 'src', 'index.ts'),
    'export const broken = ;\n',
  );
  const failed = await service.rebuild(linkId);
  assert.equal(failed.links[0]!.status, 'failed');
  assert.equal(
    failed.links[0]!.lastGood.digest,
    candidate.lastGood.digest,
  );
  assert.match(failed.links[0]!.error ?? '', /Expected expression|Unexpected/);
  await service.unlink(linkId, 'retain');
  assert.ok(invalidations >= 4);

  process.stdout.write(`${JSON.stringify({
    browserProjectionHidesTrustedSourcePath: true,
    candidateTrustUsesExactLinkedDigest: true,
    disabledCandidateNeedsNoVisibleActivation: true,
    controlledBuildFailureRetainsLastGood: true,
    explicitSourceTrustRequired: true,
    stagedCandidateRequiresActivationResolution: true,
    workspaceWrites: 'disposable-only',
  })}\n`);
} finally {
  await rm(temporaryRoot, { force: true, recursive: true });
}

async function request(
  service: PackageDevelopmentService,
  body: unknown,
) {
  const result = await handlePackageDevelopmentRequest({
    method: 'POST',
    pathname: '/package-development',
    readBody: async () => body,
    service,
  });
  assert.equal(result.handled, true);
  if (!result.handled) throw new Error('PF6 request was not handled.');
  return result;
}

async function createFixture(sourceRoot: string): Promise<void> {
  await mkdir(path.join(sourceRoot, 'src'), { recursive: true });
  await writeJson(path.join(sourceRoot, 'retake.package.json'), {
    build: {
      entrypoint: 'src/index.ts',
      profile: 'retake_web_plugin_v1',
      toolchain: retakeWebPluginV1Toolchain,
    },
    components: {
      agentPresets: [],
      pluginModules: [{
        definitionHash: 'sha256:whiteboard-pf6-plugin-v1',
        definitionPath: 'retake.plugin.json',
        pluginModuleId: 'retake.plugin.whiteboard-pf6-fixture',
        resourcePaths: [],
        version: '0.1.0',
      }],
      skills: [],
      workflows: [],
    },
    dependencies: [],
    description: 'Whiteboard PF6 fixture.',
    entrypoints: [],
    files: ['retake.plugin.json', 'src/index.ts'],
    integrity: 'sha256:auto',
    license: 'MIT',
    name: 'Whiteboard PF6 Fixture',
    optionalDependencies: [],
    packageId: 'retake.package.whiteboard-pf6-fixture',
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
    contributions: [],
    definitionHash: 'sha256:whiteboard-pf6-plugin-v1',
    description: 'Whiteboard PF6 PluginModule fixture.',
    name: 'Whiteboard PF6 Plugin',
    permissions: ['retake.asset.read.bound'],
    pluginModuleId: 'retake.plugin.whiteboard-pf6-fixture',
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
    path.join(sourceRoot, 'src', 'index.ts'),
    'export const linkedValue = 1;\n',
  );
  assert.equal(
    JSON.parse(
      await readFile(
        path.join(sourceRoot, 'retake.package.json'),
        'utf8',
      ),
    ).schemaVersion,
    1,
  );
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}
