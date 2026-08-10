import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import {
  canonicalWorkflowDefinition,
  resolveWorkflowDefinitionV1,
} from '../src/core/workflowAuthoringContracts';
import {
  addWorkflowAuthoringProjectionPosition,
  addWorkflowAuthoringStepAtContext,
  compatibleSkillsForWorkflowStep,
  workflowAuthoringChecklistFor,
  workflowAuthoringGraphFor,
  workflowBindingCandidates,
} from '../src/core/workflowAuthoringGraph';
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
import { listSkills } from '../src/core/skillRegistry';
import { listWorkflows } from '../src/core/workflowRegistry';
import {
  bootstrapDeclarativePackages,
  defaultBootstrapProfilePath,
} from './declarative-package-bootstrap-service';
import { retakeRoot } from './local-store/context';
import { resetWorkspace } from './local-store/snapshot-store';
import {
  WorkflowAuthoringConflictError,
  WorkflowAuthoringValidationError,
  archiveProjectWorkflowRevision,
  forkProjectWorkflowDraft,
  publishProjectWorkflowDraft,
  readProjectWorkflowAuthoring,
  saveProjectWorkflowDraft,
} from './local-store/workflow-authoring-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-workflow-authoring-v0')) {
  throw new Error('Workflow Authoring V0 test requires a disposable RETAKE_WORKSPACE_DIR.');
}

await rm(retakeRoot, { force: true, recursive: true });
await bootstrapDeclarativePackages({
  activateRuntime: true,
  hostVersion: '0.1.4',
  profilePath: defaultBootstrapProfilePath,
  workspaceRoot: retakeRoot,
});
const board = await resetWorkspace();
const projectId = board.project.projectId;
const installedWorkflowId = 'retake.workflow.ip-character-design';
const installedDefinition = listWorkflows().find(
  (candidate) => candidate.workflowId === installedWorkflowId,
);
assert.ok(installedDefinition);

const empty = await readProjectWorkflowAuthoring(projectId);
assert.deepEqual(empty.drafts, []);
assert.deepEqual(empty.revisions, []);

const forked = await forkProjectWorkflowDraft({
  projectId,
  source: { kind: 'installed', workflowId: installedWorkflowId },
});
assert.notEqual(forked.draft.definition.workflowId, installedWorkflowId);
assert.match(forked.draft.definition.workflowId, /^project\./);
assert.equal(forked.draft.source.kind, 'package');
assert.equal(forked.draft.validation.valid, true);
assert.equal(
  forked.draft.projectionTemplate.positions.length,
  forked.draft.definition.steps.length,
);
const authoringGraph = workflowAuthoringGraphFor({
  definition: forked.draft.definition,
  projectionTemplate: forked.draft.projectionTemplate,
});
assert.equal(authoringGraph.nodes.length, 4);
assert.equal(authoringGraph.edges.length, 3);
const authoringChecklist = workflowAuthoringChecklistFor(forked.draft.definition, [
  'Required Workflow step input is not bound: generate_character_sheet.prompt',
  `Workflow must be an acyclic graph: ${forked.draft.definition.workflowId}`,
]);
assert.deepEqual(authoringChecklist, [{
  issue: 'Required Workflow step input is not bound: generate_character_sheet.prompt',
  scope: 'step',
  stepId: 'generate_character_sheet',
}, {
  issue: `Workflow must be an acyclic graph: ${forked.draft.definition.workflowId}`,
  scope: 'workflow',
}]);
const insertionEdge = authoringGraph.edges[0];
assert.ok(insertionEdge);
const insertedCapability = capabilityDefinitionFor('image.generate');
const insertedSkill = listSkills().find((skill) => skill.capabilityBindings.some(
  (binding) => binding.capabilityId === insertedCapability.capabilityId,
));
assert.ok(insertedSkill);
const beforeContextInsertion = JSON.stringify(forked.draft.definition);
const insertedStepId = 'inserted_image_step';
const insertedDefinition = addWorkflowAuthoringStepAtContext({
  capability: insertedCapability,
  context: {
    kind: 'insert_edge',
    sourceStepId: insertionEdge.sourceStepId,
    targetStepId: insertionEdge.targetStepId,
  },
  definition: forked.draft.definition,
  skill: insertedSkill,
  stageId: forked.draft.definition.steps[0]!.stageId,
  stepId: insertedStepId,
});
assert.equal(
  JSON.stringify(forked.draft.definition),
  beforeContextInsertion,
  'Context insertion must not mutate the source Definition.',
);
assert.deepEqual(
  insertedDefinition.steps.find((step) => step.stepId === insertedStepId)?.dependsOn,
  [insertionEdge.sourceStepId],
);
const insertedTarget = insertedDefinition.steps.find(
  (step) => step.stepId === insertionEdge.targetStepId,
);
assert.ok(insertedTarget?.dependsOn.includes(insertedStepId));
assert.ok(!insertedTarget?.dependsOn.includes(insertionEdge.sourceStepId));
assert.deepEqual(
  insertedTarget?.inputBindings,
  forked.draft.definition.steps.find(
    (step) => step.stepId === insertionEdge.targetStepId,
  )?.inputBindings,
  'Edge insertion must not guess or rewrite typed bindings.',
);
const insertedProjection = addWorkflowAuthoringProjectionPosition({
  context: {
    kind: 'insert_edge',
    sourceStepId: insertionEdge.sourceStepId,
    targetStepId: insertionEdge.targetStepId,
  },
  projectionTemplate: forked.draft.projectionTemplate,
  stepId: insertedStepId,
});
const oldTargetPosition = forked.draft.projectionTemplate.positions.find(
  (position) => position.stepId === insertionEdge.targetStepId,
);
const newStepPosition = insertedProjection.positions.find(
  (position) => position.stepId === insertedStepId,
);
const shiftedTargetPosition = insertedProjection.positions.find(
  (position) => position.stepId === insertionEdge.targetStepId,
);
assert.ok(oldTargetPosition && newStepPosition && shiftedTargetPosition);
assert.equal(newStepPosition.x, oldTargetPosition.x);
assert.equal(newStepPosition.y, oldTargetPosition.y);
assert.equal(shiftedTargetPosition.x, oldTargetPosition.x + 340);

const afterStepId = 'after_source_step';
const afterDefinition = addWorkflowAuthoringStepAtContext({
  capability: insertedCapability,
  context: { kind: 'after_step', sourceStepId: insertionEdge.sourceStepId },
  definition: forked.draft.definition,
  skill: insertedSkill,
  stageId: forked.draft.definition.steps[0]!.stageId,
  stepId: afterStepId,
});
assert.deepEqual(
  afterDefinition.steps.find((step) => step.stepId === afterStepId)?.dependsOn,
  [insertionEdge.sourceStepId],
);
assert.deepEqual(
  afterDefinition.steps.find((step) => step.stepId === insertionEdge.targetStepId)?.dependsOn,
  forked.draft.definition.steps.find(
    (step) => step.stepId === insertionEdge.targetStepId,
  )?.dependsOn,
  'Add-after must not rewrite existing dependencies.',
);
const firstDefinition = addWorkflowAuthoringStepAtContext({
  capability: insertedCapability,
  context: { kind: 'first' },
  definition: { ...forked.draft.definition, steps: [] },
  skill: insertedSkill,
  stageId: forked.draft.definition.steps[0]!.stageId,
  stepId: 'first_step',
});
assert.deepEqual(firstDefinition.steps[0]?.dependsOn, []);
assert.throws(() => addWorkflowAuthoringStepAtContext({
  capability: insertedCapability,
  context: { kind: 'first' },
  definition: forked.draft.definition,
  skill: insertedSkill,
  stageId: forked.draft.definition.steps[0]!.stageId,
  stepId: 'invalid_first_step',
}), /only available for an empty Workflow Draft/);
const characterSheetStep = forked.draft.definition.steps.find(
  (step) => step.stepId === 'generate_character_sheet',
);
assert.ok(characterSheetStep);
assert.ok(compatibleSkillsForWorkflowStep(characterSheetStep).some(
  (skill) => skill.skillId === characterSheetStep.skillLock.skillId,
));
const sourceImageCandidates = workflowBindingCandidates({
  definition: forked.draft.definition,
  inputSlotId: 'source_image',
  stepId: characterSheetStep.stepId,
});
assert.ok(sourceImageCandidates.some((candidate) => (
  candidate.source.kind === 'step_output'
  && candidate.source.stepId === 'generate_concept_directions'
  && candidate.source.outputSlotId === 'images'
)));
const promptCandidates = workflowBindingCandidates({
  definition: forked.draft.definition,
  inputSlotId: 'prompt',
  stepId: characterSheetStep.stepId,
});
assert.ok(promptCandidates.some((candidate) => (
  candidate.source.kind === 'step_output'
  && candidate.source.stepId === 'define_character'
  && candidate.source.outputSlotId === 'character_bible'
)));

const renamedDefinition = structuredClone(forked.draft.definition);
renamedDefinition.name = 'Courier Cat Campaign';
const renamedCharacterSheetStep = renamedDefinition.steps.find(
  (step) => step.stepId === 'generate_character_sheet',
);
assert.ok(renamedCharacterSheetStep);
renamedCharacterSheetStep.parameters = {
  aspectRatioPreset: '9:16',
  connectionId: 'studio-image-connection',
  targetResolution: '4K',
  variationCount: 3,
};
const renamed = await saveProjectWorkflowDraft({
  definition: renamedDefinition,
  draftId: forked.draft.draftId,
  expectedRecordVersion: forked.draft.recordVersion,
  projectId,
  projectionTemplate: forked.draft.projectionTemplate,
});
assert.equal(renamed.draft.recordVersion, 2);
assert.equal(renamed.draft.definition.name, 'Courier Cat Campaign');
assert.deepEqual(
  renamed.draft.definition.steps.find(
    (step) => step.stepId === 'generate_character_sheet',
  )?.parameters,
  renamedCharacterSheetStep.parameters,
);
assert.notEqual(
  renamed.draft.definition.definitionHash,
  forked.draft.definition.definitionHash,
);
await assert.rejects(
  saveProjectWorkflowDraft({
    definition: renamedDefinition,
    draftId: forked.draft.draftId,
    expectedRecordVersion: forked.draft.recordVersion,
    projectId,
    projectionTemplate: forked.draft.projectionTemplate,
  }),
  WorkflowAuthoringConflictError,
);

const invalidDefinition = structuredClone(renamed.draft.definition);
invalidDefinition.steps[0]!.dependsOn = [
  invalidDefinition.steps[invalidDefinition.steps.length - 1]!.stepId,
];
const invalidImageStep = invalidDefinition.steps.find(
  (step) => step.stepId === 'generate_character_sheet',
);
assert.ok(invalidImageStep);
invalidImageStep.parameters = {
  aspectRatioPreset: 'invalid-ratio',
  connectionId: '',
  variationCount: 9,
};
const invalid = await saveProjectWorkflowDraft({
  definition: invalidDefinition,
  draftId: renamed.draft.draftId,
  expectedRecordVersion: renamed.draft.recordVersion,
  projectId,
  projectionTemplate: renamed.draft.projectionTemplate,
});
assert.equal(invalid.draft.validation.valid, false);
assert.match(invalid.draft.validation.issues.join('\n'), /acyclic/);
assert.match(invalid.draft.validation.issues.join('\n'), /connectionId is invalid/);
assert.match(invalid.draft.validation.issues.join('\n'), /aspectRatioPreset/);
assert.match(invalid.draft.validation.issues.join('\n'), /variationCount/);
await assert.rejects(
  publishProjectWorkflowDraft({
    draftId: invalid.draft.draftId,
    expectedRecordVersion: invalid.draft.recordVersion,
    projectId,
  }),
  WorkflowAuthoringValidationError,
);

const repairedDefinition = structuredClone(invalid.draft.definition);
repairedDefinition.steps[0]!.dependsOn = [];
const repairedImageStep = repairedDefinition.steps.find(
  (step) => step.stepId === 'generate_character_sheet',
);
assert.ok(repairedImageStep);
repairedImageStep.parameters = structuredClone(renamedCharacterSheetStep.parameters);
const repaired = await saveProjectWorkflowDraft({
  definition: repairedDefinition,
  draftId: invalid.draft.draftId,
  expectedRecordVersion: invalid.draft.recordVersion,
  projectId,
  projectionTemplate: invalid.draft.projectionTemplate,
});
assert.equal(repaired.draft.validation.valid, true);
const published = await publishProjectWorkflowDraft({
  draftId: repaired.draft.draftId,
  expectedRecordVersion: repaired.draft.recordVersion,
  projectId,
});
assert.equal(published.revision.status, 'published');
assert.equal(
  published.revision.definition.definitionHash,
  canonicalWorkflowDefinition(published.revision.definition).definitionHash,
);

published.revision.definition.name = 'mutated client copy';
const restored = await readProjectWorkflowAuthoring(projectId);
assert.equal(restored.revisions[0]?.definition.name, 'Courier Cat Campaign');
assert.deepEqual(
  restored.revisions[0]?.definition.steps.find(
    (step) => step.stepId === 'generate_character_sheet',
  )?.parameters,
  renamedCharacterSheetStep.parameters,
);
const resolved = resolveWorkflowDefinitionV1({
  installedDefinitions: listWorkflows(),
  projectRevisions: restored.revisions,
  workflowId: restored.revisions[0]!.definition.workflowId,
});
assert.equal(resolved?.source.kind, 'project_revision');

const collisionRevision = structuredClone(restored.revisions[0]!);
collisionRevision.definition = structuredClone(installedDefinition);
assert.throws(() => resolveWorkflowDefinitionV1({
  definitionHash: installedDefinition.definitionHash,
  installedDefinitions: [installedDefinition],
  projectRevisions: [collisionRevision],
  version: installedDefinition.version,
  workflowId: installedDefinition.workflowId,
}), /cannot override Installed Workflow/);

const archived = await archiveProjectWorkflowRevision({
  projectId,
  revisionId: restored.revisions[0]!.revisionId,
});
assert.deepEqual(archived.archivedRevisionIds, [restored.revisions[0]!.revisionId]);
assert.equal(resolveWorkflowDefinitionV1({
  archivedRevisionIds: archived.archivedRevisionIds,
  installedDefinitions: listWorkflows(),
  projectRevisions: archived.revisions,
  workflowId: restored.revisions[0]!.definition.workflowId,
}), undefined);

console.log(JSON.stringify({
  atomicProjectStore: true,
  canonicalDefinitionHash: true,
  compatibleSkillSelection: true,
  draftPublishSeparated: true,
  graphProjectionTemplate: true,
  immutablePublishedRevision: true,
  installedWorkflowForkOnly: true,
  optimisticConflictRejected: true,
  projectResolverNoPackageOverride: true,
  publishValidationRequired: true,
  revisionArchiveNonDestructive: true,
  typedBindingCandidates: true,
}));
