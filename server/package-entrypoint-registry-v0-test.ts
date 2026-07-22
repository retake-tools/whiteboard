import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { usePackageEntryPointController } from '../src/app/usePackageEntryPointController';
import type { RetakePackageManifest } from '../src/core/packageContracts';
import {
  createPackageRegistry,
  listPackageEntryPoints,
  listPackages,
  resolvePackageEntryPoint,
  storyProductionStarterPackage,
  validatePackageManifest,
} from '../src/core/packageRegistry';
import { createDraftSkillOperation, type TextGenerationLabels } from '../src/core/textOperations';
import type { BoardSnapshot } from '../src/core/types';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import { createWorkflowRunForGroup, reconcileWorkflowRuntime, workflowRunViewForGroup } from '../src/core/workflowRuntime';
import { resetWorkspace } from './local-store/snapshot-store';

const [toolbarSource, appSource, controllerSource] = await Promise.all([
  readFile(new URL('../src/components/FloatingToolbar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/App.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/app/usePackageEntryPointController.ts', import.meta.url), 'utf8'),
]);
assert.match(toolbarSource, /onInvokeEntryPoint/);
assert.match(toolbarSource, /data-entrypoint-id/);
assert.match(toolbarSource, /data-package-id/);
assert.equal(toolbarSource.includes('onCreateSkill'), false);
assert.equal(toolbarSource.includes('onCreateWorkflow'), false);
assert.match(appSource, /packageEntryPointController\.invokeEntryPoint/);
assert.match(controllerSource, /resolvePackageEntryPoint/);

assert.deepEqual(validatePackageManifest(storyProductionStarterPackage), []);
assert.equal(listPackages().length, 1);
assert.equal(storyProductionStarterPackage.components.skills.length, 5);
assert.equal(storyProductionStarterPackage.components.workflows.length, 1);
assert.deepEqual(listPackageEntryPoints().map(({ entrypoint }) => entrypoint.entrypointId), [
  'skill:retake.screenplay.from-brief',
  'skill:retake.screenplay.normalize',
  'skill:retake.character-bible.from-screenplay',
  'skill:retake.scene-bible.from-screenplay',
  'skill:retake.storyboard-plan.from-production-design',
  'workflow:retake.workflow.story-to-storyboard',
]);

const resolvedSkill = resolvePackageEntryPoint({ entrypointId: 'skill:retake.screenplay.from-brief' });
assert.equal(resolvedSkill.status, 'resolved');
assert.ok(resolvedSkill.status === 'resolved' && resolvedSkill.target.kind === 'skill');
assert.equal(resolvedSkill.target.entrypoint.ref.capabilityId, 'story.screenplay.generate');
assert.deepEqual(resolvedSkill.target.entrypoint.requiredInputSlotIds, ['brief']);
assert.equal(resolvedSkill.target.packageLock.digest, storyProductionStarterPackage.digest);

const resolvedWorkflow = resolvePackageEntryPoint({
  entrypointId: 'workflow:retake.workflow.story-to-storyboard',
});
assert.equal(resolvedWorkflow.status, 'resolved');
assert.ok(resolvedWorkflow.status === 'resolved' && resolvedWorkflow.target.kind === 'workflow');
assert.equal(resolvedWorkflow.target.workflowDefinitionLock.workflowDefinitionId, 'retake.workflow.story-to-storyboard');
assert.deepEqual(resolvedWorkflow.target.entrypoint.requiredInputSlotIds, ['brief']);

const invalidManifest = structuredClone(storyProductionStarterPackage);
invalidManifest.components.skills[0].definitionHash = 'sha256:stale';
assert.match(validatePackageManifest(invalidManifest).join('\n'), /Package Skill lock mismatch/);

const alternateSkillPackage: RetakePackageManifest = {
  ...structuredClone(storyProductionStarterPackage),
  packageId: 'retake.package.alternate-screenplay',
  digest: 'sha256:retake-package-alternate-screenplay-v1',
  components: {
    skills: [structuredClone(storyProductionStarterPackage.components.skills[0])],
    workflows: [],
    agentPresets: [],
    capabilityPlugins: [],
    adapterPlugins: [],
    uiPlugins: [],
  },
  entrypoints: [{
    ...structuredClone(storyProductionStarterPackage.entrypoints[0]),
    entrypointId: 'skill:alternate-screenplay-from-brief',
  }],
};
const ambiguousRegistry = createPackageRegistry([storyProductionStarterPackage, alternateSkillPackage]);
const ambiguousResolution = resolvePackageEntryPoint({
  kind: 'skill',
  refId: 'story.screenplay.generate',
}, ambiguousRegistry);
assert.equal(ambiguousResolution.status, 'needs_selection');
assert.ok(ambiguousResolution.status === 'needs_selection');
assert.equal(ambiguousResolution.candidates.length, 2);

const emptyRegistry = createPackageRegistry([]);
assert.equal(resolvePackageEntryPoint({
  entrypointId: 'skill:retake.screenplay.from-brief',
}, emptyRegistry).status, 'not_found');

const agentPackage: RetakePackageManifest = {
  schemaVersion: 1,
  packageId: 'retake.package.agent-placeholder',
  version: '0.1.0',
  digest: 'sha256:retake-package-agent-placeholder-v1',
  name: 'Agent placeholder',
  description: 'Contract-only AgentPreset package.',
  source: { kind: 'builtin' },
  components: {
    skills: [],
    workflows: [],
    agentPresets: [{ componentId: 'retake.agent.director', version: '0.1.0', definitionHash: 'sha256:agent' }],
    capabilityPlugins: [],
    adapterPlugins: [],
    uiPlugins: [],
  },
  entrypoints: [{
    schemaVersion: 1,
    entrypointId: 'agent:retake.agent.director',
    kind: 'agent_preset',
    name: 'Director',
    description: 'Not executable in Package V0.',
    ref: { agentPresetId: 'retake.agent.director' },
    compatibleStageIds: [],
    requiredInputSlotIds: [],
  }],
};
assert.equal(resolvePackageEntryPoint({
  entrypointId: 'agent:retake.agent.director',
}, createPackageRegistry([agentPackage])).status, 'unsupported');

const invokedKinds: string[] = [];
const entryPointController = usePackageEntryPointController({
  createSkillDraft: () => invokedKinds.push('skill'),
  createWorkflowDraft: () => invokedKinds.push('workflow'),
});
entryPointController.invokeEntryPoint('skill:retake.screenplay.from-brief');
entryPointController.invokeEntryPoint('workflow:retake.workflow.story-to-storyboard');
assert.deepEqual(invokedKinds, ['skill', 'workflow']);

const skillSnapshot = await emptySnapshot();
const skillDraft = createDraftSkillOperation(skillSnapshot, {
  ...labelsForSkill('retake.screenplay.from-brief'),
  skillId: resolvedSkill.target.entrypoint.ref.skillId,
  packageContext: {
    entrypointId: resolvedSkill.target.entrypoint.entrypointId,
    packageLock: resolvedSkill.target.packageLock,
  },
});
assert.equal(skillSnapshot.blocks.filter((block) => block.type === 'operation').length, 1);
assert.equal(skillDraft.operationBlock.data.packageId, storyProductionStarterPackage.packageId);
assert.equal(skillDraft.operationBlock.data.packageEntryPointId, resolvedSkill.target.entrypoint.entrypointId);
assert.equal(skillSnapshot.executions.length, 0);

const workflowSnapshot = await emptySnapshot();
const projection = projectWorkflowDraft(workflowSnapshot, {
  workflowId: resolvedWorkflow.target.entrypoint.ref.workflowDefinitionId,
  workflowTitle: 'Story to storyboard plan',
  outputPlaceholder: 'Waiting.',
  labelsForSkill,
  connectionIdForCapability: () => 'codex-app-server',
  packageContext: {
    entrypointId: resolvedWorkflow.target.entrypoint.entrypointId,
    packageLock: resolvedWorkflow.target.packageLock,
  },
});
assert.equal(projection.blockIds.length, 10);
assert.equal(projection.groupBlock.data.packageDigest, storyProductionStarterPackage.digest);
const brief = workflowSnapshot.blocks.find((block) => block.blockId === projection.workflowInputBlockIds[0]);
assert.ok(brief);
brief.data.body = 'A cat must finish a storyboard before sunrise.';
const run = createWorkflowRunForGroup(workflowSnapshot, projection.groupBlock.blockId);
assert.deepEqual(run.record.sourcePackageLock, resolvedWorkflow.target.packageLock);
assert.equal(run.record.entrypointId, resolvedWorkflow.target.entrypoint.entrypointId);
assert.equal(resolvePackageEntryPoint({
  entrypointId: resolvedWorkflow.target.entrypoint.entrypointId,
}, emptyRegistry).status, 'not_found');
reconcileWorkflowRuntime(workflowSnapshot);
assert.equal(workflowRunViewForGroup(workflowSnapshot, projection.groupBlock.blockId)?.status, 'ready');

console.log(JSON.stringify({
  ok: true,
  packageCount: listPackages().length,
  skillComponents: storyProductionStarterPackage.components.skills.length,
  workflowComponents: storyProductionStarterPackage.components.workflows.length,
  entrypoints: listPackageEntryPoints().length,
  typedDispatch: invokedKinds,
  ambiguousSelectionReturned: true,
  missingPackageDoesNotBreakRun: true,
  agentPresetExecutionDeferred: true,
}));

async function emptySnapshot(): Promise<BoardSnapshot> {
  const snapshot = await resetWorkspace();
  snapshot.blocks = [];
  snapshot.edges = [];
  snapshot.assets = [];
  snapshot.executions = [];
  snapshot.workflowRuns = [];
  snapshot.workflowStepRuns = [];
  snapshot.historyEvents = [];
  return snapshot;
}

function labelsForSkill(skillId: string): TextGenerationLabels {
  const labels: Record<string, TextGenerationLabels> = {
    'retake.screenplay.from-brief': baseLabels('Generate screenplay', 'Creative brief'),
    'retake.character-bible.from-screenplay': baseLabels('Define characters', 'Screenplay'),
    'retake.scene-bible.from-screenplay': baseLabels('Define scenes', 'Screenplay'),
    'retake.storyboard-plan.from-production-design': {
      ...baseLabels('Generate storyboard plan', 'Screenplay'),
      inputSlots: [
        { slotId: 'screenplay', promptTitle: 'Screenplay', promptPlaceholder: 'Connect screenplay.' },
        { slotId: 'character_bible', promptTitle: 'Character Bible', promptPlaceholder: 'Connect Character Bible.' },
        { slotId: 'scene_bible', promptTitle: 'Scene Bible', promptPlaceholder: 'Connect Scene Bible.' },
      ],
    },
  };
  const value = labels[skillId];
  if (!value) throw new Error(`Missing labels: ${skillId}`);
  return value;
}

function baseLabels(operationTitle: string, promptTitle: string): TextGenerationLabels {
  return {
    operationTitle,
    promptTitle,
    promptPlaceholder: `Connect ${promptTitle}.`,
    resultTitle: operationTitle,
    waitingBody: 'Waiting.',
  };
}
