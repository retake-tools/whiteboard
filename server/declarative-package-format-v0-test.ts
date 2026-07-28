import assert from 'node:assert/strict';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DeclarativePackageManifest } from '../src/core/declarativePackageContracts';
import { videoStudioPackage } from './studio-domain-test-fixtures';
import {
  inspectDeclarativePackage,
  packDeclarativePackage,
  readMaterializedPackageArchive,
  validateDeclarativePackage,
} from './declarative-package-service';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const studioArchive = path.join(
  repositoryRoot,
  'packages',
  'bootstrap',
  'video-studio-0.1.0.retakepkg',
);
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'retake-package-format-v0-'));
const starterRoot = path.join(temporaryRoot, 'studio-source');

try {
  await materializeArchiveSource(studioArchive, starterRoot);
  const studio = await validateDeclarativePackage(studioArchive);
  assert.deepEqual(studio.components, {
    agentPresets: 1,
    pluginModules: 1,
    skills: 8,
    workflows: 4,
  });
  assert.equal(studio.entrypoints, videoStudioPackage.entrypoints.length);
  assert.match(studio.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(studio.digest, videoStudioPackage.digest);
  const inspectedStudio = await inspectDeclarativePackage(studioArchive);
  assert.equal(studio.sourceKind, 'archive');
  assert.deepEqual(
    inspectedStudio.manifest.entrypoints,
    studio.manifest.entrypoints,
  );

  const singleSkillRoot = path.join(temporaryRoot, 'single-skill');
  const singleSkillManifest = await createSingleSkillFixture(singleSkillRoot);
  const singleSkill = await validateDeclarativePackage(singleSkillRoot);
  assert.deepEqual(singleSkill.components, {
    agentPresets: 0,
    pluginModules: 0,
    skills: 1,
    workflows: 0,
  });
  assert.equal(singleSkill.entrypoints, 1);
  assert.equal(singleSkill.manifest.integrity, singleSkill.digest);
  const singleSkillArchive = path.join(temporaryRoot, 'single-skill.retakepkg');
  const singleSkillArchiveCopy = path.join(
    temporaryRoot,
    'single-skill-copy.retakepkg',
  );
  const packedSingleSkill = await packDeclarativePackage(
    singleSkillRoot,
    singleSkillArchive,
  );
  const packedSingleSkillCopy = await packDeclarativePackage(
    singleSkillRoot,
    singleSkillArchiveCopy,
  );
  assert.equal(
    packedSingleSkill.archiveDigest,
    packedSingleSkillCopy.archiveDigest,
  );
  assert.deepEqual(
    await readFile(singleSkillArchive),
    await readFile(singleSkillArchiveCopy),
  );
  const inspectedSingleSkill = await inspectDeclarativePackage(singleSkillArchive);
  assert.deepEqual(inspectedSingleSkill.components, {
    agentPresets: 0,
    pluginModules: 0,
    skills: 1,
    workflows: 0,
  });

  const exactManifest: DeclarativePackageManifest = {
    ...singleSkillManifest,
    integrity: singleSkill.digest,
  };
  await writeJson(path.join(singleSkillRoot, 'retake.package.json'), exactManifest);
  const definitionPath = exactManifest.components.skills[0]!.definitionPath;
  const definitionFile = path.join(singleSkillRoot, ...definitionPath.split('/'));
  const definition = JSON.parse(await readFile(definitionFile, 'utf8')) as Record<string, unknown>;
  definition.description = `${String(definition.description)} Tampered.`;
  await writeJson(definitionFile, definition);
  await assert.rejects(
    validateDeclarativePackage(singleSkillRoot),
    /Package integrity mismatch/,
  );

  await createSingleSkillFixture(singleSkillRoot);
  await writeFile(path.join(singleSkillRoot, 'unlisted-secret.txt'), 'must not be packed', 'utf8');
  await assert.rejects(
    validateDeclarativePackage(singleSkillRoot),
    /unlisted: unlisted-secret\.txt/,
  );
  await rm(path.join(singleSkillRoot, 'unlisted-secret.txt'));

  await symlink(
    path.join(singleSkillRoot, 'README.md'),
    path.join(singleSkillRoot, 'linked-readme.md'),
  );
  await assert.rejects(
    validateDeclarativePackage(singleSkillRoot),
    /symlink/,
  );
  await rm(path.join(singleSkillRoot, 'linked-readme.md'));

  const permissionManifest = await readManifest(singleSkillRoot);
  (permissionManifest as unknown as { permissions: string[] }).permissions = ['network'];
  await writeJson(path.join(singleSkillRoot, 'retake.package.json'), permissionManifest);
  await assert.rejects(
    validateDeclarativePackage(singleSkillRoot),
    /permissions/,
  );

  await createSingleSkillFixture(singleSkillRoot);
  const wrongEntrypointManifest = await readManifest(singleSkillRoot);
  const entrypoint = wrongEntrypointManifest.entrypoints[0]!;
  assert.equal(entrypoint.kind, 'skill');
  if (entrypoint.kind === 'skill') entrypoint.ref.skillId = 'example.missing-skill';
  await writeJson(path.join(singleSkillRoot, 'retake.package.json'), wrongEntrypointManifest);
  await assert.rejects(
    validateDeclarativePackage(singleSkillRoot),
    /EntryPoint is not a component/,
  );

  await createSingleSkillFixture(singleSkillRoot);
  const traversalManifest = await readManifest(singleSkillRoot);
  traversalManifest.files[0] = '../escape';
  await writeJson(path.join(singleSkillRoot, 'retake.package.json'), traversalManifest);
  await assert.rejects(
    validateDeclarativePackage(singleSkillRoot),
    /portable, normalized, relative Package path/,
  );

  await createSingleSkillFixture(singleSkillRoot);
  await mkdir(path.join(singleSkillRoot, '.retake'), { recursive: true });
  await writeFile(path.join(singleSkillRoot, '.retake', 'snapshot.json'), '{}', 'utf8');
  await assert.rejects(
    validateDeclarativePackage(singleSkillRoot),
    /reserved \.retake directory/,
  );
  await rm(path.join(singleSkillRoot, '.retake'), { recursive: true });

  await assert.rejects(
    packDeclarativePackage(
      singleSkillRoot,
      path.join(singleSkillRoot, 'nested.retakepkg'),
    ),
    /outside the source directory/,
  );
  const linkedSourceRoot = path.join(temporaryRoot, 'linked-starter-source');
  await symlink(singleSkillRoot, linkedSourceRoot);
  await assert.rejects(
    packDeclarativePackage(
      linkedSourceRoot,
      path.join(linkedSourceRoot, 'nested-through-link.retakepkg'),
    ),
    /outside the source directory/,
  );
  await assert.rejects(
    packDeclarativePackage(starterRoot, singleSkillArchive),
    /EEXIST/,
  );

  const tamperedArchive = Buffer.from(await readFile(singleSkillArchive));
  tamperedArchive[Math.floor(tamperedArchive.byteLength / 2)]! ^= 0xff;
  const tamperedArchivePath = path.join(temporaryRoot, 'tampered.retakepkg');
  await writeFile(tamperedArchivePath, tamperedArchive);
  await assert.rejects(
    validateDeclarativePackage(tamperedArchivePath),
    /invalid|checksum|integrity|truncated/i,
  );

  const [cliSource, serviceSource] = await Promise.all([
    readFile(path.join(repositoryRoot, 'scripts', 'retake-package.ts'), 'utf8'),
    readFile(path.join(repositoryRoot, 'server', 'declarative-package-service.ts'), 'utf8'),
  ]);
  assert.equal(serviceSource.includes('RETAKE_WORKSPACE_DIR'), false);
  assert.equal(serviceSource.includes('snapshot-store'), false);
  assert.equal(serviceSource.includes('workspace-store'), false);
  assert.equal(`${cliSource}\n${serviceSource}`.includes('fetch('), false);
  assert.equal(`${cliSource}\n${serviceSource}`.includes('http://'), false);
  assert.equal(`${cliSource}\n${serviceSource}`.includes('https://'), false);

  console.log(JSON.stringify({
    ok: true,
    directoryAndArchiveValidation: true,
    studioComponents: studio.components,
    singleSkillPackage: true,
    deterministicArchive: true,
    contentDigest: studio.digest,
    archiveDigest: packedSingleSkill.archiveDigest,
    exactIntegrityTamperRejected: true,
    unlistedAndSymlinkRejected: true,
    declarativePermissionsOnly: true,
    workspaceAndNetworkIndependent: true,
  }));
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function createSingleSkillFixture(
  fixtureRoot: string,
): Promise<DeclarativePackageManifest> {
  await mkdir(fixtureRoot, { recursive: true });
  const starterManifest = await readManifest(starterRoot);
  const skill = structuredClone(starterManifest.components.skills[0]!);
  const entrypoint = structuredClone(starterManifest.entrypoints.find(
    (candidate) => candidate.kind === 'skill' && candidate.ref.skillId === skill.skillId,
  )!);
  const files = ['LICENSE', 'README.md', skill.definitionPath].sort(comparePath);
  const manifest: DeclarativePackageManifest = {
    ...starterManifest,
    build: undefined,
    components: {
      agentPresets: [],
      skills: [skill],
      workflows: [],
    },
    dependencies: [],
    description: 'A disposable single Skill declarative Package.',
    entrypoints: [entrypoint],
    files,
    integrity: 'sha256:auto',
    name: 'Single Skill Fixture',
    packageId: 'test.package.single-skill',
    version: '1.0.0',
  };
  await writeJson(path.join(fixtureRoot, 'retake.package.json'), manifest);
  await cp(path.join(starterRoot, 'LICENSE'), path.join(fixtureRoot, 'LICENSE'));
  await cp(path.join(starterRoot, 'README.md'), path.join(fixtureRoot, 'README.md'));
  const sourceDefinition = path.join(starterRoot, ...skill.definitionPath.split('/'));
  const targetDefinition = path.join(fixtureRoot, ...skill.definitionPath.split('/'));
  await mkdir(path.dirname(targetDefinition), { recursive: true });
  await cp(sourceDefinition, targetDefinition);
  return manifest;
}

async function materializeArchiveSource(
  archivePath: string,
  outputRoot: string,
): Promise<void> {
  const materialized = await readMaterializedPackageArchive(archivePath);
  await mkdir(outputRoot, { recursive: true });
  await writeJson(
    path.join(outputRoot, 'retake.package.json'),
    materialized.manifest,
  );
  for (const [relativePath, bytes] of materialized.files) {
    const outputPath = path.join(outputRoot, ...relativePath.split('/'));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, bytes);
  }
}

async function readManifest(root: string): Promise<DeclarativePackageManifest> {
  return JSON.parse(
    await readFile(path.join(root, 'retake.package.json'), 'utf8'),
  ) as DeclarativePackageManifest;
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
