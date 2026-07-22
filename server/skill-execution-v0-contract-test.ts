import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
import {
  listRecommendedSkills,
  listSkillEntryPoints,
  listSkills,
  skillsForCapability,
} from '../src/core/skillRegistry';
import { listWorkflowEntryPoints, listWorkflows } from '../src/core/workflowRegistry';
import { shouldShowSkillDock } from '../src/core/releaseFeatures';

const [toolbarSource, operationControlsSource, textOperationsSource] = await Promise.all([
  readFile(new URL('../src/components/FloatingToolbar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/nodes/OperationInlineControls.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/core/textOperations.ts', import.meta.url), 'utf8'),
]);

assert.equal(toolbarSource.includes("label={t('toolbar.generateText')}"), false, 'Generic text generation must not remain user-facing.');
assert.match(toolbarSource, /className="skill-dock"/);
assert.match(toolbarSource, /className="skill-library-search"/);
assert.match(toolbarSource, /useDismissiblePopover/);
assert.match(toolbarSource, /onCreateWorkflow/);
assert.match(toolbarSource, /workflowUiDefinitionFor/);
assert.match(toolbarSource, /aria-expanded=\{skillLibraryOpen\}/);
assert.equal(shouldShowSkillDock({ DEV: true }), true, 'Development builds should expose Skill discovery.');
assert.equal(shouldShowSkillDock({ DEV: false }), false, 'Production builds must hide the unstable Skill dock.');
assert.match(operationControlsSource, /skillsForCapability\(capabilityId\)/);
assert.match(operationControlsSource, /retake:update-operation-skill/);
assert.match(textOperationsSource, /createDraftSkillOperation/);
assert.match(textOperationsSource, /selectedBlockIds/);
assert.match(textOperationsSource, /textDocumentInputBindings/);
assert.equal(textOperationsSource.includes('screenplayInputBindings'), false);

const skills = listSkills();
assert.equal(skills.length, 5);
assert.deepEqual(listRecommendedSkills().map((skill) => skill.skillId), [
  'retake.screenplay.from-brief',
  'retake.screenplay.normalize',
]);
for (const entrypoint of listSkillEntryPoints()) {
  assert.equal(entrypoint.kind, 'skill');
  if (entrypoint.kind !== 'skill') continue;
  const definition = capabilityDefinitionFor(entrypoint.capabilityId);
  assert.equal(skillsForCapability(definition.capabilityId).some((skill) => skill.skillId === entrypoint.skillId), true);
}
assert.equal(listWorkflows().length, 1);
assert.deepEqual(listWorkflowEntryPoints().map((entrypoint) => entrypoint.kind), ['workflow']);

console.log(JSON.stringify({
  ok: true,
  skillCards: skills.length,
  recommendedSkillCards: listRecommendedSkills().length,
  typedEntryPoints: listSkillEntryPoints().length,
  typedWorkflowEntryPoints: listWorkflowEntryPoints().length,
  genericTextEntryHidden: true,
  productionSkillDockHidden: true,
}));
