import assert from 'node:assert/strict';
import { operationReadinessFor } from '../src/core/capabilities';
import { textDocumentCapabilityIds } from '../src/core/capabilityRegistry';
import type { ExecutionConnectionSummary } from '../src/core/executionProviders';
import { executeExistingTextGenerationOperation, type TextGenerationLabels } from '../src/core/textOperations';
import { listPackageEntryPoints } from '../src/core/packageRegistry';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import {
  listWorkflows,
  storyToStoryboardWorkflow,
  storyboardUnitToSheetWorkflow,
  validateWorkflowDefinition,
  type WorkflowDefinition,
} from '../src/core/workflowRegistry';
import { resetWorkspace } from './local-store/snapshot-store';

const snapshot = await resetWorkspace();
snapshot.blocks = [];
snapshot.edges = [];
snapshot.assets = [];
snapshot.executions = [];

const readyTextConnection: ExecutionConnectionSummary = {
  connectionId: 'test-text-connection',
  connectorId: 'openai-compatible',
  providerLabel: 'Test text provider',
  displayName: 'Test text provider',
  description: 'Workflow projection test connection.',
  connectionKind: 'model_provider',
  implementationKind: 'ai_sdk',
  supportedCapabilityIds: textDocumentCapabilityIds,
  enabledUseCases: ['text'],
  configurable: true,
  deletable: true,
  enabled: true,
  status: 'ready',
  hasCredential: true,
  modelId: 'test-model',
};

assert.deepEqual(listWorkflows().map((workflow) => workflow.workflowId), [
  'retake.workflow.story-to-storyboard',
  'retake.workflow.storyboard-unit-to-sheet',
]);
assert.deepEqual(listPackageEntryPoints()
  .map(({ entrypoint }) => entrypoint)
  .filter((entrypoint) => entrypoint.kind === 'workflow')
  .map((entrypoint) => [entrypoint.kind, entrypoint.entrypointId]), [
  ['workflow', 'workflow:retake.workflow.story-to-storyboard'],
  ['workflow', 'workflow:retake.workflow.storyboard-unit-to-sheet'],
]);
assert.deepEqual(validateWorkflowDefinition(storyboardUnitToSheetWorkflow), []);
assert.deepEqual(storyToStoryboardWorkflow.steps.map((step) => [step.stepId, step.dependsOn]), [
  ['screenplay_generate', []],
  ['character_define', ['screenplay_generate']],
  ['scene_define', ['screenplay_generate']],
  ['storyboard_plan', ['character_define', 'scene_define']],
]);
assert.deepEqual(storyToStoryboardWorkflow.stages?.map((stage) => [
  stage.stageId,
  stage.stageTypeId,
  stage.outputWorkflowSlotIds,
]), [
  ['story_screenplay', 'retake.stage.story_screenplay', ['screenplay']],
  ['production_design', 'retake.stage.production_design', ['character_bible', 'scene_bible']],
  ['storyboard_previsualization', 'retake.stage.storyboard_previsualization', ['storyboard_plan']],
]);
assert.equal(storyToStoryboardWorkflow.gates.length, 0);
assert.equal(storyToStoryboardWorkflow.defaultRunMode, 'manual');
assert.deepEqual(validateWorkflowDefinition(storyToStoryboardWorkflow), []);

const incompatibleWorkflowInput = structuredClone(storyToStoryboardWorkflow) as WorkflowDefinition;
incompatibleWorkflowInput.inputSlots[0].artifactTypes = ['reference'];
assert.match(validateWorkflowDefinition(incompatibleWorkflowInput).join('\n'), /Workflow input artifact type mismatch/);
const missingDependency = structuredClone(storyToStoryboardWorkflow) as WorkflowDefinition;
missingDependency.steps.find((step) => step.stepId === 'character_define')!.dependsOn = [];
assert.match(validateWorkflowDefinition(missingDependency).join('\n'), /Workflow binding source is not a dependency/);
const invalidGate = structuredClone(storyToStoryboardWorkflow) as WorkflowDefinition;
invalidGate.gates.push({
  definitionHash: 'invalid',
  gateId: 'screenplay_approval',
  kind: 'human_approval',
  required: true,
  subject: { kind: 'step_output', stepId: 'missing_step', outputSlotId: 'missing_output' },
});
assert.match(validateWorkflowDefinition(invalidGate).join('\n'), /definitionHash is invalid/);
assert.match(validateWorkflowDefinition(invalidGate).join('\n'), /subject Step is missing/);
const invalidGateOutput = structuredClone(storyToStoryboardWorkflow) as WorkflowDefinition;
invalidGateOutput.gates.push({
  definitionHash: 'sha256:test-invalid-gate-output',
  gateId: 'screenplay_approval',
  kind: 'human_approval',
  required: true,
  subject: { kind: 'step_output', stepId: 'screenplay_generate', outputSlotId: 'missing_output' },
});
assert.match(validateWorkflowDefinition(invalidGateOutput).join('\n'), /subject output is missing/);
const unknownStage = structuredClone(storyToStoryboardWorkflow) as WorkflowDefinition;
unknownStage.steps[0].stageId = 'missing_stage';
assert.match(validateWorkflowDefinition(unknownStage).join('\n'), /references unknown Stage/);
const optionalDependency = structuredClone(storyToStoryboardWorkflow) as WorkflowDefinition;
optionalDependency.steps.find((step) => step.stepId === 'screenplay_generate')!.optional = true;
assert.match(validateWorkflowDefinition(optionalDependency).join('\n'), /depends on optional Step/);
assert.match(validateWorkflowDefinition(optionalDependency).join('\n'), /requires at least one required Step/);
const crossStageCycle = structuredClone(storyToStoryboardWorkflow) as WorkflowDefinition;
crossStageCycle.steps.find((step) => step.stepId === 'storyboard_plan')!.stageId = 'story_screenplay';
assert.match(validateWorkflowDefinition(crossStageCycle).join('\n'), /Stage graph must be acyclic/);
const crossStageOutput = structuredClone(storyToStoryboardWorkflow) as WorkflowDefinition;
crossStageOutput.stages![0].outputWorkflowSlotIds = ['character_bible'];
assert.match(validateWorkflowDefinition(crossStageOutput).join('\n'), /output producer belongs to another Stage/);
const duplicateStageOutput = structuredClone(storyToStoryboardWorkflow) as WorkflowDefinition;
duplicateStageOutput.stages![1].outputWorkflowSlotIds.push('screenplay');
assert.match(validateWorkflowDefinition(duplicateStageOutput).join('\n'), /output is declared more than once/);

const firstProjection = projectWorkflowDraft(snapshot, {
  workflowId: storyToStoryboardWorkflow.workflowId,
  workflowTitle: 'Story to storyboard plan',
  outputPlaceholder: 'Run the upstream operation.',
  labelsForSkill,
  connectionIdForCapability: () => 'test-text-connection',
});

assert.equal(firstProjection.operationBlockIds.length, 4);
assert.equal(firstProjection.resultBlockIds.length, 4);
assert.equal(firstProjection.workflowInputBlockIds.length, 1);
assert.equal(firstProjection.blockIds.length, 10, 'Group + one workflow input + four operations + four results.');
assert.equal(firstProjection.groupBlock.data.groupKind, 'workflow');
assert.equal(firstProjection.groupBlock.data.workflowDefinitionId, storyToStoryboardWorkflow.workflowId);
assert.equal(firstProjection.groupBlock.data.workflowProjectionId, firstProjection.projectionId);
assert.equal(snapshot.executions.length, 0, 'Draft Projection must not create WorkflowRun, StepRun, or Execution state.');

const firstProjectionBlocks = snapshot.blocks.filter(
  (block) => block.data.workflowProjectionId === firstProjection.projectionId,
);
assert.equal(firstProjectionBlocks.length, 10);
assert.equal(
  firstProjectionBlocks.filter((block) => block.blockId !== firstProjection.groupBlock.blockId)
    .every((block) => block.parentGroupId === firstProjection.groupBlock.blockId),
  true,
);
assert.deepEqual(
  firstProjection.operationBlockIds.map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId)?.data.workflowStepId),
  ['screenplay_generate', 'character_define', 'scene_define', 'storyboard_plan'],
);
assert.deepEqual(
  firstProjection.resultBlockIds.map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId)?.data.documentKind),
  ['screenplay_master', 'character_bible', 'scene_bible', 'storyboard_plan'],
);
assert.deepEqual(
  firstProjection.resultBlockIds.map((blockId) => snapshot.blocks.find((block) => block.blockId === blockId)?.data.managedDocumentResult),
  [true, true, true, true],
);

const operationsByStep = new Map(firstProjection.operationBlockIds.map((blockId) => {
  const block = snapshot.blocks.find((candidate) => candidate.blockId === blockId);
  assert.ok(block);
  return [block.data.workflowStepId, block] as const;
}));
const screenplayOperation = operationsByStep.get('screenplay_generate');
const characterOperation = operationsByStep.get('character_define');
const sceneOperation = operationsByStep.get('scene_define');
const storyboardOperation = operationsByStep.get('storyboard_plan');
assert.ok(screenplayOperation);
assert.ok(characterOperation);
assert.ok(sceneOperation);
assert.ok(storyboardOperation);
assert.equal(operationReadinessFor(snapshot, screenplayOperation).canRun, false);
assert.equal(operationReadinessFor(snapshot, characterOperation).canRun, false);
assert.equal(operationReadinessFor(snapshot, sceneOperation).canRun, false);
assert.equal(operationReadinessFor(snapshot, storyboardOperation).canRun, false);
assert.deepEqual(
  snapshot.edges
    .filter((edge) => edge.targetBlockId === storyboardOperation.blockId && edge.kind === 'execution_input')
    .map((edge) => edge.inputSlotId),
  ['screenplay', 'character_bible', 'scene_bible'],
);

const briefBlock = snapshot.blocks.find((block) => block.blockId === firstProjection.workflowInputBlockIds[0]);
assert.ok(briefBlock);
briefBlock.data.body = 'A cat director must finish the film before sunrise.';
assert.equal(operationReadinessFor(snapshot, screenplayOperation).canRun, true);
const screenplayResultId = firstProjection.resultBlockIds[0];
const screenplayExecution = executeExistingTextGenerationOperation(snapshot, {
  connection: readyTextConnection,
  labels: labelsForSkill('retake.screenplay.from-brief'),
  operationBlockId: screenplayOperation.blockId,
});
assert.equal(
  screenplayExecution.resultBlock.blockId,
  screenplayResultId,
  'Manual execution must reuse the Workflow-projected Document result instead of creating a duplicate.',
);

const secondProjection = projectWorkflowDraft(snapshot, {
  workflowId: storyToStoryboardWorkflow.workflowId,
  workflowTitle: 'Story to storyboard plan',
  outputPlaceholder: 'Run the upstream operation.',
  labelsForSkill,
  connectionIdForCapability: () => 'test-text-connection',
});
assert.notEqual(secondProjection.projectionId, firstProjection.projectionId);
for (const edge of snapshot.edges) {
  const source = snapshot.blocks.find((block) => block.blockId === edge.sourceBlockId);
  const target = snapshot.blocks.find((block) => block.blockId === edge.targetBlockId);
  if (!source?.data.workflowProjectionId || !target?.data.workflowProjectionId) continue;
  assert.equal(
    source.data.workflowProjectionId,
    target.data.workflowProjectionId,
    'Repeated projection must create an independent draft without cross-wiring prior drafts.',
  );
}

console.log(JSON.stringify({
  ok: true,
  workflowDefinitions: listWorkflows().length,
  typedWorkflowEntryPoints: listPackageEntryPoints().filter(({ entrypoint }) => entrypoint.kind === 'workflow').length,
  projectedOperations: firstProjection.operationBlockIds.length,
  projectedDocuments: firstProjection.resultBlockIds.length,
  reusableResultSlot: true,
  repeatedProjectionCreatesIndependentDraft: true,
}));

function labelsForSkill(skillId: string): TextGenerationLabels {
  const labels: Record<string, TextGenerationLabels> = {
    'retake.screenplay.from-brief': {
      operationTitle: 'Generate screenplay',
      promptPlaceholder: 'Describe the creative brief.',
      promptTitle: 'Creative brief',
      resultTitle: 'Screenplay',
      waitingBody: 'Waiting.',
    },
    'retake.character-bible.from-screenplay': {
      operationTitle: 'Define characters',
      promptPlaceholder: 'Connect the screenplay.',
      promptTitle: 'Screenplay',
      resultTitle: 'Character Bible',
      waitingBody: 'Waiting.',
    },
    'retake.scene-bible.from-screenplay': {
      operationTitle: 'Define scenes',
      promptPlaceholder: 'Connect the screenplay.',
      promptTitle: 'Screenplay',
      resultTitle: 'Scene Bible',
      waitingBody: 'Waiting.',
    },
    'retake.storyboard-plan.from-production-design': {
      operationTitle: 'Generate storyboard plan',
      promptPlaceholder: 'Connect the required documents.',
      promptTitle: 'Screenplay',
      resultTitle: 'Storyboard Plan',
      waitingBody: 'Waiting.',
      inputSlots: [
        { slotId: 'screenplay', promptTitle: 'Screenplay', promptPlaceholder: 'Connect the screenplay.' },
        { slotId: 'character_bible', promptTitle: 'Character Bible', promptPlaceholder: 'Connect the Character Bible.' },
        { slotId: 'scene_bible', promptTitle: 'Scene Bible', promptPlaceholder: 'Connect the Scene Bible.' },
      ],
    },
  };
  const label = labels[skillId];
  if (!label) throw new Error(`Missing test labels for Skill: ${skillId}`);
  return label;
}
