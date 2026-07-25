import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  DeclarativePackageManifest,
  DeclarativeSkillComponent,
  DeclarativeWorkflowComponent,
} from '../src/core/declarativePackageContracts';
import { agentPresetDefinitionFor } from '../src/core/agentPresetRegistry';
import type { RetakePackageManifest } from '../src/core/packageContracts';
import {
  storyProductionAgentPackage,
  storyProductionStarterPackage,
} from '../src/core/packageRegistry';
import { skillDefinitionFor } from '../src/core/skillRegistry';
import { workflowDefinitionFor } from '../src/core/workflowRegistry';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(repositoryRoot, 'packages', 'builtin');
const license = await readFile(path.join(repositoryRoot, 'LICENSE'), 'utf8');

await exportPackage(storyProductionStarterPackage, {
  dependencies: [{
    packageId: storyProductionAgentPackage.packageId,
    range: `^${storyProductionAgentPackage.version}`,
  }],
  directoryName: 'story-production-starter',
});
await exportPackage(storyProductionAgentPackage, {
  dependencies: [],
  directoryName: 'story-production-agent',
});

async function exportPackage(
  runtimeManifest: RetakePackageManifest,
  input: {
    dependencies: DeclarativePackageManifest['dependencies'];
    directoryName: string;
  },
): Promise<void> {
  const packageRoot = path.join(outputRoot, input.directoryName);
  const skillComponents: DeclarativeSkillComponent[] = runtimeManifest.components.skills.map((lock) => ({
    definitionHash: lock.definitionHash,
    definitionPath: `skills/${slug(lock.skillId)}/retake.skill.json`,
    resourcePaths: [],
    skillId: lock.skillId,
    version: lock.version,
  }));
  const workflowComponents: DeclarativeWorkflowComponent[] = runtimeManifest.components.workflows.map((lock) => ({
    definitionHash: lock.definitionHash,
    definitionPath: `workflows/${slug(lock.workflowDefinitionId)}/retake.workflow.json`,
    resourcePaths: [],
    version: lock.version,
    workflowDefinitionId: lock.workflowDefinitionId,
  }));
  const agentPresetComponents = runtimeManifest.components.agentPresets.map((lock) => ({
    agentPresetId: lock.agentPresetId,
    definitionHash: lock.definitionHash,
    definitionPath: `agents/${slug(lock.agentPresetId)}/retake.agent.json`,
    resourcePaths: [],
    version: lock.version,
  }));
  const files = [
    'LICENSE',
    'README.md',
    ...skillComponents.map((component) => component.definitionPath),
    ...workflowComponents.map((component) => component.definitionPath),
    ...agentPresetComponents.map((component) => component.definitionPath),
  ].sort(comparePath);
  const manifest: DeclarativePackageManifest = {
    components: {
      agentPresets: agentPresetComponents,
      skills: skillComponents,
      workflows: workflowComponents,
    },
    dependencies: input.dependencies,
    description: runtimeManifest.description,
    entrypoints: structuredClone(runtimeManifest.entrypoints),
    files,
    integrity: 'sha256:auto',
    license: 'MIT',
    name: runtimeManifest.name,
    optionalDependencies: [],
    packageId: runtimeManifest.packageId,
    permissions: [],
    publisher: {
      name: 'Retake Tools',
      publisherId: 'retake.tools',
    },
    retakeHostCompatibility: '>=0.1.2 <0.2.0',
    schemaVersion: 1,
    signature: null,
    version: runtimeManifest.version,
  };

  await mkdir(packageRoot, { recursive: true });
  await writeJson(path.join(packageRoot, 'retake.package.json'), manifest);
  await writeFile(path.join(packageRoot, 'LICENSE'), license, 'utf8');
  await writeFile(
    path.join(packageRoot, 'README.md'),
    `# ${runtimeManifest.name}\n\n${runtimeManifest.description}\n\nThis directory is the declarative source for \`${runtimeManifest.packageId}@${runtimeManifest.version}\`.\n`,
    'utf8',
  );

  for (const component of skillComponents) {
    await writeJson(
      path.join(packageRoot, ...component.definitionPath.split('/')),
      skillDefinitionFor(component.skillId),
    );
  }
  for (const component of workflowComponents) {
    await writeJson(
      path.join(packageRoot, ...component.definitionPath.split('/')),
      workflowDefinitionFor(component.workflowDefinitionId),
    );
  }
  for (const component of agentPresetComponents) {
    await writeJson(
      path.join(packageRoot, ...component.definitionPath.split('/')),
      agentPresetDefinitionFor(component.agentPresetId),
    );
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function slug(value: string): string {
  return value.replace(/^retake\./, '').replaceAll('.', '-').replaceAll('_', '-');
}

function comparePath(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
