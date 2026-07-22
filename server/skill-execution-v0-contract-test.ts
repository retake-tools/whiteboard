import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
import {
  listRecommendedSkills,
  listSkillEntryPoints,
  listSkills,
  skillsForCapability,
} from '../src/core/skillRegistry';

const [toolbarSource, operationControlsSource, textOperationsSource] = await Promise.all([
  readFile(new URL('../src/components/FloatingToolbar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/nodes/OperationInlineControls.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/core/textOperations.ts', import.meta.url), 'utf8'),
]);

assert.equal(toolbarSource.includes("label={t('toolbar.generateText')}"), false, 'Generic text generation must not remain user-facing.');
assert.match(toolbarSource, /className="skill-dock"/);
assert.match(toolbarSource, /className="skill-library-search"/);
assert.match(toolbarSource, /useDismissiblePopover/);
assert.match(toolbarSource, /aria-expanded=\{skillLibraryOpen\}/);
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

console.log(JSON.stringify({
  ok: true,
  skillCards: skills.length,
  recommendedSkillCards: listRecommendedSkills().length,
  typedEntryPoints: listSkillEntryPoints().length,
  genericTextEntryHidden: true,
}));
