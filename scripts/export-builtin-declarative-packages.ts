import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DeclarativePackageManifest,
} from '../src/core/declarativePackageContracts';
import { packDeclarativePackage } from '../server/declarative-package-service';
import {
  defaultBootstrapProfileId,
  validateBootstrapProfileArchives,
  type BootstrapPackageReference,
} from '../server/declarative-package-bootstrap-service';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, 'packages', 'builtin');
const bootstrapRoot = path.join(repositoryRoot, 'packages', 'bootstrap');
const storyProductionStarterPackage = await readManifest(
  'story-production-starter',
);
const storyProductionAgentPackage = await readManifest(
  'story-production-agent',
);
await exportBootstrapArchives();

async function readManifest(
  directoryName: string,
): Promise<DeclarativePackageManifest> {
  const manifestPath = path.join(
    outputRoot,
    directoryName,
    'retake.package.json',
  );
  return JSON.parse(
    await readFile(manifestPath, 'utf8'),
  ) as DeclarativePackageManifest;
}

async function exportBootstrapArchives(): Promise<void> {
  await mkdir(bootstrapRoot, { recursive: true });
  const starterReference = await packBootstrapPackage(
    'story-production-starter',
    storyProductionStarterPackage.packageId,
    storyProductionStarterPackage.version,
  );
  const agentReference = await packBootstrapPackage(
    'story-production-agent',
    storyProductionAgentPackage.packageId,
    storyProductionAgentPackage.version,
  );
  const profilePath = path.join(bootstrapRoot, 'retake.bootstrap.json');
  const temporaryProfilePath = `${profilePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryProfilePath,
      `${JSON.stringify({
        dependencyPackages: [agentReference],
        hostCompatibility: '>=0.1.2 <0.2.0',
        profileId: defaultBootstrapProfileId,
        rootPackage: starterReference,
        schemaVersion: 1,
      }, null, 2)}\n`,
      'utf8',
    );
    await rename(temporaryProfilePath, profilePath);
  } finally {
    await rm(temporaryProfilePath, { force: true });
  }
  await validateBootstrapProfileArchives(profilePath, '0.1.2');
}

async function packBootstrapPackage(
  directoryName: string,
  packageId: string,
  version: string,
): Promise<BootstrapPackageReference> {
  const archivePath = `${directoryName}-${version}.retakepkg`;
  const outputPath = path.join(bootstrapRoot, archivePath);
  const temporaryPath = path.join(
    bootstrapRoot,
    `.${archivePath}.${process.pid}.${randomUUID()}.tmp.retakepkg`,
  );
  try {
    const result = await packDeclarativePackage(
      path.join(outputRoot, directoryName),
      temporaryPath,
    );
    await rename(temporaryPath, outputPath);
    return {
      archiveDigest: result.archiveDigest,
      archivePath,
      digest: result.digest,
      packageId,
      version,
    };
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
