import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { resolvedSkillUiDefinitionFor } from '../src/core/skillRegistry';
import { canonicalWorkflowDefinition } from '../src/core/workflowAuthoringContracts';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import {
  configureProjectWorkflowRegistry,
  listWorkflows,
  upsertProjectWorkflowDefinition,
  workflowDefinitionFor,
} from '../src/core/workflowRegistry';
import { createWorkflowRunForGroup } from '../src/core/workflowRuntime';
import {
  bootstrapDeclarativePackages,
  defaultBootstrapProfilePath,
} from './declarative-package-bootstrap-service';
import { retakeRoot } from './local-store/context';
import { resetWorkspace } from './local-store/snapshot-store';
import {
  forkProjectWorkflowDraft,
  publishProjectWorkflowDraft,
  saveProjectWorkflowDraft,
} from './local-store/workflow-authoring-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-workflow-authoring-projection-v0')) {
  throw new Error('Workflow Authoring Projection V0 test requires a disposable RETAKE_WORKSPACE_DIR.');
}

await rm(retakeRoot, { force: true, recursive: true });
await bootstrapDeclarativePackages({
  activateRuntime: true,
  hostVersion: '0.1.4',
  profilePath: defaultBootstrapProfilePath,
  workspaceRoot: retakeRoot,
});
const snapshot = await resetWorkspace();
snapshot.blocks = [];
snapshot.edges = [];
snapshot.assets = [];
snapshot.executions = [];
snapshot.workflowRuns = [];
snapshot.workflowStepRuns = [];
const forked = await forkProjectWorkflowDraft({
  projectId: snapshot.project.projectId,
  source: { kind: 'installed', workflowId: 'retake.workflow.ip-character-design' },
});
const movedTemplate = structuredClone(forked.draft.projectionTemplate);
movedTemplate.positions = movedTemplate.positions.map((position, index) => ({
  ...position,
  x: 100 + index * 410,
  y: 75 + (index % 2) * 90,
}));
const saved = await saveProjectWorkflowDraft({
  definition: forked.draft.definition,
  draftId: forked.draft.draftId,
  expectedRecordVersion: forked.draft.recordVersion,
  projectId: snapshot.project.projectId,
  projectionTemplate: movedTemplate,
});
const published = await publishProjectWorkflowDraft({
  draftId: saved.draft.draftId,
  expectedRecordVersion: saved.draft.recordVersion,
  projectId: snapshot.project.projectId,
});

assert.equal(listWorkflows().some(
  (definition) => definition.workflowId === published.revision.definition.workflowId,
), false, 'Project Workflow must stay outside the Installed registry listing.');
upsertProjectWorkflowDefinition(snapshot.project.projectId, published.revision.definition);
assert.equal(
  workflowDefinitionFor(published.revision.definition.workflowId).definitionHash,
  published.revision.definition.definitionHash,
);

const before = {
  agentRuns: snapshot.agentRuns?.length ?? 0,
  executions: snapshot.executions.length,
  workflowRuns: snapshot.workflowRuns?.length ?? 0,
};
const projection = projectWorkflowDraft(snapshot, {
  composerInput: {
    instruction: { body: 'Design an orange courier cat.', slotId: 'creative_brief' },
    mentions: [],
  },
  connectionIdForCapability: () => undefined,
  labelsForSkill: (skillId) => {
    const ui = resolvedSkillUiDefinitionFor(skillId, 'en');
    return {
      inputSlots: ui.inputSlots?.map((slot) => ({
        promptPlaceholder: slot.placeholder,
        promptTitle: slot.label,
        slotId: slot.slotId,
      })),
      operationTitle: ui.operationTitle,
      promptPlaceholder: ui.placeholder,
      promptTitle: ui.inputLabel,
      resultTitle: ui.operationTitle,
      waitingBody: 'Waiting.',
    };
  },
  outputPlaceholder: 'Waiting.',
  projectionTemplate: published.revision.projectionTemplate,
  projectRevisionId: published.revision.revisionId,
  workflowDefinition: published.revision.definition,
  workflowId: published.revision.definition.workflowId,
  workflowTitle: published.revision.definition.name,
});
assert.deepEqual({
  agentRuns: snapshot.agentRuns?.length ?? 0,
  executions: snapshot.executions.length,
  workflowRuns: snapshot.workflowRuns?.length ?? 0,
}, before, 'Projection must not create AgentRun, Execution, or WorkflowRun state.');
assert.equal(projection.groupBlock.data.workflowRevisionId, published.revision.revisionId);
assert.equal(projection.groupBlock.data.workflowDefinitionHash, published.revision.definition.definitionHash);
const firstStep = published.revision.definition.steps[0]!;
const firstOperation = snapshot.blocks.find((block) => (
  block.type === 'operation'
  && block.data.workflowProjectionId === projection.projectionId
  && block.data.workflowStepId === firstStep.stepId
));
assert.deepEqual(firstOperation?.position, { x: 420, y: 80 });

const run = createWorkflowRunForGroup(snapshot, projection.groupBlock.blockId);
assert.equal(run.record.sourceWorkflowRevisionId, published.revision.revisionId);
assert.equal(run.record.workflowDefinitionLock.definitionHash, published.revision.definition.definitionHash);
assert.equal(run.steps.length, published.revision.definition.steps.length);

configureProjectWorkflowRegistry(snapshot.project.projectId, []);
assert.throws(
  () => workflowDefinitionFor(published.revision.definition.workflowId),
  /not found/,
);
configureProjectWorkflowRegistry(snapshot.project.projectId, [published.revision.definition]);
assert.equal(
  workflowDefinitionFor(published.revision.definition.workflowId).definitionHash,
  published.revision.definition.definitionHash,
);
const nextVersion = canonicalWorkflowDefinition({
  ...structuredClone(published.revision.definition),
  version: '0.2.0',
});
configureProjectWorkflowRegistry(snapshot.project.projectId, [
  published.revision.definition,
  nextVersion,
]);
assert.throws(
  () => workflowDefinitionFor(published.revision.definition.workflowId),
  /ambiguous/,
);
assert.equal(workflowDefinitionFor(published.revision.definition.workflowId, {
  definitionHash: published.revision.definition.definitionHash,
  version: published.revision.definition.version,
}).definitionHash, published.revision.definition.definitionHash);
configureProjectWorkflowRegistry(snapshot.project.projectId, [published.revision.definition]);

const incompleteTemplate = structuredClone(published.revision.projectionTemplate);
incompleteTemplate.positions.pop();
assert.throws(() => projectWorkflowDraft(structuredClone(snapshot), {
  connectionIdForCapability: () => undefined,
  labelsForSkill: () => ({
    operationTitle: 'Operation',
    promptPlaceholder: 'Prompt',
    promptTitle: 'Prompt',
    resultTitle: 'Result',
    waitingBody: 'Waiting.',
  }),
  outputPlaceholder: 'Waiting.',
  projectionTemplate: incompleteTemplate,
  projectRevisionId: published.revision.revisionId,
  workflowDefinition: published.revision.definition,
  workflowId: published.revision.definition.workflowId,
  workflowTitle: published.revision.definition.name,
}), /position every Step/);

console.log(JSON.stringify({
  exactRevisionRuntimeLock: true,
  installedRegistrySeparated: true,
  projectRegistryReload: true,
  projectionCreatesNoRuntime: true,
  projectionTemplateApplied: true,
  revisionProvenanceProjected: true,
}));
