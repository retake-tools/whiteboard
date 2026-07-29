import path from 'node:path';
import {
  PackageManager,
  readMaterializedPackageArchive,
} from '@retake-tools/package-sdk';

export interface InstalledPackageLoadFailure {
  digest: string;
  error: string;
  installationId: string;
  packageId: string;
  version: string;
}

export async function loadInstalledPackagesTolerant(
  manager: PackageManager,
  packagesRoot: string,
): Promise<{
  failures: InstalledPackageLoadFailure[];
  installedPackages: Awaited<
    ReturnType<PackageManager['loadInstalledPackages']>
  >;
}> {
  const lockfile = await manager.list();
  const installedPackages: Awaited<
    ReturnType<PackageManager['loadInstalledPackages']>
  > = [];
  const failures: InstalledPackageLoadFailure[] = [];
  for (const resolved of lockfile.resolvedPackages) {
    const installation = lockfile.installations.find(
      (entry) => entry.installationId === resolved.installationId,
    );
    if (!installation) {
      failures.push({
        digest: resolved.digest,
        error: `Resolved Package Installation is missing: ${resolved.packageId}`,
        installationId: resolved.installationId,
        packageId: resolved.packageId,
        version: resolved.version,
      });
      continue;
    }
    try {
      const installed = await readMaterializedPackageArchive(path.join(
        packagesRoot,
        'cache',
        'sha256',
        `${requiredDigestHex(resolved.digest)}.retakepkg`,
      ));
      if (
        installed.digest !== installation.digest
        || installed.archiveDigest !== installation.archiveDigest
        || installed.manifest.packageId !== installation.packageId
        || installed.manifest.version !== installation.version
      ) {
        throw new Error(
          `Installed Package cache does not match its lock: ${resolved.packageId}`,
        );
      }
      installedPackages.push(installed);
    } catch (error) {
      failures.push({
        digest: resolved.digest,
        error: errorMessage(error),
        installationId: resolved.installationId,
        packageId: resolved.packageId,
        version: resolved.version,
      });
    }
  }
  return { failures, installedPackages };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requiredDigestHex(digest: string): string {
  const match = /^sha256:([a-f0-9]{64})$/.exec(digest);
  if (!match) throw new Error(`Invalid Package content digest: ${digest}`);
  return match[1]!;
}
