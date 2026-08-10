import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { resolvedSkillUiDefinitionFor } from '../src/core/skillRegistry';
import { compatibleSkillsForWorkflowStep } from '../src/core/workflowAuthoringGraph';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import {
  configureProjectWorkflowRegistry,
  upsertProjectWorkflowDefinition,
  workflowDefinitionFor,
} from '../src/core/workflowRegistry';
import {
  createWorkflowRunForGroup,
  workflowRunViewForId,
} from '../src/core/workflowRuntime';
import {
  bootstrapDeclarativePackages,
  defaultBootstrapProfilePath,
} from './declarative-package-bootstrap-service';
import { retakeRoot } from './local-store/context';
import {
  createBlankSnapshot,
  loadSnapshot,
  resetWorkspace,
  saveSnapshot,
} from './local-store/snapshot-store';
import {
  forkProjectWorkflowDraft,
  publishProjectWorkflowDraft,
  saveProjectWorkflowDraft,
} from './local-store/workflow-authoring-store';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-workflow-authoring-ip-design-closure-v0')) {
  throw new Error('Workflow Authoring IP Design closure test requires a disposable workspace.');
}

await rm(retakeRoot, { force: true, recursive: true });
await bootstrapDeclarativePackages({
  activateRuntime: true,
  hostVersion: '0.1.4',
  profilePath: defaultBootstrapProfilePath,
  workspaceRoot: retakeRoot,
});
const sourceBoard = await resetWorkspace();
const projectId = sourceBoard.project.projectId;
const forked = await forkProjectWorkflowDraft({
  projectId,
  source: { kind: 'installed', workflowId: 'retake.workflow.ip-character-design' },
});

const editedDefinition = structuredClone(forked.draft.definition);
const conceptStep = editedDefinition.steps.find(
  (step) => step.stepId === 'generate_concept_directions',
);
assert.ok(conceptStep);
const replacementSkill = compatibleSkillsForWorkflowStep(conceptStep).find(
  (skill) => skill.skillId === 'retake.image.ip-character-sheet',
);
assert.ok(replacementSkill, 'IP Design must expose a compatible replacement Skill for authoring acceptance.');
conceptStep.skillLock = {
  definitionHash: replacementSkill.definitionHash,
  skillId: replacementSkill.skillId,
  version: replacementSkill.version,
};
editedDefinition.name = 'Courier Cat IP System';

const saved = await saveProjectWorkflowDraft({
  definition: editedDefinition,
  draftId: forked.draft.draftId,
  expectedRecordVersion: forked.draft.recordVersion,
  projectId,
  projectionTemplate: forked.draft.projectionTemplate,
});
assert.equal(saved.draft.validation.valid, true);
const published = await publishProjectWorkflowDraft({
  draftId: saved.draft.draftId,
  expectedRecordVersion: saved.draft.recordVersion,
  projectId,
});
assert.equal(
  published.revision.definition.steps.find(
    (step) => step.stepId === conceptStep.stepId,
  )?.skillLock.skillId,
  replacementSkill.skillId,
);

const targetBoard = createBlankSnapshot({
  boardId: 'board_ip_authoring_target',
  boardName: '[TEST] IP Authoring target',
  now: '2026-08-03T14:00:00.000Z',
  project: sourceBoard.project,
  projectId,
  projectName: sourceBoard.project.name,
});
upsertProjectWorkflowDefinition(projectId, published.revision.definition);
const projection = projectWorkflowDraft(targetBoard, {
  composerInput: {
    instruction: {
      body: 'Design an orange courier cat for a city cycling brand.',
      slotId: 'creative_brief',
    },
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
assert.equal(targetBoard.workflowRuns?.length, 0, 'Projection must not create a WorkflowRun.');
assert.equal(targetBoard.agentRuns?.length, 0, 'Projection must not create an AgentRun.');

const run = createWorkflowRunForGroup(targetBoard, projection.groupBlock.blockId);
assert.equal(run.record.sourceWorkflowRevisionId, published.revision.revisionId);
assert.equal(run.record.workflowDefinitionLock.definitionHash, published.revision.definition.definitionHash);
assert.equal(
  run.steps.find((step) => step.record.stepId === conceptStep.stepId)?.record.skillLock.skillId,
  replacementSkill.skillId,
  'The explicit Run must freeze the edited Project Revision Skill lock.',
);
await saveSnapshot(targetBoard);

configureProjectWorkflowRegistry(projectId, []);
const restored = await loadSnapshot(projectId, targetBoard.board.boardId);
const restoredRun = workflowRunViewForId(restored, run.record.workflowRunId);
assert.ok(restoredRun);
assert.equal(restoredRun.record.workflowDefinitionLock.definitionHash, published.revision.definition.definitionHash);
assert.equal(
  restoredRun.steps.find((step) => step.record.stepId === conceptStep.stepId)?.record.skillLock.skillId,
  replacementSkill.skillId,
  'Historical Run facts must survive without the current Project registry.',
);

configureProjectWorkflowRegistry('project_other', []);
assert.throws(
  () => workflowDefinitionFor(published.revision.definition.workflowId),
  /not found/,
  'A Project Revision must not leak into another Project registry.',
);
configureProjectWorkflowRegistry(projectId, [published.revision.definition]);
assert.equal(
  workflowDefinitionFor(published.revision.definition.workflowId).definitionHash,
  published.revision.definition.definitionHash,
);

console.log(JSON.stringify({
  explicitRunAfterProjection: true,
  historicalLocksSurviveRegistryRemoval: true,
  packageForked: true,
  projectRegistryIsolated: true,
  publishedRevisionProjectedToNewBoard: true,
  refreshRecovered: true,
  skillReplaced: replacementSkill.skillId,
}));
