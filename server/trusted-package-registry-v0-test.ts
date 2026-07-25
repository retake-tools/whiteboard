import assert from 'node:assert/strict';
import {
  generateKeyPairSync,
  sign,
  type KeyObject,
} from 'node:crypto';
import {
  fetchTrustedRegistryCatalog,
  registryCatalogSigningBytes,
  retakeCanonicalJsonV1,
  trustedRegistryKeyId,
  verifyTrustedRegistryCatalog,
} from './trusted-package-registry-client';
import {
  resolveTrustedRegistryCandidate,
  trustedRegistryTargetUrl,
} from './trusted-package-registry-resolver';
import {
  trustedRegistryMaxCatalogBytes,
  type RegistryCatalogV1,
  type SignedRegistryCatalogV1,
  type TrustedRegistryRootV1,
} from './trusted-package-registry-contracts';

const now = new Date('2026-07-25T12:00:00.000Z');
const primary = registryKeyPair();
const secondary = registryKeyPair();
const outsider = registryKeyPair();
const root = registryRoot([primary], 1);
const catalog = registryCatalog();
const envelope = signedCatalog(catalog, [primary]);

const verified = verifyTrustedRegistryCatalog({
  envelope,
  now,
  root,
});
assert.equal(verified.verified, true);
assert.equal(verified.state.catalogVersion, catalog.catalogVersion);
assert.deepEqual(verified.validSignatureKeyIds, [primary.keyId]);
assert.equal(verified.state.releases.length, 3);

const rangeResolution = resolveTrustedRegistryCandidate({
  hostVersion: '0.1.2',
  packageId: 'retake.package.registry-demo',
  selector: { kind: 'range', range: '*' },
  verifiedCatalog: verified,
});
assert.equal(rangeResolution.status, 'resolved');
if (rangeResolution.status !== 'resolved') throw new Error('Range candidate expected.');
assert.equal(rangeResolution.candidate.version, '1.1.0');
assert.equal(rangeResolution.candidate.releaseStatus, 'deprecated');
assert.deepEqual(
  rangeResolution.candidate.warnings.map((warning) => warning.kind),
  ['deprecated', 'security_advisory'],
);
assert.equal(
  rangeResolution.candidate.targetUrl,
  `https://registry.example.test/v1/targets/sha256/${hex('b')}.retakepkg`,
);

const exactResolution = resolveTrustedRegistryCandidate({
  hostVersion: '0.1.2',
  packageId: 'retake.package.registry-demo',
  selector: { kind: 'exact', version: '1.1.0' },
  verifiedCatalog: verified,
});
assert.equal(exactResolution.status, 'resolved');
if (exactResolution.status !== 'resolved') throw new Error('Exact candidate expected.');
assert.deepEqual(exactResolution.candidate.publisher, {
  name: 'Registry Demo Publisher',
  publisherId: 'retake.publisher.registry-demo',
});

const channelBlocked = resolveTrustedRegistryCandidate({
  hostVersion: '0.1.2',
  packageId: 'retake.package.registry-demo',
  selector: { channel: 'stable', kind: 'channel' },
  verifiedCatalog: verified,
});
assert.deepEqual(channelBlocked, {
  advisoryIds: ['retake.advisory.registry-demo-critical'],
  packageId: 'retake.package.registry-demo',
  reason: 'security_advisory',
  status: 'blocked',
  version: '1.0.0',
});

const yanked = resolveTrustedRegistryCandidate({
  hostVersion: '0.1.2',
  packageId: 'retake.package.registry-demo',
  selector: { kind: 'exact', version: '1.2.0' },
  verifiedCatalog: verified,
});
assert.deepEqual(yanked, {
  advisoryIds: [],
  packageId: 'retake.package.registry-demo',
  reason: 'release_yanked',
  status: 'blocked',
  version: '1.2.0',
});

assert.deepEqual(resolveTrustedRegistryCandidate({
  hostVersion: '0.1.2',
  packageId: 'retake.package.missing',
  selector: { kind: 'range', range: '*' },
  verifiedCatalog: verified,
}), {
  packageId: 'retake.package.missing',
  reason: 'package_not_found',
  status: 'not_found',
});

const tamperedEnvelope = structuredClone(envelope);
tamperedEnvelope.signed.packages[0]!.description = 'Tampered after signing.';
assert.throws(
  () => verifyTrustedRegistryCatalog({ envelope: tamperedEnvelope, now, root }),
  /signature threshold/,
);

const unauthorizedEnvelope = signedCatalog(catalog, [outsider]);
assert.throws(
  () => verifyTrustedRegistryCatalog({ envelope: unauthorizedEnvelope, now, root }),
  /unauthorized key/,
);

const thresholdRoot = registryRoot([primary, secondary], 2);
assert.throws(
  () => verifyTrustedRegistryCatalog({ envelope, now, root: thresholdRoot }),
  /signature threshold/,
);
const thresholdEnvelope = signedCatalog(catalog, [primary, secondary]);
assert.equal(
  verifyTrustedRegistryCatalog({
    envelope: thresholdEnvelope,
    now,
    root: thresholdRoot,
  }).validSignatureKeyIds.length,
  2,
);

const mismatchedKeyRoot = structuredClone(root);
mismatchedKeyRoot.keys[0]!.keyId = digest('f');
mismatchedKeyRoot.roles.catalog.keyIds = [digest('f')];
assert.throws(
  () => verifyTrustedRegistryCatalog({ envelope, now, root: mismatchedKeyRoot }),
  /keyId does not match/,
);

const expiredRoot = structuredClone(root);
expiredRoot.expiresAt = '2026-07-25T11:59:59.000Z';
assert.throws(
  () => verifyTrustedRegistryCatalog({ envelope, now, root: expiredRoot }),
  /Root is expired/,
);
const expiredCatalog = structuredClone(catalog);
expiredCatalog.expiresAt = '2026-07-25T11:59:59.000Z';
expiredCatalog.issuedAt = '2026-07-24T00:00:00.000Z';
assert.throws(
  () => verifyTrustedRegistryCatalog({
    envelope: signedCatalog(expiredCatalog, [primary]),
    now,
    root,
  }),
  /catalog is expired/,
);

const rollbackCatalog = structuredClone(catalog);
rollbackCatalog.catalogVersion = catalog.catalogVersion - 1;
assert.throws(
  () => verifyTrustedRegistryCatalog({
    envelope: signedCatalog(rollbackCatalog, [primary]),
    now,
    previousState: verified.state,
    root,
  }),
  /catalog rollback/,
);

const equivocationCatalog = structuredClone(catalog);
equivocationCatalog.issuedAt = '2026-07-25T11:01:00.000Z';
assert.throws(
  () => verifyTrustedRegistryCatalog({
    envelope: signedCatalog(equivocationCatalog, [primary]),
    now,
    previousState: verified.state,
    root,
  }),
  /catalog equivocation/,
);

const immutableConflictCatalog = nextCatalog(catalog);
immutableConflictCatalog.packages[0]!.releases[0]!.digest = digest('e');
immutableConflictCatalog.packages[0]!.channels[0]!.digest = digest('e');
assert.throws(
  () => verifyTrustedRegistryCatalog({
    envelope: signedCatalog(immutableConflictCatalog, [primary]),
    now,
    previousState: verified.state,
    root,
  }),
  /immutable release conflict/,
);

const releaseRemovalCatalog = nextCatalog(catalog);
releaseRemovalCatalog.packages[0]!.releases.pop();
assert.throws(
  () => verifyTrustedRegistryCatalog({
    envelope: signedCatalog(releaseRemovalCatalog, [primary]),
    now,
    previousState: verified.state,
    root,
  }),
  /release removal/,
);

const invalidChannelCatalog = nextCatalog(catalog);
invalidChannelCatalog.packages[0]!.channels[0]!.digest = digest('e');
assert.throws(
  () => verifyTrustedRegistryCatalog({
    envelope: signedCatalog(invalidChannelCatalog, [primary]),
    now,
    root,
  }),
  /channel does not lock an active exact release/,
);

assert.throws(
  () => trustedRegistryTargetUrl(
    { ...root, baseUrl: 'http://registry.example.test/' },
    digest('a'),
  ),
  /HTTPS directory URL/,
);
assert.throws(
  () => verifyTrustedRegistryCatalog({
    envelope,
    now,
    root: { ...root, baseUrl: 'https://user:secret@registry.example.test/' },
  }),
  /HTTPS directory URL/,
);

let requestedUrl = '';
let requestedInit: RequestInit | undefined;
const fetched = await fetchTrustedRegistryCatalog({
  fetchImpl: (async (url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return jsonResponse(envelope);
  }) as typeof fetch,
  now,
  root,
});
assert.equal(requestedUrl, 'https://registry.example.test/v1/catalog.v1.json');
assert.equal(requestedInit?.credentials, 'omit');
assert.equal(requestedInit?.redirect, 'error');
assert.equal(fetched.state.catalogDigest, verified.state.catalogDigest);

await assert.rejects(
  fetchTrustedRegistryCatalog({
    fetchImpl: (async () => new Response('{}', {
      headers: { 'content-type': 'text/html' },
      status: 200,
    })) as typeof fetch,
    now,
    root,
  }),
  /Content-Type is invalid/,
);

await assert.rejects(
  fetchTrustedRegistryCatalog({
    fetchImpl: (async () => new Response('{}', {
      headers: {
        'content-length': String(trustedRegistryMaxCatalogBytes + 1),
        'content-type': 'application/json',
      },
      status: 200,
    })) as typeof fetch,
    now,
    root,
  }),
  /exceeds the byte limit/,
);

const oversizedStream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(new Uint8Array(trustedRegistryMaxCatalogBytes));
    controller.enqueue(new Uint8Array(1));
    controller.close();
  },
});
await assert.rejects(
  fetchTrustedRegistryCatalog({
    fetchImpl: (async () => new Response(oversizedStream, {
      headers: { 'content-type': 'application/json' },
      status: 200,
    })) as typeof fetch,
    now,
    root,
  }),
  /exceeds the byte limit/,
);

await assert.rejects(
  fetchTrustedRegistryCatalog({
    fetchImpl: (async () => ({
      arrayBuffer: async () => new ArrayBuffer(0),
      body: null,
      headers: new Headers({ 'content-type': 'application/json' }),
      ok: true,
      redirected: true,
      status: 200,
      url: 'https://other.example.test/catalog.v1.json',
    }) as Response) as typeof fetch,
    now,
    root,
  }),
  /redirects are not allowed/,
);

await assert.rejects(
  fetchTrustedRegistryCatalog({
    fetchImpl: ((_, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as typeof fetch,
    now,
    root,
    timeoutMs: 5,
  }),
  /request timed out/,
);

assert.equal(
  retakeCanonicalJsonV1({ z: 1, a: ['x', true] }),
  '{"a":["x",true],"z":1}',
);
assert.throws(() => retakeCanonicalJsonV1({ value: 1.5 }), /safe integers/);

console.log(JSON.stringify({
  ok: true,
  advisoryPolicies: {
    block: true,
    deprecatedWarning: true,
    yanked: true,
  },
  candidateSelectors: ['exact', 'range', 'channel'],
  canonicalSignedCatalog: true,
  derivedTargetUrlOnly: true,
  immutableReleaseHistory: true,
  networkBoundaries: {
    contentType: true,
    redirect: true,
    responseByteLimit: true,
    timeout: true,
  },
  repositoryTrust: {
    algorithm: 'ed25519',
    threshold: true,
  },
  workspaceWrites: 0,
}));

function registryKeyPair(): {
  keyId: string;
  privateKey: KeyObject;
  publicKeyPem: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' }).toString();
  return {
    keyId: trustedRegistryKeyId(publicKeyPem),
    privateKey,
    publicKeyPem,
  };
}

function registryRoot(
  keys: Array<{ keyId: string; publicKeyPem: string }>,
  threshold: number,
): TrustedRegistryRootV1 {
  return {
    baseUrl: 'https://registry.example.test/v1/',
    expiresAt: '2027-07-25T00:00:00.000Z',
    keys: keys.map((key) => ({
      algorithm: 'ed25519',
      keyId: key.keyId,
      publicKeyPem: key.publicKeyPem,
    })),
    registryId: 'retake.registry.official-test',
    roles: {
      catalog: {
        keyIds: keys.map((key) => key.keyId),
        threshold,
      },
    },
    rootVersion: 1,
    schemaVersion: 1,
  };
}

function registryCatalog(): RegistryCatalogV1 {
  return {
    advisories: [
      {
        advisoryId: 'retake.advisory.registry-demo-critical',
        affectedRange: '1.0.0',
        packageId: 'retake.package.registry-demo',
        policy: 'block',
        publishedAt: '2026-07-20T00:00:00.000Z',
        severity: 'critical',
        summary: 'The first release must not be newly installed.',
        updatedAt: '2026-07-20T00:00:00.000Z',
        url: 'https://registry.example.test/advisories/registry-demo-critical',
      },
      {
        advisoryId: 'retake.advisory.registry-demo-warning',
        affectedRange: '1.1.0',
        packageId: 'retake.package.registry-demo',
        policy: 'warn',
        publishedAt: '2026-07-21T00:00:00.000Z',
        severity: 'moderate',
        summary: 'Review this deprecated release before installing.',
        updatedAt: '2026-07-21T00:00:00.000Z',
      },
    ],
    catalogVersion: 3,
    expiresAt: '2026-08-25T00:00:00.000Z',
    issuedAt: '2026-07-25T11:00:00.000Z',
    packages: [{
      channels: [{
        archiveDigest: digest('a'),
        channel: 'stable',
        digest: digest('1'),
        version: '1.0.0',
      }],
      description: 'A declarative Registry contract fixture.',
      name: 'Registry Demo Package',
      packageId: 'retake.package.registry-demo',
      publisher: {
        name: 'Registry Demo Publisher',
        publisherId: 'retake.publisher.registry-demo',
      },
      releases: [
        release('1.0.0', '1', 'a', 'active'),
        release('1.1.0', '2', 'b', 'deprecated'),
        release('1.2.0', '3', 'c', 'yanked'),
      ],
    }],
    registryId: 'retake.registry.official-test',
    schemaVersion: 1,
    type: 'retake.registry.catalog',
  };
}

function release(
  version: string,
  contentCharacter: string,
  archiveCharacter: string,
  status: 'active' | 'deprecated' | 'yanked',
): RegistryCatalogV1['packages'][number]['releases'][number] {
  return {
    archiveDigest: digest(archiveCharacter),
    archiveSizeBytes: 4096,
    dependencies: [],
    digest: digest(contentCharacter),
    optionalDependencies: [],
    permissions: [],
    publishedAt: '2026-07-01T00:00:00.000Z',
    retakeHostCompatibility: '>=0.1.2 <0.2.0',
    status,
    version,
  };
}

function signedCatalog(
  value: RegistryCatalogV1,
  signers: Array<{ keyId: string; privateKey: KeyObject }>,
): SignedRegistryCatalogV1 {
  const signingBytes = registryCatalogSigningBytes(value);
  return {
    schemaVersion: 1,
    signatures: signers.map((signer) => ({
      algorithm: 'ed25519',
      keyId: signer.keyId,
      signatureBase64: sign(null, signingBytes, signer.privateKey).toString('base64'),
    })),
    signed: structuredClone(value),
  };
}

function nextCatalog(value: RegistryCatalogV1): RegistryCatalogV1 {
  const next = structuredClone(value);
  next.catalogVersion += 1;
  next.issuedAt = '2026-07-25T11:30:00.000Z';
  return next;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { 'content-type': 'application/vnd.retake.registry+json; charset=utf-8' },
    status: 200,
  });
}

function digest(character: string): string {
  return `sha256:${hex(character)}`;
}

function hex(character: string): string {
  return character.repeat(64);
}
