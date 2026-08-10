import path from 'node:path';
import { readMaterializedPackageArchive } from '@retake-tools/package-sdk';
import { LocalPackageManagerService } from './local-package-manager-service';

export async function readActiveInstalledPackageFile(
  manager: LocalPackageManagerService,
  input: {
    digest: string;
    installationId: string;
    packageId: string;
    path: string;
  },
): Promise<Buffer> {
  const lockfile = await manager.sdkManager.list();
  const resolved = lockfile.resolvedPackages.find((entry) => (
    entry.packageId === input.packageId
    && entry.installationId === input.installationId
    && entry.digest === input.digest
  ));
  if (!resolved) {
    throw new Error('Installed Package file authority is stale.');
  }
  const installation = lockfile.installations.find((entry) => (
    entry.installationId === resolved.installationId
    && entry.packageId === resolved.packageId
    && entry.digest === resolved.digest
    && entry.version === resolved.version
  ));
  if (!installation) {
    throw new Error('Installed Package record is missing.');
  }
  const installed = await readMaterializedPackageArchive(path.join(
    manager.packagesRoot,
    'cache',
    'sha256',
    `${requiredDigestHex(input.digest)}.retakepkg`,
  ));
  if (
    installed.digest !== installation.digest
    || installed.archiveDigest !== installation.archiveDigest
    || installed.manifest.packageId !== installation.packageId
    || installed.manifest.version !== installation.version
  ) {
    throw new Error('Installed Package cache does not match its lock.');
  }
  const bytes = installed.files.get(input.path);
  if (!bytes) throw new Error('Installed Package file is missing.');
  return Buffer.from(bytes);
}

function requiredDigestHex(digest: string): string {
  const match = /^sha256:([a-f0-9]{64})$/.exec(digest);
  if (!match) throw new Error(`Invalid Package content digest: ${digest}`);
  return match[1]!;
}
