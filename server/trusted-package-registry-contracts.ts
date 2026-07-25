import { z } from 'zod';
import {
  packageVersionSatisfies,
  parsePackageVersion,
} from './package-semver';

export const trustedRegistryCatalogPath = 'catalog.v1.json';
export const trustedRegistryMaxCatalogBytes = 2 * 1024 * 1024;
export const trustedRegistryMaxPackages = 2048;
export const trustedRegistryMaxReleasesPerPackage = 512;

const namespacedIdPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/;
const channelPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;
const signaturePattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const namespacedIdSchema = z.string().min(3).max(256).regex(namespacedIdPattern);
const digestSchema = z.string().regex(digestPattern);
const isoDateSchema = z.string().max(64).refine(isIsoDate, 'must be a canonical UTC ISO date-time');
const exactVersionSchema = z.string().max(128).refine(isExactVersion, 'must be an exact SemVer');
const versionRangeSchema = z.string().max(256).refine(isVersionRange, 'must be a supported SemVer range');

const dependencySchema = z.object({
  packageId: namespacedIdSchema,
  range: versionRangeSchema,
}).strict();

const registryKeySchema = z.object({
  algorithm: z.literal('ed25519'),
  keyId: digestSchema,
  publicKeyPem: z.string().min(1).max(4096),
}).strict();

export const trustedRegistryRootSchema = z.object({
  baseUrl: z.string().max(2048),
  expiresAt: isoDateSchema,
  keys: z.array(registryKeySchema).min(1).max(32),
  registryId: namespacedIdSchema,
  roles: z.object({
    catalog: z.object({
      keyIds: z.array(digestSchema).min(1).max(32),
      threshold: z.number().int().min(1).max(32),
    }).strict(),
  }).strict(),
  rootVersion: z.number().int().min(1),
  schemaVersion: z.literal(1),
}).strict().superRefine((root, context) => {
  addDuplicateIssues(root.keys.map((key) => key.keyId), 'Registry Root keyId', context);
  addDuplicateIssues(root.roles.catalog.keyIds, 'Registry catalog role keyId', context);
  const knownKeyIds = new Set(root.keys.map((key) => key.keyId));
  for (const keyId of root.roles.catalog.keyIds) {
    if (!knownKeyIds.has(keyId)) {
      context.addIssue({
        code: 'custom',
        message: `Registry catalog role references an unknown key: ${keyId}`,
      });
    }
  }
  if (root.roles.catalog.threshold > root.roles.catalog.keyIds.length) {
    context.addIssue({
      code: 'custom',
      message: 'Registry catalog role threshold exceeds its key count.',
    });
  }
});

const releaseSchema = z.object({
  archiveDigest: digestSchema,
  archiveSizeBytes: z.number().int().min(1).max(64 * 1024 * 1024),
  dependencies: z.array(dependencySchema).max(128),
  digest: digestSchema,
  optionalDependencies: z.array(dependencySchema).max(128),
  permissions: z.array(z.string()).max(0),
  publishedAt: isoDateSchema,
  retakeHostCompatibility: versionRangeSchema,
  status: z.enum(['active', 'deprecated', 'yanked']),
  version: exactVersionSchema,
}).strict().superRefine((release, context) => {
  addDuplicateIssues(
    release.dependencies.map((dependency) => dependency.packageId),
    'required dependency',
    context,
  );
  addDuplicateIssues(
    release.optionalDependencies.map((dependency) => dependency.packageId),
    'optional dependency',
    context,
  );
  const requiredIds = new Set(release.dependencies.map((dependency) => dependency.packageId));
  for (const dependency of release.optionalDependencies) {
    if (requiredIds.has(dependency.packageId)) {
      context.addIssue({
        code: 'custom',
        message: `Dependency cannot be both required and optional: ${dependency.packageId}`,
      });
    }
  }
});

const channelSchema = z.object({
  archiveDigest: digestSchema,
  channel: z.string().regex(channelPattern),
  digest: digestSchema,
  version: exactVersionSchema,
}).strict();

const registryPackageSchema = z.object({
  channels: z.array(channelSchema).max(64),
  description: z.string().min(1).max(4096),
  name: z.string().min(1).max(256),
  packageId: namespacedIdSchema,
  publisher: z.object({
    name: z.string().min(1).max(256),
    publisherId: namespacedIdSchema,
  }).strict(),
  releases: z.array(releaseSchema).min(1).max(trustedRegistryMaxReleasesPerPackage),
}).strict().superRefine((registryPackage, context) => {
  addDuplicateIssues(
    registryPackage.releases.map((release) => release.version),
    `release version for ${registryPackage.packageId}`,
    context,
  );
  addDuplicateIssues(
    registryPackage.channels.map((channel) => channel.channel),
    `channel for ${registryPackage.packageId}`,
    context,
  );
  const releases = new Map(
    registryPackage.releases.map((release) => [release.version, release]),
  );
  for (const channel of registryPackage.channels) {
    const release = releases.get(channel.version);
    if (
      !release
      || release.status !== 'active'
      || release.digest !== channel.digest
      || release.archiveDigest !== channel.archiveDigest
    ) {
      context.addIssue({
        code: 'custom',
        message: `Registry channel does not lock an active exact release: ${registryPackage.packageId}/${channel.channel}`,
      });
    }
  }
});

const advisorySchema = z.object({
  advisoryId: namespacedIdSchema,
  affectedRange: versionRangeSchema,
  packageId: namespacedIdSchema,
  policy: z.enum(['inform', 'warn', 'block']),
  publishedAt: isoDateSchema,
  severity: z.enum(['low', 'moderate', 'high', 'critical']),
  summary: z.string().min(1).max(2048),
  updatedAt: isoDateSchema,
  url: z.string().max(2048).optional(),
}).strict();

export const registryCatalogSchema = z.object({
  advisories: z.array(advisorySchema).max(4096),
  catalogVersion: z.number().int().min(1),
  expiresAt: isoDateSchema,
  issuedAt: isoDateSchema,
  packages: z.array(registryPackageSchema).max(trustedRegistryMaxPackages),
  registryId: namespacedIdSchema,
  schemaVersion: z.literal(1),
  type: z.literal('retake.registry.catalog'),
}).strict().superRefine((catalog, context) => {
  addDuplicateIssues(catalog.packages.map((entry) => entry.packageId), 'Registry Package', context);
  addDuplicateIssues(catalog.advisories.map((entry) => entry.advisoryId), 'Registry advisory', context);
  const packageIds = new Set(catalog.packages.map((entry) => entry.packageId));
  for (const advisory of catalog.advisories) {
    if (!packageIds.has(advisory.packageId)) {
      context.addIssue({
        code: 'custom',
        message: `Registry advisory references an unknown Package: ${advisory.advisoryId}`,
      });
    }
    if (advisory.url && !isSafeHttpsUrl(advisory.url, false)) {
      context.addIssue({
        code: 'custom',
        message: `Registry advisory URL must be HTTPS: ${advisory.advisoryId}`,
      });
    }
  }
  if (Date.parse(catalog.issuedAt) >= Date.parse(catalog.expiresAt)) {
    context.addIssue({
      code: 'custom',
      message: 'Registry catalog expiresAt must be after issuedAt.',
    });
  }
});

const registrySignatureSchema = z.object({
  algorithm: z.literal('ed25519'),
  keyId: digestSchema,
  signatureBase64: z.string().min(1).max(512).regex(signaturePattern),
}).strict();

export const signedRegistryCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  signatures: z.array(registrySignatureSchema).min(1).max(32),
  signed: registryCatalogSchema,
}).strict().superRefine((envelope, context) => {
  addDuplicateIssues(
    envelope.signatures.map((signature) => signature.keyId),
    'Registry catalog signature keyId',
    context,
  );
});

export type TrustedRegistryRootV1 = z.infer<typeof trustedRegistryRootSchema>;
export type RegistryCatalogV1 = z.infer<typeof registryCatalogSchema>;
export type SignedRegistryCatalogV1 = z.infer<typeof signedRegistryCatalogSchema>;
export type RegistryPackageV1 = RegistryCatalogV1['packages'][number];
export type RegistryReleaseV1 = RegistryPackageV1['releases'][number];
export type RegistryAdvisoryV1 = RegistryCatalogV1['advisories'][number];

export interface TrustedRegistryReleaseStateV1 {
  archiveDigest: string;
  digest: string;
  packageId: string;
  version: string;
}

export interface TrustedRegistryStateV1 {
  catalogDigest: string;
  catalogExpiresAt: string;
  catalogVersion: number;
  registryId: string;
  releases: TrustedRegistryReleaseStateV1[];
  rootVersion: number;
  schemaVersion: 1;
}

export const trustedRegistryStateSchema = z.object({
  catalogDigest: digestSchema,
  catalogExpiresAt: isoDateSchema,
  catalogVersion: z.number().int().min(1),
  registryId: namespacedIdSchema,
  releases: z.array(z.object({
    archiveDigest: digestSchema,
    digest: digestSchema,
    packageId: namespacedIdSchema,
    version: exactVersionSchema,
  }).strict()).max(trustedRegistryMaxPackages * trustedRegistryMaxReleasesPerPackage),
  rootVersion: z.number().int().min(1),
  schemaVersion: z.literal(1),
}).strict().superRefine((state, context) => {
  addDuplicateIssues(
    state.releases.map((release) => `${release.packageId}@${release.version}`),
    'trusted Registry release state',
    context,
  );
});

export type TrustedRegistryCandidateSelector =
  | { kind: 'channel'; channel: string }
  | { kind: 'exact'; version: string }
  | { kind: 'range'; range: string };

export function parseTrustedRegistryRoot(input: unknown): TrustedRegistryRootV1 {
  return trustedRegistryRootSchema.parse(input);
}

export function parseSignedRegistryCatalog(input: unknown): SignedRegistryCatalogV1 {
  return signedRegistryCatalogSchema.parse(input);
}

export function parseTrustedRegistryState(input: unknown): TrustedRegistryStateV1 {
  return trustedRegistryStateSchema.parse(input);
}

export function validateRegistryRootBaseUrl(baseUrl: string): URL {
  if (!isSafeHttpsUrl(baseUrl, true)) {
    throw new Error('Trusted Registry baseUrl must be an HTTPS directory URL without credentials, query, or fragment.');
  }
  return new URL(baseUrl);
}

function isSafeHttpsUrl(value: string, requireTrailingSlash: boolean): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
      && (!requireTrailingSlash || url.pathname.endsWith('/'));
  } catch {
    return false;
  }
}

function isIsoDate(value: string): boolean {
  try {
    return new Date(value).toISOString() === value;
  } catch {
    return false;
  }
}

function isExactVersion(value: string): boolean {
  try {
    parsePackageVersion(value);
    return true;
  } catch {
    return false;
  }
}

function isVersionRange(value: string): boolean {
  try {
    packageVersionSatisfies('0.0.0', value);
    return true;
  } catch {
    return false;
  }
}

function addDuplicateIssues(
  values: string[],
  label: string,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      context.addIssue({
        code: 'custom',
        message: `Duplicate ${label}: ${value}`,
      });
    }
    seen.add(value);
  }
}
