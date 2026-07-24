import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { capabilityDefinitionFor } from '../src/core/capabilityRegistry';
import {
  listSkills,
  skillsForCapability,
} from '../src/core/skillRegistry';
import { listPackageEntryPoints, listRecommendedPackageEntryPoints } from '../src/core/packageRegistry';
import { listWorkflows } from '../src/core/workflowRegistry';
import { shouldShowSkillDock } from '../src/core/releaseFeatures';

const [toolbarSource, composerSource, operationControlsSource, textOperationsSource] = await Promise.all([
  readFile(new URL('../src/components/FloatingToolbar.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/SkillQuickInputComposer.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/nodes/OperationInlineControls.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/core/textOperations.ts', import.meta.url), 'utf8'),
]);

assert.equal(toolbarSource.includes("label={t('toolbar.generateText')}"), false, 'Generic text generation must not remain user-facing.');
assert.match(toolbarSource, /SkillQuickInputComposer/);
assert.match(composerSource, /className=\{`skill-composer/);
assert.match(composerSource, /skill-composer-picker-search/);
assert.match(composerSource, /useDismissiblePopover/);
assert.match(toolbarSource, /onInvokeEntryPoint/);
assert.match(composerSource, /workflowUiDefinitionFor/);
assert.match(composerSource, /aria-expanded=\{picker\?\.mode === 'entrypoint'\}/);
assert.equal(shouldShowSkillDock({ DEV: true }), true, 'Development builds should expose Skill discovery.');
assert.equal(shouldShowSkillDock({ DEV: false }), true, 'The develop branch should keep Skill discovery enabled for integrated testing.');
assert.match(operationControlsSource, /skillsForCapability\(capabilityId\)/);
assert.match(operationControlsSource, /retake:update-operation-skill/);
assert.match(textOperationsSource, /createDraftSkillOperation/);
assert.match(textOperationsSource, /selectedBlockIds/);
assert.match(textOperationsSource, /textDocumentInputBindings/);
assert.equal(textOperationsSource.includes('screenplayInputBindings'), false);

const skills = listSkills();
assert.equal(skills.length, 8);
assert.deepEqual(listRecommendedPackageEntryPoints().map(({ entrypoint }) => entrypoint.entrypointId), [
  'skill:retake.screenplay.from-brief',
  'skill:retake.screenplay.normalize',
  'skill:retake.storyboard-sheet.from-unit-plan',
  'skill:retake.video-generation-package.from-approved-storyboard',
  'workflow:retake.workflow.approved-generation-package-to-video',
]);
const packageEntryPoints = listPackageEntryPoints().map(({ entrypoint }) => entrypoint);
for (const entrypoint of packageEntryPoints.filter((candidate) => candidate.kind === 'skill')) {
  assert.equal(entrypoint.kind, 'skill');
  if (entrypoint.kind !== 'skill') continue;
  const definition = capabilityDefinitionFor(entrypoint.ref.capabilityId);
  assert.equal(skillsForCapability(definition.capabilityId).some((skill) => skill.skillId === entrypoint.ref.skillId), true);
}
assert.equal(listWorkflows().length, 4);
assert.deepEqual(
  packageEntryPoints.filter((entrypoint) => entrypoint.kind === 'workflow').map((entrypoint) => entrypoint.kind),
  ['workflow', 'workflow', 'workflow', 'workflow'],
);

console.log(JSON.stringify({
  ok: true,
  skillCards: skills.length,
  recommendedSkillCards: listRecommendedPackageEntryPoints().length,
  typedEntryPoints: packageEntryPoints.filter((entrypoint) => entrypoint.kind === 'skill').length,
  typedWorkflowEntryPoints: packageEntryPoints.filter((entrypoint) => entrypoint.kind === 'workflow').length,
  genericTextEntryHidden: true,
  developSkillDockEnabled: true,
}));
