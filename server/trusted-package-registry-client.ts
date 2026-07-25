import {
  createHash,
  createPublicKey,
  verify,
  type KeyObject,
} from 'node:crypto';
import {
  comparePackageVersions,
} from './package-semver';
import {
  parseSignedRegistryCatalog,
  parseTrustedRegistryRoot,
  parseTrustedRegistryState,
  trustedRegistryCatalogPath,
  trustedRegistryMaxCatalogBytes,
  validateRegistryRootBaseUrl,
  type RegistryCatalogV1,
  type TrustedRegistryRootV1,
  type TrustedRegistryStateV1,
} from './trusted-package-registry-contracts';

const catalogSignatureDomain = 'RETAKE-REGISTRY-CATALOG-V1\n';
const defaultCatalogTimeoutMs = 10_000;

export interface VerifiedTrustedRegistryCatalog {
  catalog: RegistryCatalogV1;
  root: TrustedRegistryRootV1;
  state: TrustedRegistryStateV1;
  validSignatureKeyIds: string[];
  verified: true;
}

export async function fetchTrustedRegistryCatalog(input: {
  fetchImpl?: typeof fetch;
  now?: Date;
  previousState?: TrustedRegistryStateV1;
  root: unknown;
  timeoutMs?: number;
}): Promise<VerifiedTrustedRegistryCatalog> {
  const root = parseAndValidateRoot(input.root, input.now);
  const catalogUrl = new URL(trustedRegistryCatalogPath, validateRegistryRootBaseUrl(root.baseUrl));
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    input.timeoutMs ?? defaultCatalogTimeoutMs,
  );
  try {
    let response: Response;
    try {
      response = await (input.fetchImpl ?? fetch)(catalogUrl, {
        credentials: 'omit',
        headers: {
          accept: 'application/vnd.retake.registry+json, application/json',
        },
        redirect: 'error',
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Trusted Registry catalog request timed out.');
      throw new Error(`Trusted Registry catalog request failed: ${errorMessage(error)}`);
    }
    if (!response.ok) {
      throw new Error(`Trusted Registry catalog request failed with HTTP ${response.status}.`);
    }
    if (response.redirected) throw new Error('Trusted Registry catalog redirects are not allowed.');
    if (response.url && response.url !== catalogUrl.href) {
      throw new Error('Trusted Registry catalog response origin or path changed.');
    }
    const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim();
    if (
      contentType !== 'application/json'
      && contentType !== 'application/vnd.retake.registry+json'
    ) throw new Error('Trusted Registry catalog Content-Type is invalid.');
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > trustedRegistryMaxCatalogBytes) {
      throw new Error('Trusted Registry catalog exceeds the byte limit.');
    }
    let bytes: Uint8Array;
    try {
      bytes = await readLimitedResponseBytes(response, trustedRegistryMaxCatalogBytes);
    } catch (error) {
      if (controller.signal.aborted) throw new Error('Trusted Registry catalog request timed out.');
      throw error;
    }
    let envelope: unknown;
    try {
      envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
    } catch {
      throw new Error('Trusted Registry catalog is not valid UTF-8 JSON.');
    }
    return verifyTrustedRegistryCatalog({
      envelope,
      now: input.now,
      previousState: input.previousState,
      root,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function verifyTrustedRegistryCatalog(input: {
  envelope: unknown;
  now?: Date;
  previousState?: TrustedRegistryStateV1;
  root: unknown;
}): VerifiedTrustedRegistryCatalog {
  const root = parseAndValidateRoot(input.root, input.now);
  const envelope = parseSignedRegistryCatalog(input.envelope);
  const previousState = input.previousState
    ? parseTrustedRegistryState(input.previousState)
    : undefined;
  const now = input.now ?? new Date();
  if (envelope.signed.registryId !== root.registryId) {
    throw new Error('Trusted Registry catalog registryId does not match its Root.');
  }
  if (Date.parse(envelope.signed.expiresAt) <= now.getTime()) {
    throw new Error('Trusted Registry catalog is expired.');
  }
  const rootKeys = validatedRootKeys(root);
  const allowedKeyIds = new Set(root.roles.catalog.keyIds);
  const signingBytes = registryCatalogSigningBytes(envelope.signed);
  const validSignatureKeyIds: string[] = [];
  for (const signature of envelope.signatures) {
    if (!allowedKeyIds.has(signature.keyId)) {
      throw new Error(`Trusted Registry catalog uses an unauthorized key: ${signature.keyId}`);
    }
    const key = rootKeys.get(signature.keyId);
    if (!key) throw new Error(`Trusted Registry catalog key is unavailable: ${signature.keyId}`);
    const signatureBytes = decodeBase64(signature.signatureBase64);
    if (verify(null, signingBytes, key, signatureBytes)) {
      validSignatureKeyIds.push(signature.keyId);
    }
  }
  if (validSignatureKeyIds.length < root.roles.catalog.threshold) {
    throw new Error('Trusted Registry catalog signature threshold is not satisfied.');
  }
  const catalogState = trustedStateFor(root, envelope.signed);
  assertTrustedStateTransition(previousState, catalogState);
  const state = mergeTrustedReleaseHistory(previousState, catalogState);
  return {
    catalog: structuredClone(envelope.signed),
    root: structuredClone(root),
    state,
    validSignatureKeyIds: [...validSignatureKeyIds].sort(compareText),
    verified: true,
  };
}

export function trustedRegistryKeyId(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Trusted Registry key must be Ed25519.');
  }
  const der = key.export({ format: 'der', type: 'spki' });
  return `sha256:${createHash('sha256').update(der).digest('hex')}`;
}

export function registryCatalogSigningBytes(catalog: RegistryCatalogV1): Uint8Array {
  return new TextEncoder().encode(
    `${catalogSignatureDomain}${retakeCanonicalJsonV1(catalog)}`,
  );
}

export function retakeCanonicalJsonV1(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      throw new Error('Retake Canonical JSON V1 only supports safe integers.');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => retakeCanonicalJsonV1(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => {
        if (entry === undefined) {
          throw new Error('Retake Canonical JSON V1 does not support undefined.');
        }
        return `${JSON.stringify(key)}:${retakeCanonicalJsonV1(entry)}`;
      })
      .join(',')}}`;
  }
  throw new Error(`Retake Canonical JSON V1 does not support ${typeof value}.`);
}

function parseAndValidateRoot(input: unknown, now = new Date()): TrustedRegistryRootV1 {
  const root = parseTrustedRegistryRoot(input);
  validateRegistryRootBaseUrl(root.baseUrl);
  if (Date.parse(root.expiresAt) <= now.getTime()) {
    throw new Error('Trusted Registry Root is expired.');
  }
  validatedRootKeys(root);
  return root;
}

function validatedRootKeys(root: TrustedRegistryRootV1): Map<string, KeyObject> {
  const keys = new Map<string, KeyObject>();
  for (const entry of root.keys) {
    const key = createPublicKey(entry.publicKeyPem);
    const keyId = trustedRegistryKeyId(entry.publicKeyPem);
    if (keyId !== entry.keyId) {
      throw new Error(`Trusted Registry keyId does not match its public key: ${entry.keyId}`);
    }
    keys.set(entry.keyId, key);
  }
  return keys;
}

function trustedStateFor(
  root: TrustedRegistryRootV1,
  catalog: RegistryCatalogV1,
): TrustedRegistryStateV1 {
  return {
    catalogDigest: sha256Digest(retakeCanonicalJsonV1(catalog)),
    catalogExpiresAt: catalog.expiresAt,
    catalogVersion: catalog.catalogVersion,
    registryId: catalog.registryId,
    releases: catalog.packages.flatMap((registryPackage) => (
      registryPackage.releases.map((release) => ({
        archiveDigest: release.archiveDigest,
        digest: release.digest,
        packageId: registryPackage.packageId,
        version: release.version,
      }))
    )).sort(compareReleaseState),
    rootVersion: root.rootVersion,
    schemaVersion: 1,
  };
}

function assertTrustedStateTransition(
  previous: TrustedRegistryStateV1 | undefined,
  next: TrustedRegistryStateV1,
): void {
  if (!previous) return;
  if (previous.registryId !== next.registryId) {
    throw new Error('Trusted Registry state belongs to a different Registry.');
  }
  if (next.rootVersion < previous.rootVersion) {
    throw new Error('Trusted Registry Root rollback detected.');
  }
  if (next.catalogVersion < previous.catalogVersion) {
    throw new Error('Trusted Registry catalog rollback detected.');
  }
  if (
    next.catalogVersion === previous.catalogVersion
    && next.catalogDigest !== previous.catalogDigest
  ) throw new Error('Trusted Registry catalog equivocation detected.');
  const nextReleases = new Map(
    next.releases.map((release) => [`${release.packageId}@${release.version}`, release]),
  );
  for (const previousRelease of previous.releases) {
    const current = nextReleases.get(`${previousRelease.packageId}@${previousRelease.version}`);
    if (!current) {
      throw new Error(
        `Trusted Registry release removal detected: ${previousRelease.packageId}@${previousRelease.version}`,
      );
    }
    if (
      current.digest !== previousRelease.digest
      || current.archiveDigest !== previousRelease.archiveDigest
    ) {
      throw new Error(
        `Trusted Registry immutable release conflict: ${previousRelease.packageId}@${previousRelease.version}`,
      );
    }
  }
}

function mergeTrustedReleaseHistory(
  previous: TrustedRegistryStateV1 | undefined,
  next: TrustedRegistryStateV1,
): TrustedRegistryStateV1 {
  if (!previous) return next;
  const releases = new Map(
    previous.releases.map((release) => [
      `${release.packageId}@${release.version}`,
      structuredClone(release),
    ]),
  );
  for (const release of next.releases) {
    releases.set(`${release.packageId}@${release.version}`, structuredClone(release));
  }
  return {
    ...next,
    releases: [...releases.values()].sort(compareReleaseState),
  };
}

function decodeBase64(value: string): Buffer {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value) {
    throw new Error('Trusted Registry signature is not canonical Base64.');
  }
  return bytes;
}

async function readLimitedResponseBytes(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error('Trusted Registry catalog exceeds the byte limit.');
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    totalBytes += result.value.byteLength;
    if (totalBytes > maxBytes) {
      await reader.cancel();
      throw new Error('Trusted Registry catalog exceeds the byte limit.');
    }
    chunks.push(result.value);
  }
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function sha256Digest(value: string | Uint8Array): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function compareReleaseState(
  left: TrustedRegistryStateV1['releases'][number],
  right: TrustedRegistryStateV1['releases'][number],
): number {
  return compareText(left.packageId, right.packageId)
    || comparePackageVersions(left.version, right.version)
    || compareText(left.digest, right.digest);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
