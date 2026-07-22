import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
import { listSkillEntryPoints, listSkills, skillsForCapability } from '../src/core/skillRegistry';

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

const skills = listSkills();
assert.equal(skills.length, 2);
for (const entrypoint of listSkillEntryPoints()) {
  assert.equal(entrypoint.kind, 'skill');
  if (entrypoint.kind !== 'skill') continue;
  const definition = capabilityDefinitionFor(entrypoint.capabilityId);
  assert.equal(skillsForCapability(definition.capabilityId).some((skill) => skill.skillId === entrypoint.skillId), true);
}

console.log(JSON.stringify({
  ok: true,
  skillCards: skills.length,
  typedEntryPoints: listSkillEntryPoints().length,
  genericTextEntryHidden: true,
}));
