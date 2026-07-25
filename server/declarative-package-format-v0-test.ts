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
import {
  storyProductionAgentPackage,
  storyProductionStarterPackage,
} from '../src/core/packageRegistry';
import {
  inspectDeclarativePackage,
  packDeclarativePackage,
  validateDeclarativePackage,
} from './declarative-package-service';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const starterRoot = path.join(repositoryRoot, 'packages', 'builtin', 'story-production-starter');
const agentRoot = path.join(repositoryRoot, 'packages', 'builtin', 'story-production-agent');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'retake-package-format-v0-'));

try {
  const starter = await validateDeclarativePackage(starterRoot);
  const agent = await validateDeclarativePackage(agentRoot);
  assert.deepEqual(starter.components, { agentPresets: 0, skills: 8, workflows: 4 });
  assert.deepEqual(agent.components, { agentPresets: 1, skills: 0, workflows: 0 });
  assert.equal(starter.entrypoints, storyProductionStarterPackage.entrypoints.length);
  assert.equal(agent.entrypoints, storyProductionAgentPackage.entrypoints.length);
  assert.deepEqual(starter.manifest.dependencies, [{
    packageId: storyProductionAgentPackage.packageId,
    range: `^${storyProductionAgentPackage.version}`,
  }]);
  assert.match(starter.digest, /^sha256:[a-f0-9]{64}$/);
  assert.match(agent.digest, /^sha256:[a-f0-9]{64}$/);
  assert.notEqual(starter.digest, storyProductionStarterPackage.digest);

  const archiveA = path.join(temporaryRoot, 'starter-a.retakepkg');
  const archiveB = path.join(temporaryRoot, 'starter-b.retakepkg');
  const packedA = await packDeclarativePackage(starterRoot, archiveA);
  const packedB = await packDeclarativePackage(starterRoot, archiveB);
  assert.equal(packedA.digest, starter.digest);
  assert.equal(packedA.archiveDigest, packedB.archiveDigest);
  assert.deepEqual(await readFile(archiveA), await readFile(archiveB));
  const archived = await validateDeclarativePackage(archiveA);
  const inspected = await inspectDeclarativePackage(archiveA);
  assert.equal(archived.sourceKind, 'archive');
  assert.equal(archived.digest, starter.digest);
  assert.equal(archived.archiveDigest, packedA.archiveDigest);
  assert.equal(archived.manifest.integrity, starter.digest);
  assert.deepEqual(inspected.manifest.entrypoints, starter.manifest.entrypoints);

  const singleSkillRoot = path.join(temporaryRoot, 'single-skill');
  const singleSkillManifest = await createSingleSkillFixture(singleSkillRoot);
  const singleSkill = await validateDeclarativePackage(singleSkillRoot);
  assert.deepEqual(singleSkill.components, { agentPresets: 0, skills: 1, workflows: 0 });
  assert.equal(singleSkill.entrypoints, 1);
  assert.equal(singleSkill.manifest.integrity, 'sha256:auto');
  const singleSkillArchive = path.join(temporaryRoot, 'single-skill.retakepkg');
  await packDeclarativePackage(singleSkillRoot, singleSkillArchive);
  const inspectedSingleSkill = await inspectDeclarativePackage(singleSkillArchive);
  assert.deepEqual(inspectedSingleSkill.components, { agentPresets: 0, skills: 1, workflows: 0 });

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

  const cycleRoot = path.join(temporaryRoot, 'workflow-cycle');
  await cp(starterRoot, cycleRoot, { recursive: true });
  const cycleManifest = await readManifest(cycleRoot);
  const workflowPath = cycleManifest.components.workflows[0]!.definitionPath;
  const workflowFile = path.join(cycleRoot, ...workflowPath.split('/'));
  const workflow = JSON.parse(await readFile(workflowFile, 'utf8')) as {
    steps: Array<{ dependsOn: string[]; stepId: string }>;
  };
  workflow.steps[0]!.dependsOn = [workflow.steps[0]!.stepId];
  await writeJson(workflowFile, workflow);
  await assert.rejects(
    validateDeclarativePackage(cycleRoot),
    /cannot depend on itself|dependency graph has a cycle/,
  );

  await createSingleSkillFixture(singleSkillRoot);
  await mkdir(path.join(singleSkillRoot, '.retake'), { recursive: true });
  await writeFile(path.join(singleSkillRoot, '.retake', 'snapshot.json'), '{}', 'utf8');
  await assert.rejects(
    validateDeclarativePackage(singleSkillRoot),
    /reserved \.retake directory/,
  );

  await assert.rejects(
    packDeclarativePackage(starterRoot, path.join(starterRoot, 'nested.retakepkg')),
    /outside the source directory/,
  );
  await assert.rejects(
    packDeclarativePackage(starterRoot, archiveA),
    /EEXIST/,
  );

  const tamperedArchive = Buffer.from(await readFile(archiveA));
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
  const offlineSource = `${cliSource}\n${serviceSource}`;
  assert.equal(offlineSource.includes('RETAKE_WORKSPACE_DIR'), false);
  assert.equal(offlineSource.includes('snapshot-store'), false);
  assert.equal(offlineSource.includes('workspace-store'), false);
  assert.equal(offlineSource.includes('fetch('), false);
  assert.equal(offlineSource.includes('http://'), false);
  assert.equal(offlineSource.includes('https://'), false);

  console.log(JSON.stringify({
    ok: true,
    directoryAndArchiveValidation: true,
    starterComponents: starter.components,
    starterDependsOnAgentPackage: true,
    singleSkillPackage: true,
    deterministicArchive: true,
    contentDigest: starter.digest,
    archiveDigest: packedA.archiveDigest,
    exactIntegrityTamperRejected: true,
    unlistedAndSymlinkRejected: true,
    workflowCycleRejected: true,
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
