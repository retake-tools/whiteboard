import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { listAuthorableCapabilityDefinitions } from '../src/core/capabilityRegistry';
import { resolvedSkillUiDefinitionFor, skillsForCapability } from '../src/core/skillRegistry';
import { projectWorkflowDraft } from '../src/core/workflowDraftProjection';
import {
  addWorkflowAuthoringStep,
  removeWorkflowAuthoringStep,
  workflowStepRemovalIssues,
} from '../src/core/workflowAuthoringGraph';
import { workflowDefinitionFor } from '../src/core/workflowRegistry';
import { createWorkflowRunForGroup } from '../src/core/workflowRuntime';
import {
  bootstrapDeclarativePackages,
  defaultBootstrapProfilePath,
} from './declarative-package-bootstrap-service';
import { retakeRoot } from './local-store/context';
import { resetWorkspace, saveSnapshot } from './local-store/snapshot-store';
import {
  captureWorkflowSelection,
  workflowSelectionCaptureProposal,
} from './workflow-selection-capture-service';

const workspaceDirectory = process.env.RETAKE_WORKSPACE_DIR;
if (!workspaceDirectory?.includes('.retake-test-workflow-authoring-selection-v0')) {
  throw new Error('Workflow Authoring Selection V0 test requires a disposable RETAKE_WORKSPACE_DIR.');
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
const workflow = workflowDefinitionFor('retake.workflow.ip-character-design');
const projection = projectWorkflowDraft(snapshot, {
  composerInput: {
    instruction: { body: 'Design an orange courier cat for a cycling brand.', slotId: 'creative_brief' },
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
  workflowId: workflow.workflowId,
  workflowTitle: workflow.name,
});
createWorkflowRunForGroup(snapshot, projection.groupBlock.blockId);
await saveSnapshot(snapshot);

const scope = {
  blockIds: projection.operationBlockIds,
  boardId: snapshot.board.boardId,
  projectId: snapshot.project.projectId,
};
const proposal = await workflowSelectionCaptureProposal(scope);
assert.equal(proposal.valid, true, proposal.issues.join('\n'));
assert.equal(proposal.definition?.definitionHash, workflow.definitionHash);
assert.equal(proposal.sourceWorkflowRunId, snapshot.workflowRuns?.[0]?.workflowRunId);

const partial = await workflowSelectionCaptureProposal({
  ...scope,
  blockIds: projection.operationBlockIds.slice(0, 1),
});
assert.equal(partial.valid, false);
assert.match(partial.issues.join('\n'), /dependency-complete/);
const mixed = await workflowSelectionCaptureProposal({
  ...scope,
  blockIds: [...projection.operationBlockIds, projection.resultBlockIds[0]!],
});
assert.equal(mixed.valid, false);
assert.match(mixed.issues.join('\n'), /not an Operation/);

const captured = await captureWorkflowSelection({
  ...scope,
  expectedFingerprint: proposal.fingerprint,
});
assert.equal(captured.draft.source.kind, 'board_selection');
assert.equal(captured.draft.definition.steps.length, workflow.steps.length);
assert.notEqual(captured.draft.definition.workflowId, workflow.workflowId);
if (captured.draft.source.kind !== 'board_selection') throw new Error('Selection source was not stored.');
assert.equal(captured.draft.source.workflowLock.definitionHash, workflow.definitionHash);

const staleProposal = await workflowSelectionCaptureProposal(scope);
const changed = structuredClone(snapshot);
const typedEdge = changed.edges.find((edge) => edge.kind === 'execution_input');
assert.ok(typedEdge);
typedEdge.inputSlotId = 'changed_after_preview';
await saveSnapshot(changed);
const incompatible = await workflowSelectionCaptureProposal(scope);
assert.equal(incompatible.valid, false);
assert.match(incompatible.issues.join('\n'), /unknown Slot/);
await assert.rejects(captureWorkflowSelection({
  ...scope,
  expectedFingerprint: staleProposal.fingerprint,
}), /changed after preview/);

const imageCapability = listAuthorableCapabilityDefinitions().find(
  (capability) => capability.capabilityId === 'image.generate',
);
const imageSkill = skillsForCapability('image.generate')[0];
assert.ok(imageCapability && imageSkill);
const added = addWorkflowAuthoringStep({
  capability: imageCapability,
  definition: workflow,
  skill: imageSkill,
  stageId: workflow.stages?.[0]?.stageId ?? workflow.steps[0]!.stageId,
  stepId: 'image_generate_99',
});
assert.equal(added.steps.length, workflow.steps.length + 1);
assert.equal(added.steps.at(-1)?.capabilityLock.definitionHash, imageCapability.definitionHash);
assert.deepEqual(workflowStepRemovalIssues(added, 'image_generate_99'), []);
assert.equal(removeWorkflowAuthoringStep(added, 'image_generate_99').steps.length, workflow.steps.length);
assert.match(workflowStepRemovalIssues(workflow, workflow.steps[0]!.stepId).join('\n'), /depends on|Workflow output/);
assert.throws(
  () => removeWorkflowAuthoringStep(workflow, workflow.steps[0]!.stepId),
  /depends on|Workflow output/,
);

console.log(JSON.stringify({
  addRemoveStepSafe: true,
  exactRunLocksRequired: true,
  nonOperationRejected: true,
  partialSelectionRejected: true,
  proposalConfirmFingerprint: true,
  selectionDraftCreated: true,
  typedEdgesRequired: true,
}));
