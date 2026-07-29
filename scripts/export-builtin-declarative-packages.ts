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
  RetakePluginPermission,
} from '@retake-tools/package-contracts';
import { packDeclarativePackage } from '../server/declarative-package-service';
import {
  defaultBootstrapProfileId,
  validateBootstrapProfileArchives,
  type BootstrapPackageReference,
} from '../server/declarative-package-bootstrap-service';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const retakeRoot = path.dirname(repositoryRoot);
const bootstrapRoot = path.join(repositoryRoot, 'packages', 'bootstrap');
const packages = [
  {
    archiveStem: 'image-studio',
    packageRoot: path.resolve(
      process.env.RETAKE_IMAGE_STUDIO_PACKAGE_ROOT
        ?? path.join(retakeRoot, 'image-studio', 'plugin'),
    ),
    pluginModules: [{
      permissions: [
        'retake.asset.create',
        'retake.asset.read.bound',
        'retake.block.read.bound',
        'retake.draft.write.bound',
        'retake.execution.manage.self',
      ] satisfies RetakePluginPermission[],
      pluginModuleId: 'design.retake.image-studio.web',
    }],
    updateSource:
      'github:retake-tools/image-studio@main#subdirectory=plugin',
  },
  {
    archiveStem: 'video-studio',
    packageRoot: path.resolve(
      process.env.RETAKE_VIDEO_STUDIO_PACKAGE_ROOT
        ?? path.join(retakeRoot, 'video-studio', 'package'),
    ),
    pluginModules: [{
      permissions: [] satisfies RetakePluginPermission[],
      pluginModuleId: 'design.retake.video-studio.web',
    }],
    updateSource:
      'github:retake-tools/video-studio@main#subdirectory=package',
  },
] as const;

await exportDefaultStudioArchives();

async function exportDefaultStudioArchives(): Promise<void> {
  await mkdir(bootstrapRoot, { recursive: true });
  const references: BootstrapPackageReference[] = [];
  for (const candidate of packages) {
    const manifest = await readManifest(candidate.packageRoot);
    const reference = await packBootstrapPackage({
      archiveStem: candidate.archiveStem,
      manifest,
      packageRoot: candidate.packageRoot,
      pluginModules: candidate.pluginModules.map((entry) => ({
        permissions: [...entry.permissions],
        pluginModuleId: entry.pluginModuleId,
      })),
      updateSource: candidate.updateSource,
    });
    references.push(reference);
  }
  const profilePath = path.join(bootstrapRoot, 'retake.bootstrap.json');
  const temporaryProfilePath =
    `${profilePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryProfilePath,
      `${JSON.stringify({
        hostCompatibility: '>=0.1.2 <0.2.0',
        packages: references,
        profileId: defaultBootstrapProfileId,
        schemaVersion: 3,
      }, null, 2)}\n`,
      'utf8',
    );
    await rename(temporaryProfilePath, profilePath);
  } finally {
    await rm(temporaryProfilePath, { force: true });
  }
  await validateBootstrapProfileArchives(profilePath, '0.1.2');
}

async function readManifest(
  packageRoot: string,
): Promise<DeclarativePackageManifest> {
  return JSON.parse(
    await readFile(path.join(packageRoot, 'retake.package.json'), 'utf8'),
  ) as DeclarativePackageManifest;
}

async function packBootstrapPackage(input: {
  archiveStem: string;
  manifest: DeclarativePackageManifest;
  packageRoot: string;
  pluginModules: BootstrapPackageReference['pluginModules'];
  updateSource: string;
}): Promise<BootstrapPackageReference> {
  const archivePath = `${input.archiveStem}-${input.manifest.version}.retakepkg`;
  const outputPath = path.join(bootstrapRoot, archivePath);
  const temporaryPath = path.join(
    bootstrapRoot,
    `.${archivePath}.${process.pid}.${randomUUID()}.tmp.retakepkg`,
  );
  try {
    const result = await packDeclarativePackage(
      input.packageRoot,
      temporaryPath,
    );
    await rename(temporaryPath, outputPath);
    return {
      archiveDigest: result.archiveDigest,
      archivePath,
      digest: result.digest,
      packageId: input.manifest.packageId,
      pluginModules: input.pluginModules,
      updateSource: input.updateSource,
      version: input.manifest.version,
    };
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
